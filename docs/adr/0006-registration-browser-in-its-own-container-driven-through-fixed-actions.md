# The Registration browser runs in its own container, and the model drives it only through fixed actions

English | [中文](0006-registration-browser-in-its-own-container-driven-through-fixed-actions.zh.md)

The browser that fills Registrations runs in its own long-lived container, owned by a small browser service of ours (TypeScript and Playwright). The bot is that service's only client, through a Unix socket, so Pi reaches the browser only through the bot's narrow interface. The model never clicks or types freely. It gets a fixed set of actions: take a snapshot, fill a field with an approved Walkthrough value named by its key, fill a Secret by reference, choose an approved option, follow a link on the Walkthrough's domain, and finish. Signup pages and Product sites are untrusted text, and any click can run the page's JavaScript, so "no click that sends data" can't be enforced element by element. The defence is that a run reading a page can do almost nothing, and that plain code makes every press. Decided in [Where does the Registration browser run, and how is page text kept from steering the Assistant?](https://github.com/ultrasadness/lab1/issues/18).

## Considered Options

- **Playwright MCP inside the Pi container**, the obvious path from the [headless-signup research](https://github.com/ultrasadness/lab1/blob/research/headless-signup/docs/research/headless-signup.md): rejected for two reasons.
  - **The snapshot leaks filled values.** Playwright's snapshot puts every field's current value into the text, passwords included (`ariaSnapshot.ts` leaves out only checkboxes, radios and file inputs), so `browser_snapshot` would hand a filled password to the model.
  - **Pi could read the profile.** Pi's `bash` could read the profile's cookies, breaking [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.md)'s rule that the container holds no Secret.
- **The bot driving Playwright directly over CDP:** one program fewer. Rejected because CDP is unauthenticated full control of the browser, and a bot restart would drop the sessions waiting for a Takeover.
- **A separate OS user on the host:** weaker isolation, and network limits would need firewall rules per user.
- **Letting the model click, refusing clicks on submit-like elements:** a page's script can send data from any click, and typing alone is enough on pages that capture fields as they change.
- **A prompt-injection classifier as a defence:** not counted as one. What stops injected text is what a run can't do, not detection.
- **One persistent browser profile** (Playwright MCP's default): it collects every Product's logged-in cookies in one place, and lets third-party trackers link the person's Registrations to each other.
- **Playwright's Dashboard for Takeovers** (`playwright cli show`): rejected after the person tried it on the iPhone in [Which Takeover shape works from the iPhone: noVNC or Playwright's Dashboard?](https://github.com/ultrasadness/lab1/issues/21).
  - Its live view takes keys on a focusable `<div>`, not a text field, so iOS never shows a keyboard. It has no touch handlers either, so taps reach the page only through the mouse events iOS fakes. The person couldn't reliably type or select anything.
  - It lists every bound browser, so two Takeovers at once show both sessions. Its one-context view exists only as a desktop app window, not on a port.
  - It has no authentication.

## Consequences

- **The model's actions**, refused unless the top-level page is on the Walkthrough's domain:
  - `snapshot`;
  - `fill(field, key)`, with approved values only and never the model's own text;
  - `fillSecret(field, password|code)`;
  - `choose(field, key)`, which clicks only elements whose role is combobox, option, checkbox, radio or switch;
  - `open(link)`, which loads an `<a href>`'s URL rather than clicking it;
  - `finish(button | wall | stuck)`, where a wall's kind comes from a fixed list: `bot-check`, `oauth-only`, `phone`, `blocked`, `card`, `free-email`, `invite-only`.

  The model gets no typed URLs, key presses, scripts, cookies, network reads, uploads, downloads or screenshots. A borderline action can only be added as an action of its own. Cookie banners aren't one: before each snapshot, plain code rejects non-essential cookies, using a rule set for known consent managers. A banner no rule matches stays up, and if it blocks a press, the Registration goes to the person (decided in [What happens when a Registration hits a wall, and where do borderline in-page actions fall?](https://github.com/ultrasadness/lab1/issues/10)). The rule set is DuckDuckGo's `autoconsent` in opt-out mode, pinned in `ops/pins` and updated only through `ops/upgrade`. It also runs in the read-only `read(url)` reads, where a banner could hide the form (decided in [What is left to decide before the spec is written?](https://github.com/ultrasadness/lab1/issues/40)).
- **A fill run** is a Pi process started with no built-in tools, no MCP, no codemode and no session. It sees only the approved Walkthrough, the Rules in Registration scope and the snapshot. Its only output is the structured `finish` result, whose reason comes from a fixed list; any short note reaches Discord in a code block.
- **Plain code presses a button only when both hold:**
  - the page passes the page check from [ADR 0005](./0005-plain-code-submits-a-registration-after-a-page-check.md);
  - the named element is visible, enabled, on the Walkthrough's domain, and the only native submit control of the form holding every field filled on that page. A field filled on an earlier step that the page has since hidden, in the same document, doesn't count (decided in [Drive a Registration session in the browser service](https://github.com/ultrasadness/lab1/issues/55)).

  Otherwise the person taps Submit on a screenshot with the named button outlined. There is one fill run per page, and after 5 pages the Registration goes to the person.
- **No raw field value reaches a model.**
  - **Snapshots** show the Walkthrough key that filled a field, or `[password]` or `[code]` for a field filled by reference. Every Secret filled into the session is removed from the whole snapshot by exact value, and random-looking strings by pattern.
  - **Screenshots** sent to Discord mask every field filled by reference.
  - **Once the account may exist**, no model reads that Registration's pages again.
  - **Stored snapshots**, the inputs that Rule cases replay, therefore hold no Secret.
- **Sessions:** one isolated browser context per Registration, in memory only, never on disk or in git. A session has one driver at a time: a fill run, plain code, or the person in a Takeover. It closes:
  - at any outcome;
  - right after plain code opens the verification link;
  - after 24 hours without progress, which is 24 hours with no request on the session: the bot's own 24-hour rules close it first, so this close catches a session the bot lost;
  - when an action in it takes longer than 60 s, since its page hangs.

  At most 5 are open at once. The last two closes were decided in [Drive a Registration session in the browser service](https://github.com/ultrasadness/lab1/issues/55).
- **Product sites** (for Dossiers) are read through a read-only `read(url)` in a throwaway context, with the same snapshot redaction. So is each signup page when its Walkthrough is prepared, before any Approval. The read gives the Walkthrough its fields, signup URL and host, and the walls visible when the page loads. Injected text can still skew a Dossier or a Skip, which its citations let the person check.
- **The container:**
  - Playwright's arm64 image pinned by digest, running Chrome for Testing headed under Xvfb as the non-root `pwuser`, with Playwright's seccomp profile so Chromium's sandbox is on. The service refuses to start without the sandbox.
  - All capabilities dropped except `SYS_CHROOT`, which Chromium's namespace sandbox needs: without it the sandbox's zygote dies at launch. Also `no-new-privileges`.
  - A read-only root filesystem, with tmpfs for `/tmp` and a home owned by `pwuser`; with a root-owned home, Chrome's crash handler aborts the browser at launch. `--shm-size` instead of `--ipc=host`.
  - In every context: downloads, permission requests, password saving and autofill off.
  - Payment fields (`autocomplete` values of `cc-*`, or fields inside a payment provider's frame) are refused whatever the Walkthrough says.
  - It holds no token for Gmail, Discord, Bitwarden or new-api. The only token in it is a Takeover link's.
- **The network:** public internet only. The host firewall blocks the private ranges, Tailscale's range, link-local addresses (Oracle's instance metadata included), the host's own services and IPv6 local ranges. The Takeover view is reachable only through `tailscale serve`, on an HTTPS port of its own, since the tailnet root already serves another app.
- **Takeover** (found in [Which Takeover shape works from the iPhone: noVNC or Playwright's Dashboard?](https://github.com/ultrasadness/lab1/issues/21)): through upstream noVNC (1.7.0), not Ubuntu's 1.0.0.
  - Each Registration's browser runs on an Xvfb display of its own, with its own VNC server on localhost, so a view shows that session alone. One websockify serves noVNC and routes each connection by token to one display.
  - The token is minted when the person taps Take over. It is removed at **Continue**, at **I submitted** and at the 24-hour close, and that display's VNC server restarts so an open view drops. A revoked link can't reconnect.
  - The link always carries `https://`, because the port speaks only HTTPS.
  - The browser service sees the person's submit through its own Playwright connection, the same second the Product's server gets it, so [ADR 0007](./0007-live-state-in-sqlite-and-an-uncertain-step-counts-as-done.md)'s verification window can anchor on it.
  - The window is a common desktop size (1280x800). A phone-shaped one also worked (Chrome's narrowest is 500 DIPs), but it is an odd shape for desktop Chrome to show a bot check.
  - Typing needs noVNC's keyboard button: tapping a field in the view doesn't raise the iOS keyboard.
- **Patching:** Chrome for Testing updates only with Playwright. The browser image is rebuilt within a week of each Playwright release, gated by a fill smoke test against a local test form instead of the Rule carry-over check. This refines [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.md)'s upgrade rule for this one image.
