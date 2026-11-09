// The real bot in a worker thread of its own, so a test can kill it. Terminating the thread stops its JavaScript where
// it stands, and takes its sockets, timers and store handle with it, so nothing the outside world does later can wake
// it: not a fake answering, not a process it started ending, not a timer. It stays in the test's process so that its
// clock moves as one step with the test's (`moveClock`). #96 weighs this against a child process and an old bot left
// frozen in the test's own thread, on its comments.
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { setFlagsFromString } from 'node:v8';
import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';
import type { Assistant, LogEntry } from '../../src/assistant.ts';
import type { Config } from '../../src/config.ts';
import type { Migration } from '../../src/store.ts';

// Node 24's V8 can free one Wasm import wrapper twice once two threads run Wasm, and the process dies of it
// (nodejs/node#66366, #105). The test's thread and the bot's both do, since Node strips types through Wasm and `fetch`
// parses through it. With V8's Wasm code GC off nothing frees a wrapper, and dead code stays until the test's process
// ends. The bot on the VM has no second thread, so this stays in the harness, until a Node 24 release holds the fix
// (nodejs/node#66376).
setFlagsFromString('--no-wasm-code-gc');

/** What the bot's thread starts from. */
export interface BotThreadData {
  config: Config;
  credentialsDir: string;
  /** The clock's time as the bot starts. */
  now: string;
  /** Counts the clock's moves the bot's thread has made. */
  clockMoves: SharedArrayBuffer;
  migrations: Migration[] | undefined;
  /** Where the bot's log lines go. */
  logPort: MessagePort;
}

export type ToBot = { kind: 'clock'; when: string } | { kind: 'whenIdle' | 'stop'; id: number };
export type FromBot = { kind: 'started' } | { kind: 'start-failed'; error: unknown } | { kind: 'answer'; id: number; error?: unknown };

/** How long a killed run or git command may take to go. */
const GONE_WITHIN_MS = 5000;
/** How long the bot's thread may take to move its clock: a timer may wait on a busy store for 5 seconds (`store.ts`). */
const CLOCK_MOVED_WITHIN_MS = 30_000;

export class BotThread implements Assistant {
  #worker: Worker;
  #logPort: MessagePort;
  #logs: LogEntry[];
  #clockMoves: Int32Array;
  /** What the test has asked and the bot hasn't answered yet. */
  #asked = new Map<number, { resolve(): void; reject(error: unknown): void }>();
  #nextId = 0;
  #over = false;

  private constructor(worker: Worker, logPort: MessagePort, logs: LogEntry[], clockMoves: Int32Array) {
    this.#worker = worker;
    this.#logPort = logPort;
    this.#logs = logs;
    this.#clockMoves = clockMoves;
  }

