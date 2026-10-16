#!/usr/bin/env bash
# PROTOTYPE, throwaway: start the Walkthrough prototype bot (lab1 #12), the day-list bot (lab1 #29), the Dossier bot (lab1 #33), or remove #12's tailnet serve.
set -euo pipefail
cd "$(dirname "$0")"
if [[ "${1:-}" == down ]]; then tailscale serve --https=8446 off; exit 0; fi
[[ -d node_modules ]] || npm install --no-fund --no-audit
if [[ "${1:-}" == day ]]; then exec node day.mjs; fi
if [[ "${1:-}" == dossier ]]; then node dossier-git.mjs; exec node dossier.mjs; fi
tailscale serve --bg --https=8446 http://127.0.0.1:8446 >/dev/null
exec node bot.mjs
