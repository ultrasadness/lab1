// The slowest tests of a run (the #47 retro), for the Bot workflow's job summary. Each test has 60 seconds and the job
// 15 minutes, and a day's every new kind of run makes each test that posts a day slower: #47's Dossier runs took the
// tests from 170 to 466 seconds on CI. This reads the spec reporter's output of `npm test` on stdin and writes, as
// Markdown, the slowest tests and the run's total, so the growth shows before a limit is hit.
import { readFileSync } from 'node:fs';

const SHOWN = 10;

/** Each test's name and time in milliseconds, slowest first, once each: a failing test is listed again at the end. */
export function slowest(output: string): { name: string; ms: number }[] {
  const times = new Map<string, number>();
  for (const line of output.split('\n')) {
    const m = line.match(/^\s*[✔✖] (.+) \(([\d.]+)ms\)$/);
    if (m) times.set(m[1]!, Math.max(times.get(m[1]!) ?? 0, Number(m[2])));
  }
  return [...times].map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms);
}

/** The summary: a table of the slowest tests, then how many tests ran and for how long. */
export function summary(output: string): string {
  const tests = slowest(output);
  const count = output.match(/^ℹ tests (\d+)$/m)?.[1];
  const total = output.match(/^ℹ duration_ms ([\d.]+)$/m)?.[1];
  const seconds = (ms: number) => (ms / 1000).toFixed(1);
  return [
    '### Slowest tests',
    '',
    '| Seconds | Test |',
    '|---:|---|',
    ...tests.slice(0, SHOWN).map((t) => `| ${seconds(t.ms)} | ${t.name.replace(/\|/g, '\\|')} |`),
    '',
    count && total ? `${count} tests took ${seconds(Number(total))} seconds.` : 'The run printed no totals.',
    '',
  ].join('\n');
}

if (import.meta.main) process.stdout.write(summary(readFileSync(0, 'utf8')));
