// The slowest-tests summary (the #47 retro): the Bot workflow pipes `npm test`'s output through it into the job summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dirname, 'slowest-tests.ts');

const summarize = (output: string) => {
  const r = spawnSync(process.execPath, [SCRIPT], { input: output, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

// As the spec reporter prints a run, a failing test listed again under "failing tests".
const RUN = [
  '✔ a 19-Launch day is judged at 01:00 PT and posted as one silent post, by band (6522.4ms)',
  '✖ a date that can’t finish is tried every 30 minutes (60409.47ms)',
  '  ✔ a subtest | with a pipe (12.5ms)',
  '✔ prints the ticket (275.16ms)',
  '✖ failing tests:',
  '',
  'test at bot/test/miner-catch-up.test.ts:33:1',
  '✖ a date that can’t finish is tried every 30 minutes (60409.47ms)',
  'ℹ tests 4',
  'ℹ pass 3',
  'ℹ fail 1',
  'ℹ duration_ms 188449.91',
].join('\n');

test('the summary lists the slowest tests first, each once, with the run’s count and total', () => {
  assert.equal(
    summarize(RUN),
    [
      '### Slowest tests',
      '',
      '| Seconds | Test |',
      '|---:|---|',
      '| 60.4 | a date that can’t finish is tried every 30 minutes |',
      '| 6.5 | a 19-Launch day is judged at 01:00 PT and posted as one silent post, by band |',
      '| 0.3 | prints the ticket |',
      '| 0.0 | a subtest \\| with a pipe |',
      '',
      '4 tests took 188.4 seconds.',
      '',
    ].join('\n'),
  );
});

test('a run that printed no tests still gets a summary, saying so', () => {
  assert.match(summarize('npm ERR! missing script: test\n'), /\|---:\|---\|\n\nThe run printed no totals\.\n$/);
});
