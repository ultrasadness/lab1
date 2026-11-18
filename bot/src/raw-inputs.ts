// Raw inputs exactly as a source returned them, kept for 90 days outside git (for Rule cases and the Miner Fit
// check), indexed by the store, then deleted.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
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

  /** The latest body kept under `<source>/<item>/`, if one is still kept. */
  latest(source: string, item: string): string | undefined {
    const folder = join(this.#dir, source, item);
    if (!existsSync(folder)) return undefined;
    const name = readdirSync(folder)
      .filter((file) => keptAt(file) !== undefined)
      .sort()
      .at(-1);
    return name === undefined ? undefined : readFileSync(join(folder, name), 'utf8');
  }

  /**
   * Deletes every raw input past its keep date. A file the store doesn't index, as after the store was lost or a stop
   * between writing a file and indexing it, goes by the time its name holds, so no copy outlives its keep date.
   */
  expire(): void {
    const now = this.#clock.now();
    const expired = this.#store.expiredRawInputs(now.toISOString());
    for (const raw of expired) {
      rmSync(raw.path, { force: true });
      this.#store.removeRawInput(raw.id);
    }
    const unindexed = existsSync(this.#dir)
      ? readdirSync(this.#dir, { recursive: true, encoding: 'utf8' }).filter((file) => {
          const kept = keptAt(basename(file));
          return kept !== undefined && kept + this.#keepDays * DAY_MS <= now.getTime();
        })
      : [];
    for (const file of unindexed) rmSync(join(this.#dir, file), { force: true });
    if (expired.length + unindexed.length > 0) this.#log('raw-inputs.expired', { count: expired.length + unindexed.length });
  }
}

/** When a raw input was kept, from its file's name as `keep` writes it, or undefined for a name it didn't write. */
function keptAt(name: string): number | undefined {
  const stamp = name.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z-[0-9a-f-]{36}\.json$/);
  if (!stamp) return undefined;
  const time = Date.parse(`${stamp[1]}:${stamp[2]}:${stamp[3]}.${stamp[4]}Z`);
  return Number.isNaN(time) ? undefined : time;
}
