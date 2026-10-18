#!/usr/bin/env bash
# Runs inside review.sh's bwrap sandbox: checks that every credential folder is covered by an empty mount, then
# starts Codex with an empty environment.
#
#   sandboxed.sh <out> <repo> <hidden folder>...
set -euo pipefail
out=$1
repo=$2
shift 2

for path in "$@"; do
  # A mountinfo line's fifth field is the mount point; the field after the lone "-" is the filesystem type.
  if ! awk -v p="$path" '$5 == p { for (i = 7; i <= NF; i++) if ($i == "-") { if ($(i + 1) == "tmpfs") found = 1; break } }
      END { exit !found }' /proc/self/mountinfo; then
    echo "Refusing to start Codex: $path is not hidden." >&2
    exit 3
  fi
done

exec env -i HOME="$HOME" PATH="$PATH" LANG=C.UTF-8 TERM=dumb \
  codex exec --sandbox read-only --ephemeral -C "$repo" --json -o "$out/review.md" - \
  < "$out/prompt.md" > "$out/events.jsonl" 2> "$out/stderr.txt"
