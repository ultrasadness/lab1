#!/usr/bin/env bash
# PROTOTYPE, throwaway: build and start the Takeover shapes rig (issue #21), tailnet-only.
#   ./run.sh         build, start, and publish to the tailnet on :8443 (thread), :8444 (noVNC), :8445 (Dashboard)
#   ./run.sh down    stop the container and remove the three tailscale serve ports
set -euo pipefail
cd "$(dirname "$0")"
TS_HOST=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
PORTS=(8443:18090 8444:18091 8445:18092)

if [[ "${1:-}" == down ]]; then
  docker rm -f takeover-proto >/dev/null 2>&1 || true
  for p in "${PORTS[@]}"; do sudo tailscale serve --https="${p%%:*}" off >/dev/null 2>&1 || true; done
  echo "rig down"; exit 0
fi

docker build -q -t takeover-proto . >/dev/null
docker rm -f takeover-proto >/dev/null 2>&1 || true
# The hardening from ADR 0006: non-root pwuser, Playwright's seccomp profile so Chromium's sandbox is on,
# all capabilities dropped but SYS_CHROOT (Chromium's namespace sandbox chroots; without it the zygote dies), read-only root filesystem, --shm-size instead of --ipc=host, ports on localhost only.
docker run -d --name takeover-proto --init \
  --user pwuser --cap-drop ALL --cap-add SYS_CHROOT --security-opt no-new-privileges \
  --security-opt seccomp="$PWD/seccomp_profile.json" \
  --read-only --tmpfs /tmp --tmpfs /home/pwuser:uid=1001,gid=1001 --tmpfs /var/lib/xkb --shm-size=1g \
  -e TS_HOST="$TS_HOST" \
  -p 127.0.0.1:18090:8090 -p 127.0.0.1:18091:6080 -p 127.0.0.1:18092:9330 \
  takeover-proto >/dev/null

for p in "${PORTS[@]}"; do sudo tailscale serve --bg --https="${p%%:*}" "http://127.0.0.1:${p##*:}" >/dev/null; done
echo "waiting for the rig..."
for _ in $(seq 60); do docker logs takeover-proto 2>&1 | grep -q 'rig ready' && break; sleep 1; done
docker logs takeover-proto 2>&1 | tail -20
echo
echo "Thread (open on the iPhone): https://$TS_HOST:8443/"
