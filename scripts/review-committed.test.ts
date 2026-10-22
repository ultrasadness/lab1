// The review-committed PreToolUse hook (the #47 retro): a code-review skill starts only on committed work that holds
// `main`, as CLAUDE.md's Code review section asks. Each test asks the hook about a skill in a throwaway repo.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = join(import.meta.dirname, '..', '.claude', 'hooks', 'review-committed.ts');

const env: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

/** A throwaway repo with one commit on `main`, and a ticket branch checked out with one commit of its own. */
function branch(t: TestContext): { dir: string; git: (...args: string[]) => void } {
  const dir = mkdtempSync(join(tmpdir(), 'review-committed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => assert.equal(spawnSync('git', args, { cwd: dir, env, timeout: 30_000 }).status, 0, `git ${args.join(' ')}`);
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'Start');
  git('switch', '-q', '-c', '47-dossiers');
  writeFileSync(join(dir, 'dossier.ts'), 'export {};\n');
  git('add', 'dossier.ts');
  git('commit', '-q', '-m', 'Write a Dossier');
  return { dir, git };
}

/** Asks the hook whether `skill` may start in `cwd`: the reason it refuses with, or undefined when it allows. */
function ask(cwd: string, skill: string): string | undefined {
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill }, cwd });
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 30_000, env });
  assert.equal(r.status, 0, r.stderr);
  if (!r.stdout.trim()) return undefined;
  const out = JSON.parse(r.stdout) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  return out.hookSpecificOutput.permissionDecisionReason;
}

test('a review of committed work that holds main starts', (t) => {
  const { dir } = branch(t);
  assert.equal(ask(dir, 'mattpocock-skills:code-review'), undefined);
  assert.equal(ask(dir, 'code-review'), undefined);
});

test('a review with work not yet committed, a new file among it, is refused until it is committed', (t) => {
  const { dir } = branch(t);
  writeFileSync(join(dir, 'card.ts'), 'export {};\n');
  assert.match(ask(dir, 'mattpocock-skills:code-review') ?? '', /^Commit the work first/);
  assert.match(ask(dir, 'code-review') ?? '', /^Commit the work first/);
});

test('a review of a branch that lacks commits main has is refused until it is rebased', (t) => {
  const { dir, git } = branch(t);
  git('switch', '-q', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'Hold a Miner date’s runs once its budget is spent');
  git('switch', '-q', '47-dossiers');
  assert.match(ask(dir, 'mattpocock-skills:code-review') ?? '', /^Rebase onto `main` first/);
  git('rebase', '-q', 'main');
  assert.equal(ask(dir, 'mattpocock-skills:code-review'), undefined);
});

test('any other skill starts whatever the checkout holds, and so does a review outside a git checkout', (t) => {
  const { dir } = branch(t);
  writeFileSync(join(dir, 'card.ts'), 'export {};\n');
  assert.equal(ask(dir, 'mattpocock-skills:tdd'), undefined);
  assert.equal(ask(dir, 'code-review-notes'), undefined);
  const outside = mkdtempSync(join(tmpdir(), 'review-committed-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  assert.equal(ask(outside, 'mattpocock-skills:code-review'), undefined);
});
