#!/usr/bin/env bash
# PROTOTYPE, throwaway: start the Walkthrough prototype bot (lab1 #12), or remove its tailnet serve.
set -euo pipefail
cd "$(dirname "$0")"
if [[ "${1:-}" == down ]]; then tailscale serve --https=8446 off; exit 0; fi
[[ -d node_modules ]] || npm install --no-fund --no-audit
tailscale serve --bg --https=8446 http://127.0.0.1:8446 >/dev/null
exec node bot.mjs
