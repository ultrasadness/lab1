// The outside review's scripts (#107): what reaches Codex, when it doesn't start, and how long it may run. Each test
// runs a copy of .claude/skills/outside-review/ in a throwaway repo. The real sandboxed.sh and audit.ts run, and only
// gh, bwrap and codex are fakes.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SKILL = join(import.meta.dirname, '..', '.claude', 'skills', 'outside-review');

/** The settled question on the parent spec, which only a run that saves the spec's comments can show Codex. */
const SETTLED = 'The person settled that a Dossier is never rewritten.';

/**
 * Answers with only the fields `--json` names, as the real gh does: `gh issue view 105 --json number,title` printed
 * those two keys alone on 2026-11-09. So a field review.sh doesn't ask for is missing here too.
 */
const FAKE_GH = `#!/usr/bin/env node
const { appendFileSync, existsSync } = require('node:fs');
if (existsSync(__dirname + '/gh-hang')) {
  process.on('SIGTERM', () => {});
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
}
const args = process.argv.slice(2);
appendFileSync(__dirname + '/gh.log', args.join(' ') + '\\n');
const issues = {
  7: { number: 7, title: 'The ticket', body: '## Parent\\n\\n#5\\n\\n## Acceptance criteria\\n\\n- [ ] It works.\\n', comments: [{ body: 'A comment on the ticket.' }] },
  5: { number: 5, title: 'Spec: the plan', body: 'The plan.', comments: [{ body: ${JSON.stringify(SETTLED)} }] },
  8: { number: 8, title: 'A later ticket', body: '## Parent\\n\\n#5\\n\\n## Acceptance criteria\\n\\n- [ ] Later.\\n', comments: [] },
};
const fields = args[args.indexOf('--json') + 1].split(',');
const pick = (issue) => Object.fromEntries(fields.map((field) => [field, issue[field]]));
if (args[1] === 'list') console.log(JSON.stringify(Object.values(issues).map(pick)));
else if (args.includes('--jq')) console.log(issues[args[2]].body);
else console.log(JSON.stringify(pick(issues[args[2]])));
`;

/**
 * Keeps the mounts it was asked for and runs what comes after `--` with no sandbox, as CI can't be counted on to allow
 * the real one. Real bwrap was tried on 2026-11-09: it covered ~ and /tmp, showed back what the mounts named, and handed
 * back its child's exit status, 137 from a kill included. With nothing mounted, sandboxed.sh would refuse every folder
 * it was told to check, so they come off its arguments unless the test wants that refusal.
 */
const FAKE_BWRAP = `#!/usr/bin/env bash
here=$(dirname "$0")
mounts=()
while [[ $1 != -- ]]; do mounts+=("$1"); shift; done
shift
printf '%s\\n' "\${mounts[@]}" > "$here/bwrap-args.txt"
if [[ -e $here/keep-hidden ]]; then exec "$@"; fi
exec "$1" "$2" "$3" "$4"
`;

/**
 * Keeps the prompt it was piped and prints the events it was given. sandboxed.sh empties the environment, so what it
 * reads and writes sits beside it. It reads as codex-cli 0.166.0 did on 2026-11-09: the prompt on stdin, the events on
 * stdout, and the last message in the file `-o` names.
 */
const FAKE_CODEX = `#!/usr/bin/env bash
here=$(dirname "$0")
cat > "$here/prompt-received.md"
[[ ! -e $here/events.jsonl ]] || cat "$here/events.jsonl"
if [[ -e $here/hang ]]; then trap '' TERM; sleep 60; fi
while [[ $# -gt 0 ]]; do
  if [[ $1 == -o ]]; then echo 'No findings.' > "$2"; fi
  if [[ $1 == -C && -e $here/change-worktree ]]; then echo changed > "$2/changed.ts"; fi
  shift
done
`;

const env = (home: string, bin: string): NodeJS.ProcessEnv => ({
  PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
  HOME: home,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
});

