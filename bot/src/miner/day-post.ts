// The day post (#29): one silent post per Miner day in the Miner days forum. A summary comes first, linking each
// Dossier's Product post and naming each Dossier not written, with why (#100), then one message per band, each Launch on one line with its own Correct button, a Dossier's
// ending in its Product post. Every message stays within Discord's limits; a band longer than 12 lines splits into
// parts. A date whose judging run hit a cap even after its automatic retry opens its post early (#45): a waiting
// summary, then a notice with Retry for each capped run. Once the date is judged, the summary and title are rewritten
// in place and the bands follow the notices. If the date is dropped instead, the post says so and its Retry buttons
// are turned off. A line names the Rules its judgment applied (#49). A line the person corrected (#48) keeps the band
// and place its first judgment gave it, and shows its new judgment "after your Correction" with a note of what it
// was and what they wrote, cut short if its message must be, and the Hard limit that declined it, if one did.
import {
  Accent,
  button,
  ButtonStyle,
  container,
  cut,
  escapeMarkdown,
  fits,
  section,
  silentMessage,
  text,
  type MessagePayload,
  type Section,
} from '../discord/components.ts';
import { dayLabel, leaderboardUrl, pacificTime, shortTime } from '../pacific.ts';
import { capText } from '../pi-runs.ts';
import { declinedText } from '../rules/sorting.ts';
import type { MinerRetry } from '../store.ts';
import { BANDS, bandOf, outcomeOf, type Band, type DayLine, type JudgedLaunch } from './day-line.ts';

/** A Launch's line: the judgment it shows, its first one or one the person's Correction gave. */
export interface DayPostLaunch extends JudgedLaunch {
  postId: string;
  rank: number;
  name: string;
  slug: string;
  reason: string;
  /** The Rules the judgment applied, by name. */
  rulesApplied: string[];
  /** The judgment the day was posted with, once a Correction changed it: it keeps the line's band and place. */
  first?: JudgedLaunch & { reason: string; rulesApplied: string[] };
  /** The person's latest Correction of it. */
  correction?: LineCorrection;
}

export interface LineCorrection {
  /** What the person wrote. */
  text: string;
  state: 're-judging' | 're-judged' | 'not re-judged';
  /** The judgment it was made on. */
  was: JudgedLaunch;
  /** Why it wasn't re-judged, or why what it changed isn't all done yet. */
  why: string | null;
  /** The Product post its Launch's Dossier was withdrawn in, while it is. */
  withdrawnPost: string | null;
  /** The Hard limit that declined what it asks, if one did (#49). */
  declined: string | null;
}

export interface RenderedDayPost {
  title: string;
  /** The summary, then the band messages, in posting order. */
  messages: MessagePayload[];
  /** The Post ids of the Launches whose lines each message holds; the summary holds none. */
  launchesIn: string[][];
}

const LINES_PER_MESSAGE = 12;

/** A post id as long as Discord's longest, standing in for the post of a Dossier written later. */
const LATER_POST = '9'.repeat(20);

/** How much of why each Dossier wasn't written the summary keeps: 200 characters, less where it must fit, or none. */
const WHYS_KEPT = [200, 80, 0] as const;

/** How much of a corrected line's quote of the person, then of its reason, is kept: all, until its message must fit. */
const SQUEEZES = [
  { quote: 200, reason: Infinity },
  { quote: 80, reason: Infinity },
  { quote: 0, reason: Infinity },
  { quote: 0, reason: 80 },
  { quote: 0, reason: 0 },
] as const;
type Squeeze = (typeof SQUEEZES)[number];

/** The Correct button's id, which its pop-up shares. */
export const correctId = (postId: string) => `correct:launch:${postId}`;

/** The Retry button's id, by the Retry's id in the store. */
export const retryId = (retry: number) => `retry:miner:${retry}`;

export const launchUrl = (slug: string) => `https://www.producthunt.com/posts/${encodeURIComponent(slug)}`;

