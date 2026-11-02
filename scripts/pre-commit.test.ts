// The pre-commit hook's typecheck of the browser service (#89): browser/ is a package of its own, so the hook runs its
// typecheck too, with its own dependencies, on the staged copy. And its hold on the live store's schema fixtures
// (#98): a commit may add one, but not change, delete or rename one that main holds. And its shell check (#71 retro):
// a staged shell script that shellcheck refuses refuses the commit. And its source checks (#96 retro): a staged file
// that `npm run check:source` refuses refuses the commit. Each test commits in a throwaway
// repo shaped like this one: a root package and a browser/ package, each with a small typecheck. Their tsc is this
// repo's own, and browser/'s dependencies hold a package the root's don't, which browser/'s code imports.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const HOOK = join(import.meta.dirname, '..', '.githooks', 'pre-commit');
const CHECK_SHELL = join(import.meta.dirname, 'check-shell.ts');
const NODE_MODULES = join(import.meta.dirname, '..', 'node_modules');

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, module: 'nodenext', types: [] },
  include: ['src'],
});

/** browser/src/index.ts, typed against the package only browser/'s dependencies hold. */
const BROWSER_CODE = "import { width } from 'only-in-browser';\nexport const w: number = width;\n";
const BROWSER_TYPE_ERROR = "import { width } from 'only-in-browser';\nexport const w: string = width;\n";

interface Repo {
  /** The checkout's top directory. */
  dir: string;
  /** Writes `content` to `file` in the checkout, making its directory; with `stage`, stages it too. */
  write(file: string, content: string, opts?: { stage?: boolean }): void;
  /** Removes `file` from the checkout, staged. */
  remove(file: string): void;
  /** Commits what is staged; says whether git committed, and what it printed. */
  commit(): { ok: boolean; stderr: string };
  /** A linked worktree of a new branch, with neither package's dependencies installed. */
  worktree(): Repo;
}

/** Installs the root package's dependencies in `dir`, by linking this repo's own. */
function installRootDependencies(dir: string) {
  symlinkSync(NODE_MODULES, join(dir, 'node_modules'));
}

/** Installs browser/'s dependencies in `dir`: this repo's tsc, and a package the root's dependencies don't hold. */
function installBrowserDependencies(dir: string) {
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  symlinkSync(join(NODE_MODULES, 'typescript', 'bin', 'tsc'), join(dir, 'node_modules', '.bin', 'tsc'));
  const only = join(dir, 'node_modules', 'only-in-browser');
  mkdirSync(only);
  writeFileSync(join(only, 'package.json'), JSON.stringify({ name: 'only-in-browser', types: './index.d.ts' }));
  writeFileSync(join(only, 'index.d.ts'), 'export declare const width: number;\n');
}

/**
 * A throwaway repo whose first commit holds both packages, with both packages' dependencies installed. Its commits
 * run the pre-commit hook alone, so a commit's message needs nothing of the commit-msg hook.
 */
