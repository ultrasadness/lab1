// Pi runs (ADR 0001): one `pi --mode rpc` process per run, started through a fixed command (in production the
// Pi container's helper). Before it starts, the bot reads the run's Rules from the Personal database's last commit
// (ADR 0002): the all scope's and its own scope's, which our extension asks the forwarder for. The bot sends the run's
// one prompt and waits until Pi settles. The run's records come in through the forwarder as the run goes, each Rule
// they name checked against the run's own; its model requests are counted there too. Every run is capped on wall
// clock, turns and tokens (#26), read from the events Pi streams, and aborted at the first cap it passes.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { inMinutes, type Clock } from './clock.ts';
import { kill, signal } from './process-group.ts';
import type { Role, RunCaps, RunKind } from './config.ts';
import type { Forwarder, RecordResult } from './forwarder.ts';
import { errorText, type Log } from './log.ts';
import { checkRulesApplied, loadedScopes, rulesPrompt, tokensOf, type Rule, type RuleScope, type RuleSet } from './rules/rules.ts';
import type { Store } from './store.ts';

export interface RunRequest {
  kind: RunKind;
  role: Role;
  /** What the run works on, such as a Miner date. */
  item: string;
  /** The scope whose Rules the run loads beside the all scope's, when its kind has none of its own. */
  ruleScope?: RuleScope;
  prompt: string;
  /** Takes one record the run's tool wrote, given the Rules the run loaded, and says whether it was kept. */
  onRecord(record: unknown, runId: string, rules: readonly Rule[]): RecordResult;
}

/** The cap a run passed, and its value. */
export interface RunCap {
  limit: keyof RunCaps;
  max: number;
}

export interface RunResult {
  runId: string;
  /** `stopped`: the Assistant stopped, and ended the run before it settled. */
  outcome: 'settled' | 'failed' | 'capped' | 'stopped';
  /** The cap that stopped the run, when it was capped. */
  cap?: RunCap;
  error?: string;
}

const STDERR_KEPT = 4000;
const KILL_GRACE_MS = 5000;

export class PiRunner {
  #command: string[];
  #env: Record<string, string>;
  #cwd: string | undefined;
  #botUrl: string;
  #caps: Record<RunKind, RunCaps>;
  #rules: (scopes: RuleScope[]) => Promise<RuleSet>;
  #forwarder: Forwarder;
  #store: Store;
  #clock: Clock;
  #log: Log;
  /** Each run's process, and when it has closed. */
  #running = new Map<ChildProcess, Promise<void>>();
  #stopped = false;

  constructor(options: {
    command: string[];
    env: Record<string, string>;
    cwd?: string;
    /** The forwarder's address as Pi reaches it. */
    botUrl: string;
    /** Each run kind's caps. */
    caps: Record<RunKind, RunCaps>;
    /** The Rules of these scopes, as the Personal database's checkout last committed them. */
    rules(scopes: RuleScope[]): Promise<RuleSet>;
    forwarder: Forwarder;
    store: Store;
    clock: Clock;
    log: Log;
  }) {
    this.#command = options.command;
    this.#env = options.env;
    this.#cwd = options.cwd;
    this.#botUrl = options.botUrl;
    this.#caps = options.caps;
    this.#rules = options.rules;
    this.#forwarder = options.forwarder;
    this.#store = options.store;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  async run(request: RunRequest): Promise<RunResult> {
    if (this.#stopped) throw new Error('The Assistant is stopping; no new runs start');
    const runId = `${request.kind}-${randomUUID()}`;
    const { commit, rules } = await this.#rules(loadedScopes(request.kind, request.ruleScope));
    const prompt = rulesPrompt(rules);
    const { kind, role, item } = request;
    this.#store.startRun({ id: runId, kind, role, item, startedAt: this.#clock.now().toISOString(), rulesCommit: commit });
    const token = this.#forwarder.register({
      runId,
      role,
      rules: () => {
        this.#log('run.rules-loaded', { runId, kind, commit, rules: rules.map((r) => r.name), tokens: tokensOf(prompt) });
        return { commit, prompt };
      },
      onRecord: (record) => {
        const checked = checkRulesApplied(record, rules);
        return checked.ok ? request.onRecord(checked.record, runId, rules) : checked;
      },
    });
    this.#log('run.started', { runId, kind, role, item, rulesCommit: commit });

    let result: RunResult;
    try {
      result = await this.#drive(runId, token, request);
    } finally {
      this.#forwarder.unregister(token);
    }

