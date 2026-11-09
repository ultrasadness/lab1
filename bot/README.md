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
the VM as its own user (`ops/README.md`), and #85 gives it its healthchecks.io ping. #54 saves a Registration's password
in the Password vault at its Approval, and refuses any model request, Discord message or commit holding a Secret.

| Path | What it is |
|---|---|
| `bot/src/assistant.ts` | Starts every part and the schedule (the 01:00 PT catch-up, its 30-minute retries, the 06:00 PT late check); the background lane, which runs Corrections, then Walkthrough preparation, then the Miner, and the plain-code work that never waits in it, such as a Keep or an Approve; who may tap |
| `bot/src/miner/` | Judging runs, the Day's line, the day post and `days/` file, the 3-date catch-up and Retry, and Corrections of a day's judgments with their sorting runs |
| `bot/src/rules/` | Rules: each run's Rule files, its prompt's Rules section and the Rule budget; a Correction's sorting run; and the cards of proposed Rules and Interest scope changes, with Keep, Edit and Discard |
| `bot/src/dossier/` | Dossiers: the pages each one reads, its run's prompt and record, its card within Discord's 4,000 characters, its Product's post, the Product's folder in the Personal database, and the tries at one that can't be written |
| `bot/src/walkthrough/` | Walkthroughs: the read of the signup page, its run's prompt and record, the card in `#needs-you` and its copy in the Product's post, Edit, Correct, Dismiss, the 14-day lapse and Prepare again, the Approval that starts the Registration, where the Product stands, and `registration.md` |
| `bot/src/browser.ts`, `bot/src/root-domain.ts` | The browser service's `read(url)` and `redirect(url)` over its Unix socket, and the root domain a Product is keyed by |
| `bot/src/personal-database.ts` | The Personal database writer: one lock over fast-forward, write, commit and push, and the card when histories diverge (ADR 0012) |
| `bot/src/status.ts` | Silent lines in the `#status` text channel |
| `bot/src/needs-you.ts` | Cards in the `#needs-you` text channel, each mentioning the person |
| `bot/src/health-ping.ts` | The healthchecks.io ping, every 5 minutes while the bot is logged in to Discord and its store takes a write |
| `bot/src/password-vault.ts` | The Password vault: `bw` run once per operation, the password the bot makes, and the item it goes in |
| `bot/src/secret-guard.ts` | The last door: each Secret the bot holds, looked for by its exact value in every model request, Discord message and commit, and the notice to replace it |
| `bot/src/forwarder.ts` | The Pi container's only endpoint: model requests with the role key, each sent to the first of its role's providers that can serve it and priced in notional dollars, and run records |
| `bot/src/providers.ts` | Which of a role's providers can serve a request now, why each that can't has dropped out, and the `#status` lines and `#needs-you` card that say so |
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
npm run check:shell                    # shellcheck over the shell scripts
npm run check:source                   # the tests that read the source as text
npm test                               # every test
node --test bot/test/miner-day.test.ts # one file
```

`npm test` gives each test 60 seconds. A test that runs out fails, and the run still ends even when it leaves a
server or timer open (`--test-force-exit`). With `TEST_SHARD` set, such as `TEST_SHARD=2/3`, it runs only that shard
of the test files, as CI does.

The hooks and CI that check each commit and push, and how to turn the hooks on in a fresh clone, are in
`docs/hooks-and-ci.md`. `npm test` also runs the ops scripts' tests, in `ops/test/` (`ops/README.md`).

The bot's tests go through seam 1 only (`bot/test/harness/`): the real bot in a worker thread of its own, with real Pi
and our extension as local processes, against fake Discord, Product Hunt, browser service, model provider and
healthchecks.io servers, a fake `bw`, a fake GitHub holding the Personal database, and a clock the test moves. The fake GitHub is a local bare repo that git reaches through
`bot/test/harness/fake-ssh.ts` in place of ssh. It lets in only the deploy key, can refuse or hold pushes, and takes the
person's own commits, merges and tags. Only the harness imports from `bot/src`: `npm test` fails any other file under
`bot/test/` whose import names a file there (`scripts/bot-test-imports.test.ts`). `bot/test/store-schema.test.ts` also reads the
live store's file with `node:sqlite`, as #98 asks of it, and `bot/test/health-ping.test.ts` holds the store's write
lock through it, to show a store that can't take a write. `npm test` fails any other file under `bot/test/` that names
`node:sqlite` (`scripts/bot-test-store.test.ts`). What else a test may assert on is **What a test asserts on** in
`CODING_STANDARDS.md`.

A jump of the clock (`advanceTo`) fires an overdue timer only once, at the new time, as a real clock does. To test
a repeating timer, step through each firing with `stepThrough`.

`world.restart()` and `world.outage()` go through the bot's own stop, which waits for every job and piece of
plain-code work to finish, so no test can stop the bot between two steps of one piece of work with them. `world.kill()`
can. It terminates the bot's thread and kills each run, git command and `bw` command the bot started, and the bot's stop never runs.
The old bot never acts again, whatever a fake answers
or the clock does, and `restart` or `outage` then starts a fresh one on the same live store, data dir and Personal
database checkout. A test chooses the point through the outside world, never by reaching into `bot/src`: it has a fake
take a request and never answer, with `world.model.hold`, `world.git.holdPushes` or `world.bitwarden.holdCreate`,
waits until the fake has it, and kills the bot. A request held stays held once the hold is off, so the fresh bot's requests get answered. A point with
no outside call beside it can't be reached this way. A kill differs from a crash on the VM in two ways. The store's
handle closes cleanly, so no test exercises SQLite's recovery of its write-ahead log, and the next bot reads the same
commits either way. And what the bot started ends at once, where on the VM a git command gets SIGTERM first, from
systemd, and Pi, in its container, is told to end through its stdin and can no longer reach a model
(`ops/README.md`). #96 says why the bot runs in a thread. That thread makes two in the test's process that run Wasm,
which can crash Node 24's V8 (#105), so `bot/test/harness/bot-thread.ts` turns off V8's Wasm code GC there, until a
Node 24 release holds the fix (nodejs/node#66376). The bot on the VM has one such thread: `npm test` fails a `node:worker_threads` import under `bot/src`
(`scripts/bot-imports.test.ts`).

The fake browser service answers `read(url)` and `redirect(url)` on a Unix socket. Each Launch's website redirect leads
to a plain site of its own on `.example`, with a pricing page and a signup page, unless a test serves a real Product's
pages from `bot/test/harness/dossier-fixtures.ts`. A HEAD answers 403 unless a test sets its answer.

The fake `bw` (`bot/test/harness/fake-bw.ts`) is one process per command, as the real one is, and `world.bitwarden` reads
what it keeps: the Password vault's items, each command's arguments and which `BW_` variables it was given, and each
session key `bw login` and `bw unlock` printed. Its comment says what of the real CLI it was anchored to, and what no
real account has tried yet.

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
role, `personal-database-deploy-key`, the Personal database repo's deploy key, `healthchecks-ping-bot`, the ping
URL of the bot's check on healthchecks.io, and `bitwarden-api-key` and `bitwarden-master-password`, its Bitwarden
account's.

The bot's checkout of the Personal database sits at `personalDatabase.dir`: a clone of the person's repo with `main`
checked out and its `origin` at the repo's ssh URL. The bot runs git in it with no git config but the checkout's own,
and reaches GitHub through `personalDatabase.ssh` with the deploy key, so GitHub's host key must be in the bot user's
`known_hosts`. Before each run it fast-forwards the checkout, and runs read the Interest scope from
`profile/interest-scope.md` there. Each file the bot writes, such as `days/<YYYY-MM-DD>.md`, is queued in the live
store and committed on its own, and every commit is pushed. A push GitHub refuses, or a history that has diverged, is
tried again every `personalDatabase.retryMinutes`. The fast-forward, the commits and the push run together as one sync,
under one lock. A git command that dies can leave its lock file in the checkout, which can stop later syncs:
`.git/index.lock`, `.git/HEAD.lock`, `.git/ORIG_HEAD.lock`, `.git/refs/heads/main.lock` or
`.git/refs/remotes/origin/main.lock`. Each sync starts by removing any of these it finds. No git command can still hold
one by then: syncs run one at a time, and the part of git's auto gc that outlives its command takes none of them, as
#103 traced on git 2.34.1. The fetch takes only `main` and no tags, so a tag's lock file can't stop a sync.

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
inputs. When a read of its Launch's website redirect stops at a bot check on Product Hunt, a HEAD of that redirect may
give the landing page's address, which logs `dossier.redirect-head`. One that doesn't logs `dossier.redirect-unread` with
what it answered, and the try ends naming the bot check: lines of it on every Launch mean Product Hunt has closed this
route, which #102 waits on.

A Dossier that can't be written doesn't hold its day's list (settled by the person on #100). The list goes out once each
of its Dossiers is posted or has failed in that pass, and its summary names each one not written, with why. A try fails
when the Product's landing page won't load, or its Dossier run fails, hits its cap or records no Dossier. Each Dossier
not written is tried again once a day, at the Miner's 01:00 PT start or the bot's first start after it, highest Fit
first, then the oldest Launch. A Dossier a Correction asks for joins them when its try fails, and the Correction is done
without it. A Launch gets at most `dossiers.tries` tries that end without a Dossier, 3 to start, counted in the live
store across passes, restarts and both paths. A run the Assistant stops itself, as at shutdown, or one a crash cuts
short doesn't count, and neither does an error of its own before the run starts, such as a browser service it can't
reach: that still holds the list, and the Miner tries again every 30 minutes. A run that fails because the Pi container
is down counts like any other. A role with no provider left is different (settled by the person on #46, changing #100):
no run starts for it and no try counts, and neither does a run no provider served. The list still goes out, naming the
Dossier and why, and each 30-minute pass tries again until the role has a provider. A run a provider served before its
role ran out counts, since it spent. At the limit no more tries start, and one silent line in `#status`
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

