// The Miner's catch-up (#26): the dates it still works on, and the #status lines for a date dropped or late.
// The window is the latest few dates whose start has passed. A date is dropped when the window moves past it, so a
// date the Miner can't finish is tried until the Miner's start on the third day after it.
import type { Config } from '../config.ts';
import { addDays, dayLabel, pacificDate, pacificInstant, shortTime } from '../pacific.ts';
import type { MinerRetry } from '../store.ts';
import { cappedText } from './day-post.ts';

/** What sets the window: when each date starts, and how many of the latest dates it holds. */
export type CatchUp = Pick<Config['miner'], 'startsAt' | 'catchUpDates'>;

/** The dates in the catch-up window at `now`, oldest first. */
export function catchUpWindow(now: Date, { startsAt, catchUpDates }: CatchUp): string[] {
  const today = pacificDate(now);
  const latest = now >= pacificInstant(today, startsAt) ? today : addDays(today, -1);
  return Array.from({ length: catchUpDates }, (_, i) => addDays(latest, i - catchUpDates + 1));
}

/** When a date leaves the window: the start of the first date that pushes it out. */
export function leavesWindow(date: string, { startsAt, catchUpDates }: CatchUp): Date {
  return pacificInstant(addDays(date, catchUpDates), startsAt);
}

const MOST_DATES_NAMED = 7;

/** The one line naming the dates dropped together, oldest first. */
export function droppedLine(dates: string[], catchUpDates: number): string {
  const labels = dates.map(dayLabel);
  const named =
    labels.length > MOST_DATES_NAMED
      ? `${labels.length} dates from ${labels[0]} to ${labels.at(-1)}`
      : labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  return `Miner: dropped ${named}, outside the ${catchUpDates}-day catch-up. ${labels.length === 1 ? 'Its list' : 'Their lists'} won't go out.`;
}

/** A date whose Miner budget is spent while Launches wait to be judged: what it spent, and how many Launches wait. */
export interface BudgetHold {
  spent: number;
  budget: number;
  waiting: number;
  featured: number;
}

/** The line saying a date's list isn't out by its deadline, and why. */
export function lateLine(input: {
  date: string;
  /** Its spent Miner budget, if that holds it up. */
  heldByBudget?: BudgetHold;
  /** The Retry it waits on, if it waits on one, and the post its notice is in. */
  waiting?: { retry: MinerRetry; threadId: string | null };
  problem: string | null;
  retryMinutes: number;
  catchUp: CatchUp;
}): string {
  const { date, heldByBudget: held, waiting, problem, retryMinutes, catchUp } = input;
  const leaves = leavesWindow(date, catchUp);
  const until = shortTime(leaves);
  const late = `Miner: ${dayLabel(date)}'s list is late`;
  const window = `the ${catchUp.catchUpDates}-day catch-up`;
  const where = waiting?.threadId ? ` in <#${waiting.threadId}>` : '';
  // A spent Miner budget holds a tapped Retry too, so it comes first. Raising it doesn't tap a Retry still waiting.
  if (held) {
    const spent = `its Miner budget is spent (${dollars(held.spent)} of ${dollars(held.budget)})`;
    const share = held.waiting === held.featured ? `all ${held.featured} of its` : `${held.waiting} of its ${held.featured}`;
    const launches = `${share} Featured Launches wait to be judged`;
    const retry = waiting ? ` It waits on Retry${where} too.` : '';
    return `${late}: ${spent}, so ${launches} until the Miner budget is raised.${retry} The date leaves ${window} at ${until}.`;
  }
  if (waiting) {
    return `${late}: it waits on Retry${where}, because ${cappedText(waiting.retry)}. The date leaves ${window} at ${until}.`;
  }
  const why = problem ?? 'it is still being judged';
  return `${late}: ${why}. The Miner tries again every ${retryMinutes} minutes until the date leaves ${window} at ${until}.`;
}

const dollars = (amount: number) => `$${amount.toFixed(2)}`;
