// Pi runs (ADR 0001): one `pi --mode rpc` process per run, started through a fixed command (in production the
// Pi container's helper). The bot sends the run's one prompt and waits until Pi settles. The run's records come
// in through the forwarder as the run goes; its model requests are counted there too.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Clock } from './clock.ts';
import type { Role } from './config.ts';
import type { Forwarder, RecordResult } from './forwarder.ts';
import { errorText, type Log } from './log.ts';
import type { Store } from './store.ts';

export type RunKind = 'miner-judging';

export interface RunRequest {
  kind: RunKind;
  role: Role;
  /** What the run works on, such as a Miner date. */
  item: string;
  prompt: string;
  wallClockMs: number;
  onRecord(record: unknown, runId: string): RecordResult;
}

export interface RunResult {
  runId: string;
  outcome: 'settled' | 'failed' | 'timed out';
  error?: string;
}

const STDERR_KEPT = 4000;
const KILL_GRACE_MS = 5000;

export class PiRunner {
  #command: string[];
  #env: Record<string, string>;
  #cwd: string | undefined;
  #botUrl: string;
  #forwarder: Forwarder;
  #store: Store;
  #clock: Clock;
  #log: Log;
  #running = new Set<ChildProcess>();
  #stopped = false;

  constructor(options: {
    command: string[];
    env: Record<string, string>;
    cwd?: string;
    /** The forwarder's address as Pi reaches it. */
    botUrl: string;
    forwarder: Forwarder;
    store: Store;
    clock: Clock;
    log: Log;
  }) {
    this.#command = options.command;
    this.#env = options.env;
    this.#cwd = options.cwd;
    this.#botUrl = options.botUrl;
    this.#forwarder = options.forwarder;
    this.#store = options.store;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  async run(request: RunRequest): Promise<RunResult> {
    if (this.#stopped) throw new Error('The Assistant is stopping; no new runs start');
    const runId = `${request.kind}-${randomUUID()}`;
    this.#store.startRun({ id: runId, kind: request.kind, role: request.role, item: request.item, startedAt: this.#clock.now().toISOString() });
    const token = this.#forwarder.register({ runId, role: request.role, onRecord: (record) => request.onRecord(record, runId) });
    this.#log('run.started', { runId, kind: request.kind, role: request.role, item: request.item });

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
      ...(result.error ? { error: result.error } : {}),
      providers: totals.providers,
      models: totals.models,
      requests: totals.requests,
      tokens: totals.tokens,
    });
    return result;
  }

  /** Stops every run in flight and refuses new ones. */
  async stop(): Promise<void> {
    this.#stopped = true;
    await Promise.all(
      [...this.#running].map(
        (child) =>
          new Promise<void>((resolve) => {
            child.once('exit', () => resolve());
            child.kill('SIGTERM');
          }),
      ),
    );
  }

  #drive(runId: string, token: string, request: RunRequest): Promise<RunResult> {
    const [command, ...args] = this.#command;
    const child = spawn(command!, args, {
      cwd: this.#cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        ...this.#env,
        ASSISTANT_ROLE: request.role,
        ASSISTANT_RUN_KIND: request.kind,
        ASSISTANT_RUN_TOKEN: token,
        ASSISTANT_BOT_URL: this.#botUrl,
      },
    });
    this.#running.add(child);

    return new Promise<RunResult>((resolve) => {
      let error: string | undefined;
      let modelError: string | undefined;
      let timedOut = false;
      let stderr = '';
      let pending = Buffer.alloc(0);

      const timer = setTimeout(() => {
        timedOut = true;
        send({ type: 'abort' });
        setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
      }, request.wallClockMs);

      const send = (command: Record<string, unknown>) => {
        if (child.stdin?.writable) child.stdin.write(`${JSON.stringify(command)}\n`);
      };

      const onRecord = (record: Record<string, unknown>) => {
        if (record.type === 'response' && record.id === 'prompt' && record.success === false) {
          error = `Pi refused the prompt: ${String(record.error)}`;
          child.stdin?.end();
        }
        if (record.type === 'message_end') {
          // Pi retries a failed model request itself, so only the last reply says whether the run failed.
          const message = record.message as { role?: string; stopReason?: string; errorMessage?: string } | undefined;
          if (message?.role === 'assistant') {
            modelError = message.stopReason === 'error' ? (message.errorMessage ?? 'the model request failed') : undefined;
          }
        }
        if (record.type === 'extension_error') error = `extension error: ${String(record.error)}`;
        // Pi will not go on by itself; closing stdin asks it to shut down.
        if (record.type === 'agent_settled') child.stdin?.end();
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
        clearTimeout(timer);
        this.#running.delete(child);
        if (timedOut) return resolve({ runId, outcome: 'timed out', error: `the run passed ${request.wallClockMs / 60000} minutes` });
        error ??= modelError;
        if (!error && code !== 0) error = `Pi exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`;
        resolve(error ? { runId, outcome: 'failed', error } : { runId, outcome: 'settled' });
      });

      send({ id: 'prompt', type: 'prompt', message: request.prompt });
    });
  }
}
