// The Bot workflow's shard plan (#110): how it packs the test files from their recorded times, what it plans for a file
// with no record, and a file too slow for any shard. Each test runs the plan in a throwaway checkout, as the plan job
// runs it after restoring the record into `test-times/`.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const PLAN = join(import.meta.dirname, 'plan-shards.ts');
const MINUTE = 60_000;

/** A test file holding `count` top-level tests. */
const tests = (count: number) =>
  `import { test } from 'node:test';\n${Array.from({ length: count }, (_, i) => `test('${i}', () => {});\n`).join('')}`;

function checkout(t: TestContext, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'plan-shards-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

type Shard = { shard: number; files: string; planned_ms: number; estimated: number; checks: boolean };

/** Runs the plan as the plan job does, and returns the matrix it hands the shards and what it printed. */
function plan(dir: string) {
  const output = join(dir, 'github-output');
  writeFileSync(output, '');
  const r = spawnSync(process.execPath, [PLAN], {
    cwd: dir,
    env: { ...process.env, GITHUB_OUTPUT: output },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(r.status, 0, r.stderr);
  const written = readFileSync(output, 'utf8');
  const line = written.match(/^matrix=(.*)$/m);
  assert.ok(line, 'the plan wrote no matrix');
  const shards = (JSON.parse(line[1]!) as { include: Shard[] }).include;
  // The record job keeps a run's record only once it holds as many shards' records as this.
  assert.equal(written.match(/^shards=(\d+)$/m)?.[1], String(shards.length));
  return { shards, out: r.stdout };
}

test('the files are packed slowest first into the fewest shards of 8 minutes or less, and the lightest runs the checks', (t) => {
  // 15 minutes of tests need 2 shards. Slowest first, each file goes to the shard with the least so far: 5 and 4 open
  // the two, 3 joins the 4, 2 the 5, and 1 the first of the two shards at 7.
  const dir = checkout(t, {
    'bot/test/five.test.ts': tests(3),
    'bot/test/four.test.ts': tests(3),
    'ops/test/three.test.ts': tests(3),
    'scripts/two.test.ts': tests(3),
    'scripts/one.test.ts': tests(3),
    'scripts/helper.ts': tests(3),
    'test-times/1.json': JSON.stringify({ 'bot/test/five.test.ts': 5 * MINUTE, 'ops/test/three.test.ts': 3 * MINUTE }),
    'test-times/2.json': JSON.stringify({
      'bot/test/four.test.ts': 4 * MINUTE,
      'scripts/two.test.ts': 2 * MINUTE,
      'scripts/one.test.ts': 1 * MINUTE,
    }),
  });
  assert.deepEqual(plan(dir).shards, [
    {
      shard: 1,
      files: 'bot/test/five.test.ts scripts/two.test.ts scripts/one.test.ts',
      planned_ms: 8 * MINUTE,
      estimated: 0,
      checks: false,
    },
    { shard: 2, files: 'bot/test/four.test.ts ops/test/three.test.ts', planned_ms: 7 * MINUTE, estimated: 0, checks: true },
  ]);
});

/** The shards the plan makes of files recorded at these times, in minutes or another unit, as those times. */
function packed(t: TestContext, times: number[], unit = MINUTE) {
  const dir = checkout(t, {
    ...Object.fromEntries(times.map((_, i) => [`bot/test/${i}.test.ts`, tests(1)])),
    'test-times/1.json': JSON.stringify(Object.fromEntries(times.map((m, i) => [`bot/test/${i}.test.ts`, m * unit]))),
  });
  return plan(dir).shards.map((s) => s.files.split(' ').map((f) => times[Number(f.match(/(\d+)\.test/)![1])]!));
}

test('when spreading the files evenly takes a shard more, the plan searches for the fewest that hold them', (t) => {
  // Codex's two cases in #110's review. Spread evenly, 3, 3, 2, 2, 2 and 2 leave 7 in each of 2 shards, and the last
  // 2 fits neither. Filled in turn, 5, 4, 3, 3, 3, 2, 2 and 2 take 4 shards, where 3 hold them at 8 minutes each.
  assert.deepEqual(packed(t, [3, 3, 2, 2, 2, 2, 2]), [
    [3, 3, 2],
    [2, 2, 2, 2],
  ]);
  assert.deepEqual(packed(t, [5, 4, 3, 3, 3, 2, 2, 2]), [
    [5, 3],
    [4, 2, 2],
    [3, 3, 2],
  ]);
});

test('a list the search can’t settle within its budget gets a shard more, rather than holding up the run', (t) => {
  // Codex's case in #110's third review: these 48 times, in seconds, fill 4 shards to exactly 8 minutes each, but no
  // shard is left any room, and a million placings don't find the way.
  const seconds = [
    [41, 52, 30, 47, 50, 23, 56, 46, 17, 52, 26, 40],
    [53, 52, 25, 27, 23, 57, 40, 35, 35, 54, 36, 43],
    [51, 26, 49, 31, 40, 28, 26, 52, 39, 40, 65, 33],
    [25, 49, 47, 36, 57, 31, 39, 45, 28, 36, 41, 46],
  ].flat();
  const shards = packed(t, seconds, 1000);
  assert.equal(shards.length, 5);
  assert.ok(shards.every((s) => s.reduce((a, b) => a + b, 0) <= 480));
});

test('a file with no record is planned at 10 seconds a top-level test, and a recorded file that is gone is dropped', (t) => {
  // 30 `test(` calls in the new file, its subtests and a method named test left out, plan 5 minutes. With the recorded
  // 4, that is 9 minutes, which needs 2 shards.
  const dir = checkout(t, {
    'bot/test/new.test.ts': `${tests(29)}for (const x of [1, 2]) test(\`\${x}\`, async (t) => {\n  await t.test('sub', () => {});\n  run.test(x);\n});\n`,
    'bot/test/old.test.ts': tests(1),
    'test-times/1.json': JSON.stringify({ 'bot/test/old.test.ts': 4 * MINUTE, 'bot/test/renamed.test.ts': 7 * MINUTE }),
  });
  const { shards, out } = plan(dir);
  assert.deepEqual(shards, [
    { shard: 1, files: 'bot/test/new.test.ts', planned_ms: 5 * MINUTE, estimated: 1, checks: false },
    { shard: 2, files: 'bot/test/old.test.ts', planned_ms: 4 * MINUTE, estimated: 0, checks: true },
  ]);
  assert.match(out, /^Shard 1, 5\.0 minutes, 1 of its 1 files estimated: bot\/test\/new\.test\.ts$/m);
});

test('a run that finds no record plans every file from its tests', (t) => {
  // Three files of 30 tests are 5 minutes each: 15 minutes would fit 2 shards by their sum, but no two files fit one.
  const dir = checkout(t, {
    'bot/test/a.test.ts': tests(30),
    'bot/test/b.test.ts': tests(30),
    'ops/test/c.test.ts': tests(30),
  });
  const { shards, out } = plan(dir);
  assert.deepEqual(
    shards.map((s) => [s.files, s.planned_ms, s.estimated]),
    [
      ['bot/test/a.test.ts', 5 * MINUTE, 1],
      ['bot/test/b.test.ts', 5 * MINUTE, 1],
      ['ops/test/c.test.ts', 5 * MINUTE, 1],
    ],
  );
  assert.match(out, /^Planned 3 shards for 3 test files, 3 of them with no record\.$/m);
});

test('a file over 8 minutes gets a shard to itself, and the plan names it as the file to split', (t) => {
  // 49 tests with no record plan 8.2 minutes, but an estimate errs high, so the plan doesn't say to split that file.
  const dir = checkout(t, {
    'bot/test/huge.test.ts': tests(1),
    'bot/test/many.test.ts': tests(49),
    'bot/test/a.test.ts': tests(1),
    'bot/test/b.test.ts': tests(1),
    'test-times/1.json': JSON.stringify({
      'bot/test/huge.test.ts': 9 * MINUTE,
      'bot/test/a.test.ts': 3 * MINUTE,
      'bot/test/b.test.ts': 2 * MINUTE,
    }),
  });
  const { shards, out } = plan(dir);
  assert.deepEqual(
    shards.map((s) => [s.files, s.planned_ms]),
    [
      ['bot/test/huge.test.ts', 9 * MINUTE],
      ['bot/test/many.test.ts', 49 * 10_000],
      ['bot/test/a.test.ts bot/test/b.test.ts', 5 * MINUTE],
    ],
  );
  assert.match(
    out,
    /^::warning file=bot\/test\/huge\.test\.ts::bot\/test\/huge\.test\.ts took 9\.0 minutes, over a shard's 8, so it runs in a shard of its own\. Split it\.$/m,
  );
  assert.doesNotMatch(out, /many\.test\.ts took/);
});

test('a record that does not read as times is passed over, and its files are planned from their tests', (t) => {
  const dir = checkout(t, {
    'bot/test/a.test.ts': tests(6),
    'bot/test/b.test.ts': tests(6),
    'bot/test/c.test.ts': tests(6),
    'test-times/1.json': '{"bot/test/a.test.ts": 12',
    'test-times/2.json': JSON.stringify({ 'bot/test/b.test.ts': 'slow', 'bot/test/c.test.ts': 2 * MINUTE }),
  });
  const { shards, out } = plan(dir);
  assert.deepEqual(
    shards.map((s) => [s.files, s.planned_ms, s.estimated]),
    [['bot/test/c.test.ts bot/test/a.test.ts bot/test/b.test.ts', 4 * MINUTE, 2]],
  );
  assert.match(out, /^::warning::test-times\/1\.json isn't a record of times, so the plan passed it over: /m);
});

/** What `npmTest` keeps from the test's own environment: each of these would stand in for the run it starts. */
const NOT_PASSED_ON = ['NODE_TEST_CONTEXT', 'TEST_FILES', 'TEST_RECORD', 'TEST_NAME'];

/** Runs `npm test` in a copy of the repo's test script and reporter, as a shard does, and returns what it printed. */
function npmTest(t: TestContext, files: Record<string, string>, env: NodeJS.ProcessEnv = {}) {
  const dir = checkout(t, {
    ...files,
    'package.json': readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    'scripts/test-times.ts': readFileSync(join(import.meta.dirname, 'test-times.ts'), 'utf8'),
  });
  // A test process passes the run it belongs to on to its children, which would report there instead, and a CI shard
  // passes on its own files and record, which would stand in for this test's (Codex's case in #110's review), as a
  // session running one test by name would pass on its name.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !NOT_PASSED_ON.includes(name)));
  const r = spawnSync('npm', ['test'], { cwd: dir, env: { ...inherited, ...env }, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  return { dir, out: r.stdout };
}

const passing = (name: string) => `import { test } from 'node:test';\ntest('${name}', () => {});\n`;

test('npm test with nothing set runs every file the plan plans, and with TEST_FILES only those', (t) => {
  const files = {
    'bot/test/a.test.ts': passing('ran bot/test/a'),
    'ops/test/deeper/b.test.ts': passing('ran ops/test/deeper/b'),
    'scripts/c.test.ts': passing('ran scripts/c'),
    'bot/src/d.test.ts': passing('ran bot/src/d'),
    'ops/e.test.ts': passing('ran ops/e'),
    'pi/f.test.ts': passing('ran pi/f'),
  };
  const planned = plan(checkout(t, files)).shards.flatMap((s) => s.files.split(' ')).sort();
  assert.deepEqual(planned, ['bot/test/a.test.ts', 'ops/test/deeper/b.test.ts', 'scripts/c.test.ts']);
  const ran = (out: string) => [...out.matchAll(/^✔ ran (\S+)/gm)].map((m) => `${m[1]}.test.ts`).sort();
  assert.deepEqual(ran(npmTest(t, files).out), planned);
  assert.deepEqual(ran(npmTest(t, files, { TEST_FILES: 'scripts/c.test.ts bot/test/a.test.ts' }).out), [
    'bot/test/a.test.ts',
    'scripts/c.test.ts',
  ]);
});

test('with TEST_NAME set, npm test runs only the tests whose names match it, a pattern with spaces and | included', (t) => {
  const files = {
    'bot/test/a.test.ts': `import { test } from 'node:test';\ntest('ran a wall card', () => {});\ntest('ran a Handoff', () => {});\n`,
    'scripts/c.test.ts': passing('ran a Submit tap'),
  };
  const ran = (out: string) => [...out.matchAll(/^✔ (ran .+?) \(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(ran(npmTest(t, files, { TEST_NAME: 'wall card|Submit tap' }).out), ['ran a Submit tap', 'ran a wall card']);
  assert.deepEqual(ran(npmTest(t, files, { TEST_FILES: 'bot/test/a.test.ts', TEST_NAME: 'a Handoff' }).out), ['ran a Handoff']);
});

test('with TEST_RECORD set, npm test records each file’s top-level tests’ times added up, beside its usual output', (t) => {
  const sleep = 'const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));\n';
  const { dir, out } = npmTest(
    t,
    {
      'bot/test/slow.test.ts': `import { test } from 'node:test';\n${sleep}test('one', () => sleep(200));\ntest('two', async (t) => {\n  await t.test('sub', () => sleep(2000));\n});\n`,
      'scripts/quick.test.ts': passing('quick'),
    },
    { TEST_RECORD: 'times.json' },
  );
  assert.match(out, /^✔ one \(/m);
  const record = JSON.parse(readFileSync(join(dir, 'times.json'), 'utf8')) as Record<string, number>;
  assert.deepEqual(Object.keys(record).sort(), ['bot/test/slow.test.ts', 'scripts/quick.test.ts']);
  // Its two tests took 200 ms and 2 s. Counting the subtest again would make it 4.2 s, and a second left for a slow
  // runner's late timers.
  const slow = record['bot/test/slow.test.ts']!;
  assert.ok(slow >= 2200 && slow < 3200, `${slow}`);
  assert.ok(record['scripts/quick.test.ts']! < 400);
});

test('with TEST_RECORD set, npm test runs one file at a time, as the plan adds up their times', (t) => {
  // Each test notes when it started and ended. Node otherwise runs a file for each CPU but one at once: 3 on the 4-CPU
  // runner a public repo gets, which would put each file's time into a shard's sum while others ran beside it.
  const timed = (name: string) =>
    `import { test } from 'node:test';\nimport { appendFileSync } from 'node:fs';\ntest('${name}', async () => {\n  const start = Date.now();\n  await new Promise((r) => setTimeout(r, 300));\n  appendFileSync('spans', \`\${start} \${Date.now()}\\n\`);\n});\n`;
  const { dir } = npmTest(
    t,
    { 'bot/test/a.test.ts': timed('a'), 'bot/test/b.test.ts': timed('b'), 'scripts/c.test.ts': timed('c') },
    { TEST_RECORD: 'times.json' },
  );
  const spans = readFileSync(join(dir, 'spans'), 'utf8').trim().split('\n').map((l) => l.split(' ').map(Number));
  spans.sort((x, y) => x[0]! - y[0]!);
  assert.equal(spans.length, 3);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i]![0]! >= spans[i - 1]![1]!, JSON.stringify(spans));
});
