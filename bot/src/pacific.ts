// Pacific dates. A Miner day is a date in America/Los_Angeles. These turn instants into Pacific dates and wall
// clock times and back, so a day is 23 or 25 hours long across a daylight-saving change.

const wallClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function wall(instant: Date): { date: string; time: string } {
  const p = Object.fromEntries(wallClock.formatToParts(instant).map((part) => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** The Pacific date (`YYYY-MM-DD`) at an instant. */
export function pacificDate(instant: Date): string {
  return wall(instant).date;
}

function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y!, m!, d!];
}

/** The Pacific wall-clock time (`HH:MM`) at an instant. */
export function pacificTime(instant: Date): string {
  return wall(instant).time;
}

/** The earliest instant at which the Pacific wall clock reads `time` on `date`. */
export function pacificInstant(date: string, time: string): Date {
  const [y, m, d] = ymd(date);
  const [hh, mm] = time.split(':').map(Number);
  const asIfUtc = Date.UTC(y, m - 1, d, hh!, mm!);
  // Los Angeles is 7 hours behind UTC in daylight time and 8 in standard time. When the clocks fall back a
  // time can happen twice; take the first.
  const matches = [7, 8]
    .map((hours) => asIfUtc + hours * 3_600_000)
    .filter((t) => {
      const w = wall(new Date(t));
      return w.date === date && w.time === time;
    });
  // A time skipped when the clocks spring forward never happens; standard time's reading lands just after it.
  return new Date(matches.length > 0 ? Math.min(...matches) : asIfUtc + 8 * 3_600_000);
}

export function nextDate(date: string): string {
  return addDays(date, 1);
}

/** The date `days` after `date`, or before it when `days` is negative. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = ymd(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The instants a Pacific date starts and ends: midnight to the next midnight. */
export function pacificDay(date: string): { start: Date; end: Date } {
  return { start: pacificInstant(date, '00:00'), end: pacificInstant(nextDate(date), '00:00') };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const weekday = (date: string) => {
  const [y, m, d] = ymd(date);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

/** `Wed Oct 14`, as the person reads a day on Discord. */
export function dayLabel(date: string): string {
  const [, m, d] = ymd(date);
  return `${weekday(date)} ${MONTHS[m - 1]} ${d}`;
}

/** `08:12 PT Wed Oct 14`, as the person reads an instant on Discord. */
export function shortTime(instant: Date): string {
  return `${pacificTime(instant)} PT ${dayLabel(pacificDate(instant))}`;
}

// Every date the bot writes into the Personal database carries its year and zone, so a Question can filter by date
// (#37). Discord keeps its short dates.

/** `Wed 2026-10-14 PT`: a Pacific date as the bot writes it into the Personal database. */
export function fullDate(date: string): string {
  return `${weekday(date)} ${date} PT`;
}

/** `2026-10-14 08:12 PT`: an instant as the bot writes it into the Personal database. */
export function fullTime(instant: Date): string {
  return `${pacificDate(instant)} ${pacificTime(instant)} PT`;
}

/** Product Hunt's daily leaderboard for a Pacific date. */
export function leaderboardUrl(date: string): string {
  const [y, m, d] = ymd(date);
  return `https://www.producthunt.com/leaderboard/daily/${y}/${m}/${d}`;
}
