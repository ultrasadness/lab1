// The slowest tests of a run (the #47 retro), for the Bot workflow's job summary. Each test has 60 seconds and the job
// 15 minutes, and a day's every new kind of run makes each test that posts a day slower: #47's Dossier runs took the
// tests from 170 to 466 seconds on CI. This reads the spec reporter's output of `npm test` on stdin and writes, as
// Markdown, the slowest tests and the run's total, so the growth shows before a limit is hit. Given a shard's plan
// (`scripts/plan-shards.ts`) and the record its tests wrote (`scripts/test-times.ts`), it gives the shard's planned
// time beside the time its tests took, so a plan that stops predicting shows too.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

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

/** A shard's plan: its planned time, how many of its files had no record, and the record its tests wrote. */
type Plan = { plannedMs: number; estimated: number; record: string };

/** The shard's planned time beside its tests' recorded time, both in minutes. */
function plannedBesideTaken({ plannedMs, estimated, record }: Plan): string {
  const minutes = (ms: number) => (ms / 60_000).toFixed(1);
  let took: number | undefined;
  try {
    const times = JSON.parse(readFileSync(record, 'utf8')) as Record<string, number>;
    took = Object.values(times).reduce((sum, ms) => sum + ms, 0);
  } catch {}
  const plan = `This shard was planned at ${minutes(plannedMs)} minutes`;
  if (took === undefined) return `${plan}, and its tests wrote no record.`;
  const unrecorded = estimated
    ? ` ${estimated} of its files had no record, and ${estimated === 1 ? 'was' : 'were'} planned at 10 seconds a test.`
    : '';
  return `${plan}, and its tests took ${minutes(took)}.${unrecorded}`;
}

/** The summary: a table of the slowest tests, then how many tests ran and for how long, then the shard's plan. */
export function summary(output: string, plan?: Plan): string {
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
    ...(plan ? [plannedBesideTaken(plan), ''] : []),
  ].join('\n');
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { 'planned-ms': { type: 'string' }, estimated: { type: 'string' }, record: { type: 'string' } },
  });
  const plan =
    values.record === undefined
      ? undefined
      : { plannedMs: Number(values['planned-ms']), estimated: Number(values.estimated ?? 0), record: values.record };
  process.stdout.write(summary(readFileSync(0, 'utf8'), plan));
}
