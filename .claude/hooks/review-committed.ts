// A PreToolUse hook on the Skill tool (.claude/settings.json): a code-review skill starts only on committed work that
// holds `main`, as the Code review section of CLAUDE.md asks. A review reads `git diff main...HEAD`. That diff leaves out
// work not yet committed. It also leaves out a conflict a rebase onto a newer `main` still has to resolve, which would
// then land unreviewed: in #47, `main` gained #84 midway, and the rebase added a budget the review would not have read.
// The hook refuses the skill, saying which to do first. It lets the skill through when it can't tell, such as outside
// a git checkout or in one with no `main`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const GIT_TIMEOUT_MS = 10_000;

/** The skills that review a branch's work: this repo's two-axis review and Claude Code's own. */
export const isReview = (skill: string) => /(?:^|:)code-review$/.test(skill);

function git(cwd: string, ...args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }) };
  } catch {
    return { ok: false, out: '' };
  }
}

/** Why a review can't start in this checkout yet, or undefined when it can. */
export function notReady(cwd: string): string | undefined {
  if (!git(cwd, 'rev-parse', '--is-inside-work-tree').ok) return undefined;
  const changed = git(cwd, 'status', '--porcelain');
  if (!changed.ok) return undefined;
  if (changed.out.trim()) {
    return 'Commit the work first: a review reads `git diff main...HEAD`, which leaves out whatever is not committed, new files included.';
  }
  if (!git(cwd, 'rev-parse', '--verify', '--quiet', 'refs/heads/main').ok) return undefined;
  if (!git(cwd, 'merge-base', '--is-ancestor', 'main', 'HEAD').ok) {
    return 'Rebase onto `main` first (`git rebase main`): `main` has commits this branch lacks, and the conflicts a rebase resolves would land unreviewed.';
  }
  return undefined;
}

function main(): void {
  let input: { tool_input?: { skill?: unknown }; cwd?: unknown };
  try {
    input = JSON.parse(readFileSync(0, 'utf8')) as typeof input;
  } catch {
    return;
  }
  const skill = input.tool_input?.skill;
  if (typeof skill !== 'string' || !isReview(skill)) return;
  const reason = notReady(typeof input.cwd === 'string' ? input.cwd : process.cwd());
  if (!reason) return;
  const decision = { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason };
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: decision })}\n`);
}

if (import.meta.main) main();
