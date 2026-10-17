// The Assistant's sense of time. Everything that depends on the date or schedules work goes through a Clock,
// so tests can move time in America/Los_Angeles across days and daylight-saving changes.

export interface Clock {
  now(): Date;
  /** Calls `fn` once, no earlier than `when`. Returns a function that cancels the call. */
  at(when: Date, fn: () => void): () => void;
}

// Long timers are re-armed in steps, so a suspended VM or a clock change can't leave one far off.
const STEP_MS = 60 * 60 * 1000;

export const systemClock: Clock = {
  now: () => new Date(),
  at(when, fn) {
    let timer: NodeJS.Timeout | undefined;
    const arm = () => {
      const wait = when.getTime() - Date.now();
      if (wait <= 0) return fn();
      timer = setTimeout(arm, Math.min(wait, STEP_MS));
    };
    arm();
    return () => clearTimeout(timer);
  },
};
