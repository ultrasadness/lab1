# The bot

The Assistant's one long-running process: TypeScript on Node 24, run as-is through Node's type stripping, with no
npm dependencies of its own. It holds every token, alone writes the live store, and makes every outside call.
The spec is #41; this first slice (#42) brings up the Miner's path from Product Hunt to the Miner days forum.

| Path | What it is |
|---|---|
| `bot/src/assistant.ts` | Starts every part and the 01:00 PT schedule; the background lane; who may tap |
| `bot/src/miner/` | Judging runs, the Day's line, the day post |
| `bot/src/forwarder.ts` | The Pi container's only endpoint: model requests with the role key, and run records |
| `bot/src/pi-runs.ts` | One `pi --mode rpc` process per run |
| `bot/src/store.ts` | The live store (SQLite) |
| `bot/src/product-hunt.ts`, `bot/src/discord/` | Product Hunt API v2 and Discord |
| `pi/extension/` | Our Pi extension: the forwarder as provider, and each run kind's record tool and prompt |
| `pi/pi-run`, `pi/Dockerfile` | How a run starts, and the Pi container image |
| `config/assistant.json` | Settings, changed only through `ops/upgrade` |

## Test

```sh
npm ci
npm run typecheck
npm test                               # every test
node --test bot/test/miner-day.test.ts # one file
```

Tests go through seam 1 only (`bot/test/harness/`): the real bot in-process, with real Pi and our extension as
local processes, against fake Discord, Product Hunt and model provider servers and a clock the test moves.

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
place of `docker exec`.

The bot logs one JSON line per event to stdout. Each `run.finished` and `miner.judged` line carries the role,
provider, model and exact tokens.
