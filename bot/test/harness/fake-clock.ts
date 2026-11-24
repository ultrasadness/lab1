import type { Clock } from '../../src/clock.ts';

interface Timer {
  at: number;
  fn: () => void;
}

/** A clock that only moves when the test moves it. */
export class FakeClock implements Clock {
  #now: number;
  #timers = new Set<Timer>();
  /** Called after each move, with the new time. */
  onMove: (when: string) => void = () => {};

  constructor(start: string) {
    this.#now = Date.parse(start);
  }

  now(): Date {
    return new Date(this.#now);
  }

  /**
   * Calls `fn` once the clock reaches `when`; a time already reached fires at once, inside `at`, as `systemClock`'s
   * does (bot/src/clock.ts), before `at` hands back what cancels it (#59).
   */
  at(when: Date, fn: () => void): () => void {
    if (when.getTime() <= this.#now) {
      fn();
      return () => {};
    }
    const timer = { at: when.getTime(), fn };
    this.#timers.add(timer);
    return () => this.#timers.delete(timer);
  }

  /** Jumps to `when` and fires each timer that is now due, once, as a real clock does after a jump. */
  advanceTo(when: string): void {
    const target = Date.parse(when);
    if (target < this.#now) throw new Error(`The clock can't go back to ${when}`);
    this.#now = target;
    const due = [...this.#timers].filter((t) => t.at <= target).sort((a, b) => a.at - b.at);
    for (const timer of due) {
      this.#timers.delete(timer);
      timer.fn();
    }
    this.onMove(when);
  }
}
