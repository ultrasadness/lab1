# The bot

English | [中文](README.zh.md)

The Assistant's one long-running process: TypeScript on Node 24, run as-is through Node's type stripping, with no
npm dependencies of its own. It holds every token, alone writes the live store, and makes every outside call.
The spec is #41. Its first slice (#42) brought up the Miner's path from Product Hunt to the Miner days forum,
#47 adds a Dossier for each Launch at or above the Day's line, #48 lets the person correct a Miner judgment, #49
sorts each Correction into fix only, an Interest scope change or a Rule, and loads each kept Rule into later runs, and
#53 puts a Walkthrough to the person for each open or waitlisted Product, whose Approval starts its Registration.
#99 lets the config switch Walkthroughs off, and it ships with them off. #100 bounds the tries at a Dossier that
can't be written. #98 gives the live store a schema version, and migrations the bot runs at start. #71 installs it on
the VM as its own user (`ops/README.md`).

| Path | What it is |
|---|---|
| `bot/src/assistant.ts` | Starts every part and the schedule (the 01:00 PT catch-up, its 30-minute retries, the 06:00 PT late check); the background lane, which runs Corrections, then Walkthrough preparation, then the Miner, and the plain-code work that never waits in it, such as a Keep or an Approve; who may tap |
| `bot/src/miner/` | Judging runs, the Day's line, the day post and `days/` file, the 3-date catch-up and Retry, and Corrections of a day's judgments with their sorting runs |
| `bot/src/rules/` | Rules: each run's Rule files, its prompt's Rules section and the Rule budget; a Correction's sorting run; and the cards of proposed Rules and Interest scope changes, with Keep, Edit and Discard |
| `bot/src/dossier/` | Dossiers: the pages each one reads, its run's prompt and record, its card within Discord's 4,000 characters, its Product's post, the Product's folder in the Personal database, and the tries at one that can't be written |
| `bot/src/walkthrough/` | Walkthroughs: the read of the signup page, its run's prompt and record, the card in `#needs-you` and its copy in the Product's post, Edit, Correct, Dismiss, the 14-day lapse and Prepare again, the Approval that starts the Registration, where the Product stands, and `registration.md` |
| `bot/src/browser.ts`, `bot/src/root-domain.ts` | The browser service's `read(url)` over its Unix socket, and the root domain a Product is keyed by |
| `bot/src/personal-database.ts` | The Personal database writer: one lock over fast-forward, write, commit and push, and the card when histories diverge (ADR 0012) |
| `bot/src/status.ts` | Silent lines in the `#status` text channel |
| `bot/src/needs-you.ts` | Cards in the `#needs-you` text channel, each mentioning the person |
| `bot/src/forwarder.ts` | The Pi container's only endpoint: model requests with the role key, each priced in notional dollars, and run records |
| `bot/src/pi-runs.ts` | One `pi --mode rpc` process per run, capped on wall clock, turns and tokens |
| `bot/src/store.ts` | The live store (SQLite), with its schema and migrations |
| `bot/src/product-hunt.ts`, `bot/src/discord/` | Product Hunt API v2 and Discord |
| `pi/extension/` | Our Pi extension: the forwarder as provider, the run's Rules, and each run kind's record tool and prompt. It is copied alone into the Pi container, so it and `bot/src` import nothing from each other |
| `pi/pi-run`, `pi/Dockerfile` | How a run starts, and the Pi container image |
| `config/assistant.json` | Settings, changed only through `ops/upgrade`; until #72 brings it, through a commit and `ops/install --deploy` |
| `ops/`, `compose.yaml` | The VM's install, tokens, nightly backup and browser firewall, the Docker helper, and the compose project of Pi and the browser service (`ops/README.md`) |

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
server or timer open (`--test-force-exit`). With `TEST_SHARD` set, such as `TEST_SHARD=2/3`, it runs only that shard
of the test files, as CI does.

The hooks and CI that check each commit and push, and how to turn the hooks on in a fresh clone, are in
`docs/hooks-and-ci.md`. `npm test` also runs the ops scripts' tests, in `ops/test/` (`ops/README.md`).

The bot's tests go through seam 1 only (`bot/test/harness/`): the real bot in-process, with real Pi and our extension
as local processes, against fake Discord, Product Hunt, browser service and model provider servers, a fake GitHub
holding the Personal database, and a clock the test moves. The fake GitHub is a local bare repo that git reaches through
`bot/test/harness/fake-ssh.ts` in place of ssh. It lets in only the deploy key, can refuse pushes, and takes the
person's own commits and merges. Only the harness imports from `bot/src`: `npm test` fails any other file under
`bot/test/` whose import names a file there (`scripts/bot-test-imports.test.ts`). `bot/test/store-schema.test.ts` also reads the
live store's file with `node:sqlite`, as #98 asks of it.

A jump of the clock (`advanceTo`) fires an overdue timer only once, at the new time, as a real clock does. To test
a repeating timer, step through each firing with `stepThrough`.

