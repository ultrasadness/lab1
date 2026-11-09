#!/usr/bin/env bash
# An outside review: Codex, a model other than the one that wrote the code, reviews a ticket's commits.
#
#   review.sh <ticket> <base> [<head>]      OUT=<folder> chooses where the review's files go
#
# Codex runs read-only inside bwrap, which shows it no other process and hides the home folder and /tmp but for what
# it needs, and it starts with an empty environment. sandboxed.sh refuses to start Codex unless every folder in HIDDEN
# is covered. Afterwards audit.ts lists every command Codex ran.
#
# Exit codes: 2, a bad argument; 3, a folder wasn't hidden, so no review ran; 4, the diff holds only docs, so no review
# ran; 137, Codex ran past its limit; other, a failure this script explains.
set -euo pipefail

# Hidden whole, so that what nobody listed stays hidden: #107 found ~/.cc-switch, ~/.claude.json and ~/.bash_history
# past the list of credential folders this replaced. /tmp holds the sessions' scratchpads, and a session's reasoning is
# what an outside review keeps out.
HIDDEN=("$HOME" /tmp)
# The programs Codex runs, shown back read-only. Its own home, ~/.codex, comes back writable below.
PROGRAMS=("$HOME/.local/bin" "$HOME/.nvm")

usage='usage: review.sh <ticket> <base> [<head>]'
ticket=${1:?$usage}
base_ref=${2:?$usage}
head_ref=${3:-HEAD}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
cd "$repo"

[[ $ticket =~ ^[0-9]+$ ]] || { echo "The ticket is a GitHub issue number, such as 42." >&2; exit 2; }
base=$(git rev-parse --verify --quiet "$base_ref^{commit}") || { echo "$base_ref is not a commit." >&2; exit 2; }
head=$(git rev-parse --verify --quiet "$head_ref^{commit}") || { echo "$head_ref is not a commit." >&2; exit 2; }
# The review reads the branch's own work. `main` can move on after the branch was rebased, and a diff against its tip
# reads what `main` gained as the branch undoing it: #107's first review was told its branch reverted #105.
base=$(git merge-base "$base" "$head") || { echo "$base_ref and $head_ref share no history." >&2; exit 2; }
if git diff --quiet "$base" "$head"; then
  echo "Nothing to review: $base_ref and $head_ref have the same tree." >&2
  exit 2
fi

# A diff of only docs gets no Codex, as the person settled on #107. Each side of a rename is listed, so a rename from
# code to a doc counts as code. The list is read whole first: with pipefail, `git diff | grep -q` can fail on the
# SIGPIPE that grep's early exit gives git.
changed=$(git -c core.quotePath=false diff --name-only --no-renames "$base" "$head")
if ! grep -qvE '(\.md|\.i18n\.yaml)$' <<< "$changed"; then
  echo "Nothing to review: only docs changed between $base_ref and $head_ref, so Codex didn't start." >&2
  exit 4
fi

out=${OUT:-$(mktemp -d "${TMPDIR:-/tmp}/outside-review-$ticket-XXXXXX")}
mkdir -p "$out"
out=$(cd "$out" && pwd)

# A code review waits on this script, so GitHub has a bound as Codex does.
github() {
  timeout --signal=KILL "${OUTSIDE_REVIEW_GITHUB_LIMIT:-60s}" gh "$@" || {
    echo "gh $1 $2 failed or ran past its limit (exit $?)." >&2
    exit 1
  }
}

# What the reviewer reads besides the repo: the commits, the ticket and its parent spec with their comments, where the
# person's settled questions are, and the spec's other open tickets, so a finding a later ticket owns is marked as that
# ticket's.
git log --format='%h %s' "$base..$head" > "$out/commits.txt"
github issue view "$ticket" --json number,title,body,comments > "$out/ticket.json"
body=$(github issue view "$ticket" --json body --jq .body)
parent=$(sed -n '/^## Parent/,/^## [^P]/p' <<< "$body" | grep -o -m1 '#[0-9]\+' | tr -d '#' || true)
if [[ -n $parent ]]; then
  github issue view "$parent" --json number,title,body,comments > "$out/spec.json"
  github issue list --state open --limit 500 --json number,title,body | node "$here/siblings.ts" "$ticket" "$parent" > "$out/siblings.md"
else
  echo "Ticket #$ticket has no parent spec, so it has no sibling tickets." > "$out/siblings.md"
fi
sed -e "s|{{REPO}}|$repo|g" -e "s|{{OUT}}|$out|g" -e "s|{{BASE}}|$base|g" -e "s|{{HEAD}}|$head|g" \
  -e "s|{{TICKET}}|$ticket|g" "$here/prompt.md" > "$out/prompt.md"

# A worktree's git data sits in the main checkout, so the review needs that checkout as well as its own.
checkout=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
mounts=()
for path in "${HIDDEN[@]}"; do
  mounts+=(--tmpfs "$path")
done
mounts+=(--ro-bind "$checkout" "$checkout" --ro-bind "$repo" "$repo")
for path in "${PROGRAMS[@]}"; do
  [[ ! -e $path ]] || mounts+=(--ro-bind "$path" "$path")
done
[[ ! -e $HOME/.codex ]] || mounts+=(--bind "$HOME/.codex" "$HOME/.codex")
mounts+=(--bind "$out" "$out")

# The session holds the worktree still while Codex reads it (CLAUDE.md), and this says when it didn't.
worktree_state() {
  git rev-parse HEAD
  git status --porcelain
}
before=$(worktree_state)

echo "Codex is reviewing #$ticket ($(wc -l < "$out/commits.txt") commits); its files go in $out"
status=0
bwrap --dev-bind / / --unshare-pid --proc /proc --die-with-parent "${mounts[@]}" \
  -- bash "$here/sandboxed.sh" "$out" "$repo" "${HIDDEN[@]}" || status=$?
[[ $status -ne 3 ]] || exit 3

# A run that failed or was stopped is audited too: what it tried is still worth the record.
[[ ! -e $out/events.jsonl ]] || node "$here/audit.ts" "$out" "$repo" "$checkout"
[[ $(worktree_state) == "$before" ]] || echo "Warning: the worktree changed while Codex read it, so its review may not match these commits."
if [[ $status -ne 0 ]]; then
  [[ $status -ne 137 ]] || echo "Codex ran past its limit, so there is no review." >&2
  tail -n 20 "$out/stderr.txt" >&2 || true
  exit "$status"
fi
echo "Review: $out/review.md"
