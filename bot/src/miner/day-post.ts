// The day post (#29): one silent post per Miner day in the Miner days forum. A summary comes first, then one
// message per band, each Launch on one line with its own Correct button. Every message stays within Discord's
// limits; a band longer than 12 lines splits into parts.
import {
  Accent,
  button,
  container,
  escapeMarkdown,
  fits,
  section,
  silentMessage,
  text,
  type MessagePayload,
} from '../discord/components.ts';
import { dayLabel, leaderboardUrl } from '../pacific.ts';
import { BANDS, bandOf, outcomeOf, type Band, type DayLine } from './day-line.ts';

export interface DayPostLaunch {
  postId: string;
  rank: number;
  name: string;
  slug: string;
  fit: number;
  notAProduct: boolean;
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

const launchUrl = (slug: string) => `https://www.producthunt.com/posts/${encodeURIComponent(slug)}`;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

export function renderDayPost(input: { date: string; line: DayLine; floor: number; launches: DayPostLaunch[] }): RenderedDayPost {
  const { date, line, floor, launches } = input;
  const judged = launches.map((l) => ({ ...l, reLaunchOfRegistered: false }));
  const dossiers = judged.filter((l) => outcomeOf(l, line.line) === 'dossier').length;

  const title = `${dayLabel(date)} · ${count(dossiers, 'Dossier')} · line ${line.line}`;
  const summary = silentMessage([
    container(Accent.progress, [
      text(
        [
          `## Miner · ${dayLabel(date)}`,
          `**${count(dossiers, 'Dossier')}** · ${count(launches.length - dossiers, 'Skip')} · ${count(line.featuredCount, 'Featured Launch', 'Featured Launches')} · Day's line **${line.line}**`,
          `-# Line: ${whyTheLine(line, floor)}`,
          `-# Data sourced from [Product Hunt](${leaderboardUrl(date)})`,
        ].join('\n'),
      ),
    ]),
  ]);

  const byBand = new Map<Band, typeof judged>();
  for (const launch of judged) {
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

function whyTheLine(line: DayLine, floor: number): string {
  const which = `the ${ordinal(line.k)} best Fit (⌈√${line.featuredCount}⌉ = ${line.k})`;
  if (line.featuredCount === 0) return `Product Hunt featured no Launches, so the floor of ${floor} sets it.`;
  if (line.kth === null) {
    return `only ${count(line.eligibleCount, 'Launch', 'Launches')} could get a Dossier, fewer than ${line.k}, so the floor of ${floor} sets it.`;
  }
  if (line.kth < floor) return `${which} is ${line.kth}, so the floor of ${floor} sets it.`;
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

function lineText(l: DayPostLaunch & { reLaunchOfRegistered: boolean }, line: number): string {
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
