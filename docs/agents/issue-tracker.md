# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: first search the open issues for the same work, `gh issue list --state open --search "<words>"`,
  and widen the one you find with a comment rather than opening another: #94 duplicated #87. Then
  `gh issue create --title "..." --body "..."`, with a heredoc for a multi-line body. A ticket cut from another issue
  opens with a `## Parent` section naming that issue, and is linked as its sub-issue, so that **Read an issue** on the
  ticket prints the parent:
  `gh api --method POST repos/{owner}/{repo}/issues/<parent>/sub_issues -F sub_issue_id="$(gh api repos/{owner}/{repo}/issues/<child> --jq .id)"`.
- **A change to a decision goes where it is checked:** a rule a review checks to `CODING_STANDARDS.md`, a design decision
  to a new ADR under `docs/adr/`, and new behaviour to a ticket and its tests. #41 stays as the plan of 2026-10-17, so a
  ticket's criteria name one of those three. The person settled this on #92 on 2026-10-21, and it stayed on #92 alone:
  #101, opened on 2026-11-01, asked to amend #41 first, and #41 was amended.
- **A ticket that writes a rule** tries it on what the repo holds, and names each case it reaches. #92's rule, on what a
  test asserts on, was tried on the twelve tests it named. A grep of `bot/test` found it also reached healthchecks.io's
  pings, the raw input files and whether a run's processes are alive, and the person had to settle those in the middle
  of the work.
- **A ticket that settles a question by trying it** says what to build for each result the trial can give, not only
  the expected ones. #91's criteria covered GitHub closing an issue on one of two split forms, or on neither. It closed
  on both, and two of the criteria then asked for opposite things.
- **A criterion that names the part doing the work** names one that can do it at that moment: check it against the
  spec's parts and boundaries. #49's "The extension measures the Rule budget… when a Rule is kept" named our Pi
  extension, which runs only inside a Pi run, and Keep happens in none. The bot measured it instead, and #49 closed on
  a departure from its own criteria.
- **A criterion over a state**, such as "With Walkthroughs off: …", names each way into that state it covers. #99's
  meant a bot whose Walkthroughs had never been on. Both reviewers read it as covering Walkthroughs turned off after
  their cards went out too, where Correct still starts a run, and the person settled that case only after the review.
- **A ticket says when by what it waits on**: a ticket or a condition, as "until #56 lets an Approval fill the form".
  #85's "The other parts stay off until their sprint" gave #99 its title and `bot/README.md` its phrase, and the
  person asked what a sprint was. Nothing in the repo or the tracker defines one.
- **A question the person settles while you work a ticket** goes on the ticket as a comment before the review: the
  question, the answer, and what it changes in the ticket's criteria. The review then reads it with the ticket, and
  later tickets find it there. In #47 the person chose to hold the day's list on a Dossier that can't be written. Only
  the Spec prompt was told, and the Standards reviewer reported that choice as a hard violation. A case the criteria's
  wording reaches that the ticket never weighed is such a question: ask it when you find it. #99's session met the
  turned-off-again case while building, decided it alone, and asked only once both reviewers sent it back.
- **Read an issue**: `npm run ticket -- <number>`. It prints the issue's number, state, title, labels, body and
  comments, then its parent with the parent's body and comments, then each issue that mentions it with the lines that
  do. A `Spec:` parent prints its headings in place of its body. It reads through `gh api`, so it prints the same
  without a terminal, where `gh issue view --comments` prints only the comments.
- **Read part of an issue**: `npm run ticket -- <number> --heading "<words>"`, once for each part, prints only the parts
  of the issue's body and comments whose heading names those words, each down to the next heading of its level. Use it
  for a part another issue names, such as a spec heading the ticket needs or the "#40 §2 and §8" #48 was decided in:
  `npm run ticket -- 40 --heading "2." --heading "8."`. #48's session printed #40 whole for those two, 54 KB where the
  parts are 2.5 KB. Words that name no heading fail, listing the issue's headings.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **List the ready tickets**: open, `ready-for-agent`, unassigned and with no open blocker. A `Spec:` issue is its tickets' parent, not a ticket. `gh issue list --state open --label ready-for-agent --limit 100 --json number,title,assignees,blockedBy --jq '.[] | select(.assignees == [] and ([.blockedBy.nodes[] | select(.state == "OPEN")] | length) == 0 and (.title | startswith("Spec:") | not)) | "#\(.number) \(.title)"'`
