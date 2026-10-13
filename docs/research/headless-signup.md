# Driving a signup form from the arm64 VM, and what blocks it

Research for ticket #3 on the wayfinder map (#1). Researched 2026-10-13. Terms follow `CONTEXT.md` (Registration, Walkthrough, Approval, Handoff, Signup identity, Hard limit).

Out of scope, not researched: CAPTCHA solvers, anti-detection or fingerprint-spoofing browsers, temporary SMS numbers. Where a wall shows up, the answer here is a Handoff.

## Answer in brief

- **Automation runs here today.** Playwright supports Ubuntu 22.04 arm64 with Node 24. On Linux arm64 it downloads Chrome for Testing (since 1.63) and also offers its patched Firefox. Microsoft's Playwright MCP gives Claude Code form tools (`browser_fill_form`, `browser_click`, `browser_snapshot`, `browser_take_screenshot`) that work from the accessibility tree, with no vision model needed.
- **One trap on this host.** Playwright MCP defaults to the branded Google Chrome channel, and Playwright's Chrome installer exits with "not supported on Linux Arm64". The Assistant has to run it with `--browser chromium` (Chrome for Testing) or `--browser firefox`.
- **Headless or headed.** With no `DISPLAY`, Playwright MCP runs headless automatically. Running it headed under Xvfb costs one package and is what lets the person take over the same browser live.
- **Bot checks are the wall that matters most.** Cloudflare's own docs say Playwright is "detected as bots by Turnstile". Clerk, a common auth vendor for new Products, turns a Turnstile check on by default for new apps ("If it doesn't pass, the account isn't created"). Cloudflare sits in front of 27% of all websites. Google may block sign-in from browsers "controlled through software automation", so a Product that offers only "Sign in with Google" is a Handoff.
- **How often walls appear is not measured.** No primary source counts walls on Product Hunt Launch signup pages. The map needs its own measurement (see Surfaced).
- **Taking over from the iPhone has three workable shapes:** (A) the person finishes the step in their own iPhone Safari from a Discord message; (B) noVNC over Tailscale into a headed browser running under Xvfb; (C) Playwright's built-in Dashboard (`playwright cli show --port`), which streams the page and forwards clicks and keys. A raw Chrome DevTools remote-debugging view is a poor fit: it targets desktop Chrome and exposes cookies.
- **Terms.** Some sites ban automated account creation outright: GitHub says "You must be a human to create an Account". Many others ban "automated means" only for access or scraping (Meta, Google, LinkedIn). Some say nothing on the point (Discord, Vercel). The legal status of a user-directed agent is unsettled. The 9th Circuit vacated Amazon's injunction against Perplexity's Comet in Aug 2026; that is secondary reporting and the case is still pending.

## 1. Host facts (checked on the VM, read-only, 2026-10-13)

| Fact | Value | How checked |
|---|---|---|
| Architecture | `aarch64` / dpkg `arm64` | `uname -m`, `dpkg --print-architecture` |
| OS | **Ubuntu 22.04.5 LTS** (kernel 6.8 HWE) | `/etc/os-release` |
| Browsers / Playwright | none installed; no `~/.cache/ms-playwright` | `which`, `ls` |
| Tailscale | 1.102.4 | `tailscale version` |
| Display / VNC packages in apt (not installed) | `xvfb` 21.1.4, `x11vnc` 0.9.16, `tigervnc-standalone-server` 1.12.0, `websockify` 0.10.0, `novnc` **1.0.0** (upstream is 1.7.0) | `apt-cache policy` |

