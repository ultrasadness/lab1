# PROTOTYPE, throwaway: Takeover shapes rig

Answers [Which Takeover shape works from the iPhone: noVNC or Playwright's Dashboard?](https://github.com/ultrasadness/lab1/issues/21). Kept as a primary source; not production code.

**Verdict: noVNC.** Both noVNC test Registrations were completed from the iPhone. On the Dashboard the person couldn't reliably type or select anything, and it lists every bound session. The full answer is on the issue and in [ADR 0006](https://github.com/ultrasadness/lab1/blob/main/docs/adr/0006-registration-browser-in-its-own-container-driven-through-fixed-actions.md).

## What it runs

One container with ADR 0006's hardening (with the corrections it found: `SYS_CHROOT` kept, home tmpfs owned by `pwuser`). Four test Registrations, each a headed Chrome for Testing on its own Xvfb display:

| Registration | Takeover shape | Window |
|---|---|---|
| Acme Notes | noVNC | phone-sized, 500x900 @2x (500 DIPs is Chrome's narrowest window) |
| Birch Docs | noVNC | desktop-sized, 1280x800 |
| Cobalt CRM | Playwright Dashboard | phone-sized |
| Delta Sheets | Playwright Dashboard | desktop-sized |

Plain code fills name, email and password into a local test form, then stops at a bot check (Cloudflare Turnstile's always-interactive test key). The person takes over, ticks Terms, passes the bot check, types the code from `/inbox` (a Gmail stand-in) and submits. The browser service logs the POST it observes.

- `:8443`: the thread page, standing in for the Discord messages (Take over, Continue, I submitted, Fill password again, Reset session)
- `:8444`: noVNC 1.7.0 + websockify, routed by a per-Takeover token to one display
- `:8445`: `playwright cli show`, the Dashboard; a browser is bound only while it is taken over

All three are tailnet-only through `tailscale serve`; the container publishes to `127.0.0.1` only.

## Run

```sh
./run.sh        # build, start, publish to the tailnet; prints the thread URL
./run.sh down   # stop, and remove the three serve ports
```
