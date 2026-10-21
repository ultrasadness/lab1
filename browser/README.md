# The browser service

English | [中文](README.zh.md)

Playwright in its own hardened container (ADR 0006), run as-is through Node's type stripping. Its only
client is the bot, through a Unix socket: it listens on no port, and its network is its own, so the Pi
container can't reach it. This slice (#43) brings up the container and the read-only `read(url)` that
Dossiers and Walkthroughs use to read Product pages before any Approval.

| Path | What it is |
|---|---|
| `src/api.ts` | The socket API's types: what the bot sends and gets back |
| `src/client.ts` | The bot's side of the socket |
| `src/main.ts` | Starts Xvfb, one headed Chrome for Testing (refusing to start without its sandbox) and the socket |
| `src/reader.ts` | `read(url)`: one page in a throwaway in-memory context |
| `src/snapshot.ts`, `src/redact.ts` | What a read sees of a page, and the removal of random-looking strings |
| `src/cookie-banners.ts` | autoconsent in opt-out mode, before each snapshot |
| `src/walls.ts` | Card fields, and a bot check or interstitial on load |
| `Dockerfile`, `compose.yaml`, `seccomp_profile.json` | The image, pinned by digest, and the container's hardening |
| `chrome-policies.json` | Managed policies: no password saving, autofill, downloads or permission prompts in any context |

The pins: the Playwright image's digest in `Dockerfile`, and exact versions of `playwright-core` (matching the
image) and `@duckduckgo/autoconsent` in `package.json`, both updated only through `ops/upgrade`.

## The socket API

HTTP with JSON bodies, on the socket at `$SOCKET_PATH`.

- `GET /health`: the browser's version and the autoconsent version. The service only runs headed, with
  Chromium's sandbox: without the sandbox it exits at start.
- `POST /read` with `{ "url": "https://…" }`: a `PageRead` (`src/api.ts`), or `{ "error": { "kind", "message" } }`
  with 400 for a URL that isn't plain http or https, and 502 when the page won't load, is a download, or takes
  longer than 60 s. `snapshot` is what a model may see: every string in it has random-looking strings replaced
  by `[random]`. The rest (the exact final URL and host, status, payment fields, bot check and cookie banner)
  is for plain code.

## Test

```sh
npm ci
npm run typecheck
npm test                         # every test; builds the image first
KEEP_BROWSER=1 npm test          # leaves the containers up afterwards
```

The tests are the browser seam (seam 2): they drive the socket against real Chromium in the real image, started
from `compose.yaml` with all its hardening. `test/compose.test.yaml` puts it on a network with no internet,
beside a server of local test pages (`test/pages/`) that answers for every host the tests name.

The pre-commit hook runs this typecheck on the staged files, with the dependencies installed here, and CI runs
`npm ci`, the typecheck and the tests in a workflow of their own (`docs/hooks-and-ci.md`).

## Run

`compose.yaml` needs two settings, which the install on the VM (#71) provides:

- `BROWSER_SOCKET_DIR`: a directory owned by the bot's user and group, mode `2770`, so the socket inside it
  takes the bot's group;
- `BROWSER_SOCKET_GID`: the bot's group id, which the container joins to create the socket there.

```sh
BROWSER_SOCKET_DIR=/run/lab1-browser BROWSER_SOCKET_GID=$(getent group assistant | cut -d: -f3) docker compose up -d --build
```

The host firewall rules that keep its egress to the public internet are also #71's.
