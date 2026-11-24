# The browser service

English | [中文](README.zh.md)

Playwright in its own hardened container (ADR 0006), run as-is through Node's type stripping. Its only
client is the bot, through a Unix socket: it listens on no port, and its network is its own, so the Pi
container can't reach it. #43 brought up the container and the read-only `read(url)` that Dossiers and
Walkthroughs use to read Product pages before any Approval. #55 adds a Registration's session: the fixed actions a
fill run may use through the bot, and plain code's page check, press and fills by reference. #101 added
`redirect(url)`. Since #56 the bot drives a session: it opens one, switches drivers, carries out a fill run's actions,
and asks for the check, the fingerprint and the press. Since #58 it asks for `fill-code` and `open-link` to verify a
Registration. Since #59 it asks for a screenshot for a Submit tap, and presses on the page whose fingerprint the person
approved. Since #115 it adds a domain to an open session, once the person approves an amended Walkthrough naming a host
off the session's domains.

| Path | What it is |
|---|---|
| `src/api.ts` | The socket API's types: what the bot sends and gets back |
| `src/client.ts` | The browser tests' client for the socket. The bot imports nothing from `browser/`, so its own side is `bot/src/browser.ts` |
| `src/main.ts` | Starts Xvfb, one headed Chrome for Testing (refusing to start without its sandbox) and the socket |
| `src/reader.ts` | `read(url)`: one page in a throwaway in-memory context |
| `src/redirect.ts` | `redirect(url)`: where a URL points, from a HEAD that follows nothing |
| `src/sessions.ts` | A Registration's sessions: their limit, drivers and closes, the fixed actions, and plain code's actions |
| `src/page-check.ts` | The page check's rules, judged on the form the named button submits |
| `src/snapshot.ts`, `src/redact.ts` | What a read or a session sees of a page, and the removal of each Secret filled into a session and of random-looking strings |
| `src/cookie-banners.ts` | autoconsent in opt-out mode, before each snapshot |
| `src/walls.ts` | Card fields, and a bot check or interstitial on load |
| `Dockerfile`, `compose.yaml`, `seccomp_profile.json` | The image, pinned by digest, and the container's hardening |
| `chrome-policies.json` | Managed policies: no password saving, autofill, downloads or permission prompts in any context |

The pins: the Node runtime and Playwright images' digests in `Dockerfile`, and exact versions of `playwright-core`
(matching the Playwright image) and `@duckduckgo/autoconsent` in `package.json`, updated only through `ops/upgrade`.
The patched Node binary replaces the Playwright image's Node at `/usr/bin/node`, with `/usr/local/bin/node` pointing
to it, so both absolute paths and PATH use it without changing Chromium. Until #72 brings `ops/upgrade`, deploy
these pins through `ops/install --deploy` as `ops/README.md` describes.

## The socket API

HTTP with JSON bodies, on the socket at `$SOCKET_PATH`.

- `GET /health`: the browser's version and the autoconsent version. The service only runs headed, with
  Chromium's sandbox: without the sandbox it exits at start.
- `POST /read` with `{ "url": "https://…" }`: a `PageRead` (`src/api.ts`), or `{ "error": { "kind", "message" } }`
  with 400 for a URL that isn't plain http or https, and 502 when the page won't load, is a download, or takes
  longer than 60 s. `snapshot` is what a model may see: every string in it has random-looking strings replaced
  by `[random]`. The rest (the exact final URL and host, status, payment fields, bot check and cookie banner)
  is for plain code.