    this.#store.finishRun(runId, result.outcome, this.#clock.now().toISOString());
    const totals = this.#store.runTotals(runId);
    this.#log('run.finished', {
      runId,
      kind: request.kind,
      role: request.role,
      item: request.item,
      outcome: result.outcome,
      ...(result.cap ? { cap: result.cap } : {}),
      ...(result.error ? { error: result.error } : {}),
      providers: totals.providers,
      models: totals.models,
      requests: totals.requests,
      tokens: totals.tokens,
      dollars: totals.dollars,
    });
    return result;
  }

  /** Stops every run in flight and refuses new ones. A run still up after the grace time is killed. */
  async stop(): Promise<void> {
    this.#stopped = true;
    await Promise.all(
      [...this.#running].map(async ([child, closed]) => {
        signal(child, 'SIGTERM');
        const killer = setTimeout(() => kill(child), KILL_GRACE_MS);
        await closed;
        clearTimeout(killer);
      }),
    );
  }

  #drive(runId: string, token: string, request: RunRequest): Promise<RunResult> {
    const [command, ...args] = this.#command;
    const child = spawn(command!, args, {
      cwd: this.#cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // The run leads its own process group, so a signal reaches Pi even through a command that wraps it.
      detached: true,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        ...this.#env,
        ASSISTANT_ROLE: request.role,
        ASSISTANT_RUN_KIND: request.kind,
        ASSISTANT_RUN_TOKEN: token,
        ASSISTANT_BOT_URL: this.#botUrl,
      },
    });
    this.#running.set(child, new Promise((resolve) => child.once('close', () => resolve())));

    const caps = this.#caps[request.kind];
    return new Promise<RunResult>((resolve) => {
      let error: string | undefined;
      let modelError: string | undefined;
      let cap: RunCap | undefined;
      let settled = false;
      let turns = 0;
      let tokens = 0;
      let stderr = '';
      let pending = Buffer.alloc(0);
      let killer: NodeJS.Timeout | undefined;

      // The first cap passed aborts the run; one that settled already has nothing left to stop.
      const stopAt = (passed: RunCap) => {
        if (cap || settled) return;
        cap = passed;
        send({ type: 'abort' });
        killer = setTimeout(() => kill(child), KILL_GRACE_MS);
      };
      const cancelWallClock = inMinutes(this.#clock, caps.wallClockMinutes, () =>
        stopAt({ limit: 'wallClockMinutes', max: caps.wallClockMinutes }),
      );

      const send = (command: Record<string, unknown>) => {
        if (child.stdin?.writable) child.stdin.write(`${JSON.stringify(command)}\n`);
      };

      const onRecord = (record: Record<string, unknown>) => {
        if (record.type === 'response' && record.id === 'prompt' && record.success === false) {
          error = `Pi refused the prompt: ${String(record.error)}`;
          child.stdin?.end();
        }
        if (record.type === 'turn_start' && ++turns > caps.turns) stopAt({ limit: 'turns', max: caps.turns });
        if (record.type === 'message_end') {
          // Pi retries a failed model request itself, so only the last reply says whether the run failed.
          const message = record.message as { role?: string; stopReason?: string; errorMessage?: string; usage?: PiUsage } | undefined;
          if (message?.role === 'assistant') {
            modelError = message.stopReason === 'error' ? (message.errorMessage ?? 'the model request failed') : undefined;
            tokens += usedTokens(message.usage);
            if (tokens > caps.tokens) stopAt({ limit: 'tokens', max: caps.tokens });
          }
        }
        if (record.type === 'extension_error') error = `extension error: ${String(record.error)}`;
        // Pi will not go on by itself; closing stdin asks it to shut down.
        if (record.type === 'agent_settled') {
          settled = true;
          child.stdin?.end();
        }
      };

      // Pi's RPC records are JSON lines split on LF only; U+2028 inside a string is not a line break.
      child.stdout!.on('data', (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        let newline: number;
        while ((newline = pending.indexOf(0x0a)) >= 0) {
          const line = pending.subarray(0, newline).toString('utf8').replace(/\r$/, '');
          pending = pending.subarray(newline + 1);
          if (!line) continue;
          try {
            onRecord(JSON.parse(line) as Record<string, unknown>);
          } catch (e) {
            this.#log('run.unreadable-record', { runId, error: errorText(e) });
          }
        }
      });
      child.stderr!.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_KEPT);
      });
      child.stdin!.on('error', () => {});

      child.on('error', (e) => {
        error = `Pi could not start: ${e.message}`;
      });
      child.on('close', (code) => {
        cancelWallClock();
        clearTimeout(killer);
        this.#running.delete(child);
        if (cap) return resolve({ runId, outcome: 'capped', cap, error: `the run passed its ${capText(cap)}` });
        if (this.#stopped && !settled) return resolve({ runId, outcome: 'stopped', error: 'the Assistant stopped' });
        error ??= modelError;
        if (!error && code !== 0) error = `Pi exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`;
        resolve(error ? { runId, outcome: 'failed', error } : { runId, outcome: 'settled' });
      });

      send({ id: 'prompt', type: 'prompt', message: request.prompt });
    });
  }
}

/** Token counts as Pi reports them on each assistant message. */
interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
}

/** A count from Pi's output; anything that isn't a count counts as none. */
const tokenCount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

function usedTokens(usage: PiUsage | undefined): number {
  if (!usage) return 0;
  if (typeof usage.totalTokens === 'number') return tokenCount(usage.totalTokens);
  return tokenCount(usage.input) + tokenCount(usage.output) + tokenCount(usage.cacheRead) + tokenCount(usage.cacheWrite);
}

/** A cap as the person reads it: `time cap (10 min)`, `turn cap (20 turns)`, `token cap (200,000 tokens)`. */
export function capText(cap: RunCap): string {
  switch (cap.limit) {
    case 'wallClockMinutes':
      return `time cap (${cap.max} min)`;
    case 'turns':
      return `turn cap (${cap.max} turns)`;
    case 'tokens':
      return `token cap (${cap.max.toLocaleString('en-US')} tokens)`;
  }
}
