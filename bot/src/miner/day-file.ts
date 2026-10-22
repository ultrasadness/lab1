// The Miner day's view in the Personal database (#37): `days/<YYYY-MM-DD>.md`, written from the live store once the
// day is judged, and rewritten when a Correction changes the day. It holds the Day's line, then one line per Featured
// Launch in Product Hunt order, so a line keeps its place when a Correction rewrites it. A corrected line shows its new
// judgment "after your Correction", then each Correction with its date: what it was, what the person wrote, and once
// its sort has settled (#49), what came of it. Like every date the bot writes there, the day's carries its year and
// zone.
import { fullDate, fullTime, leaderboardUrl } from '../pacific.ts';
import { plain } from '../personal-database.ts';
import type { StoredDayLine } from '../store.ts';
import { count, launchUrl, whyTheLine, type DayPostLaunch } from './day-post.ts';
import { outcomeOf, type JudgedLaunch } from './day-line.ts';

export interface DayFileLaunch extends Omit<DayPostLaunch, 'postId' | 'rank'> {
  /**
   * Each Correction re-judged, oldest first: when, the judgment it was made on, what the person wrote, and what came of
   * its sort once nothing more waits on it.
   */
  corrections: { at: string; was: JudgedLaunch; text: string; sort: string | null }[];
}

/** The file to write: where it goes, what it holds, and its commit's message. */
export interface DayFile {
  path: string;
  content: string;
  message: string;
}

/** The day's file, from its stored line and its Launches in Product Hunt order, and what changed it, if anything did. */
export function renderDayFile(input: { date: string; line: StoredDayLine; launches: DayFileLaunch[]; change?: string }): DayFile {
  const { date, line, launches, change } = input;
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
    message: `Miner day ${fullDate(date)}: ${change ? `${change}, ` : ''}${count(dossiers, 'Dossier')}, line ${line.line}`,
  };
}

/** `Dossier · fit 8`, or `Skip · fit 2, not a Product`. */
function judged(j: JudgedLaunch, line: number): string {
  const outcome = outcomeOf(j, line);
  return outcome === 'dossier' ? `Dossier · fit ${j.fit}` : `Skip · fit ${j.fit}${outcome === 'not-a-product' ? ', not a Product' : ''}`;
}

function launchLine(l: DayFileLaunch, line: number): string {
  const after = l.corrections.length > 0 ? ' after your Correction' : '';
  const rules = l.rulesApplied.length > 0 ? l.rulesApplied.map(plain).join(', ') : 'none';
  const corrections = l.corrections.map(
    (c) => ` · Corrected ${fullTime(new Date(c.at))}: was ${judged(c.was, line)}, you wrote "${plain(c.text)}"${c.sort ? `, ${plain(c.sort)}` : ''}`,
  );
  return `- [${plain(l.name)}](${launchUrl(l.slug)}) · ${judged(l, line)}${after} · ${plain(l.reason)} · Rules applied: ${rules}${corrections.join('')}`;
}
