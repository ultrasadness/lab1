// The commit-msg hook (#90): a message that would close an issue the moment it reaches main is refused, since a ticket
// closes by hand once it has landed (docs/agents/issue-tracker.md, Close). Each test commits in a throwaway repo.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = join(import.meta.dirname, '..', '.githooks', 'commit-msg');

interface Repo {
  /** Commits with `message` and any further `git commit` arguments; says whether git committed, and what it printed. */
  commit(message: string, ...args: string[]): { ok: boolean; stderr: string };
  /** HEAD's message, or '' before the first commit. */
  head(): string;
  /** Writes `content` to `file` and stages it. */
  stage(file: string, content: string): void;
}

/**
 * A throwaway repo whose commits run the commit-msg hook alone: the pre-commit hook beside it needs this repo's
 * dependencies, so `.githooks/` itself can't be the hooks path.
 */
function repo(t: TestContext): Repo {
  const root = mkdtempSync(join(tmpdir(), 'commit-msg-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'hooks'));
  symlinkSync(HOOK, join(root, 'hooks', 'commit-msg'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    // An editor that keeps the message git hands it, for a commit run with --edit.
    GIT_EDITOR: 'true',
  };
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(git('init', '-q', '-b', 'main', 'work').status, 0);
  const work = (...args: string[]) => git('-C', 'work', ...args);
  const hooks = `core.hooksPath=${join(root, 'hooks')}`;
  return {
    commit(message, ...args) {
      const r = work('-c', hooks, 'commit', '-q', '--allow-empty', '-m', message, ...args);
      return { ok: r.status === 0, stderr: r.stderr };
    },
    head: () => work('log', '-1', '--format=%B').stdout.trim(),
    stage(file, content) {
      writeFileSync(join(root, 'work', file), content);
      assert.equal(work('add', file).status, 0);
    },
  };
}

/** Asserts the commit was refused and left HEAD alone, and returns what it printed. */
function refused(r: Repo, message: string, ...args: string[]): string {
  const before = r.head();
  const committed = r.commit(message, ...args);
  assert.equal(committed.ok, false, `committed: ${message}`);
  assert.equal(r.head(), before);
  return committed.stderr;
}

test('a message that closes an issue is refused, quoting its line and saying to write (#88) instead', (t) => {
  const said = refused(repo(t), 'Refuse a push to main\n\nCloses #88 once landed.');
  assert.match(said, /^ {2}Closes #88 once landed\.$/m);
  assert.match(said, /close\s+by\s+hand/);
  assert.match(said, /Close\s+in\s+docs\/agents\/issue-tracker\.md/);
  assert.match(said, /as\s+\(#88\)\s+instead/);
});

test('a refusal quotes each line that closes an issue and suggests the first one\'s reference', (t) => {
  const said = refused(repo(t), 'Fixes owner/repo#12\n\nThe hook (#88) also\nresolves #7.');
  assert.match(said, /^ {2}Fixes owner\/repo#12$/m);
  assert.match(said, /^ {2}resolves #7\.$/m);
  assert.doesNotMatch(said, /The hook/);
  assert.match(said, /as\s+\(owner\/repo#12\)\s+instead/);
});

// GitHub closes an issue whose reference a line break splits from its closing keyword: in #91's trial, each of
// these forms closed its issue once the commit reached the default branch.
test('a closing keyword that ends a line, before the reference that opens the next, is refused, quoting both lines', (t) => {
  const said = refused(repo(t), 'Subject\n\nThis commit fixes\n#88 for good.');
  assert.match(said, /^ {2}This commit fixes\n {2}#88 for good\.$/m);
  assert.match(said, /as\s+\(#88\)\s+instead/);
});

test('a closing keyword that ends the subject, before a body that opens with a reference, is refused, as 7310714 would be', (t) => {
  const said = refused(
    repo(t),
    'Say how a ticket lands on main and how it closes\n\n#76\'s session pieced the landing together.',
  );
  assert.match(said, /^ {2}Say how a ticket lands on main and how it closes\n {2}\n {2}#76's session pieced the landing together\.$/m);
  assert.match(said, /as\s+\(#76\)\s+instead/);
});

const KEYWORDS = ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];

for (const keyword of KEYWORDS) {
  test(`"${keyword}" before an issue reference is refused, in any case and with or without a colon`, (t) => {
    const r = repo(t);
    const capitalized = keyword.charAt(0).toUpperCase() + keyword.slice(1);
    for (const line of [
      `${keyword} #88`,
      `${capitalized}: #88`,
      `${keyword.toUpperCase()}:#88`,
      `This one ${keyword}  #88 too.`,
    ]) {
      refused(r, `Subject\n\n${line}`);
    }
  });
}

test('a closing keyword is refused before an issue in another repo and before an issue URL', (t) => {
  const r = repo(t);
  refused(r, 'Subject\n\nCloses ultrasadness/lab1#88');
  refused(r, 'Subject\n\nFixes https://github.com/ultrasadness/lab1/issues/88');
});

test('a message that mentions an issue without closing it goes through', (t) => {
  const r = repo(t);
  for (const message of [
    'Refuse a closing keyword in a commit message (#90)',
    'Fix the pre-push hook\n\nLeft for #72: the install on the VM.',
    'Prefixes and suffixes #12 alike\n\n#88\'s first commit message ended with a closing keyword.',
  ]) {
    const committed = r.commit(message);
    assert.equal(committed.ok, true, committed.stderr);
    assert.equal(r.head(), message);
  }
});

test('an amend is held to the same rule', (t) => {
  const r = repo(t);
  assert.equal(r.commit('Refuse a push to main').ok, true);
  refused(r, 'Refuse a push to main\n\nCloses #88 once landed.', '--amend');
  const amended = r.commit('Refuse a push to main (#88)', '--amend');
  assert.equal(amended.ok, true, amended.stderr);
  assert.equal(r.head(), 'Refuse a push to main (#88)');
});

test('a closing keyword in the staged diff that git commit --verbose shows below the message goes through', (t) => {
  const r = repo(t);
  r.stage('notes.txt', 'Closes #88 once landed.\n');
  const committed = r.commit('Write down how #88 nearly closed', '--edit', '--verbose');
  assert.equal(committed.ok, true, committed.stderr);
  assert.equal(r.head(), 'Write down how #88 nearly closed');
});