Approve on a Walkthrough with a password field first saves a new password in the Password vault, the *Registrations*
collection of the person's Bitwarden organization (ADR 0004), with one item per Registration. The bot makes the
password, 24 characters with every character class, and no model ever makes or sees it. The item is named after the
Product, its website is the Product's root domain, and its username is the Signup identity's plus-address. The password
reaches only `bw`, on its stdin, and the live store, `registration.md` and the log hold only the item's id. The bot runs
`bitwarden.command` once per operation, with `bw`'s data folder at `bitwarden/` in `dataDir` and the session key in
memory only, so nothing listens, and it has no way to change or delete an item.

While Bitwarden is unavailable, the Approval is held: it is kept, but the Registration doesn't start. That means `bw`
fails, takes longer than `bitwarden.timeoutSeconds` (60 to start) or isn't there, or the bot's account sees anything but
the *Registrations* collection. The card says it waits, and the bot tries again every 5 minutes and at each start. A create that may have
reached the Password vault, because the bot died during one or its answer never came, is read back before another is made, so a
Registration has one item. Fills by reference, a replacement password for a form that refuses one, and fills held while
Bitwarden is unavailable are #56's (settled by the person on #54).

The bot refuses any model request, at the forwarder, any Discord message and any commit to the Personal database
holding the exact value of a Secret it holds: each token it reads, its Bitwarden session key, and each password it has made since it started (ADR 0009). It
looks for the value as it stands, inside a JSON string, and as a URL carries it. A refused model request fails its run,
with a 403 Pi doesn't retry, and a refused Discord message counts as one Discord refused, so the work it belonged to
goes on as after any refusal. A refused file isn't committed, and the Personal database keeps that file as it was until
the next write of it holds no such value (settled by the person on #54). The first refusal of each Secret since the bot started posts one `#needs-you` notice,
naming it and how to replace it. A verification code joins them once #57 reads the Signup mailbox.

```sh
sudo ops/install   # on the VM, from the main checkout: ops/README.md
```

On the VM, `ops/install` runs the bot as `assistant.service`: as the `assistant` user, from its own checkout of lab1
at `/opt/assistant/lab1`, with its tokens from `/etc/assistant/credentials`. `config/assistant.json` is set for it
there. Its `pi.command` is `ops/run-pi.ts`, the bot's side of the Docker helper, since the `assistant` user has no
`docker` group (ADR 0009). The only value a run passes into the container is the run's own token, which lets Pi reach
the forwarder for that run alone and is never a key. `browser.socketPath` is the socket the compose project's browser
service shares, and `gateway.baseUrl` reaches new-api on loopback, where new-api's compose project publishes it. The
Discord ids and the providers' models were set at go-live (#85); a change to them reaches the VM as a commit, then
`ops/install --deploy`. Elsewhere, `$ASSISTANT_CONFIG` names a config whose `pi.command` starts Pi
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
line names the Miner budget; raising `budgets.miner` and restarting the bot lets them go on. At go-live (#85) both
roles' provider serves OpenRouter's free `nvidia/nemotron-3-ultra-550b-a55b:free`, priced at $0, so no budget holds a
run, and what limits a runaway is OpenRouter's daily cap on free requests (settled by the person on #85). `prices`
also keeps GPT-6.1 Sol's, the price the budgets were sized at (#39). `budgets.registration`, $20 to start, is what the registration role's runs may spend in a Pacific day,
Dossier and Walkthrough runs among them; their spend is counted, but nothing holds a run to it until #69.

`roles` lists each role's providers in priority order, which #72 moves to `ops/pins`. `providers` gives each one its
`label` on Discord and says whether its route is in new-api's `mail` group. The bot won't start while a role lists a
provider with no label, or while a mail-cleared role lists one outside that group (ADR 0010). The mail role itself
comes with #61. At go-live (#85) each role has one provider, so until a second is set up, losing it is an outage.

The forwarder sends each model request to the first of the role's providers that can serve it, and moves the request
on from one that can't, so the run never hears of it (#46, ADR 0011, ADR 0013). A provider that dropped out and is due to be tried
again goes first, ahead of the order, or one further down would never hear again once one above it serves (settled by
the person on #46). What new-api answers decides what follows:

| new-api's answer | What the forwarder does |
|---|---|
| 429 | The provider is at its limit, for every role that lists it, until the reset time the error gives, or otherwise for `gateway.retryMinutes` |
| 402 | The provider is out of balance, for every role that lists it, for `gateway.retryMinutes` |
| 401 | It reads `GET /api/usage/token/` with that key. No quota left is *gateway quota spent*, for that role. Quota left means the provider refused its own key, so that `role@provider` name is failing. A key new-api refuses there too is dead: all of that role's providers are out, and #70 adds its notice to the `#status` line naming `ops/token` (settled by the person on #46). An answer it can't read goes back to the run |
| 403 `pre_consume_token_quota_failed` | *Gateway quota spent*, for that role: all its providers share its key (settled by the person on #46) |
| 403 `insufficient_user_quota` | *Gateway quota spent*, for every role, since one new-api user holds every key (settled by the person on #46) |
| 400, 404, 413 or 422 | The request's own fault: it goes back to the run, and no provider drops out |
| Anything else, or no answer | That `role@provider` name is failing for `gateway.retryMinutes`, and the role's other names and other roles carry on: on 2026-11-06 one name had no channel while the one beside it worked (settled by the person on #46) |

A reply that fails part way, with an error in its stream or no `finish_reason` at its end, counts the same. The
forwarder reads the rest of it for up to 5 seconds, for the usage that says what it spent, then cuts it off, and Pi's
retry of that goes to the next provider. One 5xx is enough to drop out, with the fallback of three in a row if a one-off
5xx ever costs a run. Only OpenRouter's reset time reaches the bot: new-api keeps a 429's `error.metadata`, and drops
CPA's `Retry-After` and `reset_seconds` (the trial on #46), so ChatGPT Plus is tried again every 30 minutes. Once its
time is up, a provider is tried again by the next request. If it serves, it's back; if not, it stays out a while longer,
with a new line only if why it is out has changed. Drop-outs live in the live store, so a restart keeps skipping a
provider.

A provider dropping out gets one silent line in `#status`, naming it, why, until when and which provider took over, and
another when it's back. A role with no provider left is an outage. Its runs don't start: the Miner tries again every 30
minutes and its 06:00 PT late line names why, a Correction or a Walkthrough preparation waits for the next 30-minute
try, and a Dossier waits as above. A card goes to `#needs-you` only when an empty balance or a spent gateway quota leaves
a role with no provider, and it shrinks to a line once that is back. A day's summary names its providers, with how many
Launches each judged, when more than one judged it.

The bot logs one JSON line per event to stdout. A `run.finished` line carries the run's role, the providers and models
that served it, exact tokens and notional dollars, and for a capped run the cap it hit. A `miner.run-held` line names a run that waits on
the Miner budget, with the date's spend, and a `miner.posted` line carries what the date spent in all. A
`miner.judged` line names the model request whose reply held the judgment, with that request's exact tokens; one reply
usually judges every Launch in its run. A `dossier.written` line names a Dossier's Product by its root domain, with
the run, provider and model that wrote it. A `dossier.unwritten` line names a Launch whose try wrote no Dossier, with
why and how many of its tries count, a `dossier.stopped` line one that reached the limit, and a `dossier.waiting` line
one that waits for a provider, with why. A `provider.dropped-out` line names what dropped out, why and until when, and a
`provider.back` line what came back. A `forwarder.no-provider` line names a request no provider was left to serve, and a
`forwarder.key-unread` line a 401 whose `GET /api/usage/token/` said nothing it could read. A `run.rules-loaded`
line names the commit a run's Rules were read at, the Rules by name, and about how many tokens they take. A
`walkthrough.prepared` line names a Walkthrough's version and the run that prepared it, a `walkthrough.none` line why
a Product gets none, and a `walkthrough.approved` line the Discord interaction an Approval came in. A
`vault-item.created` line names a Registration's vault item by its id, a `vault-item.found` line one read back after a
create whose answer never came, and a `password-vault.unavailable` line why an Approval is held. A `secret.refused` line names the
door a Secret was stopped at, and the Secret by its name. A `personal-database.lock-removed` line names a git lock
file a sync found left in the checkout and removed.

Every 5 minutes the bot pings its check on healthchecks.io, at the URL in `healthchecks-ping-bot`, but only while it
is logged in to Discord and its store takes a write: it writes the time to the store first. A ping withheld gets a
`health.ping-withheld` line saying why, and one healthchecks.io doesn't take a `health.ping-failed` line; neither is
tried again before the next 5 minutes. The check has a 5-minute period and 10 minutes' grace, so 15 minutes without a
ping sends the person an email that says only that the Assistant can't reach them on Discord (#26). The Miner's, the
backup's and the weekly check's pings come with #70.