- **Claim a ticket** as the session's first write on it: `gh issue edit <number> --add-assignee @me`. **List the ready tickets** leaves out an assigned ticket, so a claimed one stays with this session while parallel sessions pick theirs.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Land a ticket**, once the person says to: from the ticket's worktree, push its branch and wait for the branch's CI to pass (`gh run watch <id>`, with the ids from `gh run list --commit "$(git rev-parse HEAD)"`; `--commit` takes only a full SHA, and a short one lists no runs). Then fast-forward `main` in the main checkout (`main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`) and push it: `git -C "$main" merge --ff-only <branch> && git -C "$main" push origin main`. Fast-forwarding keeps the branch's commit, so the branch's CI is the one that counts: the pre-push hook (`.githooks/pre-push`) refuses the push to `main` until GitHub Actions has run on that commit and every run has passed. Other sessions share the main checkout, so first check that it is on `main` with a clean `git status`. If `origin/main` has moved past the branch's base, rebase the branch onto it before pushing the branch.
- **Close**: `gh issue close <number> --comment "$(cat <<'EOF' ... EOF)"`, with the heredoc's lines on lines of their own, once the ticket has landed. The comment holds backticks, which double quotes would run as a command, and the command has no body-file flag. Landing already waited for the branch's CI on the same commit, so closing doesn't wait for the run that pushing `main` starts. The comment opens with ``Landed on main in <sha> (branch `<branch>`); CI passed.``, says what the ticket delivered, and ends with a `Left for #<number>: ...` line naming each piece of work another ticket takes on. When nothing is left, it ends on what the ticket delivered. A departure from an ADR is such a piece: name the ticket that builds what the ADR describes, or propose amending the ADR. #84 put the Miner's prices in the config where ADR 0011 names `ops/pins`, and its close named only #85 and #69, so #72, which builds `ops/pins`, heard of it only in a retro. For leftover work that no open ticket takes on, ask the person before closing whether to open one, and name the new ticket in that line. Then write that work up in full on the ticket taking it on, where whoever reads that ticket sees it: `gh issue comment <number> --body "Left by #<closed number>: ..."`, saying what is left, which of that ticket's criteria it touches, and what would settle it. Auto mode refuses a comment on another ticket, even a single one, as it did closing #55, #96 and #108, while it lets through the close of the ticket itself. So write each such comment to a file in the scratchpad, and hand the person one `!` line that posts it: `gh issue comment <number> --body-file <file>` for one, or a script that posts each for several. Last, from the main checkout, remove the ticket's worktree, its local branch and its remote branch, which `main` now holds: `git -C "$main" merge-base --is-ancestor <branch> origin/main && git -C "$main" worktree remove .claude/worktrees/<branch> && git -C "$main" branch -d <branch> && git -C "$main" push origin --delete <branch>`. The first command stops the rest if `origin/main` lacks the branch; `git branch -d` wouldn't, since it checks a branch against its upstream. Removing the worktree deletes its own `node_modules` too. This step once named only the local branch, and by 2026-11-02, 45 merged branches had piled up on `origin`.

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
of #74's triage brief, and the other half, now #92, came to light only because the session read #74. A `Spec:` parent
prints its heading line, the headings of its body and its comments, since a spec is the plan its tickets were cut
from: when a heading names what the ticket needs, such as Starting values for a ticket that sets one, print that part
with **Read part of an issue**. Do the same for each part of another issue the ticket says it was decided in. An
issue the ticket names whole, as #53 named "#12 (the card)", holds its decision in its `## Resolution` comment: print
that part, `npm run ticket -- 12 --heading Resolution`. #53's session printed #10, #11 and #12 whole, 53 to 61 KB
each, where their Resolutions print in 7 to 11 KB.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue, as **Create an issue** links a ticket cut from another issue. Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