function repo(t: TestContext): Repo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pre-commit-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'hooks'));
  symlinkSync(HOOK, join(root, 'hooks', 'pre-commit'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  const hooks = `core.hooksPath=${join(root, 'hooks')}`;

  const checkout = (dir: string): Repo => {
    const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, env, encoding: 'utf8', timeout: 60_000 });
    const must = (...args: string[]) => {
      const r = git(...args);
      assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    };
    return {
      dir,
      write(file, content, { stage = false } = {}) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), content);
        if (stage) must('add', file);
      },
      remove(file) {
        must('rm', '-q', file);
      },
      commit() {
        const r = git('-c', hooks, 'commit', '-q', '--allow-empty', '-m', 'A change');
        return { ok: r.status === 0, stderr: r.stderr };
      },
      worktree() {
        const wt = join(root, 'worktree');
        must('worktree', 'add', '-q', wt, '-b', 'ticket');
        return checkout(wt);
      },
    };
  };

  const work = join(root, 'work');
  mkdirSync(work);
  assert.equal(spawnSync('git', ['init', '-q', '-b', 'main', work], { env, timeout: 60_000 }).status, 0);
  const r = checkout(work);
  r.write('.gitignore', 'node_modules\n', { stage: true });
  r.write('package.json', JSON.stringify({
    private: true,
    type: 'module',
    scripts: {
      typecheck: 'tsc -p .',
      'check:docs': 'true',
      'check:shell': `node ${CHECK_SHELL}`,
      // Stands for the real check, whose files this throwaway repo doesn't hold: it refuses one staged file.
      'check:source': 'test ! -e src/refused-by-a-source-check.ts',
    },
  }), { stage: true });
  r.write('tsconfig.json', TSCONFIG, { stage: true });
  r.write('src/index.ts', 'export const n: number = 1;\n', { stage: true });
  // The browser service's tests build an image, so the hook mustn't run them: these fail whenever they run.
  r.write('browser/package.json', JSON.stringify({
    private: true,
    type: 'module',
    scripts: { typecheck: 'tsc -p .', test: 'echo the hook ran the browser tests >&2; exit 1' },
  }), { stage: true });
  r.write('browser/tsconfig.json', TSCONFIG, { stage: true });
  r.write('browser/src/index.ts', BROWSER_CODE, { stage: true });
  const first = spawnSync('git', ['commit', '-q', '-m', 'Both packages'], {
    cwd: work,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(first.status, 0, first.stderr);
  installRootDependencies(work);
  installBrowserDependencies(join(work, 'browser'));
  return r;
}

/** Asserts the commit was refused, and returns what it printed. */
function refused(r: Repo): string {
  const committed = r.commit();
  assert.equal(committed.ok, false, `committed: ${committed.stderr}`);
  return committed.stderr;
}

test('a type error staged in browser/ refuses the commit, though the working copy has it fixed', (t) => {
  const r = repo(t);
  r.write('browser/src/index.ts', BROWSER_TYPE_ERROR, { stage: true });
  r.write('browser/src/index.ts', BROWSER_CODE);
  const said = refused(r);
  assert.match(said, /src\/index\.ts.*TS2322/);
  assert.ok(said.includes(`the typecheck in ${r.dir}/browser failed, so the commit is refused`), said);
});

test('a commit whose staged browser/ passes its typecheck goes through, though the working copy has an error', (t) => {
  const r = repo(t);
  r.write('browser/src/index.ts', `${BROWSER_CODE}export const h: number = width;\n`, { stage: true });
  r.write('browser/src/index.ts', BROWSER_TYPE_ERROR);
  const committed = r.commit();
  assert.equal(committed.ok, true, committed.stderr);
  assert.doesNotMatch(committed.stderr, /ran the browser tests/);
});

test('a checkout without browser/\'s dependencies refuses the commit, naming browser/ alone to run npm ci in', (t) => {
  const r = repo(t);
  rmSync(join(r.dir, 'browser', 'node_modules'), { recursive: true });
  const said = refused(r);
  assert.ok(said.includes(`none are installed in:\n  ${r.dir}/browser\nRun npm ci in each`), said);
  assert.doesNotMatch(said, /ln -s/);
});

test('a commit in a worktree with no dependencies is refused, naming each package to run npm ci in', (t) => {
  const r = repo(t);
  const wt = r.worktree();
  const said = refused(wt);
  assert.ok(said.includes(`none are installed in:\n  ${wt.dir}\n  ${wt.dir}/browser\nRun npm ci in each`), said);
  assert.doesNotMatch(said, /ln -s/);
});

test('a staged shell script that fails shellcheck refuses the commit, and one fixed goes through', (t) => {
  const r = repo(t);
  // An unquoted variable splits on spaces (SC2086); the working copy's fix doesn't count until it is staged.
  r.write('tools/run.sh', '#!/bin/sh\nset -eu\nrm -f $1\n', { stage: true });
  r.write('tools/run.sh', '#!/bin/sh\nset -eu\nrm -f "$1"\n');
  const said = refused(r);
  assert.match(said, /tools\/run\.sh line 3:[\s\S]*SC2086/);
  assert.match(said, /a shell script fails shellcheck, so the commit is refused/);
  r.write('tools/run.sh', '#!/bin/sh\nset -eu\nrm -f "$1"\n', { stage: true });
  const committed = r.commit();
  assert.equal(committed.ok, true, committed.stderr);
});

const FIXTURE = 'bot/test/fixtures/store-schemas/1.sql';
const SCHEMA_1 = 'CREATE TABLE launches (post_id TEXT PRIMARY KEY);\n';

test('a staged file a source check refuses refuses the commit, and it runs on the staged copy alone', (t) => {
  const r = repo(t);
  // Unstaged, it doesn't count.
  r.write('src/refused-by-a-source-check.ts', 'export const a = 1;\n');
  assert.equal(r.commit().ok, true);

  r.write('src/refused-by-a-source-check.ts', 'export const a = 1;\n', { stage: true });
  assert.match(refused(r), /a source check failed, so the commit is refused/);
});

test('a commit that changes or deletes a store-schema fixture main holds is refused, naming it', (t) => {
  const r = repo(t);
  r.write(FIXTURE, SCHEMA_1, { stage: true });
  assert.equal(r.commit().ok, true, 'a new fixture is let through');

  r.write(FIXTURE, 'CREATE TABLE launches (post_id TEXT PRIMARY KEY, rank INTEGER);\n', { stage: true });
  const changed = refused(r);
  assert.ok(changed.includes(`a store-schema fixture that main holds is changed, deleted or renamed, so the commit is refused:\n  ${FIXTURE}\n`), changed);
  r.write(FIXTURE, SCHEMA_1, { stage: true });

  r.remove(FIXTURE);
  r.write('bot/test/fixtures/store-schemas/2.sql', SCHEMA_1, { stage: true });
  const renamed = refused(r);
  assert.ok(renamed.includes(`so the commit is refused:\n  ${FIXTURE}\n`), renamed);
});

test('a commit that adds the next store-schema fixture beside those main holds goes through, from a worktree too', (t) => {
  const r = repo(t);
  r.write(FIXTURE, SCHEMA_1, { stage: true });
  assert.equal(r.commit().ok, true);
  const wt = r.worktree();
  installRootDependencies(wt.dir);
  installBrowserDependencies(join(wt.dir, 'browser'));
  wt.write('bot/test/fixtures/store-schemas/2.sql', 'CREATE TABLE launches (post_id TEXT PRIMARY KEY, rank INTEGER);\n', { stage: true });
  // A fixture main holds, unchanged in the working copy's staged files, though changed and unstaged.
  wt.write(FIXTURE, 'not staged');
  const committed = wt.commit();
  assert.equal(committed.ok, true, committed.stderr);
});
