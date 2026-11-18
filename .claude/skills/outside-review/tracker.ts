// Writes what the outside review shows Codex of the tracker, into the folder `out`: ticket.md and spec.md, the ticket
// and its parent spec as `npm run ticket` prints them, and siblings.md, the acceptance criteria of the spec's other
// open tickets, so the reviewer can tell when a later ticket owns a finding. The tracker is public, and Codex takes a
// question settled in it as settled, so it reads only text that the repo's owner and collaborators wrote, by the rule
// of scripts/ticket.ts (#114): a body or comment anyone else wrote stands as one line naming its author, date and page,
// and each file that withheld one ends by counting it.
//
// The spec is the parent GitHub links the ticket to, the one `npm run ticket` prints, and its other tickets are its
// other sub-issues: only someone with write access can link either (settled on #114).
//
//   node tracker.ts <ticket> <out>
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { api, apiList, issueNumbered, ticket, trustIn, type Issue, type Trust } from '../../../scripts/ticket.ts';

/** The acceptance criteria in `body`, or a line saying it holds none. */
const criteria = (body: string | null) =>
  (body ?? '').replace(/\r\n/g, '\n').match(/## Acceptance criteria\s*([\s\S]*?)(?=\n## |$)/)?.[1]?.trim() ??
  '(no acceptance criteria)';

/**
 * The acceptance criteria of each open sub-issue of `spec` but ticket `n`, in the order of their numbers, as Markdown.
 * Only a sub-issue that a trusted author opened in the ticket's repo is listed.
 */
async function siblings(n: number, spec: Issue, trust: Trust): Promise<string> {
  // A parent holds at most 100 sub-issues, and a page at most 100 (GitHub's docs, read on 2026-11-18), so they come in
  // one page, and none can move between pages.
  const subIssues = await apiList<Issue>(`repos/{owner}/{repo}/issues/${spec.number}/sub_issues?per_page=100`);
  const found = subIssues
    .filter((issue) => issue.state === 'open' && !trust.elsewhere(issue) && issue.number !== n && trust.trusts(issue.user))
    .sort((a, b) => a.number - b.number);
  if (found.length === 0) return `Spec #${spec.number} has no other open tickets.\n`;
  return found.map((issue) => `## #${issue.number} ${issue.title}\n\n${criteria(issue.body)}\n`).join('\n');
}

try {
  const [number, out] = process.argv.slice(2);
  if (!number || !/^[1-9]\d*$/.test(number) || !out) throw new Error('usage: node tracker.ts <ticket> <out>');
  const n = Number(number);
  const [issue, parent] = await Promise.all([
    issueNumbered(n),
    api([`repos/{owner}/{repo}/issues/${n}/parent`]) as Promise<Issue | undefined>,
  ]);
  const trust = await trustIn(issue.repository_url);
  writeFileSync(join(out, 'ticket.md'), await ticket(n));
  let others = `Ticket #${n} has no parent spec, so it has no sibling tickets.\n`;
  // A parent someone else opened, or one in another repo, is withheld in ticket.md, as it stays here.
  if (parent && (!trust.trusts(parent.user) || trust.elsewhere(parent))) {
    others = `Ticket #${n}'s parent is withheld in ticket.md, so neither it nor its other tickets were read.\n`;
  } else if (parent) {
    writeFileSync(join(out, 'spec.md'), await ticket(parent.number));
    others = await siblings(n, parent, trust);
  }
  writeFileSync(join(out, 'siblings.md'), others);
} catch (error) {
  process.stderr.write(`tracker: ${(error as Error).message}\n`);
  process.exitCode = 1;
}
