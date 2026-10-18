// The day post (#29): one silent post per Miner day in the Miner days forum. A summary comes first, then one
// message per band, each Launch on one line with its own Correct button. Every message stays within Discord's
// limits; a band longer than 12 lines splits into parts. A date whose judging run hit a cap even after its automatic
// retry opens its post early (#45): a waiting summary, then a notice with Retry for each capped run. Once the date is
// judged, the summary and title are rewritten in place and the bands follow the notices. If the date is dropped
// instead, the post says so and its Retry buttons are turned off.
import {
  Accent,
  button,
  ButtonStyle,
  container,
  escapeMarkdown,
  fits,
  section,
  silentMessage,
  text,
  type MessagePayload,
} from '../discord/components.ts';
import { dayLabel, leaderboardUrl, pacificDate, pacificTime } from '../pacific.ts';
import { capText } from '../pi-runs.ts';
import type { MinerRetry } from '../store.ts';
import { BANDS, bandOf, outcomeOf, type Band, type DayLine } from './day-line.ts';

export interface DayPostLaunch {
  postId: string;
  rank: number;
  name: string;
  slug: string;
  fit: number;
  notAProduct: boolean;
  reLaunchOfRegistered: boolean;
  reason: string;
}

export interface RenderedDayPost {
  title: string;
  /** The summary, then the band messages, in posting order. */
  messages: MessagePayload[];
}

const LINES_PER_MESSAGE = 12;

/** The Correct button's id. Correct itself is wired in #48. */
export const correctId = (postId: string) => `correct:launch:${postId}`;

/** The Retry button's id, by the Retry's id in the store. */
export const retryId = (retry: number) => `retry:miner:${retry}`;

const launchUrl = (slug: string) => `https://www.producthunt.com/posts/${encodeURIComponent(slug)}`;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

export function renderDayPost(input: { date: string; line: DayLine; floor: number; launches: DayPostLaunch[] }): RenderedDayPost {
  const { date, line, floor, launches } = input;
  const dossiers = launches.filter((l) => outcomeOf(l, line.line) === 'dossier').length;

  const title = `${dayLabel(date)} · ${count(dossiers, 'Dossier')} · line ${line.line}`;
  const summary = silentMessage([
    container(Accent.progress, [
      text(
        [
          `## Miner · ${dayLabel(date)}`,
          `**${count(dossiers, 'Dossier')}** · ${count(launches.length - dossiers, 'Skip')} · ${count(line.featuredCount, 'Featured Launch', 'Featured Launches')} · Day's line **${line.line}**`,
          `-# Line: ${whyTheLine(line, floor)}`,
          `-# [Data sourced from Product Hunt](${leaderboardUrl(date)})`,
        ].join('\n'),
      ),
    ]),
  ]);

  const byBand = new Map<Band, DayPostLaunch[]>();
  for (const launch of launches) {
    const band = bandOf(launch, line.line);
    byBand.set(band, [...(byBand.get(band) ?? []), launch]);
  }

  const messages = [summary];
  for (const band of BANDS) {
    const members = (byBand.get(band) ?? []).sort((a, b) => b.fit - a.fit || a.rank - b.rank);
    if (members.length === 0) continue;
    const lines = members.map((l) => section(lineText(l, line.line), button(correctId(l.postId), 'Correct')));
    messages.push(...bandMessages(heading(band, line.line), band === 'dossiers' ? Accent.dossiers : Accent.progress, lines));
  }
  return { title, messages };
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
            `Dropped at ${pacificTime(at)} PT ${dayLabel(pacificDate(at))}, outside the ${catchUpDates}-day catch-up. Its list won't go out.`,
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

function whyTheLine(line: DayLine, floor: number): string {
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

function lineText(l: DayPostLaunch, line: number): string {
  const name = `**[${escapeMarkdown(l.name)}](${launchUrl(l.slug)})**`;
  const reason = escapeMarkdown(l.reason);
  switch (outcomeOf(l, line)) {
    case 'dossier':
      return `${name} · Dossier · fit ${l.fit} · ${reason}`;
    case 'skip':
      return `${name} · Skip · fit ${l.fit} · ${reason}`;
    case 'not-a-product':
      return `${name} · Skip · not a Product · ${reason}`;
  }
}

/** A band's messages: 12 lines each, or fewer where the text would pass Discord's limit. */
function bandMessages(title: string, accent: number, lines: ReturnType<typeof section>[]): MessagePayload[] {
  for (let parts = Math.ceil(lines.length / LINES_PER_MESSAGE); parts <= lines.length; parts++) {
    const size = Math.ceil(lines.length / parts);
    const chunks: (typeof lines)[] = [];
    for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size));
    const messages = chunks.map((chunk, i) =>
      silentMessage([container(accent, [text(`### ${title}${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}`), ...chunk])]),
    );
    if (messages.every(fits)) return messages;
  }
  throw new Error(`A line of the ${title} band is longer than one Discord message allows`);
}
