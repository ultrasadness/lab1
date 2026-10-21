// `npm run ticket -- <number>` (#87): prints a ticket whole, with its parent and each issue that mentions it. Each test
// runs the script as its own process, with no terminal, against a fake `gh` on PATH that answers `gh api` from the
// issues the test gives it, so no test reaches GitHub.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dirname, 'ticket.ts');

/**
 * `gh api [--paginate [--slurp]] ENDPOINT`, answered from the issues in $FAKE_GH_ISSUES as GitHub's REST API would:
 * an issue, its comments, its parent and its timeline, where each other issue whose body or comments name `#N` is a
 * cross-reference. `{owner}/{repo}` is owner/repo, and an issue with a `repo` of its own is in that repo instead. A
 * list comes in pages of two, so a caller that doesn't paginate sees only the first. An unknown issue is a 404, as gh
 * prints one. With $FAKE_GH_ERROR set, every call fails with that error instead.
 */
const FAKE_GH = String.raw`#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] !== 'api') {
  process.stderr.write('fake gh: only api is faked, not: ' + args.join(' ') + '\n');
  process.exit(2);
}
if (process.env.FAKE_GH_ERROR) {
  process.stderr.write(process.env.FAKE_GH_ERROR + '\n');
  process.exit(1);
}
const paginate = args.includes('--paginate');
const slurp = args.includes('--slurp');
const endpoint = args.slice(1).find((arg) => !arg.startsWith('--'));
const issues = JSON.parse(process.env.FAKE_GH_ISSUES);
const HOME = 'owner/repo';
const find = (repo, n) => issues.find((issue) => (issue.repo ?? HOME) === repo && issue.number === n);
const shown = (issue) => ({
  url: 'https://api.github.com/repos/' + (issue.repo ?? HOME) + '/issues/' + issue.number,
  number: issue.number,
  title: issue.title,
  state: issue.state ?? 'open',
  labels: (issue.labels ?? []).map((name) => ({ name })),
  body: issue.body ?? null,
  user: { login: 'someone' },
  comments: (issue.comments ?? []).length,
  comments_url: 'https://api.github.com/repos/' + (issue.repo ?? HOME) + '/issues/' + issue.number + '/comments',
  repository_url: 'https://api.github.com/repos/' + (issue.repo ?? HOME),
  ...(issue.pullRequest ? { pull_request: { url: 'https://api.github.com/repos/' + HOME + '/pulls/' + issue.number } } : {}),
});
const notFound = (message) => {
  process.stdout.write(JSON.stringify({ message, status: '404' }));
  process.stderr.write('gh: ' + message + ' (HTTP 404)\n');
  process.exit(1);
};
const list = (items) => {
  const pages = [];
  for (let i = 0; i < items.length; i += 2) pages.push(items.slice(i, i + 2));
  if (pages.length === 0) pages.push([]);
  if (!paginate) process.stdout.write(JSON.stringify(pages[0]));
  else if (slurp) process.stdout.write(JSON.stringify(pages));
  else for (const page of pages) process.stdout.write(JSON.stringify(page));
  process.exit(0);
};
const match = /^(?:repos\/\{owner\}\/\{repo\}|https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+))\/issues\/(\d+)(?:\/(comments|parent|timeline))?$/.exec(endpoint ?? '');
const issue = match && find(match[1] ?? HOME, Number(match[2]));
if (!issue) notFound('Not Found');
const mentions = (text, n) => new RegExp('#' + n + '\\b').test(text ?? '');
switch (match[3]) {
  case undefined:
    process.stdout.write(JSON.stringify(shown(issue)));
    break;
  case 'comments':
    list((issue.comments ?? []).map((comment) => ({ user: { login: comment.author }, created_at: comment.at, body: comment.body })));
    break;
  case 'parent': {
    const parent = issue.parent && find(issue.repo ?? HOME, issue.parent);
    if (!parent) notFound('No parent issue found');
    process.stdout.write(JSON.stringify(shown(parent)));
    break;
  }
  case 'timeline':
    list([
      { event: 'labeled', label: { name: 'ready-for-agent' } },
      ...issues
        .filter((other) => other !== issue && [other.body, ...(other.comments ?? []).map((c) => c.body)].some((text) => mentions(text, issue.number)))
        .map((other) => ({ event: 'cross-referenced', source: { type: 'issue', issue: shown(other) } })),
      { event: 'commented', body: 'Mentions #' + issue.number + ' in a comment on the ticket itself.' },
    ]);
}
`;

