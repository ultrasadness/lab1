// Raw inputs exactly as a source returned them, kept for 90 days outside git (for Rule cases and the Miner Fit
// check), indexed by the store, then deleted.
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from './clock.ts';
import type { Log } from './log.ts';
import type { Store } from './store.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export class RawInputs {
  #dir: string;
  #store: Store;
  #clock: Clock;
  #keepDays: number;
  #log: Log;

  constructor(options: { dir: string; store: Store; clock: Clock; keepDays: number; log: Log }) {
    this.#dir = options.dir;
    this.#store = options.store;
    this.#clock = options.clock;
    this.#keepDays = options.keepDays;
    this.#log = options.log;
  }

  /**
   * Writes one response body as it came, under `<source>/<item>/`, and indexes it. Its name is new each time, so a
   * second read of the same item at the same moment, as after a restart, keeps both.
   */
  keep(source: string, item: string, body: string): void {
    const now = this.#clock.now();
    const folder = join(this.#dir, source, item);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const path = join(folder, `${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`);
    writeFileSync(path, body, { mode: 0o600, flag: 'wx' });
    this.#store.addRawInput({
      source,
      item,
      path,
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.#keepDays * DAY_MS).toISOString(),
    });
  }

  /** Deletes every raw input past its keep date. */
  expire(): void {
    const expired = this.#store.expiredRawInputs(this.#clock.now().toISOString());
    for (const raw of expired) {
      rmSync(raw.path, { force: true });
      this.#store.removeRawInput(raw.id);
    }
    if (expired.length > 0) this.#log('raw-inputs.expired', { count: expired.length });
  }
}
