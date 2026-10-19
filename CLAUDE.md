## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Branches

A ticket's branch gets a worktree of its own: `git worktree add .claude/worktrees/<branch> -b <branch> main`, and the
session works there. The main checkout stays on `main`, because other sessions share it.
