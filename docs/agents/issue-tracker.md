# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: first search the open issues for the same work, `gh issue list --state open --search "<words>"`,
  and widen the one you find with a comment rather than opening another: #94 duplicated #87. Then
  `gh issue create --title "..." --body "..."`, with a heredoc for a multi-line body. A ticket cut from another issue
  opens with a `## Parent` section naming that issue, and is linked as its sub-issue, so that **Read an issue** on the
  ticket prints the parent:
  `gh api --method POST repos/{owner}/{repo}/issues/<parent>/sub_issues -F sub_issue_id="$(gh api repos/{owner}/{repo}/issues/<child> --jq .id)"`.
- **A ticket that settles a question by trying it** says what to build for each result the trial can give, not only
  the expected ones. #91's criteria covered GitHub closing an issue on one of two split forms, or on neither. It closed
  on both, and two of the criteria then asked for opposite things.
- **Read an issue**: `npm run ticket -- <number>`. It prints the issue's number, state, title, labels, body and
  comments, then its parent with the parent's body and comments, then each issue that mentions it with the lines that
  do. It reads through `gh api`, so it prints the same without a terminal, where `gh issue view --comments` prints only
  the comments.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **List the ready tickets**: open, `ready-for-agent`, unassigned and with no open blocker. A `Spec:` issue is its tickets' parent, not a ticket. `gh issue list --state open --label ready-for-agent --limit 100 --json number,title,assignees,blockedBy --jq '.[] | select(.assignees == [] and ([.blockedBy.nodes[] | select(.state == "OPEN")] | length) == 0 and (.title | startswith("Spec:") | not)) | "#\(.number) \(.title)"'`
- **Claim a ticket** as the session's first write on it: `gh issue edit <number> --add-assignee @me`. **List the ready tickets** leaves out an assigned ticket, so a claimed one stays with this session while parallel sessions pick theirs.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Land a ticket**, once the person says to: from the ticket's worktree, push its branch and wait for the branch's CI to pass (`gh run watch <id>`, with the ids from `gh run list --commit "$(git rev-parse HEAD)"`; `--commit` takes only a full SHA, and a short one lists no runs). Then fast-forward `main` in the main checkout (`main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`) and push it: `git -C "$main" merge --ff-only <branch> && git -C "$main" push origin main`. Fast-forwarding keeps the branch's commit, so the branch's CI is the one that counts: the pre-push hook (`.githooks/pre-push`) refuses the push to `main` until GitHub Actions has run on that commit and every run has passed. Other sessions share the main checkout, so first check that it is on `main` with a clean `git status`. If `origin/main` has moved past the branch's base, rebase the branch onto it before pushing the branch.
- **Close**: `gh issue close <number> --comment "..."`, once the ticket has landed. Landing already waited for the branch's CI on the same commit, so closing doesn't wait for the run that pushing `main` starts. The comment opens with ``Landed on main in <sha> (branch `<branch>`); CI passed.``, says what the ticket delivered, and ends with a `Left for #<number>: ...` line naming each piece of work another ticket takes on. When nothing is left, it ends on what the ticket delivered. A departure from an ADR is such a piece: name the ticket that builds what the ADR describes, or propose amending the ADR. #84 put the Miner's prices in the config where ADR 0011 names `ops/pins`, and its close named only #85 and #69, so #72, which builds `ops/pins`, heard of it only in a retro. For leftover work that no open ticket takes on, ask the person before closing whether to open one, and name the new ticket in that line. Then write that work up in full on the ticket taking it on, where whoever reads that ticket sees it: `gh issue comment <number> --body "Left by #<closed number>: ..."`, saying what is left, which of that ticket's criteria it touches, and what would settle it. Last, from the main checkout, remove the ticket's worktree and its local branch, which `main` now holds: `git -C "$main" worktree remove .claude/worktrees/<branch> && git -C "$main" branch -d <branch>`. Removing it deletes the worktree's own `node_modules` too.

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `npm run ticket -- <number>` (**Read an issue**) and read all three of its parts. An earlier ticket's closing
comment may leave work for this one (`Left for #<number>: ...`), and that work is part of the ticket: **Mentioned by**
prints that line. The parent may hold work beside the ticket's own that no ticket takes on yet: #77 was cut from half
of #74's triage brief, and the other half, now #92, came to light only because the session read #74.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue, as **Create an issue** links a ticket cut from another issue. Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
