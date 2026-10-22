# The bot

English | [中文](README.zh.md)

The Assistant's one long-running process: TypeScript on Node 24, run as-is through Node's type stripping, with no
npm dependencies of its own. It holds every token, alone writes the live store, and makes every outside call.
The spec is #41. Its first slice (#42) brought up the Miner's path from Product Hunt to the Miner days forum,
#47 adds a Dossier for each Launch at or above the Day's line, #48 lets the person correct a Miner judgment, and #49
sorts each Correction into fix only, an Interest scope change or a Rule, and loads each kept Rule into later runs.

| Path | What it is |
|---|---|
| `bot/src/assistant.ts` | Starts every part and the schedule (the 01:00 PT catch-up, its 30-minute retries, the 06:00 PT late check); the background lane, which runs Corrections before the Miner, and the plain-code work that never waits in it, such as a Keep; who may tap |
| `bot/src/miner/` | Judging runs, the Day's line, the day post and `days/` file, the 3-date catch-up and Retry, and Corrections of a day's judgments with their sorting runs |
| `bot/src/rules/` | Rules: each run's Rule files, its prompt's Rules section and the Rule budget; a Correction's sorting run; and the cards of proposed Rules and Interest scope changes, with Keep, Edit and Discard |
| `bot/src/dossier/` | Dossiers: the pages each one reads, its run's prompt and record, its card within Discord's 4,000 characters, its Product's post, and the Product's folder in the Personal database |
| `bot/src/browser.ts`, `bot/src/root-domain.ts` | The browser service's `read(url)` over its Unix socket, and the root domain a Product is keyed by |
| `bot/src/personal-database.ts` | The Personal database writer: one lock over fast-forward, write, commit and push, and the card when histories diverge (ADR 0012) |
| `bot/src/status.ts` | Silent lines in the `#status` text channel |
| `bot/src/needs-you.ts` | Cards in the `#needs-you` text channel, each mentioning the person |
| `bot/src/forwarder.ts` | The Pi container's only endpoint: model requests with the role key, each priced in notional dollars, and run records |
| `bot/src/pi-runs.ts` | One `pi --mode rpc` process per run, capped on wall clock, turns and tokens |
| `bot/src/store.ts` | The live store (SQLite) |
| `bot/src/product-hunt.ts`, `bot/src/discord/` | Product Hunt API v2 and Discord |
| `pi/extension/` | Our Pi extension: the forwarder as provider, the run's Rules, and each run kind's record tool and prompt |
| `pi/pi-run`, `pi/Dockerfile` | How a run starts, and the Pi container image |
| `config/assistant.json` | Settings, changed only through `ops/upgrade` |

Pi's own docs ship in its package, at `node_modules/@earendil-works/pi-coding-agent/docs/` once `npm ci` has run:
`rpc.md` for the RPC mode each run uses, `json.md` for the event stream, `message-types.md` for the messages in it,
and `settings.md` for Pi's `settings.json`, its retry backoff included.

## Test

```sh
npm ci
npm run typecheck
npm run check:docs                     # the doc pairs
npm test                               # every test
node --test bot/test/miner-day.test.ts # one file
```

`npm test` gives each test 60 seconds. A test that runs out fails, and the run still ends even when it leaves a
server or timer open (`--test-force-exit`).

The hooks and CI that check each commit and push, and how to turn the hooks on in a fresh clone, are in
`docs/hooks-and-ci.md`.

The bot's tests go through seam 1 only (`bot/test/harness/`): the real bot in-process, with real Pi and our extension
as local processes, against fake Discord, Product Hunt, browser service and model provider servers, a fake GitHub
holding the Personal database, and a clock the test moves. The fake GitHub is a local bare repo that git reaches through
`bot/test/harness/fake-ssh.ts` in place of ssh. It lets in only the deploy key, can refuse pushes, and takes the
person's own commits and merges. Only the harness imports from `bot/src`: `npm test` fails any other file under
`bot/test/` whose import names a file there (`scripts/bot-test-imports.test.ts`).

A jump of the clock (`advanceTo`) fires an overdue timer only once, at the new time, as a real clock does. To test
a repeating timer, step through each firing with `stepThrough`.

The fake browser service answers `read(url)` on a Unix socket. Each Launch's website redirect leads to a plain site of
its own on `.example`, with a pricing page and a signup page, unless a test serves a real Product's pages from
`bot/test/harness/dossier-fixtures.ts`.

Each Pi run takes about half a second of CPU, and a Miner day makes one for each of its Dossiers beside its judging
runs, so the fixture days' Dossiers cost every test that posts a day. A test that isn't about Dossiers keeps its day to
the few it needs with `world.model.onlyDossiers(postIds)`, which judges every other Launch below the Day's line.

The fake Product Hunt answers only a query that the real API's live schema accepts, with variables that fit it, and
refuses any other with GraphQL errors and no data, so a wrong field, argument or enum value fails a test instead of
the bot's read at go-live. `npm run capture:producthunt-schema` captures that schema by introspection and writes it as
SDL to `bot/test/fixtures/producthunt/schema.graphql`, where the fake reads it. On an HTTP error, GraphQL errors or a
reply that doesn't build a schema, the script writes nothing and says why. The person runs it, since agents never read
the token: it reads `producthunt-token` in `$CREDENTIALS_DIRECTORY` itself, as the bot does, and asks the API the
bot's config names. In a Claude Code session, typing `!` before the command keeps the token out of the agent's
context. Run it again, and commit what it writes, whenever a query in `bot/src/product-hunt.ts` changes or the live
API might have.