interface Review {
  status: number | null;
  stdout: string;
  stderr: string;
  /** The folder review.sh writes its files in. */
  out: string;
  /** The prompt Codex was piped, or undefined when Codex never started. */
  prompt: string | undefined;
  /** Each gh command review.sh ran. */
  ghCalls: string[];
}

/** A throwaway repo holding the skill and one commit on `main`. */
function world(t: TestContext) {
  const top = mkdtempSync(join(tmpdir(), 'outside-review-'));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const repo = join(top, 'repo');
  const home = join(top, 'home');
  const bin = join(top, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  cpSync(SKILL, join(repo, '.claude', 'skills', 'outside-review'), { recursive: true });
  for (const [name, script] of [['gh', FAKE_GH], ['bwrap', FAKE_BWRAP], ['codex', FAKE_CODEX]] as const) {
    writeFileSync(join(bin, name), script);
    chmodSync(join(bin, name), 0o755);
  }
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: repo, env: env(home, bin), encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'code.ts'), 'export {};\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Start');

  /** Commits what `change` writes. */
  const commit = (change: () => void) => {
    change();
    git('add', '-A');
    git('commit', '-q', '-m', 'Change');
  };

  return {
    repo,
    home,
    bin,
    git,
    commit,
    /** Commits a change to the code, which is what most tests review. */
    commitCode: () => commit(() => writeFileSync(join(repo, 'code.ts'), 'export const changed = 1;\n')),
    /** Runs the copy of review.sh in `checkout` on `base`, as a session does. */
    review(base = 'HEAD~1', extraEnv: NodeJS.ProcessEnv = {}, checkout = repo): Review {
      const out = join(top, 'out');
      const r = spawnSync(join(checkout, '.claude', 'skills', 'outside-review', 'review.sh'), ['7', base], {
        cwd: checkout,
        env: { ...env(home, bin), OUT: out, ...extraEnv },
        encoding: 'utf8',
        timeout: 30_000,
      });
      const received = join(bin, 'prompt-received.md');
      const ghLog = join(bin, 'gh.log');
      return {
        status: r.status,
        stdout: r.stdout,
        stderr: r.stderr,
        out,
        prompt: existsSync(received) ? readFileSync(received, 'utf8') : undefined,
        ghCalls: existsSync(ghLog) ? readFileSync(ghLog, 'utf8').trim().split('\n') : [],
      };
    },
    /** A worktree of the repo on a new branch, where a session works. */
    worktree() {
      const path = join(top, 'worktree');
      git('worktree', 'add', '-q', path, '-b', 'ticket', 'main');
      return path;
    },
    /** Makes the fake Codex print these events, each a line. */
    events(...lines: string[]) {
      writeFileSync(join(bin, 'events.jsonl'), lines.join('\n') + '\n');
    },
    /** Tells a fake to behave as the file's name says. */
    flag: (name: string) => writeFileSync(join(bin, name), ''),
  };
}

test('a diff of only docs starts no Codex', (t) => {
  const w = world(t);
  w.commit(() => {
    writeFileSync(join(w.repo, 'guide.md'), 'A guide.\n');
    writeFileSync(join(w.repo, 'guide.zh.md'), '指南。\n');
    writeFileSync(join(w.repo, 'guide.i18n.yaml'), 'pair: guide\n');
  });
  const r = w.review();
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /only docs/i);
  assert.equal(r.prompt, undefined);
  assert.deepEqual(r.ghCalls, []);
});

test('a doc with a name git would quote still counts as a doc', (t) => {
  const w = world(t);
  w.commit(() => writeFileSync(join(w.repo, '指南.md'), '指南。\n'));
  const r = w.review();
  assert.equal(r.status, 4, r.stderr);
  assert.equal(r.prompt, undefined);
});

test('a diff with one file past the docs starts Codex', (t) => {
  const w = world(t);
  w.commit(() => {
    writeFileSync(join(w.repo, 'guide.md'), 'A guide.\n');
    writeFileSync(join(w.repo, 'code.ts'), 'export const changed = 1;\n');
  });
  const r = w.review();
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(r.prompt, undefined);
});