- `POST /redirect` with `{ "url": "https://…" }`: a HEAD of the URL from the service's network, with no browser and
  nothing followed, answering `{ "status", "location" }`. `location` is where a 3xx answer points, as an absolute URL,
  and otherwise null. The errors are `/read`'s, and it takes at most 30 s. The bot sends it only for Product Hunt's
  redirect, after a read of that redirect stops at a bot check (#101).
- `POST /session/open` with `{ "registration", "url", "domains" }`: a Registration's session, an in-memory context of
  its own, opened at the Walkthrough's start URL, answering `{ "session" }`. At most 5 are open at once (429, `full`),
  one per Registration (409, `already-open`), and a start page that won't load opens none (502). A session closes on
  `POST /session/close`, when an action takes longer than 60 s, once a verification link is opened, or after 24 hours
  with no request on it (`SESSION_IDLE_LIMIT_MS`): the bot's own 24-hour rules close it first, so this close catches a
  session the bot lost.
- `POST /session/domains` with `{ "session", "domain" }`: adds a host name to the session's domains, on which its
  actions may then act, as an amended Walkthrough's Approval of a host off them asks (#115). Adding one the session
  holds changes nothing, a session holds at most 10, and it needs no driver.
- `POST /session/drive` with `{ "session", "driver" }`: who drives the session now, `none`, `fill-run`,
  `plain-code` or `person`. Each action's path names the driver it needs, and while the person drives in a Takeover
  nothing else acts. Showing the fields the person fills as `[person]`, which the page check accepts, comes with
  #60's Takeover.
- `POST /fill-run/…`: the fixed actions a fill run may use through the bot, each refused (`off-domain`) unless the
  top-level page is on one of the session's domains, the refusal naming the page's `host`. `snapshot` rejects cookie banners first. It shows a field only by
  what filled it (its Walkthrough key, `[password]` or `[code]`), never by its value, and removes each Secret filled
  into the session by its exact value, then random-looking strings. Its refs (`f1`, `b1`, `l1`) name the fields,
  submit controls and links the other actions take, a form that shows only its button included. `fill` takes a Walkthrough key and the approved value the bot
  supplies; `fill-secret` a `password` or `code` the bot supplies by reference; `choose` an option's label, or
  `ticked` or `left unticked`, and clicks only elements whose role is combobox, option, checkbox, radio or switch;
  `open` loads a link's URL rather than clicking it, only on the session's domains.
- `POST /plain-code/…`: plain code's own actions. `snapshot` is the same as a fill run's. `check` is the page check:
  given the named button, the approved signup host, the approved terms' URLs and the Signup identity's two
  addresses, it answers which rule failed on which field, and `off-host` names the page's `host`. It judges the page once it has held still for 1.5 s, or as
  it stands 5 s after it was asked, since a page's script may still be reacting to the last fill. `fingerprint` hashes the URL, the form structure and the
  values, and answers the page's `shape` beside it: the URL, and each form's fields by type and name and its buttons by
  label, which tells the same form still showing after a press (#59). `screenshot` masks every field filled by reference, and can outline a button and mark
  fields, and masks too any field holding a Secret filled into the session, as when a page moves a password into a field
  of its own. A failure on such a field, or on one filled by reference, carries `secret`. `check` and `press`
  may take `approvedPage`, the fingerprint of the page a Submit tap approved: they then let through the values the
  person saw on it, `unapproved-value` and `unapproved-box` but never one marked `secret`, and are refused `changed`
  unless the page still has that fingerprint, judged on the page as it holds still (#59). `press` acts
  only when the check passes and the button is visible, enabled, on the session's domains and the only submit control
  of the form holding every filled field still shown, so an earlier step the page has hidden doesn't count. A click
  that fails once it has begun answers with `uncertain`, and counts as done (ADR 0007). `fill-code` fills an emailed
  code by reference, and `open-link` opens a verification link, then closes the session.
- Card fields (`cc-*` autocomplete values) are refused whatever is asked (`payment-field`), and a payment provider's
  frame is never in a snapshot. A refusal is `{ "error": { "kind", "message" } }` with the kinds `src/api.ts` lists,
  and a press refused by the check carries it in `check`.

## Test

```sh
npm ci
npm run typecheck
npm test                         # every test; builds the image first
KEEP_BROWSER=1 npm test          # leaves the containers up afterwards
npm run test:file -- test/page-check.test.ts   # one file, or several; builds the image first
npm run smoke                    # the fill smoke test alone
```

The tests are the browser seam (seam 2): they drive the socket against real Chromium in the real image, started
from `compose.yaml` with all its hardening. `test/compose.test.yaml` puts it on a network with no internet,
beside a server of local test pages (`test/pages/`) that answers for every host the tests name. That server logs each
form a session posts and each verification link it opens, which the tests read as what the Product received. The
test compose file also shortens a session's 24 hours without a request to 15 s, and its 60-second action limit to
20 s (`SESSION_ACTION_LIMIT_MS`), so the tests see both close a session. The whole run takes about 4 minutes.

On CI's runner a page's timers can run about a second late, which no local run has shown: see "Plain code judges a
page that has held still" in `CODING_STANDARDS.md` before a test asserts on a page script's reaction.

The fill smoke test (`test/smoke.test.ts`) fills the local test form through the fixed actions, presses it by plain
code, and checks that the test server received exactly the approved values. It is the browser image's upgrade gate
(ADR 0006), for `ops/upgrade` to run once #72 builds it.

The pre-commit hook runs this typecheck on the staged files, with the dependencies installed here, and CI runs
`npm ci`, the typecheck and the tests in a workflow of their own (`docs/hooks-and-ci.md`).

## Run

On the VM the service runs in the project of the root `compose.yaml`, beside Pi, on a bridge with a fixed name,
`br-lab1-browser`, and `ops/install` starts it there (`ops/README.md`). `compose.yaml` here needs two settings,
which `ops/install` provides:

- `BROWSER_SOCKET_DIR`: a directory owned by the bot's user and group, mode `2770`, so the socket inside it
  takes the bot's group;
- `BROWSER_SOCKET_GID`: the bot's group id, which the container joins to create the socket there.

Compose reads the seccomp profile from the project's directory, so a project elsewhere, such as the root
`compose.yaml`'s, also sets `BROWSER_SECCOMP_PROFILE` to `seccomp_profile.json`'s absolute path.

```sh
BROWSER_SOCKET_DIR=/run/lab1-browser BROWSER_SOCKET_GID=$(getent group assistant | cut -d: -f3) docker compose up -d --build
```

`ops/firewall` keeps its egress to the public internet: from its bridge, nothing private, link-local or on the host
is reachable (`ops/README.md`).

To try one read on the live service by hand, the person runs this on the VM, with `!` in an agent's session. The socket
takes only the bot's group, so an agent's own shell can't reach it. `/redirect` takes the same body.

```sh
sudo curl -s --max-time 90 --unix-socket /run/lab1-browser/browser.sock -H 'content-type: application/json' -d '{"url":"https://example.com/"}' http://localhost/read | jq '{finalHost, status, botCheck, error}'
```