interface Comment {
  author: string;
  /** When it was posted, as GitHub writes it. */
  at: string;
  body: string;
}

interface Issue {
  number: number;
  title: string;
  state?: 'open' | 'closed';
  labels?: string[];
  body?: string | null;
  comments?: Comment[];
  /** The number of the issue this one is a sub-issue of, in the same repo. */
  parent?: number;
  /** The repo it is in, as owner/name, when it isn't the one `{owner}/{repo}` names. */
  repo?: string;
  pullRequest?: boolean;
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the script on `args`, without a terminal, against a `gh` that knows `issues`, or fails with `error`. */
function ticket(t: TestContext, args: string[], gh: { issues?: Issue[]; error?: string }): Promise<Run> {
  const root = mkdtempSync(join(tmpdir(), 'ticket-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_GH_ISSUES: JSON.stringify(gh.issues ?? []),
    FAKE_GH_ERROR: gh.error ?? '',
  };
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { env, timeout: 30_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, stdout, stderr });
    });
  });
}

test('prints the ticket: its number, state, title, labels, body and every comment, with who wrote it and when', async (t) => {
  const run = await ticket(t, ['87'], {
    issues: [
      {
        number: 87,
        title: 'Print a ticket whole with one command',
        labels: ['ready-for-agent', 'enhancement'],
        body: 'From the retro on #76.\r\n\r\n## What to build\r\n\r\nOne command.',
        comments: [
          { author: 'ana', at: '2026-10-20T08:00:00Z', body: 'First.' },
          { author: 'bo', at: '2026-10-20T09:00:00Z', body: 'Second.' },
          { author: 'ana', at: '2026-10-21T10:00:00Z', body: 'Third, on the second page.' },
        ],
      },
    ],
  });
  assert.equal(run.code, 0, run.stderr);
  assert.ok(
    run.stdout.startsWith(
      '#87 OPEN Print a ticket whole with one command [ready-for-agent, enhancement]\n\n' +
        'From the retro on #76.\n\n## What to build\n\nOne command.\n\n' +
        '--- ana, 2026-10-20T08:00:00Z:\nFirst.\n\n' +
        '--- bo, 2026-10-20T09:00:00Z:\nSecond.\n\n' +
        '--- ana, 2026-10-21T10:00:00Z:\nThird, on the second page.\n',
    ),
    run.stdout,
  );
});

test("prints the ticket's parent, with its body and comments, after the ticket's own", async (t) => {
  const run = await ticket(t, ['77'], {
    issues: [
      {
        number: 74,
        title: "Improve the agents' environment",
        labels: ['ready-for-human'],
        body: 'The retro proposed eight changes.',
        comments: [{ author: 'ana', at: '2026-10-19T08:00:00Z', body: 'Cut into tickets.' }],
      },
      {
        number: 77,
        title: 'Give the reviewer coding standards',
        state: 'closed',
        body: 'Half of the triage brief.',
        comments: [{ author: 'bo', at: '2026-10-20T08:00:00Z', body: 'Landed.' }],
        parent: 74,
      },
    ],
  });
  assert.equal(run.code, 0, run.stderr);
  assert.ok(
    run.stdout.startsWith(
      '#77 CLOSED Give the reviewer coding standards []\n\nHalf of the triage brief.\n\n' +
        '--- bo, 2026-10-20T08:00:00Z:\nLanded.\n\n' +
        '=== Parent\n\n' +
        "#74 OPEN Improve the agents' environment [ready-for-human]\n\nThe retro proposed eight changes.\n\n" +
        '--- ana, 2026-10-19T08:00:00Z:\nCut into tickets.\n',
    ),
    run.stdout,
  );
});

test('says when a ticket has no parent', async (t) => {
  const run = await ticket(t, ['74'], { issues: [{ number: 74, title: 'A map', body: 'Its tickets.' }] });
  assert.equal(run.code, 0, run.stderr);
  assert.ok(run.stdout.startsWith('#74 OPEN A map []\n\nIts tickets.\n\n=== Parent\n\n#74 has no parent.\n'), run.stdout);
});

