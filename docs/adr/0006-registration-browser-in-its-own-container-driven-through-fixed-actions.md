# The Registration browser runs in its own container, and the model drives it only through fixed actions

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

## Consequences

- **The model's actions**, refused unless the top-level page is on the Walkthrough's domain:
  - `snapshot`;
  - `fill(field, key)`, with approved values only and never the model's own text;
  - `fillSecret(field, password|code)`;
  - `choose(field, key)`, which clicks only elements whose role is combobox, option, checkbox, radio or switch;
  - `open(link)`, which loads an `<a href>`'s URL rather than clicking it;
  - `finish(button | wall | stuck)`.

  The model gets no typed URLs, key presses, scripts, cookies, network reads, uploads, downloads or screenshots. A borderline action, such as dismissing a cookie banner, can only be added as an action of its own.
- **A fill run** is a Pi process started with no built-in tools, no MCP, no codemode and no session. It sees only the approved Walkthrough, the Rules in Registration scope and the snapshot. Its only output is the structured `finish` result, whose reason comes from a fixed list; any short note reaches Discord in a code block.
- **Plain code presses a button only when both hold:**
  - the page passes the page check from [ADR 0005](./0005-plain-code-submits-a-registration-after-a-page-check.md);
  - the named element is visible, enabled, on the Walkthrough's domain, and the only native submit control of the form holding every field filled on that page.

  Otherwise the person taps Submit on a screenshot with the named button outlined. There is one fill run per page, and after 5 pages the Registration goes to the person.
- **No raw field value reaches a model.**
  - **Snapshots** show the Walkthrough key that filled a field, or `[password]` or `[code]` for a field filled by reference. Every Secret filled into the session is removed from the whole snapshot by exact value, and random-looking strings by pattern.
  - **Screenshots** sent to Discord mask every field filled by reference.
  - **Once the account may exist**, no model reads that Registration's pages again.
  - **Stored snapshots**, the inputs that Rule cases replay, therefore hold no Secret.
- **Sessions:** one isolated browser context per Registration, in memory only, never on disk or in git. A session has one driver at a time: a fill run, plain code, or the person in a Takeover. It closes:
  - at any outcome;
  - right after plain code opens the verification link;
  - after 24 hours without progress.

  At most 5 are open at once.
- **Product sites** (for Dossiers) are read through a read-only `read(url)` in a throwaway context, with the same snapshot redaction. Injected text can still skew a Dossier or a Skip, which its citations let the person check.
- **The container:**
  - Playwright's arm64 image pinned by digest, running Chrome for Testing headed under Xvfb as the non-root `pwuser`, with Playwright's seccomp profile so Chromium's sandbox is on. The service refuses to start without the sandbox.
  - All capabilities dropped, a read-only root filesystem, and `--shm-size` instead of `--ipc=host`.
  - In every context: downloads, permission requests, password saving and autofill off.
  - Payment fields (`autocomplete` values of `cc-*`, or fields inside a payment provider's frame) are refused whatever the Walkthrough says.
  - It holds no token.
- **The network:** public internet only. The host firewall blocks the private ranges, Tailscale's range, link-local addresses (Oracle's instance metadata included), the host's own services and IPv6 local ranges. The Takeover view is reachable only through `tailscale serve`.
- **Patching:** Chrome for Testing updates only with Playwright. The browser image is rebuilt within a week of each Playwright release, gated by a fill smoke test against a local test form instead of the Rule carry-over check. This refines [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.md)'s upgrade rule for this one image.