export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/** `ChatGPT Plus (8) and OpenRouter (4)`: a day with more than one may be uneven (#46). */
const judgedByText = (judgedBy: { provider: string; launches: number }[]) => {
  const named = judgedBy.map((j) => `${escapeMarkdown(j.provider)} (${j.launches})`);
  return `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
};

export function renderDayPost(input: {
  date: string;
  line: DayLine;
  launches: DayPostLaunch[];
  /** The Product post holding each Dossier Launch's Dossier, by Post id. */
  productPosts: ReadonlyMap<string, string>;
  /** Why each Launch filed under no Product went without a Dossier at its latest try, by Post id. */
  unwritten: ReadonlyMap<string, string>;
  /** The providers that made the day's judgments, most Launches first. */
  judgedBy: { provider: string; launches: number }[];
}): RenderedDayPost {
  const { date, line, launches, productPosts, unwritten, judgedBy } = input;
  const dossierLaunches = launches.filter((l) => outcomeOf(l, line.line) === 'dossier').sort((a, b) => b.fit - a.fit || a.rank - b.rank);
  const dossiers = dossierLaunches.length;
  const dossierPosts = [...new Set(dossierLaunches.flatMap((l) => productPosts.get(l.postId) ?? []))];
  // Each Dossier not written, and why, as much of it as the summary has room for.
  const notWritten = (whyKept: number) =>
    dossierLaunches.flatMap((l) => {
      const why = unwritten.get(l.postId);
      if (why === undefined) return [];
      const name = `**Not written:** ${escapeMarkdown(l.name.trim())}`;
      return [whyKept > 0 ? `${name}, because ${cut(escapeMarkdown(why), whyKept)}` : name];
    });

  const title = `${dayLabel(date)} · ${count(dossiers, 'Dossier')} · line ${line.line}`;
  const summaryKeeping = (whyKept: number) =>
    silentMessage([
      container(Accent.progress, [
        text(
          [
            `## Miner · ${dayLabel(date)}`,
            `**${count(dossiers, 'Dossier')}** · ${count(launches.length - dossiers, 'Skip')} · ${count(line.featuredCount, 'Featured Launch', 'Featured Launches')} · Day's line **${line.line}**`,
            ...(dossierPosts.length > 0 ? [`**Dossiers:** ${dossierPosts.map((id) => `<#${id}>`).join(' · ')}`] : []),
            ...notWritten(whyKept),
            ...(judgedBy.length > 1 ? [`-# Judged by ${judgedByText(judgedBy)}`] : []),
            `-# Line: ${whyTheLine(line)}`,
            `-# [Data sourced from Product Hunt](${leaderboardUrl(date)})`,
          ].join('\n'),
        ),
      ]),
    ]);
  const summary = WHYS_KEPT.map(summaryKeeping).find(fits);
  if (!summary) throw new Error(`${dayLabel(date)}'s summary is longer than one Discord message allows`);

  // A line's place comes from the judgment the day was posted with.
  const posted = (l: DayPostLaunch): DayPostLaunch => (l.first ? { ...l, ...l.first, first: undefined, correction: undefined } : l);
  const byBand = new Map<Band, DayPostLaunch[]>();
  for (const launch of launches) {
    const band = bandOf(posted(launch), line.line);
    byBand.set(band, [...(byBand.get(band) ?? []), launch]);
  }

  const messages = [summary];
  const launchesIn: string[][] = [[]];
  for (const band of BANDS) {
    const members = (byBand.get(band) ?? []).sort((a, b) => posted(b).fit - posted(a).fit || a.rank - b.rank);
    if (members.length === 0) continue;
    const title = heading(band, line.line);
    const accent = band === 'dossiers' ? Accent.dossiers : Accent.progress;
    // Correct is off while a line is re-judging.
    const lineOf = (l: DayPostLaunch, squeeze: Squeeze = SQUEEZES[0], post = productPosts.get(l.postId)) =>
      section(
        lineText(l, line.line, post, squeeze),
        button(correctId(l.postId), 'Correct', ButtonStyle.Secondary, l.correction?.state === 're-judging'),
      );
    // Parts split as the band was first posted, with a post for every Dossier, so a corrected line, or one whose
    // Dossier is written later, stays in the message it was in.
    const size = partSize(title, accent, members.map((l) => lineOf(posted(l), SQUEEZES[0], productPosts.get(l.postId) ?? LATER_POST)));
    const parts = Math.ceil(members.length / size);
    for (let i = 0; i < parts; i++) {
      const chunk = members.slice(i * size, (i + 1) * size);
      const part = parts > 1 ? ` (${i + 1}/${parts})` : '';
      const message = SQUEEZES.map((squeeze) => bandMessage(`${title}${part}`, accent, chunk.map((l) => lineOf(l, squeeze)))).find(fits);
      if (!message) throw new Error(`A corrected line of the ${title} band is longer than one Discord message allows`);
      messages.push(message);
      launchesIn.push(chunk.map((l) => l.postId));
    }
  }
  return { title, messages, launchesIn };
}

