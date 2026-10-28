// The bot's healthchecks.io ping (#26): its check emails the person once 15 minutes pass without one, saying only that
// the Assistant can't reach them on Discord. The ping URL is a token (ADR 0009), so it is never logged.
import type { Clock } from './clock.ts';
import { errorText, type Log } from './log.ts';
import type { Store } from './store.ts';

/** How often the bot pings; its check on healthchecks.io has this period and 10 minutes' grace. */
export const PING_MINUTES = 5;
const TIMEOUT_MS = 10_000;

export class HealthPing {
  #url: string;
  #loggedIn: () => boolean;
  #store: Store;
  #clock: Clock;
  #log: Log;

  constructor(options: {
    url: string;
    /** Whether the bot is logged in to Discord, where it reaches the person. */
    loggedIn: () => boolean;
    store: Store;
    clock: Clock;
    log: Log;
  }) {
    this.#url = options.url;
    this.#loggedIn = options.loggedIn;
    this.#store = options.store;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  /**
   * Pings the check once, if the bot can reach the person and its store takes a write; a ping healthchecks.io doesn't
   * take waits for the next.
   */
  async ping(): Promise<void> {
    if (!this.#loggedIn()) {
      this.#log('health.ping-withheld', { why: 'not logged in to Discord' });
      return;
    }
    try {
      this.#store.savePingWrite(this.#clock.now().toISOString());
    } catch (error) {
      this.#log('health.ping-withheld', { why: 'the store can’t take a write', error: errorText(error) });
      return;
    }
    try {
      const response = await fetch(this.#url, { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) });
      await response.body?.cancel();
      if (!response.ok) this.#log('health.ping-failed', { status: response.status });
    } catch (error) {
      // Only the error's name or code: a fetch error's message can hold the URL, which is a token.
      const e = error as Error & { cause?: { code?: unknown } };
      this.#log('health.ping-failed', { error: typeof e.cause?.code === 'string' ? e.cause.code : e.name });
    }
  }
}