The fake browser service answers `read(url)` on a Unix socket. Each Launch's website redirect leads to a plain site of
its own on `.example`, with a pricing page and a signup page, unless a test serves a real Product's pages from
`bot/test/harness/dossier-fixtures.ts`.

Each Pi run takes about half a second of CPU, and a Miner day makes one for each of its Dossiers beside its judging
runs, and, as the harness starts the bot with Walkthroughs on, one more for each open or waitlisted Product's
Walkthrough, so the fixture days' Dossiers cost every test that posts a day. A test that isn't about Dossiers keeps
its day to the few it needs with `world.model.onlyDossiers(postIds)`, which judges every other Launch below the Day's
line.

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

## Change the live store's schema

The live store, `assistant.sqlite` in `dataDir`, records its schema version in `PRAGMA user_version`. Version 1 is
the schema from before #98. When the bot starts, before anything reads or writes the store, it gives a new store
`SCHEMA` from `bot/src/store.ts` whole, at the latest version. On an older store it runs each migration after the
store's version, in order, each in one transaction with its version. A store with tables but no version recorded is
at version 1. A migration that fails, or that leaves a key pointing at no row, is undone: the store keeps its version,
and the bot doesn't start, saying which migration failed. A store newer than the code is refused untouched, and the
bot doesn't start either (settled by the person on #98). The error names both versions and the two ways out: upgrade
to code that knows the store's version again, or restore the store from a nightly backup, losing the live state
since. So rolling the bot back past a migration leaves it stopped.

To change the schema, in one commit:

1. Change `SCHEMA` to the new schema.
2. Add a migration at the end of `MIGRATIONS`, beside it, that changes a store at the previous version to match:
   `name` says what it changes, `sql` how. It runs inside its own transaction, so it opens none itself, and with
   foreign keys off, so it can rebuild a table that keys point at, as in SQLite's
   [steps for other changes](https://www.sqlite.org/lang_altertable.html#otheralter).
3. Add the new version's fixture, `bot/test/fixtures/store-schemas/<version>.sql`, holding the new `SCHEMA`.

`bot/test/store-schema.test.ts` builds a store from each fixture, starts the bot on it, and compares the store's
tables, columns, indexes and keys with a new store's. So `npm test` fails on a `SCHEMA` change with no migration, a
migration that misses part of one, or a version with no fixture. Once a migration or a fixture reaches `main`, it
never changes, since a store may already be at its version, and `.githooks/pre-commit` refuses a commit that changes,
deletes or renames a fixture `main` holds (settled by the person on #98). The test sees what SQLite's pragmas report,
which leaves out `CHECK` constraints, a column's collation, a partial index's condition, a trigger's body, and rows:
a migration that moves rows, as #53's new key for `sorts` would have on a live store, gets a test of its own that the
rows arrive.

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

The person's Profile is `profile/profile.md` there, in whatever Markdown they write. A Walkthrough's run reads the
names it fills from it, and while there is no such file, a Walkthrough leaves the names empty and says where to add
them. Each Product's Signup identity is a plus-address of `signupMailbox`, the Signup mailbox's own address, with that
address as the fallback for a form that refuses `+` (ADR 0003). The bot needs it while Walkthroughs are on, or while
one is still in `#needs-you`.

Each run loads its Rules from the checkout's last commit (ADR 0002): every file in `rules/all/`, and every one in its
own scope's folder, `miner`, `dossier`, `registration` or `mail`, as `rules/<scope>/<slug>.md`. Our extension asks the
forwarder for them before the run starts and puts each one whole into the run's system prompt, so a run whose Rules
don't arrive doesn't start. A record names the Rules it applied, and the bot turns back one naming a Rule its run didn't
load. Once a Correction's Launch is re-judged, a Miner-role run sorts the Correction. The day's file says what came of
it, and a Correction declined for a Hard limit says so on its Launch's line in the day post too. A Walkthrough's
Correction is sorted the same way, by a registration-role run that loads the Walkthrough/Registration Rules, and its
Product's `registration.md` says what came of it. A proposed Rule, an amendment of a kept
one or an Interest scope change goes to `#needs-you` as a purple card. Keep commits the Rule file or
`profile/interest-scope.md` under the write lock, unless git changed what it replaces since the proposal, or a Rule
would take its runs' Rules past the Rule budget, `rules.budgetTokens` (about 4,000 tokens, counted at four characters a
token). The card then says why and stays open.

Dossiers go to the Products forum, `discord.productsForumId`, whose tags the person makes: *Walkthrough*,
*Registering*, *Needs you*, *registered*, *waitlisted*, *handed off*, *abandoned*, *no account* and *Skipped*. The bot
finds a tag by its name, so only the names matter, and for now applies *no account*; *Walkthrough* while a
Walkthrough waits on the person; *Registering*, or *handed off*, once one is approved; and *Skipped* to the post of a
Dossier a Correction withdraws. A Dossier reads its Product's pages through the browser service's socket at
`browser.socketPath` (`browser/README.md`), and each read is kept for 90 days under `pages/`, beside the other raw
inputs.

A Dossier that can't be written doesn't hold its day's list (settled by the person on #100). The list goes out once each
of its Dossiers is posted or has failed in that pass, and its summary names each one not written, with why. A try fails
when the Product's landing page won't load, or its Dossier run fails, hits its cap or records no Dossier. Each Dossier
not written is tried again once a day, at the Miner's 01:00 PT start or the bot's first start after it, highest Fit
first, then the oldest Launch. A Dossier a Correction asks for joins them when its try fails, and the Correction is done
without it. A Launch gets at most `dossiers.tries` tries that end without a Dossier, 3 to start, counted in the live
store across passes, restarts and both paths. A run the Assistant stops itself, as at shutdown, or one a crash cuts
short doesn't count, and neither does an error of its own before the run starts, such as a browser service it can't
reach: that still holds the list, and the Miner tries again every 30 minutes. A run that fails because the Pi container
or every provider is down counts like any other. At the limit no more tries start, and one silent line in `#status`
names the Dossier and why its last try failed. A Dossier written on a later try is posted as any other, and its date's
list then links it. Raising `dossiers.tries` through `ops/upgrade` lets the bot try such a Dossier again, however old,
as after an outage that stopped Dossiers.

Walkthroughs come only while `walkthroughs.on` is `true`, changed like any setting through `ops/upgrade`.
`config/assistant.json` ships with them off, and the go-live (#85) keeps them off until #56 lets an Approval fill the
form. While they are off, the bot prepares no new Walkthrough: no signup page is read for one and no run prepares
one, so no card goes to `#needs-you`, no post is tagged *Walkthrough*, and a Dossier's Register line says nothing of
one; the bot also starts without `signupMailbox`. The start that turns them on prepares a Walkthrough for each open
or waitlisted Product whose Dossier was posted while they were off, however old it is, oldest first, in the
background lane. Turning them off again only stops that preparation, Prepare again's included, and holds back a
version whose card didn't go out (settled by the person on #99): one already in `#needs-you` can still be approved,
edited, corrected or dismissed, and a Correction's run still needs `signupMailbox`.

While they are on, once an open or waitlisted Product's post is up, the bot reads its signup page again, live: the
one its landing page links to, or the landing page itself when it links to none. A registration-role run prepares the
Walkthrough from that read, the Dossier and the Profile. Its card goes to `#needs-you`, a copy of each version goes
to the Product's post, and the Dossier's Register line says where the Walkthrough stands. Card fields on the signup
page, or a wall the run names that nothing can get past, mean no Walkthrough, and Register says why. Edit makes a new
version of the same card, Correct a new card from another run, and Dismiss ends it. One left unanswered lapses after
14 days, with **Prepare again**. Approve records the Approval and starts the Registration as *queued*, or as *handed
off* when the Product's terms ban accounts made by a bot, with a silent status message in the post and a line in
`registration.md`. Filling the form is #56's, and **Stop** on the status message is wired with it.

```sh
sudo ops/install   # on the VM, from the main checkout: ops/README.md
```

On the VM, `ops/install` runs the bot as `assistant.service`: as the `assistant` user, from its own checkout of lab1
at `/opt/assistant/lab1`, with its tokens from `/etc/assistant/credentials`. `config/assistant.json` is set for it
there. Its `pi.command` is `ops/run-pi.ts`, the bot's side of the Docker helper, since the `assistant` user has no
`docker` group (ADR 0009). The only value a run passes into the container is the run's own token, which lets Pi reach
the forwarder for that run alone and is never a key. `browser.socketPath` is the socket the compose project's browser
service shares, and `gateway.baseUrl` reaches new-api on loopback, where new-api's compose project publishes it. The
Discord ids and the providers' models stay `set at go-live` (#85): the bot won't start until a commit sets them and
`ops/install --deploy` takes it to the VM. Elsewhere, `$ASSISTANT_CONFIG` names a config whose `pi.command` starts Pi
another way, such as `docker exec -i` into the `assistant-pi` container with the four `ASSISTANT_` variables.

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
Dossier and Walkthrough runs among them; their spend is counted, but nothing holds a run to it until #69.

The bot logs one JSON line per event to stdout. A `run.finished` line carries the run's role, providers, models, exact
tokens and notional dollars, and for a capped run the cap it hit. A `miner.run-held` line names a run that waits on
the Miner budget, with the date's spend, and a `miner.posted` line carries what the date spent in all. A
`miner.judged` line names the model request whose reply held the judgment, with that request's exact tokens; one reply
usually judges every Launch in its run. A `dossier.written` line names a Dossier's Product by its root domain, with
the run, provider and model that wrote it. A `dossier.unwritten` line names a Launch whose try wrote no Dossier, with
why and how many of its tries count, and a `dossier.stopped` line one that reached the limit. A `run.rules-loaded`
line names the commit a run's Rules were read at, the Rules by name, and about how many tokens they take. A
`walkthrough.prepared` line names a Walkthrough's version and the run that prepared it, a `walkthrough.none` line why
a Product gets none, and a `walkthrough.approved` line the Discord interaction an Approval came in.