/** A withdrawn Dossier's first message, in its Product post: the Launch's line and the Correction that withdrew it. */
export function renderWithdrawn(input: { title: string; date: string; line: number; launch: DayPostLaunch }): MessagePayload {
  const { title, date, line, launch } = input;
  return silentMessage([
    container(Accent.progress, [
      text(
        [
          `## ${escapeMarkdown(title)}`,
          `**Withdrawn** · your Correction put it below ${dayLabel(date)}'s line of ${line}.`,
          lineText(launch, line, undefined),
        ].join('\n'),
      ),
    ]),
  ]);
}

/** The post as it opens before its list: a summary of how far judging got. */
export function renderWaitingPost(input: { date: string; judged: number; featured: number }): { title: string; summary: MessagePayload } {
  const { date, judged, featured } = input;
  return {
    title: `${dayLabel(date)} · judging`,
    summary: silentMessage([
      container(Accent.progress, [
        text(
          [
            `## Miner · ${dayLabel(date)}`,
            `${judged} of ${count(featured, 'Featured Launch', 'Featured Launches')} judged. The day's list follows here once every one has a Fit.`,
            `-# [Data sourced from Product Hunt](${leaderboardUrl(date)})`,
          ].join('\n'),
        ),
      ]),
    ]),
  };
}

/** The post once its date is dropped: it says so, and its list never follows. */
export function renderDroppedPost(input: { date: string; at: Date; catchUpDates: number }): { title: string; summary: MessagePayload } {
  const { date, at, catchUpDates } = input;
  return {
    title: `${dayLabel(date)} · dropped`,
    summary: silentMessage([
      container(Accent.progress, [
        text(
          [
            `## Miner · ${dayLabel(date)}`,
            `Dropped at ${shortTime(at)}, outside the ${catchUpDates}-day catch-up. Its list won't go out.`,
            `-# [Data sourced from Product Hunt](${leaderboardUrl(date)})`,
          ].join('\n'),
        ),
      ]),
    ]),
  };
}

/**
 * What a Retry's runs hit, as one clause: `a judging run of 8 Launches hit its turn cap (20 turns), and so did its
 * automatic retry`, or `the run your Retry started for 8 Launches hit its token cap (200,000 tokens)`.
 */
export function cappedText(retry: MinerRetry): string {
  const [first, second] = retry.cappedRuns;
  if (retry.afterRetry || !second) return `the run your Retry started for ${count(first!.launches, 'Launch', 'Launches')} hit its ${capText(first!.cap)}`;
  const run = `a judging run of ${count(first!.launches, 'Launch', 'Launches')} hit its ${capText(first!.cap)}`;
  const of = second.launches < first!.launches ? ` of the ${second.launches} left` : '';
  const same = second.cap.limit === first!.cap.limit && second.cap.max === first!.cap.max;
  return same ? `${run}, and so did its automatic retry${of}` : `${run}, and its automatic retry${of} hit its ${capText(second.cap)}`;
}

/** Which caps stopped judging, with Retry; once tapped or dropped, Retry is off. */
export function renderRetryNotice(retry: MinerRetry, dropped = false): MessagePayload {
  const what = cappedText(retry);
  const left = count(retry.postIds.length, 'Launch', 'Launches');
  const then = retry.tappedAt
    ? `-# Retried at ${pacificTime(new Date(retry.tappedAt))} PT`
    : dropped
      ? '-# Dropped with the date.'
      : `-# The day's list waits on the ${left} still without a Fit.`;
  return silentMessage([
    container(Accent.progress, [
      section(
        `**Judging stopped** · ${what[0]!.toUpperCase()}${what.slice(1)}.\n${then}`,
        button(retryId(retry.id), 'Retry', ButtonStyle.Primary, Boolean(retry.tappedAt) || dropped),
      ),
    ]),
  ]);
}

/** Why the Day's line sits where it does, as one clause. */
export function whyTheLine(line: DayLine): string {
  const { floor } = line;
  const which = `the ${ordinal(line.k)} best Fit (⌈√${line.featuredCount}⌉ = ${line.k})`;
  if (line.kth === null) {
    return `only ${count(line.eligibleCount, 'Launch', 'Launches')} could get a Dossier, fewer than ${line.k}, so the floor of ${floor} sets it.`;
  }
  if (line.kth < floor) return `${which} is ${line.kth}, so the floor of ${floor} sets it.`;
  if (line.kth === floor) return `${which} is ${line.kth}, the same as the floor.`;
  return `${which} is ${line.kth}, above the floor of ${floor}, so it sets the line.`;
}