Ubuntu 22.04 standard support ends **May 2027** ([Ubuntu release cycle](https://ubuntu.com/about/release-cycle)). Playwright dropped Ubuntu 20.04 in 1.63 (2026-09-04), about 16 months after 20.04's May 2025 end of support ([release notes](https://playwright.dev/docs/release-notes)). Expect 22.04 to fall off the supported list on a similar timeline.

## 2. Browser automation that runs here

### 2.1 Playwright platform support

- System requirements: "Node.js: latest 22.x, 24.x or 26.x" and "Debian 12 / 13, Ubuntu 22.04 / 24.04 / 26.04 (x86-64 or arm64)" ([Playwright intro](https://playwright.dev/docs/intro), fetched 2026-10-13). The VM's Node 24 and Ubuntu 22.04 arm64 both qualify.
- Latest release: **v1.64.0, 2026-10-07** (GitHub releases API). `browsers.json` on `main` pins Chromium (Chrome for Testing) 156.0.8078.12, Firefox 157.0 and WebKit 27.2 ([browsers.json](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/browsers.json)).
- 1.63: "On Linux arm64, Playwright now downloads the Chrome for Testing build of Chromium." ([release notes](https://playwright.dev/docs/release-notes)). The registry source maps `ubuntu22.04-arm64` to `chrome-linux-arm64.zip` and `chrome-headless-shell-linux-arm64.zip`, plus Firefox `firefox-ubuntu-22.04-arm64.zip` ([registry/index.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/registry/index.ts)).
- Google's Chrome for Testing JSON lists `linux-arm64` for Stable 155, Beta 156, Dev and Canary (timestamp 2026-10-12, [last-known-good-versions](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json)).
- System libraries: `npx playwright install --with-deps` or `install-deps` installs them ([Browsers](https://playwright.dev/docs/browsers)). Not run here, per the ticket.

### 2.2 Which browser

| Option | On this VM | Notes |
|---|---|---|
| **Chrome for Testing** (Playwright `chromium`) | Supported | Headed uses `chrome`, headless uses `chrome-headless-shell` (1.57 notes). Google: CfT is "without auto-update" and "should only be used to consume trustworthy content" ([CfT blog](https://developer.chrome.com/blog/chrome-for-testing), updated 2023-06-12). Browser updates arrive only when Playwright is bumped. |
| **Playwright Firefox** | Supported | Patched build; "Playwright doesn't work with the branded version of Firefox" ([Browsers](https://playwright.dev/docs/browsers)). |
| **Google Chrome (branded `chrome` channel)** | **Playwright cannot install it** | `reinstall_chrome_stable_linux.sh` begins with `if [[ $(arch) == "aarch64" ]]; then echo "ERROR: not supported on Linux Arm64"` ([source](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/bin/reinstall_chrome_stable_linux.sh)). Google announced Chrome for ARM64 Linux for Q2 2026 ([Google blog, 2026-03-12](https://blog.google/chromium/bringing-chrome-to-arm64-linux-devices/)), and `dl.google.com/linux/direct/google-chrome-stable_current_arm64.deb` answered HTTP 200 on 2026-10-13. A manual install might satisfy the `chrome` channel. **Unverified.** |
| WebKit | Supported | Little reason to use it for signups. |

### 2.3 Headless vs a virtual display

- Playwright launches headless by default. "On Linux agents, headed execution requires Xvfb to be installed", for example with `xvfb-run` ([CI docs](https://playwright.dev/docs/ci)).
- Chrome's "new headless" shares code with headed Chrome. The old headless mode was split out as `chrome-headless-shell` from Chrome 132 ([Chrome headless docs](https://developer.chrome.com/docs/chromium/headless), updated 2024-10-21).
- **What decides it for the map:** a live-takeover Handoff over VNC (shape B below) needs a headed browser on a real X display, which means Xvfb. A headless browser can only be shared through screencast frames (shape C).

### 2.4 Playwright MCP for Claude Code

Sources: [microsoft/playwright-mcp README](https://github.com/microsoft/playwright-mcp) (latest tag v0.0.83, 2026-09-28) and the MCP config source now in the Playwright monorepo, [`tools/mcp/config.ts`](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/mcp/config.ts). Playwright 1.62 also bundles it as `npx playwright mcp`.

- **Install:** `claude mcp add playwright npx @playwright/mcp@latest`.
- **Tools:** `browser_navigate`, `browser_snapshot`, `browser_fill_form`, `browser_type`, `browser_select_option`, `browser_click`, `browser_take_screenshot`, `browser_file_upload`, `browser_wait_for` and others. The README says it uses "Playwright's accessibility tree, not pixel-based input" and needs "No vision models". `browser_take_screenshot` can attach a picture of a filled, unsubmitted form to the Walkthrough on Discord.
- **Default browser is branded Chrome:** in `validateBrowserConfig`, with no browser name set, `browser.launchOptions.channel = 'chrome'`. **On this VM that fails** (see 2.2). Pass `--browser chromium`, which maps to the `chrome-for-testing` channel, or `--browser firefox`.
- **Headless default:** `headless = os.platform() === 'linux' && !process.env.DISPLAY`. So with `DISPLAY=:99` (Xvfb) in Claude Code's environment, MCP launches headed into Xvfb with no extra flag. The README also suggests running the server standalone with `DISPLAY` set and `--port` for HTTP transport.
- **Profile:** the default is a persistent profile at `~/.cache/ms-playwright/mcp-{channel}-{workspace-hash}`, which keeps the logins of every Product together. `--isolated` keeps the profile in memory, and `--storage-state` loads cookies per session. A persistent profile "can only be used by one browser instance at a time".
- **Sandbox:** for downloaded Chromium builds (`chromium` / `chrome-for-testing`) on Linux, MCP sets `chromiumSandbox = false` ("lack the setuid sandbox helper"). Playwright's own default is also "Defaults to `false`" ([BrowserType API](https://playwright.dev/docs/api/class-browsertype)). `--sandbox` turns it back on.
- **Automation signal:** MCP adds `--disable-blink-features=AutomationControlled` to Chromium by default. In Chromium's `Navigator::webdriver()`, that runtime feature is what makes `navigator.webdriver` return `true` ([navigator.cc](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/frame/navigator.cc)). So the stock MCP config turns that signal off. The net effect under Playwright was **not tested**. Mentioned because it bears on the map's "no anti-detection" line (see Surfaced).
- **Secrets:** `--secrets <dotenv>` replaces matching plaintext in tool responses. The source calls it "a convenience and not a security feature".
- **Security:** "Playwright MCP is **not** a security boundary." `--allowed-origins` / `--blocked-origins` "*does not* serve as a security boundary".

### 2.5 Docker

- `mcr.microsoft.com/playwright/mcp` and `mcr.microsoft.com/playwright:v1.64.0-noble` both publish `linux/arm64` manifests. Checked with a registry manifest query on 2026-10-13; nothing was pulled.
- The MCP README says: "The Docker implementation only supports headless chromium at the moment". So a Docker-run MCP rules out VNC takeover unless the Assistant builds its own image with Xvfb.

## 3. Walls on signup pages

| Wall | Primary evidence | What the Assistant can tell | Fits as |
|---|---|---|---|
| **Cloudflare Turnstile** | Modes: managed (may show a checkbox), non-interactive, invisible. Uses "computational puzzles", "probing of web APIs", "checks for browser quirks and human-like behavior" ([Turnstile](https://developers.cloudflare.com/turnstile/), updated 2026-08-14). "Automated testing suites (like Selenium, Cypress, or Playwright) are detected as bots by Turnstile" ([Turnstile testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/), updated 2026-05-05). | Widget iframe from `challenges.cloudflare.com`; submit fails or the widget shows an error | Handoff |
| **Cloudflare bot management in front of the whole site** | JavaScript Detections "identifies headless browsers"; the ML engine "accounts for the majority of all detections" ([detection engines](https://developers.cloudflare.com/bots/concepts/bot-detection-engines/), 2026-05-05). Cloudflare fronts **27.0%** of all websites ([W3Techs, Oct 2026](https://w3techs.com/technologies/details/cn-cloudflare)). | Interstitial challenge page before the form loads | Handoff |
| **reCAPTCHA v3 / v2** | v3 "returns a score for each request without user friction"; sites pick the threshold (default 0.5) and the action, e.g. "require 2-factor-authentication or email verification" ([v3 docs](https://developers.google.com/recaptcha/docs/v3), marked deprecated in favour of Google Cloud Fraud Defense, updated 2024-07-10). Flagged users see "your computer or network may be sending automated queries" ([FAQ](https://developers.google.com/recaptcha/docs/faq), 2026-04-02). | v2 shows a challenge; v3 gives silent rejection or an extra step | Handoff |
| **Auth-vendor defaults** | **Clerk:** "Challenge suspicious sign-ups is on by default for new applications" (Turnstile), and "If it doesn't pass, the account isn't created" ([Clerk bot protection](https://clerk.com/docs/guides/secure/bot-protection)). **Supabase:** hCaptcha/Turnstile, enabled by a toggle ([Supabase](https://supabase.com/docs/guides/auth/auth-captcha)). **Auth0:** Bot Detection is turned on in the dashboard; it covers signup and its default response is "Auth Challenge" ([Auth0](https://auth0.com/docs/secure/attack-protection/bot-detection)). | Vendor branding or iframes on the form | Handoff |
| **"Sign in with Google" only** | Google "might stop sign-ins from browsers that... Are being controlled through software automation rather than a human" ([Google Account Help](https://support.google.com/accounts/answer/7675428)). A Google sign-in also yields the base Gmail address, not the per-Product plus-address. | No email/password field; only OAuth buttons | Handoff (person signs in on their own device) or abandoned |
| **SMS / phone check** | No vendor source counts it. HTML autofill token `tel` ([WHATWG autofill](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html)). | `tel` input; "verify your phone" step | Handoff (person's own number) |
| **Plus-address or free-domain rejection** | Clerk has a "Block email subaddresses" toggle and a disposable-domain toggle; default state not stated ([Clerk restrictions](https://clerk.com/docs/guides/secure/restricting-access)). HubSpot forms offer "Block free email providers", and blocked visitors are "prompted to enter a different email address" ([HubSpot KB](https://knowledge.hubspot.com/forms/block-form-submissions-from-specific-email-domains), 2026-09-02). Gmail delivers `user+label@gmail.com` to the base address ([Gmail Help](https://support.google.com/mail/answer/12096)). | Inline validation error on the email field | Retry with the plain Gmail (per Signup identity); if gmail.com itself is refused ("work email"), Handoff or abandoned |
| **Card-gated trial** | HTML autofill tokens `cc-number`, `cc-exp`, `cc-csc` ([WHATWG](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html)); payment iframes such as Stripe's. | Payment fields present | **Hard limit:** stop. Registration abandoned unless the person wants to do it themselves |
| **IP reputation (datacenter egress)** | reCAPTCHA's FAQ names "a recently assigned suspicious IP address" and shared-network abuse as causes. Vendors do not publish their model features. | More challenges than a home connection would get | **Unverified** for Oracle Cloud specifically. Not tuned around; walls become Handoffs |

**How often each wall appears: not measured.** No first-party source reports the share of new-Product signup forms carrying each wall. The indicators above (Cloudflare's 27% share, Clerk's default-on Turnstile, Turnstile flagging Playwright) suggest bot checks will be the most common wall, but that is an **inference, not a measurement**. The ticket rules out visiting signup pages with automation during research, so the map has to measure this in use (see Surfaced).

## 4. Taking over a live VM browser session from the iPhone (powering a Handoff)

All options assume the iPhone is on the tailnet. `tailscale serve <port>` shares a local port "within your tailnet" over HTTPS with automatically provisioned certificates (HTTPS must be enabled for the tailnet). `tailscale funnel` would make it public, which is not wanted ([Tailscale Serve](https://tailscale.com/kb/1312/serve), validated 2026-01-20).

| Shape | What runs on the VM | Works with headless? | iPhone fit | Notes |
|---|---|---|---|---|
| **A. Phone-side completion** | Nothing extra | n/a | Native: the person's own Safari, Google session, phone number and network | The Assistant sends the signup URL and the approved values (Signup identity, generated password) on Discord. The VM browser's state does not carry over, so the person re-enters values. A real person on their own device is what bot checks are built to let through. The Assistant still sees the verification mail in Gmail. |
| **B. noVNC** | Xvfb + a VNC server (x11vnc or TigerVNC) + noVNC/websockify bound to localhost, then `tailscale serve` | **No.** Needs a headed browser on Xvfb | noVNC "runs well in any modern browser including mobile browsers (iOS and Android)", needs Safari 15+, and has "touch gestures" ([noVNC README](https://github.com/novnc/noVNC), v1.7.0, 2026-04-28) | The person works in the very browser the Assistant was using. Use upstream noVNC; Ubuntu 22.04 ships 1.0.0. Whether `tailscale serve` proxies WebSockets is **unverified**; binding to the Tailscale IP is the fallback. Whether a human click in an automation-launched browser passes Turnstile is also **unverified**. |
| **C. Playwright Dashboard** | `npx playwright cli show --port=<n>` (server mode) on Playwright 1.59 or later | **Yes.** Uses `page.screencast` frames | **Unverified.** The source forwards `mousemove/mousedown/mouseup/wheel/keydown/keyup` ([dashboardController.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/dashboard/dashboardController.ts)); iOS touch and on-screen-keyboard behaviour was not checked | 1.59 notes: "Click into the sessions for manual interventions". Browsers must be bound (`browser.bind`; playwright-cli binds automatically). No authentication found in a skim of the source, so keep it on localhost and expose it only via the tailnet. |
| D. Chrome DevTools remote debugging | `--remote-debugging-port` + DevTools frontend | Yes | Poor. DevTools targets desktop Chrome, and the person has only an iPhone | Chrome 136 now requires a non-default `--user-data-dir` because attackers used remote debugging "to extract cookies"; Chrome for Testing is exempt ([Chrome blog, 2025-03-17](https://developer.chrome.com/blog/remote-debugging-port)). The port is full control of the browser and must never leave localhost. |

## 5. What sites' terms say about automated account creation

| Site | Clause (verbatim) | Effective |
|---|---|---|
| GitHub | "You must be a human to create an Account. Accounts registered by "bots" or other automated methods are not permitted." Machine accounts are allowed if "set up by an individual human who accepts the Terms" ([ToS](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)) | 2026-04-27 |
| LinkedIn | Don't "Use bots or other unauthorized automated methods to access the Services..."; don't "create a Member profile for anyone other than yourself" ([User Agreement §8.2](https://www.linkedin.com/legal/user-agreement)) | 2025-11-03 |
| Meta (Facebook) | "Only create one account (your own)"; "You may not access or collect data from our Products using automated means (without our prior permission)" ([Terms](https://www.facebook.com/legal/terms)) | 2025-12-10 |
| Google | Bans "using automated means to access content... in violation of the machine-readable instructions" and "creating fake accounts" ([Terms](https://policies.google.com/terms)) | 2026-07-30 |
| Vercel | No automation clause on account creation; "A valid Vercel account may only be created... if you provide valid information"; "accessed through an electronic device controlled by you at all times" ([Terms](https://vercel.com/legal/terms)) | updated 2026-06-01 |
| Discord | No clause on automated account creation; bans scraping "by using any robot, spider, crawler, scraper" and auto-messaging ([Terms](https://discord.com/terms)) | 2025-09-29 |

Patterns:

1. Explicit bans on bot-created accounts exist (GitHub) but are not universal.
2. "Automated means" clauses mostly target access, scraping and engagement.
3. Nearly all terms require truthful information and one account for yourself. A plus-address Signup identity for the person's own account fits that wording.

Whether an account the person approved and the Assistant submitted counts as "registered by bots" is untested. Legal context: secondary reporting says the 9th Circuit vacated the preliminary injunction in *Amazon v. Perplexity* (Comet agent) on 2026-08-04 and treated the user, not the agent vendor, as the party accessing the site. The suit is pending, and the primary ruling was not read (**unverified**). Cloudflare now lists user-directed "Agent" traffic and lets operators self-identify via Web Bot Auth as Verified bots ([signed agents](https://developers.cloudflare.com/bots/concepts/bot/signed-agents/), 2026-10-08). That is an honest-identification route, the opposite of evasion; it is noted here, not recommended.

## 6. Security notes that fall out of the above

- Every Product site the Assistant opens is untrusted content. It runs in a browser Google says to use only for "trustworthy content", with the Chromium sandbox off by default under Playwright on Linux.
- Page text enters the model's context through `browser_snapshot`, so signup pages are a prompt-injection channel. Playwright MCP is "not a security boundary".
- A persistent MCP profile accumulates session cookies for every Product. Those are secrets and do not belong in the git-tracked Personal database.

## 7. Unverified or not checked

- Whether a manually installed arm64 Google Chrome `.deb` works as Playwright's `chrome` channel.
- `tailscale serve` WebSocket proxying (matters for noVNC; Playwright Dashboard transport not checked).
- Playwright Dashboard usability from iOS Safari (touch, soft keyboard).
- Whether a human solving Turnstile inside an automation-launched browser succeeds.
- Net effect on `navigator.webdriver` of MCP's default Chromium flag.
- Wall prevalence on Product Hunt Launch signup pages.
- Oracle Cloud egress IP reputation with Turnstile and reCAPTCHA.
- *Amazon v. Perplexity* ruling details (secondary sources only).

## Sources

Fetched 2026-10-13 unless noted. Page dates are given inline where the page shows one.

- Playwright: [intro / system requirements](https://playwright.dev/docs/intro), [browsers](https://playwright.dev/docs/browsers), [CI](https://playwright.dev/docs/ci), [BrowserType API](https://playwright.dev/docs/api/class-browsertype), [release notes](https://playwright.dev/docs/release-notes) and [release-notes-js.md](https://github.com/microsoft/playwright/blob/main/docs/src/release-notes-js.md), [registry/index.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/registry/index.ts), [reinstall_chrome_stable_linux.sh](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/bin/reinstall_chrome_stable_linux.sh), [browsers.json](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/browsers.json), [tools/mcp/config.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/mcp/config.ts), [dashboardApp.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/dashboard/dashboardApp.ts), [dashboardController.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/dashboard/dashboardController.ts)
- Playwright MCP: [README](https://github.com/microsoft/playwright-mcp) (v0.0.83, 2026-09-28); MCR manifests for `playwright/mcp:latest` and `playwright:v1.64.0-noble`
- Chrome: [Chrome for Testing](https://developer.chrome.com/blog/chrome-for-testing), [CfT versions JSON](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json), [headless](https://developer.chrome.com/docs/chromium/headless), [remote debugging switch changes](https://developer.chrome.com/blog/remote-debugging-port), [Chrome on ARM64 Linux](https://blog.google/chromium/bringing-chrome-to-arm64-linux-devices/), [navigator.cc](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/frame/navigator.cc). Secondary: [Linuxiac, 2026-08-03](https://linuxiac.com/google-chrome-quietly-arrives-on-arm64-linux/) on the arm64 `.deb` appearing
- noVNC: [README](https://github.com/novnc/noVNC) (v1.7.0)
- Tailscale: [Serve](https://tailscale.com/kb/1312/serve)
- Cloudflare: [Turnstile](https://developers.cloudflare.com/turnstile/), [Turnstile testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/), [bot detection engines](https://developers.cloudflare.com/bots/concepts/bot-detection-engines/), [signed agents](https://developers.cloudflare.com/bots/concepts/bot/signed-agents/)
- Google reCAPTCHA: [v3](https://developers.google.com/recaptcha/docs/v3), [FAQ](https://developers.google.com/recaptcha/docs/faq); Google Account Help [7675428](https://support.google.com/accounts/answer/7675428); Gmail Help [12096](https://support.google.com/mail/answer/12096)
- Auth vendors: [Clerk bot protection](https://clerk.com/docs/guides/secure/bot-protection), [Clerk restrictions](https://clerk.com/docs/guides/secure/restricting-access), [Supabase CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha), [Auth0 Bot Detection](https://auth0.com/docs/secure/attack-protection/bot-detection), [HubSpot free-domain blocking](https://knowledge.hubspot.com/forms/block-form-submissions-from-specific-email-domains)
- [W3Techs Cloudflare usage](https://w3techs.com/technologies/details/cn-cloudflare); [WHATWG autofill](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html); [Ubuntu release cycle](https://ubuntu.com/about/release-cycle)
- Terms: [GitHub](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service), [LinkedIn](https://www.linkedin.com/legal/user-agreement), [Meta](https://www.facebook.com/legal/terms), [Google](https://policies.google.com/terms), [Vercel](https://vercel.com/legal/terms), [Discord](https://discord.com/terms). Could not fetch: Product Hunt terms (404 at `/terms`), X (402), Slack's full AUP (PDF), Reddit, OpenAI (403)
- Secondary, unverified: *Amazon v. Perplexity* 9th Cir. coverage, e.g. [Northeast Times, 2026-08-06](https://northeasttimes.com/2026/08/06/appeals-court-sides-with-perplexity-ai-in-amazon-shopping-dispute/)
