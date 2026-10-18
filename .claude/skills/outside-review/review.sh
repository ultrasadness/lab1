#!/usr/bin/env bash
# An outside review: Codex, a model other than the one that wrote the code, reviews a ticket's commits.
#
#   review.sh <ticket> <base> [<head>]      OUT=<folder> chooses where the review's files go
#
# Codex runs read-only inside bwrap, which mounts an empty folder over each credential folder in HIDDEN and shows
# it no other process, and it starts with an empty environment. sandboxed.sh refuses to start Codex unless every
# folder in HIDDEN is covered. Afterwards audit.ts lists every command Codex ran.
#
# Exit codes: 2, a bad argument; 3, a credential folder wasn't hidden, so no review ran; other, Codex failed.
set -euo pipefail

# Every folder here that exists is hidden from Codex.
HIDDEN=(
  "$HOME/.config/lab1" # the Assistant's tokens (ADR 0009)
  "$HOME/.config/gh"
  "$HOME/.config/anthropic"
  "$HOME/.ssh"
  "$HOME/.claude"
  "$HOME/.docker"
)

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
if git diff --quiet "$base" "$head"; then
  echo "Nothing to review: $base_ref and $head_ref have the same tree." >&2
  exit 2
fi

out=${OUT:-$(mktemp -d "${TMPDIR:-/tmp}/outside-review-$ticket-XXXXXX")}
mkdir -p "$out"

# What the reviewer reads besides the repo: the commits, the ticket, its parent spec and the spec's other open
# tickets, so a finding a later ticket owns is marked as that ticket's.
git log --format='%h %s' "$base..$head" > "$out/commits.txt"
gh issue view "$ticket" --json number,title,body,comments > "$out/ticket.json"
parent=$(gh issue view "$ticket" --json body --jq .body | sed -n '/^## Parent/,/^## [^P]/p' | grep -o -m1 '#[0-9]\+' | tr -d '#' || true)
if [[ -n $parent ]]; then
  gh issue view "$parent" --json number,title,body > "$out/spec.json"
  gh issue list --state open --limit 500 --json number,title,body | node "$here/siblings.ts" "$ticket" "$parent" > "$out/siblings.md"
else
  echo "Ticket #$ticket has no parent spec, so it has no sibling tickets." > "$out/siblings.md"
fi
sed -e "s|{{REPO}}|$repo|g" -e "s|{{OUT}}|$out|g" -e "s|{{BASE}}|$base|g" -e "s|{{HEAD}}|$head|g" \
  -e "s|{{TICKET}}|$ticket|g" "$here/prompt.md" > "$out/prompt.md"

hidden=()
mounts=()
for path in "${HIDDEN[@]}"; do
  if [[ -e $path ]]; then
    hidden+=("$path")
    mounts+=(--tmpfs "$path")
  fi
done

echo "Codex is reviewing #$ticket ($(wc -l < "$out/commits.txt") commits); its files go in $out"
status=0
bwrap --dev-bind / / --unshare-pid --proc /proc --die-with-parent "${mounts[@]}" \
  -- bash "$here/sandboxed.sh" "$out" "$repo" "${hidden[@]}" || status=$?
if [[ $status -ne 0 ]]; then
  [[ $status -eq 3 ]] || tail -n 20 "$out/stderr.txt" >&2
  exit "$status"
fi

node "$here/audit.ts" "$out" "$repo"
echo "Review: $out/review.md"
