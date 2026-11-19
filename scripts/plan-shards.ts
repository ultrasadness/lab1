// The Bot workflow's shard plan (#110). Node's `--test-shard` dealt the test files out by their place in the sorted
// list and never looked at how long one takes, so after #57 one shard ran out of its 15 minutes while another took 8.
// This reads how long each test file took on an earlier run, from the shards' records restored into `test-times/`
// (`scripts/test-times.ts` writes them), packs the files into the fewest shards it finds that each add up to 8 minutes
// or less, and writes them to `$GITHUB_OUTPUT` as the test job's matrix, with the number of shards for the record job.
// It runs before `npm ci`, so it imports only Node's own.
import { appendFileSync, globSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The test files `npm test` runs when `TEST_FILES` isn't set: `package.json`'s test script names the same. */
const TEST_GLOBS = ['bot/test/**/*.test.ts', 'ops/test/**/*.test.ts', 'scripts/**/*.test.ts'];

/** A shard's limit: room for a run about 1.8 times its record before the job's 15 minutes run out. */
const LIMIT_MS = 8 * 60_000;
/** A file with no record is planned at this for each top-level `test(` call, which errs high: most take under 1. */
const ESTIMATE_MS = 10_000;
/** How many placings the search for the fewest shards tries at one count before settling for one more: 0.2 s. */
const SEARCH_STEPS = 1_000_000;
const RECORD_DIR = 'test-times';

type File = { path: string; ms: number; estimated: boolean };
type Shard = { files: File[]; ms: number };

/**
 * Each file's recorded time, from every shard's record of the run restored, or none when no run's was. A record that
 * doesn't parse is passed over, and a time that isn't a number of milliseconds: their files are then estimated.
 */
function readRecord(): Map<string, number> {
  const record = new Map<string, number>();
  let names: string[] = [];
  try {
    names = readdirSync(RECORD_DIR).filter((name) => name.endsWith('.json'));
  } catch {}
  for (const name of names.sort()) {
    let times: unknown;
    try {
      times = JSON.parse(readFileSync(join(RECORD_DIR, name), 'utf8'));
    } catch (e) {
      console.log(`::warning::${RECORD_DIR}/${name} isn't a record of times, so the plan passed it over: ${e}`);
      continue;
    }
    for (const [path, ms] of Object.entries(times ?? {})) {
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) record.set(path, ms);
    }
  }
  return record;
}

/** Spreads the files, slowest first, each to the shard with the least so far, or undefined when one goes over. */
function spread(files: File[], count: number): Shard[] | undefined {
  const shards: Shard[] = Array.from({ length: count }, () => ({ files: [], ms: 0 }));
  for (const file of files) {
    const least = shards.reduce((a, b) => (b.ms < a.ms ? b : a));
    least.files.push(file);
    least.ms += file.ms;
  }
  return shards.every((s) => s.ms <= LIMIT_MS) ? shards : undefined;
}

/**
 * Searches for a way to put the files into `count` shards of the limit or less, trying each file, slowest first, in
 * each shard it fits and backing up when one fits nowhere. It gives up after `SEARCH_STEPS`, so a list it can't settle
 * in time costs a shard more rather than the plan's 30 seconds.
 */
function search(files: File[], count: number): Shard[] | undefined {
  const shards: Shard[] = Array.from({ length: count }, () => ({ files: [], ms: 0 }));
  let steps = 0;
  const place = (i: number): boolean => {
    if (i === files.length) return true;
    if (++steps > SEARCH_STEPS) return false;
    const file = files[i]!;
    // Two shards holding the same time so far are the same choice.
    const tried = new Set<number>();
    for (const shard of shards) {
      if (shard.ms + file.ms > LIMIT_MS || tried.has(shard.ms)) continue;
      tried.add(shard.ms);
      shard.files.push(file);
      shard.ms += file.ms;
      if (place(i + 1)) return true;
      shard.files.pop();
      shard.ms -= file.ms;
    }
    return false;
  };
  return place(0) ? shards : undefined;
}

/**
 * The fewest shards found that each add up to the limit or less, after a shard of its own for each file over it. At
 * each count, from the fewest the sum allows, it spreads the files evenly, which leaves each shard the most room, and
 * searches for any way they fit where that doesn't. The fewest a packing could reach is a hard search, and the plan has
 * 30 seconds: a list whose shards are left no room, as in Codex's case in #110's third review, can cost a shard more.
 */
function pack(files: File[]): Shard[] {
  const slowest = [...files].sort((a, b) => b.ms - a.ms || a.path.localeCompare(b.path));
  const alone = slowest.filter((f) => f.ms > LIMIT_MS).map((f) => ({ files: [f], ms: f.ms }));
  const rest = slowest.filter((f) => f.ms <= LIMIT_MS);
  if (rest.length === 0) return alone;
  const total = rest.reduce((sum, f) => sum + f.ms, 0);
  for (let count = Math.max(1, Math.ceil(total / LIMIT_MS)); ; count++) {
    const shards = spread(rest, count) ?? search(rest, count);
    if (shards) return [...alone, ...shards];
  }
}

/** A file's recorded time, or with none, its top-level `test(` calls at 10 seconds each: a subtest is `t.test(`. */
function timed(path: string, record: Map<string, number>): File {
  const ms = record.get(path);
  if (ms !== undefined) return { path, ms, estimated: false };
  const calls = readFileSync(path, 'utf8').match(/(?<![\w.])test\(/g)?.length ?? 0;
  return { path, ms: calls * ESTIMATE_MS, estimated: true };
}

if (import.meta.main) {
  const record = readRecord();
  const files = globSync(TEST_GLOBS)
    .sort()
    .map((path) => timed(path, record));
  const shards = pack(files);
  const lightest = shards.reduce((a, b) => (b.ms <= a.ms ? b : a));
  const minutes = (ms: number) => (ms / 60_000).toFixed(1);
  // An estimate errs high, so only a file's recorded time names it as one to split.
  for (const f of files.filter((f) => f.ms > LIMIT_MS && !f.estimated)) {
    console.log(
      `::warning file=${f.path}::${f.path} took ${minutes(f.ms)} minutes, over a shard's 8, so it runs in a shard of its own. Split it.`,
    );
  }
  const estimated = files.filter((f) => f.estimated).length;
  console.log(`Planned ${shards.length} shards for ${files.length} test files, ${estimated} of them with no record.`);
  const include = shards.map((s, i) => {
    const shard = { shard: i + 1, files: s.files.map((f) => f.path).join(' '), planned_ms: Math.round(s.ms) };
    const unrecorded = s.files.filter((f) => f.estimated).length;
    console.log(
      `Shard ${shard.shard}, ${minutes(s.ms)} minutes, ${unrecorded} of its ${s.files.length} files estimated: ${shard.files}`,
    );
    return { ...shard, estimated: unrecorded, checks: s === lightest };
  });
  // Run by hand, it only prints the plan.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include })}\nshards=${shards.length}\n`);
  }
}
