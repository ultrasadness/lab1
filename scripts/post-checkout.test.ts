// The post-checkout hook (from the retro on #89): `git worktree add` installs each package's dependencies in the new
// worktree with npm ci, so the pre-commit hook's typechecks can run there, and links nothing to the main checkout's.
// And the post-merge hook (from the retro on #96): a merge that changes a package-lock.json installs that package's
// dependencies, so landing a ticket leaves the main checkout able to typecheck and test.
// Each test adds a worktree to, or merges in, a throwaway repo shaped like this one: a root package and a browser/
// package, each depending on a package of its own in the repo (`file:`), so npm ci needs no network.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const HOOKS = join(import.meta.dirname, '..', '.githooks');

interface Repo {
  /** The main checkout's top directory. */
  main: string;
  /** Writes `files` in the main checkout and commits them on a new `branch`, then goes back to main. */
  branch(branch: string, files: Record<string, string>): void;
  /** Adds a worktree with `git worktree add`, of a new branch or of `branch`; says what git printed, and where. */
  worktree(branch?: string): { dir: string; ok: boolean; stderr: string };
  /** Merges `branch` into the main checkout with a fast-forward; says what git printed. */
  merge(branch: string): { ok: boolean; stderr: string };
  /** Runs git in `dir` with the hooks on, and asserts it succeeded. */
  must(dir: string, ...args: string[]): void;
}

/**
 * A package's package.json and package-lock.json, as npm writes them, for a package named `name` that depends on
 * each of `deps`, kept under vendor/ beside it.
 */
function manifests(name: string, deps: string[]): Record<string, string> {
  const dependencies = Object.fromEntries(deps.map((dep) => [dep, `file:vendor/${dep}`]));
  const packages: Record<string, object> = { '': { name, version: '1.0.0', dependencies } };
  const vendored: Record<string, string> = {};
  for (const dep of deps) {
    packages[`vendor/${dep}`] = { version: '1.0.0' };
    packages[`node_modules/${dep}`] = { resolved: `vendor/${dep}`, link: true };
    vendored[`vendor/${dep}/package.json`] = JSON.stringify({ name: dep, version: '1.0.0' });
  }
  return {
    'package.json': JSON.stringify({ name, version: '1.0.0', dependencies }),
    'package-lock.json': JSON.stringify({ name, version: '1.0.0', lockfileVersion: 3, requires: true, packages }),
    ...vendored,
  };
}

/** `files` with each path under `dir`. */
function under(dir: string, files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([file, content]) => [join(dir, file), content]));
}

/**
 * A throwaway repo whose main checkout holds both packages, with no dependencies installed. Its checkouts and merges
 * run the post-checkout and post-merge hooks alone.
 */
function repo(t: TestContext): Repo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'post-checkout-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'hooks'));
  for (const hook of ['post-checkout', 'post-merge']) symlinkSync(join(HOOKS, hook), join(root, 'hooks', hook));
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
  const git = (dir: string, ...args: string[]) =>
    spawnSync('git', ['-c', hooks, ...args], { cwd: dir, env, encoding: 'utf8', timeout: 60_000 });
  const must = (dir: string, ...args: string[]) => {
    const r = git(dir, ...args);
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  const main = join(root, 'main');
  const write = (files: Record<string, string>) => {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(main, file)), { recursive: true });
      writeFileSync(join(main, file), content);
    }
  };

  mkdirSync(main);
  must(main, 'init', '-q', '-b', 'main');
  write({ '.gitignore': 'node_modules\n', ...manifests('root', ['dep']), ...under('browser', manifests('browser', ['dep'])) });
  must(main, 'add', '-A');
  must(main, 'commit', '-q', '-m', 'Both packages');

  let worktrees = 0;
  return {
    main,
    branch(branch, files) {
      must(main, 'switch', '-q', '-c', branch);
      write(files);
      must(main, 'add', '-A');
      must(main, 'commit', '-q', '-m', `Change ${Object.keys(files).join(', ')}`);
      must(main, 'switch', '-q', 'main');
    },
    worktree(branch) {
      const dir = join(root, `worktree-${++worktrees}`);
      const r = git(main, 'worktree', 'add', '-q', dir, ...(branch ? [branch] : ['-b', `ticket-${worktrees}`]));
      return { dir, ok: r.status === 0, stderr: r.stderr };
    },
    merge(branch) {
      const r = git(main, 'merge', '-q', '--ff-only', branch);
      return { ok: r.status === 0, stderr: r.stderr };
    },
    must,
  };
}

/** Asserts `dir` has a node_modules of its own, a directory and not a link, with each of `deps` installed. */
function installed(dir: string, ...deps: string[]) {
  assert.equal(lstatSync(join(dir, 'node_modules')).isDirectory(), true, `${dir}/node_modules is no directory`);
  for (const dep of deps) {
    assert.equal(existsSync(join(dir, 'node_modules', dep, 'package.json')), true, `${dep} is not in ${dir}`);
  }
}