```sh
CREDENTIALS_DIRECTORY=/path/to/credentials npm run capture:producthunt-schema
```

## Run

The bot reads `config/assistant.json` (or `$ASSISTANT_CONFIG`), and its tokens from `$CREDENTIALS_DIRECTORY`, as
systemd's `LoadCredential=` hands them over: `discord-bot-token`, `producthunt-token`, one `newapi-key-<role>` per
role, and `personal-database-deploy-key`, the Personal database repo's deploy key.

The bot's checkout of the Personal database sits at `personalDatabase.dir`: a clone of the person's repo with `main`
checked out and its `origin` at the repo's ssh URL. The bot runs git in it with no git config but the checkout's own,
and reaches GitHub through `personalDatabase.ssh` with the deploy key, so GitHub's host key must be in the bot user's
`known_hosts`. Before each run it fast-forwards the checkout, and runs read the Interest scope from
`profile/interest-scope.md` there. Each file the bot writes, such as `days/<YYYY-MM-DD>.md`, is queued in the live
store and committed on its own, and every commit is pushed. A push GitHub refuses, or a history that has diverged, is
tried again every `personalDatabase.retryMinutes`.

Each run loads its Rules from the checkout's last commit (ADR 0002): every file in `rules/all/`, and every one in its
own scope's folder, `miner`, `dossier`, `registration` or `mail`, as `rules/<scope>/<slug>.md`. Our extension asks the
forwarder for them before the run starts and puts each one whole into the run's system prompt, so a run whose Rules
don't arrive doesn't start. A record names the Rules it applied, and the bot turns back one naming a Rule its run didn't
load. Once a Correction's Launch is re-judged, a Miner-role run sorts the Correction. The day's file says what came of
it, and a Correction declined for a Hard limit says so on its Launch's line in the day post too. A proposed Rule, an amendment of a kept
one or an Interest scope change goes to `#needs-you` as a purple card. Keep commits the Rule file or
`profile/interest-scope.md` under the write lock, unless git changed what it replaces since the proposal, or a Rule
would take its runs' Rules past the Rule budget, `rules.budgetTokens` (about 4,000 tokens, counted at four characters a
token). The card then says why and stays open.

Dossiers go to the Products forum, `discord.productsForumId`, whose tags the person makes: *Walkthrough*,
*Registering*, *Needs you*, *registered*, *waitlisted*, *handed off*, *abandoned*, *no account* and *Skipped*. The bot
finds a tag by its name, so only the names matter, and for now applies *no account*, and *Skipped* to the post of a
Dossier a Correction withdraws. A Dossier reads its Product's pages through the browser service's socket at
`browser.socketPath` (`browser/README.md`), and each read is kept for 90 days under `pages/`, beside the other raw
inputs.

```sh
docker build -f pi/Dockerfile -t assistant-pi .
npm start
```

The install on the VM (its own user, the Docker helper, systemd units) is #71. It also sets what
`config/assistant.json` leaves open: the Discord ids, the browser service's socket, how new-api is reached on
loopback, and the helper in place of `docker exec`. Until then the config's `pi.command` runs `docker exec` directly, which ADR 0009 rules out
for the installed bot: the `assistant` user has no `docker` group and reaches Docker only through the helper. The
only value it passes into the container is each run's own token, which lets Pi reach the forwarder for that run
alone and is never a key.

The run caps in `config/assistant.json` are starting values. The wall clocks were decided in #26, except those of the
Dossier run and a Correction's sorting run; they and the turn and token caps are first guesses, to tune from the
`run.finished` lines.

Each provider in `roles` names the model its `role@provider` channel on new-api serves, and `prices` holds each such
model's list price in dollars per 1M uncached input, cached input and output tokens. The bot won't start while a
provider's model has no price. ADR 0011 puts the prices in `ops/pins`; until it exists, they live here. Every model
request is counted at its provider's price, in notional dollars. `budgets.miner` is what a Miner date's runs may
spend, Retries included, starting at $6. A run starts only while its date's spend is under the Miner budget, and
finishes even when it goes over. Once the Miner budget is spent, the date's remaining runs wait and its 06:00 PT late
line names the Miner budget; raising `budgets.miner` and restarting the bot lets them go on. The Miner provider's
model is set at go-live (#85), with its price; `prices` already holds GPT-6.1 Sol's, the price the budgets were sized
at (#39). `budgets.registration`, $20 to start, is what the registration role's runs may spend in a Pacific day,
Dossier runs among them; their spend is counted, but nothing holds a run to it until #69.

The bot logs one JSON line per event to stdout. A `run.finished` line carries the run's role, providers, models,
exact tokens and notional dollars, and for a capped run the cap it hit. A `miner.run-held` line names a run that waits
on the Miner budget, with the date's spend, and a `miner.posted` line carries what the date spent in all. A
`miner.judged` line names the model request whose reply held the judgment, with that request's exact tokens; one reply
usually judges every Launch in its run. A `dossier.written` line names a Dossier's Product by its root domain, with
the run, provider and model that wrote it. A `run.rules-loaded` line names the commit a run's Rules were read at, the
Rules by name, and about how many tokens they take.