test('a rename from code to a doc starts Codex, since the code is gone', (t) => {
  const w = world(t);
  w.commit(() => renameSync(join(w.repo, 'code.ts'), join(w.repo, 'code.md')));
  const r = w.review();
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(r.prompt, undefined);
});

// More names than a pipe holds (64 KB here), with code listed first, so that a `git diff | grep -q` under pipefail
// would see git die of SIGPIPE and take the diff for one of only docs.
test('a list of changed files longer than a pipe holds still starts Codex', (t) => {
  const w = world(t);
  w.commit(() => {
    for (let i = 0; i < 800; i++) writeFileSync(join(w.repo, `${String(i).padStart(4, '0')}${'a'.repeat(120)}.ts`), '');
  });
  const r = w.review();
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(r.prompt, undefined);
});

// `main` gained #105 while #107's first review ran, and Codex was told the branch reverted it.
test('when main has moved on, the review reads only the branch', (t) => {
  const w = world(t);
  const fork = w.git('rev-parse', 'HEAD');
  w.git('switch', '-q', '-c', 'ticket');
  w.commit(() => writeFileSync(join(w.repo, 'ticket.ts'), 'export {};\n'));
  w.git('switch', '-q', 'main');
  w.commitCode();
  w.git('switch', '-q', 'ticket');

  const r = w.review('main');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.prompt!.includes(`git diff ${fork} `), r.prompt);
  assert.equal(readFileSync(join(r.out, 'commits.txt'), 'utf8').trim().split('\n').length, 1);
});

test('when main has moved on with code, a branch of only docs still starts no Codex', (t) => {
  const w = world(t);
  w.git('switch', '-q', '-c', 'ticket');
  w.commit(() => writeFileSync(join(w.repo, 'guide.md'), 'A guide.\n'));
  w.git('switch', '-q', 'main');
  w.commitCode();
  w.git('switch', '-q', 'ticket');

  const r = w.review('main');
  assert.equal(r.status, 4, r.stderr);
});

