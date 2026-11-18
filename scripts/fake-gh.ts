// A fake `gh` that answers `gh api` from the issues a test gives it, for the tests of what reads the tracker through
// scripts/ticket.ts: `npm run ticket` (scripts/ticket.test.ts) and the outside review (scripts/outside-review.test.ts).
// No test reaches GitHub.
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `gh api [--paginate [--slurp]] ENDPOINT`, answered from the issues in $FAKE_GH_ISSUES as GitHub's REST API would:
 * an issue, its comments, its parent, its sub-issues and its timeline, where each other issue whose body or comments
 * name `#N` is a cross-reference, and the repo's collaborators: its owner, then the logins in
 * $FAKE_GH_COLLABORATORS. `{owner}/{repo}` is owner/repo, and an issue with a `repo` of its own is in that repo
 * instead. An issue and a comment name their author as `user.login` and their page as `html_url`, and the
 * collaborators list holds the repo's owner, as lab1's answers did on 2026-11-17 (#112). A parent's sub-issues come
 * open and closed, each with the fields of an issue, as #41's 39 did on 2026-11-18 (#114). Two cases lab1 has never
 * shown come from GitHub's REST description (github/rest-api-description, read on 2026-11-17): an issue's and a
 * comment's `user` is a `nullable-simple-user`, so an author given as null comes as `user: null`, and a sub-issue
 * "must belong to the same repository owner as the parent issue", so a parent and its sub-issue can be in different
 * repos of the owner, as `parentRepo` puts it. A list comes in pages of two, so a caller that doesn't paginate sees
 * only the first, and a query on the endpoint, such as `?per_page=100`, is taken and ignored. An unknown issue
 * is a 404, as gh prints one. Each call's endpoint is appended to the file $FAKE_GH_LOG names, one to a line. With
 * $FAKE_GH_ERROR set, every call fails with that error instead, and with $FAKE_GH_HANG set, every call ignores SIGTERM
 * and waits a minute, as a GitHub that never answers.
 */
const FAKE_GH = String.raw`#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] !== 'api') {
  process.stderr.write('fake gh: only api is faked, not: ' + args.join(' ') + '\n');
  process.exit(2);
}
if (process.env.FAKE_GH_HANG) {
  process.on('SIGTERM', () => {});
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
}
if (process.env.FAKE_GH_ERROR) {
  process.stderr.write(process.env.FAKE_GH_ERROR + '\n');
  process.exit(1);
}
const paginate = args.includes('--paginate');
const slurp = args.includes('--slurp');
const endpoint = args.slice(1).find((arg) => !arg.startsWith('--'));
require('node:fs').appendFileSync(process.env.FAKE_GH_LOG, endpoint + '\n');
const issues = JSON.parse(process.env.FAKE_GH_ISSUES);
const HOME = 'owner/repo';
const find = (repo, n) => issues.find((issue) => (issue.repo ?? HOME) === repo && issue.number === n);
const page = (issue) => 'https://github.com/' + (issue.repo ?? HOME) + '/issues/' + issue.number;
const shown = (issue) => ({
  url: 'https://api.github.com/repos/' + (issue.repo ?? HOME) + '/issues/' + issue.number,
  html_url: page(issue),
  number: issue.number,
  title: issue.title,
  state: issue.state ?? 'open',
  labels: (issue.labels ?? []).map((name) => ({ name })),
  body: issue.body ?? null,
  user: issue.author === null ? null : { login: issue.author ?? 'owner' },
  created_at: issue.at ?? '2026-10-01T00:00:00Z',
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
if (endpoint === 'repos/{owner}/{repo}/collaborators') {
  const logins = ['owner', ...JSON.parse(process.env.FAKE_GH_COLLABORATORS)];
  list(logins.map((login, i) => ({ login, role_name: i === 0 ? 'admin' : 'write' })));
}
const match = /^(?:repos\/\{owner\}\/\{repo\}|https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+))\/issues\/(\d+)(?:\/(comments|parent|sub_issues|timeline))?(?:\?.*)?$/.exec(endpoint ?? '');
const issue = match && find(match[1] ?? HOME, Number(match[2]));
if (!issue) notFound('Not Found');
const mentions = (text, n) => new RegExp('#' + n + '\\b').test(text ?? '');
switch (match[3]) {
  case undefined:
    process.stdout.write(JSON.stringify(shown(issue)));
    break;
  case 'comments':
    list(
      (issue.comments ?? []).map((comment, i) => ({
        user: comment.author === null ? null : { login: comment.author },
        created_at: comment.at,
        html_url: page(issue) + '#issuecomment-' + (issue.number * 100 + i + 1),
        body: comment.body,
      })),
    );
    break;
  case 'parent': {
    const parent = issue.parent && find(issue.parentRepo ?? issue.repo ?? HOME, issue.parent);
    if (!parent) notFound('No parent issue found');
    process.stdout.write(JSON.stringify(shown(parent)));
    break;
  }
  case 'sub_issues':
    list(
      issues
        .filter((other) => other.parent === issue.number && (other.parentRepo ?? other.repo ?? HOME) === (issue.repo ?? HOME))
        .map(shown),
    );
    break;
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

export interface Comment {
  /** Its author's login, or null for a comment GitHub names no author for. */
  author: string | null;
  /** When it was posted, as GitHub writes it. */
  at: string;
  body: string;
}

export interface Issue {
  number: number;
  title: string;
  /** The login of whoever opened it, `owner` by default: the repo's owner, or null when GitHub names no one. */
  author?: string | null;
  /** When it was opened, as GitHub writes it. */
  at?: string;
  state?: 'open' | 'closed';
  labels?: string[];
  body?: string | null;
  comments?: Comment[];
  /** The number of the issue this one is a sub-issue of, in the same repo unless `parentRepo` names another. */
  parent?: number;
  parentRepo?: string;
  /** The repo it is in, as owner/name, when it isn't the one `{owner}/{repo}` names. */
  repo?: string;
  pullRequest?: boolean;
}

/** What the fake `gh` knows: the issues, the repo's collaborators besides its owner, and how it fails, if it does. */
export interface Tracker {
  issues?: Issue[];
  /** The logins of the repo's collaborators besides its owner: by default ana and bo, who write the tests' comments. */
  collaborators?: string[];
  /** The error every call fails with. */
  error?: string;
  /** Whether every call hangs. */
  hang?: boolean;
}

/**
 * Writes the fake `gh` into the folder `bin`, and gives the environment that tells it `tracker`, logging each call's
 * endpoint to the file `log`.
 */
export function fakeGh(bin: string, tracker: Tracker, log: string): NodeJS.ProcessEnv {
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  return {
    FAKE_GH_ISSUES: JSON.stringify(tracker.issues ?? []),
    FAKE_GH_ERROR: tracker.error ?? '',
    FAKE_GH_HANG: tracker.hang ? '1' : '',
    FAKE_GH_COLLABORATORS: JSON.stringify(tracker.collaborators ?? ['ana', 'bo']),
    FAKE_GH_LOG: log,
  };
}
