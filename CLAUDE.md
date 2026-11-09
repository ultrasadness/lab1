## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues, using the `gh` CLI. Read `docs/agents/issue-tracker.md` before the first `gh`
call on an issue, and again before landing or closing a ticket.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Code review

A review reads committed work, rebased onto `main`, as a hook checks: review `git diff main...HEAD`, and amend the
review's fixes into the commit.

A review's standards sources include each ADR in `docs/adr/` whose decision covers what the diff changes, and each
question the person settled on the ticket. Name them in the Standards prompt, and the Standards report names each ADR
it checked, or says that none covers the diff.

The Spec prompt asks for each case the spec's wording reaches that neither the spec nor the questions settled on it
weighed, as a question for the person rather than a defect, and the Spec report names each one or says it found none.
It also lets the Spec reviewer try a case it doubts in a scratch copy of the worktree, stopping only the processes it
started, by pid.

A Claude session's review also runs the outside review, so a model that didn't write the code reads it too. Read
`.claude/skills/outside-review/SKILL.md` first. Start its `review.sh` in the message that spawns the two sub-agents,
with the ticket and `main` as its ticket and base, and carry on from its step 3 once it exits. Leave the worktree as it
is until all three have reported, since Codex reads it. Report step 5 as the review's `## Outside`, after `## Standards`
and `## Spec`, saying why when Codex didn't run, as on a review with no ticket. The findings it confirms are fixes like
any others.

## Branches

A ticket's branch gets a worktree of its own: `git worktree add .claude/worktrees/<branch> -b <branch> main`, and the
session works there. The main checkout stays on `main`, because other sessions share it.

## Language

Reply to me in Simplified Chinese, in chat and in the questions you ask me. Inside Chinese sentences, keep glossary
terms (`CONTEXT.md`) and skill names in English. Write everything that lands in the repo or the tracker in English:
code, comments, commits, issues, docs, and the Assistant's own Discord text. The one exception is a doc pair's Chinese
side, `foo.zh.md` beside `foo.md`: a commit that edits either side updates the other side too, as
`docs/agents/doc-pairs.md` says.