function heading(band: Band, line: number): string {
  switch (band) {
    case 'dossiers':
      return 'Dossiers';
    case 'near-misses':
      return `Near misses · fit ${line - 1}`;
    case 'further-off':
      return `Further off · fit 3–${line - 2}`;
    case 'far-off':
      return 'Far off · fit 0–2';
    case 'not-products':
      return 'Not Products';
  }
}

/** The judgment a line shows, as the Correct pop-up shows it: `**Skip · fit 6** · <reason>`. */
export function judgmentText(l: DayPostLaunch, line: number): string {
  return `**${head(l, line)}** · ${escapeMarkdown(l.reason)}`;
}

/** A judgment as a run reads it, unescaped: `Skip · fit 6 · <reason> (Rule: <name>)`. */
export function plainJudgment(j: JudgedLaunch & { reason: string; rulesApplied: string[] }, line: number): string {
  return `${outcomeText(j, line)} · ${j.reason}${rulesNamed(j.rulesApplied)}`;
}

/** ` (Rule: <name>)`, or ` (Rules: <name>, <name>)`, closing a judgment that applied Rules; empty when it applied none. */
const rulesNamed = (names: string[]) => (names.length > 0 ? ` (Rule${names.length > 1 ? 's' : ''}: ${names.join(', ')})` : '');

/** `Dossier · fit 8`, `Skip · fit 6` or `Skip · not a Product`. */
function outcomeText(j: JudgedLaunch, line: number): string {
  switch (outcomeOf(j, line)) {
    case 'dossier':
      return `Dossier · fit ${j.fit}`;
    case 'skip':
      return `Skip · fit ${j.fit}`;
    case 'not-a-product':
      return 'Skip · not a Product';
  }
}

/** The judgment's outcome, saying when a Correction gave it. */
const head = (l: DayPostLaunch, line: number) => `${outcomeText(l, line)}${l.first ? ' after your Correction' : ''}`;


/**
 * A Launch's line, its reason followed by the Rules it applied, which a Correction ends with a note. A corrected line's
 * quote of the person, then its reason, keep only as much as the squeeze allows.
 */
function lineText(l: DayPostLaunch, line: number, productPost: string | undefined, squeeze: Squeeze = SQUEEZES[0]): string {
  const name = `**[${escapeMarkdown(l.name)}](${launchUrl(l.slug)})**`;
  const c = l.correction;
  const reason = c ? cut(escapeMarkdown(l.reason), squeeze.reason) : escapeMarkdown(l.reason);
  const quote = c && `“${cut(escapeMarkdown(c.text), squeeze.quote)}”`;
  const rules = rulesNamed(l.rulesApplied.map(escapeMarkdown));
  if (c?.state === 're-judging') return `${name} · re-judging… · ${reason}${rules}\n-# you wrote ${quote}`;
  const dossier = outcomeOf(l, line) === 'dossier';
  const text = `${name} · ${head(l, line)} · ${reason}${rules}${dossier && productPost ? ` → <#${productPost}>` : ''}`;
  if (!c) return text;
  if (c.state === 'not re-judged') return `${text}\n-# Your Correction ${quote} couldn't be re-judged: ${c.why}. Correct to try again.`;
  const withdrawn = c.withdrawnPost ? ` · Dossier withdrawn <#${c.withdrawnPost}>` : '';
  const declined = c.declined ? ` · ${declinedText(c.declined)}` : '';
  return `${text}\n-# was ${outcomeText(c.was, line)} · you wrote ${quote}${withdrawn}${declined}${c.why ? ` · ${c.why}` : ''}`;
}

const bandMessage = (title: string, accent: number, lines: Section[]) => silentMessage([container(accent, [text(`### ${title}`), ...lines])]);

/** How many lines each of a band's messages holds: 12, or fewer where the text would pass Discord's limit. */
function partSize(title: string, accent: number, lines: Section[]): number {
  for (let parts = Math.ceil(lines.length / LINES_PER_MESSAGE); parts <= lines.length; parts++) {
    const size = Math.ceil(lines.length / parts);
    const chunks: Section[][] = [];
    for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size));
    const part = (i: number) => (chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '');
    if (chunks.every((chunk, i) => fits(bandMessage(`${title}${part(i)}`, accent, chunk)))) return size;
  }
  throw new Error(`A line of the ${title} band is longer than one Discord message allows`);
}