test('what reaches Codex: the standards, the settled questions and the questions it should raise', (t) => {
  const w = world(t);
  w.commitCode();
  const r = w.review();
  assert.equal(r.status, 0, r.stderr);

  const prompt = r.prompt!;
  assert.doesNotMatch(prompt, /\{\{/, 'a placeholder was left in the prompt');
  assert.match(prompt, /CODING_STANDARDS\.md/);
  assert.match(prompt, /CONTEXT\.md/);
  assert.match(prompt, /docs\/adr\//);
  assert.match(prompt, /settled/i);
  assert.match(prompt, /Questions for the person/);
  assert.match(prompt, /each ADR you checked/);

  const spec = JSON.parse(readFileSync(join(r.out, 'spec.json'), 'utf8')) as { comments: { body: string }[] };
  assert.equal(spec.comments[0]!.body, SETTLED);
  const ticket = JSON.parse(readFileSync(join(r.out, 'ticket.json'), 'utf8')) as { comments: unknown[] };
  assert.equal(ticket.comments.length, 1);
  assert.match(readFileSync(join(r.out, 'siblings.md'), 'utf8'), /#8 A later ticket/);
});

test('the sandbox hides the home folder and /tmp, then shows back only what Codex needs', (t) => {
  const w = world(t);
  w.commitCode();
  for (const folder of ['.codex', '.nvm', '.ssh', '.cc-switch']) mkdirSync(join(w.home, folder));
  const r = w.review();
  assert.equal(r.status, 0, r.stderr);

  const mounts = readFileSync(join(w.bin, 'bwrap-args.txt'), 'utf8').trim().split('\n');
  const after = (flag: string, path: string) => {
    const i = mounts.findIndex((m, n) => m === flag && mounts[n + 1] === path);
    assert.notEqual(i, -1, `no ${flag} ${path} in ${mounts.join(' ')}`);
    return i;
  };
  const hidden = Math.max(after('--tmpfs', w.home), after('--tmpfs', '/tmp'));
  // Each comes after the mounts that hide it, or the hiding would cover it again.
  assert.ok(after('--ro-bind', w.repo) > hidden);
  assert.ok(after('--ro-bind', join(w.home, '.nvm')) > hidden);
  assert.ok(after('--bind', join(w.home, '.codex')) > hidden);
  assert.ok(after('--bind', r.out) > hidden);
  assert.ok(!mounts.some((m) => m.includes('.ssh') || m.includes('.cc-switch')), mounts.join(' '));
});

test('a folder left unhidden stops the review before Codex starts', (t) => {
  const w = world(t);
  w.commitCode();
  w.flag('keep-hidden');
  const r = w.review();
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /not hidden/);
  assert.equal(r.prompt, undefined);
});

let nextItem = 0;
/** A command as codex-cli 0.166.0 reports one in `--json`, from the run on #103's commit on 2026-11-09. */
const ran = (command: string, id = `item_${nextItem++}`) =>
  JSON.stringify({ type: 'item.completed', item: { id, type: 'command_execution', command, aggregated_output: '', exit_code: 0, status: 'completed' } });
/** The event of the same run that came when the command started. */
const started = (command: string, id = `item_${nextItem++}`) =>
  JSON.stringify({ type: 'item.started', item: { id, type: 'command_execution', command, aggregated_output: '', exit_code: null, status: 'in_progress' } });

test('a Codex that ignores TERM and never ends is killed at the limit, and what it ran is still audited', (t) => {
  const w = world(t);
  w.commitCode();
  w.events(ran(`/bin/bash -lc 'sudo -n true'`));
  w.flag('hang');
  const started = Date.now();
  const r = w.review('HEAD~1', { OUTSIDE_REVIEW_LIMIT: '1s' });
  assert.equal(r.status, 137, r.stderr);
  assert.ok(Date.now() - started < 25_000, 'the review waited out the fake Codex rather than stopping it');
  assert.match(r.stderr, /past its limit/);
  assert.ok(!existsSync(join(r.out, 'review.md')));
  assert.match(readFileSync(join(r.out, 'audit.md'), 'utf8'), /Codex ran 1 shell commands; 1 flagged\./);
});

test('a gh that never answers ends the review at its limit, saying so, before Codex starts', (t) => {
  const w = world(t);
  w.commitCode();
  w.flag('gh-hang');
  const started = Date.now();
  const r = w.review('HEAD~1', { OUTSIDE_REVIEW_GITHUB_LIMIT: '1s' });
  assert.equal(r.status, 1, r.stderr);
  assert.ok(Date.now() - started < 25_000, 'the review waited out the fake gh rather than stopping it');
  assert.match(r.stderr, /gh issue view failed or ran past its limit/);
  assert.equal(r.prompt, undefined);
});

test('a worktree that changes while Codex reads it gets a warning', (t) => {
  const w = world(t);
  w.commitCode();
  w.flag('change-worktree');
  const r = w.review();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /worktree changed while Codex read it/);
});

test('a worktree left alone gets no warning', (t) => {
  const w = world(t);
  w.commitCode();
  const r = w.review();
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /worktree changed/);
});

test('the audit flags Docker and sudo however a command starts them', (t) => {
  const w = world(t);
  w.commitCode();
  const reaching = [
    `/bin/bash -lc 'docker ps'`,
    `/bin/bash -lc "cd ${w.repo} && sudo -n true"`,
    `/bin/bash -lc '/usr/bin/docker ps'`,
    `/bin/bash -lc '/usr/bin/sudo -n true'`,
    `/bin/bash -lc '(docker ps)'`,
    `/bin/bash -lc 'timeout 5 docker ps'`,
    `/bin/bash -lc 'FOO=1 sudo -n true'`,
    `/bin/bash -lc 'xargs sudo < list'`,
  ];
  w.events(...reaching.map((command) => ran(command)));
  const r = w.review();
  assert.equal(r.status, 0, r.stderr);
  const audit = readFileSync(join(r.out, 'audit.md'), 'utf8');
  assert.ok(audit.includes(`Codex ran ${reaching.length} shell commands; ${reaching.length} flagged.`), audit.slice(0, 300));
  assert.equal(audit.split('## Every command')[0]!.match(/reaches for Docker or sudo/g)?.length, reaching.length);
});

// Both real runs flagged a read-only `git merge-base`, which led their reports as an attempt to change something.
test('the audit lets a read-only git command through, and flags the merge it resembles', (t) => {
  const w = world(t);
  w.commitCode();
  w.events(ran(`/bin/bash -lc 'git merge-base main HEAD'`), ran(`/bin/bash -lc 'git merge main'`));
  const r = w.review();
  assert.equal(r.status, 0, r.stderr);
  const flagged = readFileSync(join(r.out, 'audit.md'), 'utf8').split('## Every command')[0]!;
  assert.match(flagged, /Codex ran 2 shell commands; 1 flagged\./);
  assert.ok(flagged.includes('git merge main'));
  assert.ok(!flagged.includes('merge-base'));
});

test('the audit counts a command once, and keeps one that started and never finished', (t) => {
  const w = world(t);
  w.commitCode();
  w.events(started(`/bin/bash -lc 'git status'`, 'item_a'), ran(`/bin/bash -lc 'git status'`, 'item_a'), started(`/bin/bash -lc 'docker wait busy'`, 'item_b'));
  const r = w.review();
  assert.equal(r.status, 0, r.stderr);
  const flagged = readFileSync(join(r.out, 'audit.md'), 'utf8').split('## Every command')[0]!;
  assert.match(flagged, /Codex ran 2 shell commands; 1 flagged\./);
  assert.ok(flagged.includes('docker wait busy'));
  assert.match(flagged, /exit \?/);
});

test('a review from a worktree shows Codex the checkout that holds its git data, and the audit lets that through', (t) => {
  const w = world(t);
  const worktree = w.worktree();
  writeFileSync(join(worktree, 'code.ts'), 'export const changed = 1;\n');
  const inWorktree = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: worktree, env: env(w.home, w.bin), encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 0, r.stderr);
  };
  inWorktree('add', '-A');
  inWorktree('commit', '-q', '-m', 'Change');
  w.events(ran(`/bin/bash -lc 'ls -ld ${w.repo}/.git ${worktree}/.git'`));

  const r = w.review('main', {}, worktree);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(r.out, 'audit.md'), 'utf8'), /Codex ran 1 shell commands; 0 flagged\./);
  const mounts = readFileSync(join(w.bin, 'bwrap-args.txt'), 'utf8');
  assert.ok(mounts.includes(`--ro-bind\n${w.repo}\n${w.repo}`), mounts);
  assert.ok(mounts.includes(`--ro-bind\n${worktree}\n${worktree}`), mounts);
});

test('an audit that could read no commands says so, in its file and on its line', (t) => {
  const w = world(t);
  w.commitCode();
  w.events(JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Done.' } }));
  const r = w.review();
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(r.out, 'audit.md'), 'utf8'), /^Unaudited/m);
  assert.match(r.stdout, /Audit: Unaudited/);
  assert.doesNotMatch(r.stdout, /0 flagged/);
});

test('an event it cannot read leaves the audit standing, and the audit says it may miss commands', (t) => {
  const w = world(t);
  w.commitCode();
  w.events(
    ran(`/bin/bash -lc 'git status'`),
    '{"type":"item.completed","item":{"type":"comma',
    JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } }),
    'null',
  );
  const r = w.review();
  assert.equal(r.status, 0, r.stderr);
  const audit = readFileSync(join(r.out, 'audit.md'), 'utf8');
  assert.match(audit, /Codex ran 1 shell commands; 0 flagged\./);
  assert.match(audit, /3 events could not be read/);
  assert.equal(readFileSync(join(r.out, 'review.md'), 'utf8').trim(), 'No findings.');
});