test('prints each issue that mentions the ticket, after the parent, with only the lines that do', async (t) => {
  const run = await ticket(t, ['87'], {
    issues: [
      { number: 87, title: 'Print a ticket whole', body: 'One command.' },
      {
        number: 94,
        title: 'Read a ticket with its parent',
        state: 'closed',
        body: 'Duplicate of #87, which came first.\r\nThis line names #870 and #187.',
        comments: [{ author: 'ana', at: '2026-10-21T09:00:00Z', body: "Closed: #87's comment holds the rest." }],
      },
      { number: 90, title: 'Refuse a closing keyword', body: 'Unrelated.\n\nLeft for #87: the doc lines.' },
      { number: 91, title: 'Try the other system', body: 'Names #88 only.' },
    ],
  });
  assert.equal(run.code, 0, run.stderr);
  assert.ok(
    run.stdout.endsWith(
      '=== Parent\n\n#87 has no parent.\n\n' +
        '=== Mentioned by\n\n' +
        '#90 OPEN Refuse a closing keyword\n  Left for #87: the doc lines.\n' +
        '#94 CLOSED Read a ticket with its parent\n  Duplicate of #87, which came first.\n' +
        "  Closed: #87's comment holds the rest.\n",
    ),
    run.stdout,
  );
});

test('says when no other issue mentions the ticket', async (t) => {
  const run = await ticket(t, ['87'], { issues: [{ number: 87, title: 'Print a ticket whole', body: 'Names #87 itself.' }] });
  assert.equal(run.code, 0, run.stderr);
  assert.ok(run.stdout.endsWith('=== Mentioned by\n\nNo other issue mentions #87.\n'), run.stdout);
});

test('fails on a number that names no issue, saying so', async (t) => {
  const run = await ticket(t, ['9999'], { issues: [{ number: 87, title: 'Print a ticket whole' }] });
  assert.equal(run.code, 1);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /^ticket: #9999 names no issue in this repo\b/);
});

test('fails on the number of a pull request, saying it is one', async (t) => {
  const run = await ticket(t, ['5'], { issues: [{ number: 5, title: 'A pull request', pullRequest: true }] });
  assert.equal(run.code, 1);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /^ticket: #5 is a pull request, not an issue\b/);
});

test("fails with gh's own error when gh can't answer, printing nothing else", async (t) => {
  const run = await ticket(t, ['87'], {
    issues: [{ number: 87, title: 'Print a ticket whole' }],
    error: 'To get started with GitHub CLI, please run:  gh auth login',
  });
  assert.equal(run.code, 1);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /^ticket: gh api repos\/\{owner\}\/\{repo\}\/issues\/87 failed: To get started with GitHub CLI/);
});

for (const args of [[], ['eighty-seven'], ['87', '94']]) {
  test(`fails on ${args.length === 0 ? 'no argument' : args.join(' ')}, saying how to run it`, async (t) => {
    const run = await ticket(t, args, { error: 'gh was asked' });
    assert.equal(run.code, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /^ticket: give one issue number, as in npm run ticket -- 87\n$/);
  });
}

test("takes the number with GitHub's # before it", async (t) => {
  const run = await ticket(t, ['#87'], { issues: [{ number: 87, title: 'Print a ticket whole' }] });
  assert.equal(run.code, 0, run.stderr);
  assert.ok(run.stdout.startsWith('#87 OPEN Print a ticket whole []\n'), run.stdout);
});

test('tells apart an issue from another repo that mentions the ticket, naming that repo', async (t) => {
  const run = await ticket(t, ['87'], {
    issues: [
      { number: 87, title: 'Print a ticket whole' },
      { number: 5, title: 'Here', body: 'Needs #87.' },
      {
        number: 5,
        repo: 'owner/data',
        title: 'Elsewhere',
        body: 'Uses owner/repo#87.',
        comments: [{ author: 'ana', at: '2026-10-21T09:00:00Z', body: 'Still owner/repo#87.' }],
      },
    ],
  });
  assert.equal(run.code, 0, run.stderr);
  assert.ok(
    run.stdout.endsWith(
      '=== Mentioned by\n\n#5 OPEN Here\n  Needs #87.\n' +
        'owner/data#5 OPEN Elsewhere\n  Uses owner/repo#87.\n  Still owner/repo#87.\n',
    ),
    run.stdout,
  );
});