  /** Starts the bot in a thread of its own. Rejects as `startAssistant` does when the bot can't start. */
  static async start(options: Omit<BotThreadData, 'logPort' | 'clockMoves'> & { logTo: LogEntry[] }): Promise<BotThread> {
    const { logTo, ...data } = options;
    const { port1: testLogPort, port2: logPort } = new MessageChannel();
    const clockMoves = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const worker = new Worker(new URL('./bot-thread-entry.ts', import.meta.url), {
      workerData: { ...data, logPort, clockMoves } satisfies BotThreadData,
      transferList: [logPort],
    });
    const bot = new BotThread(worker, testLogPort, logTo, new Int32Array(clockMoves));
    // An error nothing in the bot catches fails the test, as it would with the bot in the test's own thread.
    worker.on('error', (error) => {
      throw error;
    });
    worker.on('exit', () => bot.#ended());
    await new Promise<void>((resolve, reject) => {
      worker.once('exit', () => reject(new Error("The bot's thread ended before the bot started")));
      worker.on('message', (message: FromBot) => {
        if (message.kind === 'started') resolve();
        else if (message.kind === 'start-failed') reject(message.error as Error);
        else bot.#answered(message);
      });
    }).catch(async (error: unknown) => {
      await worker.terminate();
      throw error;
    });
    return bot;
  }

  /** Resolves once no background work is queued or running, or at once for a bot that is over. */
  whenIdle(): Promise<void> {
    return this.#ask('whenIdle');
  }

  /** The bot's own stop, which waits for what it is doing. */
  async stop(): Promise<void> {
    await this.#ask('stop');
    await this.#worker.terminate();
    this.takeLogs();
  }

  /**
   * Ends the bot where it stands, and each run, git command and `bw` command it started. Its stop never runs. `bot/README.md` says how
   * this differs from a crash on the VM.
   */
  async kill(): Promise<void> {
    await this.#worker.terminate();
    this.takeLogs();
    await killChildProcessGroups();
  }

  /**
   * Moves the bot's clock and fires its timers now due, and returns once that is done, so a move is one step to the bot
   * and to the test, as with both on one thread. The bot never reads the new time with those timers unfired, and
   * whatever the test does next comes after them. A timer's work up to its first wait runs in that step, and none of it
   * waits on this thread, which blocks here.
   */
  moveClock(when: string): void {
    if (this.#over) return;
    const moves = Atomics.load(this.#clockMoves, 0);
    this.#worker.postMessage({ kind: 'clock', when } satisfies ToBot);
    if (Atomics.wait(this.#clockMoves, 0, moves, CLOCK_MOVED_WITHIN_MS) === 'timed-out') {
      throw new Error(`The bot's thread didn't move its clock to ${when} within ${CLOCK_MOVED_WITHIN_MS} ms`);
    }
  }

  /**
   * Moves what the bot has logged so far to the test's list. The thread queues each line before it goes on, so whatever
   * a fake has seen of the bot, the lines the bot logged before that are here to take.
   */
  takeLogs(): void {
    for (let taken = receiveMessageOnPort(this.#logPort); taken; taken = receiveMessageOnPort(this.#logPort)) {
      this.#logs.push(taken.message as LogEntry);
    }
  }

  #ask(kind: 'whenIdle' | 'stop'): Promise<void> {
    if (this.#over) return Promise.resolve();
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#asked.set(id, { resolve, reject });
      this.#worker.postMessage({ kind, id } satisfies ToBot);
    });
  }

  #answered(message: Extract<FromBot, { kind: 'answer' }>): void {
    const asked = this.#asked.get(message.id);
    this.#asked.delete(message.id);
    if (message.error === undefined) asked?.resolve();
    else asked?.reject(message.error);
  }

  /** The thread has ended, so nothing asked of it can still be going on: a `whenIdle` it left open resolves. */
  #ended(): void {
    this.#over = true;
    for (const asked of this.#asked.values()) asked.resolve();
    this.#asked.clear();
  }
}

/** How many processes the bot started are still running: its runs, git commands and `bw` commands, and what they started. */
export function botProcessesRunning(): number {
  const all = processes();
  const groups = botProcessGroups(all);
  return all.filter((p) => groups.includes(p.pgid) && !p.stat.startsWith('Z')).length;
}

function processes(): { pid: number; ppid: number; pgid: number; stat: string }[] {
  return execFileSync('ps', ['-eo', 'pid=,ppid=,pgid=,stat='], { encoding: 'utf8', timeout: GONE_WITHIN_MS })
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .map(([pid, ppid, pgid, stat]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), stat: stat! }));
}

/**
 * The process groups this process's children lead. The bot starts each run, git command and `bw` command as the leader of its own
 * group (`bot/src/process-group.ts`), and nothing else in a test's process has one, so a test's git helpers aren't among
 * them. These are all one bot's, since `world.kill` refuses to run beside a second world.
 */
function botProcessGroups(all: ReturnType<typeof processes>): number[] {
  return all.filter((p) => p.ppid === process.pid && p.pid === p.pgid).map((p) => p.pgid);
}

/** Kills the bot's process groups, and resolves once they are gone. A killed child stays a zombie, as the thread that would reap it is gone. */
async function killChildProcessGroups(): Promise<void> {
  for (const group of botProcessGroups(processes())) {
    try {
      process.kill(-group, 'SIGKILL');
    } catch {
      // Gone already.
    }
  }
  const until = Date.now() + GONE_WITHIN_MS;
  while (botProcessesRunning() > 0) {
    if (Date.now() > until) throw new Error(`${botProcessesRunning()} processes the bot started outlived its kill`);
    await delay(10);
  }
}
