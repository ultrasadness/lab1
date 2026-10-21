# The bot

English | [中文](README.zh.md)

The Assistant's one long-running process: TypeScript on Node 24, run as-is through Node's type stripping, with no
npm dependencies of its own. It holds every token, alone writes the live store, and makes every outside call.
The spec is #41; this first slice (#42) brings up the Miner's path from Product Hunt to the Miner days forum.

| Path | What it is |
|---|---|
| `bot/src/assistant.ts` | Starts every part and the schedule (the 01:00 PT catch-up, its 30-minute retries, the 06:00 PT late check); the background lane; who may tap |
| `bot/src/miner/` | Judging runs, the Day's line, the day post, the 3-date catch-up and Retry |
| `bot/src/status.ts` | Silent lines in the `#status` text channel |
| `bot/src/forwarder.ts` | The Pi container's only endpoint: model requests with the role key, and run records |
| `bot/src/pi-runs.ts` | One `pi --mode rpc` process per run, capped on wall clock, turns and tokens |
| `bot/src/store.ts` | The live store (SQLite) |
| `bot/src/product-hunt.ts`, `bot/src/discord/` | Product Hunt API v2 and Discord |
| `pi/extension/` | Our Pi extension: the forwarder as provider, and each run kind's record tool and prompt |
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
as local processes, against fake Discord, Product Hunt and model provider servers and a clock the test moves.

A jump of the clock (`advanceTo`) fires an overdue timer only once, at the new time, as a real clock does. To test
a repeating timer, step through each firing with `stepThrough`.

The fake Product Hunt doesn't check the fields a query names. What the real API accepts is its live schema, which
`npm run capture:producthunt-schema` captures by introspection and writes as SDL to
`bot/test/fixtures/producthunt/schema.graphql`. On an HTTP error, GraphQL errors or a reply that doesn't build a
schema, it writes nothing and says why. The person runs it, since agents never read the token: it reads
`producthunt-token` in `$CREDENTIALS_DIRECTORY` itself, as the bot does, and asks the API the bot's config names.
In a Claude Code session, typing `!` before the command keeps the token out of the agent's context. Run it again,
and commit what it writes, whenever a query in `bot/src/product-hunt.ts` changes or the live API might have.

```sh
CREDENTIALS_DIRECTORY=/path/to/credentials npm run capture:producthunt-schema
```

## Run

The bot reads `config/assistant.json` (or `$ASSISTANT_CONFIG`), and its tokens from `$CREDENTIALS_DIRECTORY`, as
systemd's `LoadCredential=` hands them over: `discord-bot-token`, `producthunt-token` and one `newapi-key-<role>`
per role. The Interest scope is `profile/interest-scope.md` in its checkout of the Personal database.

```sh
docker build -f pi/Dockerfile -t assistant-pi .
npm start
```

The install on the VM (its own user, the Docker helper, systemd units) is #71. It also sets what
`config/assistant.json` leaves open: the Discord ids, how new-api is reached on loopback, and the helper in
place of `docker exec`. Until then the config's `pi.command` runs `docker exec` directly, which ADR 0009 rules out
for the installed bot: the `assistant` user has no `docker` group and reaches Docker only through the helper. The
only value it passes into the container is each run's own token, which lets Pi reach the forwarder for that run
alone and is never a key.

The run caps in `config/assistant.json` are starting values. The wall clocks were decided in #26; the turn and token
caps are first guesses, to tune from the `run.finished` lines.

The bot logs one JSON line per event to stdout. A `run.finished` line carries the run's role, providers, models and
exact tokens, and for a capped run the cap it hit. A `miner.judged` line names the model request whose reply held
the judgment, with that request's exact tokens; one reply usually judges every Launch in its run.