test('a new worktree gets each package\'s dependencies installed with npm ci, its own and not linked', (t) => {
  const r = repo(t);
  const wt = r.worktree();
  assert.equal(wt.ok, true, wt.stderr);
  installed(wt.dir, 'dep');
  installed(join(wt.dir, 'browser'), 'dep');
  assert.equal(existsSync(join(r.main, 'node_modules')), false);
});

test('a worktree of a branch with another package-lock.json gets that branch\'s dependencies', (t) => {
  const r = repo(t);
  r.branch('upgrade', under('browser', manifests('browser', ['dep', 'extra'])));
  const wt = r.worktree('upgrade');
  assert.equal(wt.ok, true, wt.stderr);
  installed(join(wt.dir, 'browser'), 'dep', 'extra');
});

test('a failed install says to run npm ci there again, and the worktree is made anyway', (t) => {
  const r = repo(t);
  // A package.json naming a dependency its package-lock.json doesn't hold, which npm ci refuses.
  r.branch('out-of-step', { 'browser/package.json': JSON.stringify({ name: 'browser', dependencies: { gone: '1.0.0' } }) });
  const wt = r.worktree('out-of-step');
  assert.equal(wt.ok, true, wt.stderr);
  assert.ok(wt.stderr.includes(`npm ci failed in ${wt.dir}/browser, as above`), wt.stderr);
  installed(wt.dir, 'dep');
});

test('a worktree of a commit with no browser/ installs the root\'s dependencies and says nothing of browser/', (t) => {
  const r = repo(t);
  r.must(r.main, 'switch', '-q', '-c', 'before-browser');
  r.must(r.main, 'rm', '-q', '-r', 'browser');
  r.must(r.main, 'commit', '-q', '-m', 'No browser/ yet');
  r.must(r.main, 'switch', '-q', 'main');
  const wt = r.worktree('before-browser');
  assert.equal(wt.ok, true, wt.stderr);
  installed(wt.dir, 'dep');
  assert.doesNotMatch(wt.stderr, /browser/);
});

test('a branch switch in an existing worktree installs nothing', (t) => {
  const r = repo(t);
  const wt = r.worktree();
  assert.equal(wt.ok, true, wt.stderr);
  rmSync(join(wt.dir, 'browser', 'node_modules'), { recursive: true });
  r.must(wt.dir, 'switch', '-q', '-c', 'another');
  assert.equal(existsSync(join(wt.dir, 'browser', 'node_modules')), false);
});

test('a clone installs nothing', (t) => {
  const r = repo(t);
  const clone = join(dirname(r.main), 'clone');
  r.must(dirname(r.main), 'clone', '-q', r.main, clone);
  assert.equal(existsSync(join(clone, 'package.json')), true);
  assert.equal(existsSync(join(clone, 'node_modules')), false);
});

test('a fast-forward that changes a package-lock.json installs that package\'s dependencies, and no other\'s', (t) => {
  const r = repo(t);
  r.branch('upgrade', under('browser', manifests('browser', ['dep', 'extra'])));
  const merged = r.merge('upgrade');
  assert.equal(merged.ok, true, merged.stderr);
  installed(join(r.main, 'browser'), 'dep', 'extra');
  assert.equal(existsSync(join(r.main, 'node_modules')), false);
});

test('a fast-forward that changes the root\'s package-lock.json installs the root\'s dependencies', (t) => {
  const r = repo(t);
  r.branch('upgrade', manifests('root', ['dep', 'extra']));
  const merged = r.merge('upgrade');
  assert.equal(merged.ok, true, merged.stderr);
  installed(r.main, 'dep', 'extra');
  assert.equal(existsSync(join(r.main, 'browser', 'node_modules')), false);
});

test('a merge that changes no package-lock.json installs nothing', (t) => {
  const r = repo(t);
  r.branch('docs', { 'notes.md': 'A note.\n' });
  const merged = r.merge('docs');
  assert.equal(merged.ok, true, merged.stderr);
  assert.equal(existsSync(join(r.main, 'notes.md')), true);
  assert.equal(existsSync(join(r.main, 'node_modules')), false);
  assert.equal(existsSync(join(r.main, 'browser', 'node_modules')), false);
});

test('a failed install after a merge says to run npm ci there again, and the merge stands', (t) => {
  const r = repo(t);
  // A package.json naming a dependency its changed package-lock.json doesn't hold, which npm ci refuses.
  r.branch('out-of-step', {
    'browser/package-lock.json': manifests('browser', ['dep', 'extra'])['package-lock.json']!,
    'browser/package.json': JSON.stringify({ name: 'browser', dependencies: { gone: '1.0.0' } }),
  });
  const merged = r.merge('out-of-step');
  assert.equal(merged.ok, true, merged.stderr);
  assert.ok(merged.stderr.includes(`npm ci failed in ${r.main}/browser, as above`), merged.stderr);
  assert.ok(readFileSync(join(r.main, 'browser', 'package.json'), 'utf8').includes('gone'), 'the merge stands');
});
