// The shell check (#71 retro): what it takes for a shell script, what it leaves out, and what it says when shellcheck
// isn't there. Each test runs it in a throwaway folder.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const CHECK = join(import.meta.dirname, 'check-shell.ts');
/** A script shellcheck refuses: an unquoted variable (SC2086). */
const UNQUOTED = '#!/bin/sh\nrm -f $1\n';

function folder(t: TestContext, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-shell-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

const check = (dir: string, env: NodeJS.ProcessEnv = process.env) => {
  const r = spawnSync(process.execPath, [CHECK], { cwd: dir, env, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('every file with a sh or bash shebang is checked, whatever its name', (t) => {
  const dir = folder(t, {
    '.githooks/pre-push': UNQUOTED,
    'ops/install': UNQUOTED.replace('#!/bin/sh', '#!/usr/bin/env bash'),
    'tools/run.sh': '#!/bin/bash\nrm -f "$1"\n',
    'notes.txt': 'rm -f $1\n',
    'script.py': '#!/usr/bin/env python3\nprint(1)\n',
  });
  const ran = check(dir);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /In \.githooks\/pre-push line 2:/);
  assert.match(ran.out, /In ops\/install line 2:/);
  assert.doesNotMatch(ran.out, /tools\/run\.sh|notes\.txt|script\.py/);
});

test("installed dependencies, links and other sessions' worktrees are left out", (t) => {
  const dir = folder(t, {
    'node_modules/pkg/bin.sh': UNQUOTED,
    '.claude/worktrees/ticket/ops/install': UNQUOTED,
    'ok.sh': '#!/bin/sh\necho ok\n',
  });
  symlinkSync(join(dir, 'node_modules/pkg/bin.sh'), join(dir, 'linked.sh'));
  const ran = check(dir);
  assert.equal(ran.code, 0, ran.out);
  assert.match(ran.out, /^1 shell scripts pass shellcheck\.$/m);
});

test("without shellcheck, the check fails and says how to install it", (t) => {
  const dir = folder(t, { 'ok.sh': '#!/bin/sh\necho ok\n' });
  const ran = check(dir, { ...process.env, PATH: dirname(process.execPath) });
  assert.equal(ran.code, 1);
  assert.match(ran.out, /shellcheck isn't installed: sudo apt-get install shellcheck/);
});
