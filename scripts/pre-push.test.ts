// The pre-push hook (#88): a push that moves main goes through only once GitHub Actions has run on the commit and
// every run has passed, and a refusal says why and what to do next. Each test pushes from a throwaway repo to a bare
// one, with a fake `gh` on PATH that answers from the runs the test gives it, so no test reaches the network.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOKS = join(import.meta.dirname, '..', '.githooks');

/**
 * `gh run list --commit SHA --json FIELDS --jq EXPR`, answered from $FAKE_GH_RUNS: the runs whose headSha is SHA,
 * cut down to FIELDS and put through EXPR, as gh does. With $FAKE_GH_ERROR set, it fails with that error instead.
 */
const FAKE_GH = String.raw`#!/bin/sh
[ "$1 $2" = "run list" ] || { echo "fake gh: only run list is faked, not: $*" >&2; exit 2; }
if [ -n "$FAKE_GH_ERROR" ]; then echo "$FAKE_GH_ERROR" >&2; exit 1; fi
while [ $# -gt 0 ]; do
  case $1 in
    --commit) commit=$2; shift ;;
    --json) fields=$2; shift ;;
    --jq) expr=$2; shift ;;
  esac
  shift
done
printf '%s' "$FAKE_GH_RUNS" | jq -r --arg sha "$commit" --arg fields "$fields" \
  "[.[] | select(.headSha == \$sha) | with_entries(select(.key | IN(\$fields | split(\",\")[])))] | $expr"
`;

interface Run {
  databaseId: number;
  workflowName: string;
  status: string;
  conclusion: string;
}

interface Push {
  /** Whether git pushed. */
  ok: boolean;
  /** What git and the hook printed. */
  stderr: string;
  /** Main's latest commit, the one pushed. */
  sha: string;
  /** The commit before it, where the remote's main starts. */
  earlier: string;
  /** What the remote's `branch` points at after the push, or '' when it has no such branch. */
  remote(branch: string): string;
}

/**
 * Pushes `refspec` from a repo whose main is two commits, to a bare remote whose main is still at the first. `gh` knows
 * the runs on the latest commit given as `runs`, and `earlier` on the first; `error` makes it fail instead.
 */
function push(t: TestContext, refspec: string, gh: { runs?: Run[]; earlier?: Run[]; error?: string }): Push {
  const root = mkdtempSync(join(tmpdir(), 'pre-push-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
  const must = (...args: string[]) => {
    const r = git(...args);
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  must('init', '-q', '--bare', 'remote.git');
  must('init', '-q', '-b', 'main', 'work');
  must('-C', 'work', 'commit', '-q', '--allow-empty', '-m', 'earlier');
  const earlier = must('-C', 'work', 'rev-parse', 'HEAD');
  must('-C', 'work', 'commit', '-q', '--allow-empty', '-m', 'latest');
  const sha = must('-C', 'work', 'rev-parse', 'HEAD');
  must('-C', 'work', 'push', '-q', '../remote.git', `${earlier}:refs/heads/main`);

  const runs = [
    ...(gh.runs ?? []).map((run) => ({ ...run, headSha: sha })),
    ...(gh.earlier ?? []).map((run) => ({ ...run, headSha: earlier })),
  ];
  env.FAKE_GH_RUNS = JSON.stringify(runs);
  env.FAKE_GH_ERROR = gh.error ?? '';
  const pushed = git('-C', 'work', '-c', `core.hooksPath=${HOOKS}`, 'push', '-q', '../remote.git', refspec);
  return {
    ok: pushed.status === 0,
    stderr: pushed.stderr,
    sha,
    earlier,
    remote: (branch) => git('-C', 'remote.git', 'rev-parse', '-q', '--verify', `refs/heads/${branch}`).stdout.trim(),
  };
}

function passed(databaseId: number): Run {
  return { databaseId, workflowName: 'Bot', status: 'completed', conclusion: 'success' };
}

/** Asserts the push was refused and left the remote's main alone, and returns what it printed. */
function refused(pushed: Push): string {
  assert.equal(pushed.ok, false, pushed.stderr);
  assert.equal(pushed.remote('main'), pushed.earlier);
  return pushed.stderr;
}

test('a push to main of a commit GitHub Actions has no run for is refused, saying to push the branch first', (t) => {
  const pushed = push(t, 'main', { earlier: [passed(1)] });
  const said = refused(pushed);
  assert.match(said, new RegExp(`no run for ${pushed.sha}`));
  assert.match(said, /push the branch/i);
});

test('a push to main of a commit whose every run has passed goes through', (t) => {
  const pushed = push(t, 'main', { runs: [passed(1), passed(2)] });
  assert.equal(pushed.ok, true, pushed.stderr);
  assert.equal(pushed.remote('main'), pushed.sha);
});

test('a push to main of a commit with a failed run is refused, naming that run', (t) => {
  const pushed = push(t, 'main', {
    runs: [passed(1), { databaseId: 2, workflowName: 'Bot', status: 'completed', conclusion: 'failure' }],
  });
  const said = refused(pushed);
  assert.match(said, new RegExp(`run 2 \\(Bot\\) on ${pushed.sha} didn't succeed: it ended in failure`));
  assert.doesNotMatch(said, /run 1\b/);
  assert.match(said, /gh run view 2\b/);
  assert.match(said, /gh run rerun 2\b/);
});

test('a push to main of a commit whose run is still going is refused, saying to watch that run', (t) => {
  const pushed = push(t, 'main', {
    runs: [passed(1), { databaseId: 2, workflowName: 'Bot', status: 'in_progress', conclusion: '' }],
  });
  const said = refused(pushed);
  assert.match(said, new RegExp(`run 2 \\(Bot\\) on ${pushed.sha} is still going`));
  assert.match(said, /gh run watch 2\b/);
});

test('a push to main is refused when gh cannot say whether the commit passed, with its error', (t) => {
  const pushed = push(t, 'main', { runs: [passed(1)], error: 'error connecting to api.github.com' });
  const said = refused(pushed);
  assert.match(said, /error connecting to api\.github\.com/);
  assert.match(said, new RegExp(`gh couldn't say whether GitHub Actions passed ${pushed.sha}`));
});

test('a push that does not touch main goes through without asking gh', (t) => {
  const pushed = push(t, 'main:ticket', { error: 'gh was asked' });
  assert.equal(pushed.ok, true, pushed.stderr);
  assert.equal(pushed.remote('ticket'), pushed.sha);
  assert.doesNotMatch(pushed.stderr, /gh was asked/);
});

test('a push that deletes main is refused without asking gh', (t) => {
  const pushed = push(t, ':main', { error: 'gh was asked' });
  const said = refused(pushed);
  assert.match(said, /deletes main/);
  assert.doesNotMatch(said, /gh was asked/);
});
