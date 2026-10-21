// "Every wait has a bound" (CODING_STANDARDS.md), checked where it is mechanical (from the retro on #89). A synchronous
// child process blocks the event loop, so neither a timer nor --test-timeout can end it: only its own timeout option
// does. This reads the repo's TypeScript files, staged or not, for each call of spawnSync, execSync or execFileSync,
// and fails on one whose arguments name no timeout. It reads them as text: a call named in a comment is skipped, and
// a call's parentheses are matched with no regard to strings, since an apostrophe in a comment or a regex is common
// and an unmatched parenthesis in a string is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SYNC_CALL = /\b(?:spawnSync|execSync|execFileSync)\s*\(/g;

/** The text between a call's opening parenthesis at `open` and the one that closes it. */
function argumentsOf(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

test('every synchronous child process in the repo has a timeout', () => {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  }).split('\n').filter(Boolean);
  const unbounded: string[] = [];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    for (const call of source.matchAll(SYNC_CALL)) {
      const before = source.slice(source.lastIndexOf('\n', call.index) + 1, call.index);
      if (/\/\/|\/\*|^\s*\*/.test(before)) continue;
      const open = call.index + call[0].length - 1;
      if (!/\btimeout\b/.test(argumentsOf(source, open))) {
        unbounded.push(`${file}:${source.slice(0, call.index).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(unbounded, [], `synchronous calls with no timeout in their own arguments: ${unbounded.join(', ')}`);
});
