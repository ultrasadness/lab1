// The Miner day's view in the Personal database (#37): `days/<YYYY-MM-DD>.md`, written from the live store once the
// day is judged, and rewritten when a Correction changes the day. It holds the Day's line, then one line per Featured
// Launch in Product Hunt order, so a line keeps its place when a Correction rewrites it. Like every date the bot writes
// there, the day's carries its year and zone.
import { fullDate, fullTime, leaderboardUrl } from '../pacific.ts';
import { plain } from '../personal-database.ts';
import type { StoredDayLine } from '../store.ts';
import { count, launchUrl, whyTheLine, type DayPostLaunch } from './day-post.ts';
import { outcomeOf } from './day-line.ts';

export interface DayFileLaunch extends Omit<DayPostLaunch, 'postId' | 'rank'> {
  rulesApplied: string[];
}

/** The file to write: where it goes, what it holds, and its commit's message. */
export interface DayFile {
  path: string;
  content: string;
  message: string;
}

/** The day's file, from its stored line and its Launches in Product Hunt order. */
export function renderDayFile(input: { date: string; line: StoredDayLine; launches: DayFileLaunch[] }): DayFile {
  const { date, line, launches } = input;
  const dossiers = launches.filter((l) => outcomeOf(l, line.line) === 'dossier').length;
  const content = [
    `# Miner day · ${fullDate(date)}`,
    '',
    `Day's line ${line.line}, drawn ${fullTime(new Date(line.drawnAt))}: ${whyTheLine(line)}`,
    '',
    `${count(dossiers, 'Dossier')} · ${count(launches.length - dossiers, 'Skip')} · ${count(line.featuredCount, 'Featured Launch', 'Featured Launches')} · [Data sourced from Product Hunt](${leaderboardUrl(date)})`,
    '',
    ...launches.map((l) => launchLine(l, line.line)),
    '',
  ].join('\n');
  return {
    path: `days/${date}.md`,
    content,
    message: `Miner day ${fullDate(date)}: ${count(dossiers, 'Dossier')}, line ${line.line}`,
  };
}

function launchLine(l: DayFileLaunch, line: number): string {
  const outcome = outcomeOf(l, line);
  const judged = outcome === 'dossier' ? `Dossier · fit ${l.fit}` : `Skip · fit ${l.fit}${outcome === 'not-a-product' ? ', not a Product' : ''}`;
  const rules = l.rulesApplied.length > 0 ? l.rulesApplied.map(plain).join(', ') : 'none';
  return `- [${plain(l.name)}](${launchUrl(l.slug)}) · ${judged} · ${plain(l.reason)} · Rules applied: ${rules}`;
}
