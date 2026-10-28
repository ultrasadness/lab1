# Operations on the VM

English | [中文](README.zh.md)

The scripts that run the Assistant on the Oracle VM, as ADR 0008 and ADR 0009 decide: the bot as its own `assistant`
user, every token in a root-owned file outside the containers, and the running Assistant in a checkout of its own.
#71 brings up the install, the tokens, the nightly backup, the browser's firewall and the Docker helper. Agents write
and test them, and run their dry runs; the person runs whatever touches a real token. The acceptance checklist the
person runs on the VM is in #85 and #73.

| Path | What it is |
|---|---|
| `ops/install` | The one install: safe to run again, and a second run changes nothing |
| `ops/token`, `ops/token.ts` | The only way a token is obtained, replaced or checked |
| `ops/backup` | The nightly backup of the live store and new-api |
| `ops/firewall` | The browser container's host firewall: public internet only; and Pi's way to the forwarder |
| `ops/docker-helper.ts`, `ops/run-pi.ts` | The root-owned Docker helper, and the bot's side of it |
| `ops/alert.ts` | The alert when the bot or the backup gives up |
| `ops/systemd/` | The units `ops/install` puts in `/etc/systemd/system` |
| `ops/coding-sessions/` | Claude Code's and Codex's settings that keep coding sessions out of the credentials |
| `ops/github-known-hosts` | GitHub's published ssh host keys, for the bot's ssh |
| `compose.yaml` | The compose project of Pi and the browser service |

## Installing

Run everything from the main checkout of lab1, on `main`:

1. Publish new-api on loopback, where `gateway.baseUrl` in `config/assistant.json` reaches it: in new-api's compose
   project, give the `new-api` service `ports: ["127.0.0.1:3000:3000"]`. The bot reaches new-api there and never
   through Caddy.
2. `sudo ops/install --personal-database git@github.com:<owner>/<repo>.git`. It ends by listing what the bot and its
   alerts wait on.
3. `sudo ops/token <name>` for each token it lists (below).
4. `sudo ops/install` again. With the deploy key in place, it checks out the Personal database's `main`, and once the
   config and every token are in place it starts the bot.
5. The config's values marked `set at go-live` change like any code: a commit that lands on `main`, then
   `sudo ops/install --deploy`.

`ops/install` puts in place, checking each before it changes it:

- Node 24.22.0 for the bot and the ops scripts, checked against nodejs.org's SHA-256, in `/opt/assistant/node`;
- `sqlite3`, for the backup;
- the `assistant` system user, in no group but its own: no `sudo`, no `docker`, and `/home/ubuntu` closed to it;
- `/etc/assistant/credentials` and `/var/backups/assistant`, root's alone (mode 700);
- the bot's checkout of lab1 at `/opt/assistant/lab1`, root's and only readable to the bot, apart from where coding
  sessions work;
- GitHub's host keys in the `assistant` user's `known_hosts`;
- the bot's checkout of the Personal database at `personalDatabase.dir`, with `origin` at the repo's ssh URL, and
  `main` checked out once the deploy key works;
- the units in `ops/systemd/`, and the browser service's socket folder, `/run/lab1-browser`, made again at each boot;
- the coding sessions' settings;
- the firewall, then the compose project, then the bot.

Without `--dry-run`, `ops/install` runs only what `main` holds, since coding sessions work in the checkout it runs
from: while `ops/` there differs from `main`, it refuses and names what differs (settled on #71).
`sudo ops/install --dry-run` says what would change and changes nothing, and it runs changes not yet committed; it
needs no root. Given a Personal database
whose checkout has nothing checked out yet, it also asks GitHub, through the deploy key, what it would fetch. Without
root it can't see into the credentials folder, so it lists every token as missing.

Until #72 brings `ops/upgrade`, `--deploy` is how a commit reaches the running Assistant, a stopgap the person chose
on #71. It moves the bot's checkout to the main checkout's `main`, only while that is `origin/main`: the pre-push hook
lets onto `main` only a commit whose CI passed. It then installs again, builds the compose project and restarts the
bot. It refuses a `main` that hasn't been pushed, or one that doesn't descend from the running commit. A change in
the bot's checkout that git didn't make is a problem `ops/install` names, and it fails until the change is gone.

## Tokens

`sudo ops/token <name>` reads the value without echo, checks it with a harmless call, and only once that passes writes
`/etc/assistant/credentials/<name>` (root, mode 600) and restarts the service that reads it. A value that fails its
check changes nothing. The bot restarts only once every token it reads is in place and the Personal database is
checked out; until then `ops/token` says what it waits on. `ops/token --list` names every token,
`ops/token --check [<name>…]` checks those in place, and `ops/token --dry-run <name>` reads and checks a value
without writing it.

| Token | How it is obtained | Its check |
|---|---|---|
| `discord-bot-token` | the Developer Portal's Bot page | Discord's `/users/@me` |
| `producthunt-token` | Product Hunt API v2's developer token | a query for one Launch |
| `newapi-key-<role>`, for `miner`, `registration`, `mail`, `question` and `checks` | a key new-api makes for the role | new-api's `/models` |
| `newapi-key-probe` | a key new-api makes for the daily probe | new-api's `/models` |
| `gmail-client-secret` | the JSON Google Cloud's Credentials page downloads for the Desktop app client | Google takes the client, refusing only a made-up code |
| `gmail-refresh-token` | a consent in Safari: open the link `ops/token` shows, signed in to the Signup mailbox's account, then paste the address Safari can't load | a refresh, exactly `gmail.readonly` and `gmail.compose`, and the mailbox's address |
| `bitwarden-api-key` | the bot's Bitwarden account's personal API key: its `client_id`, then its `client_secret` | Bitwarden logs the bot in with it |
| `bitwarden-master-password` | the bot's Bitwarden account | `bw` unlocks the vault with it, once #54 installs `bw` |
| `healthchecks-ping-bot`, `-miner`, `-backup`, `-weekly` | each check's ping URL on healthchecks.io; the bot's check has a 5-minute period and 10 minutes' grace | a log event on the check, which changes nothing else |
| `personal-database-deploy-key` | made on the VM: `ops/token` shows the public key to add to the repo's Deploy keys, with "Allow write access", then waits for Enter | `git ls-remote origin main` from the bot's checkout, through the key, and a push of nothing, which GitHub refuses a key added without write access |

The deploy key's private half never leaves the VM (settled on #71): while GitHub is asked, it waits in a folder inside
the credentials folder, removed even when the SSH session drops. A key GitHub still refuses after five tries
changes nothing: remove it from the repo and run `ops/token` again. CPA's ChatGPT login, pasted as the failed
`localhost:1455` address, comes with CPA itself in #72.

The bot's unit hands over only the tokens the bot reads today: `discord-bot-token`, `producthunt-token`,
`newapi-key-miner`, `newapi-key-registration`, `personal-database-deploy-key` and `healthchecks-ping-bot`. A later ticket that reads another
adds its `LoadCredential=` line to `ops/systemd/assistant.service`: `ops/test/token.test.ts` fails while the unit and
the names the bot reads differ.

## The bot's user and the Docker helper

The `assistant` user has no `docker` group, so the bot reaches Docker only through the helper (ADR 0009).
`assistant-docker.socket` listens on `/run/assistant-docker.sock`, which only the `assistant` group may open, and
starts `ops/docker-helper.ts` as root for each connection. The connection's first line asks for one of exactly two
commands: start one `pi --mode rpc` process for a role in the `assistant-pi` container, or report each running
container's image and digests. Anything else is refused, and no Docker command runs. The run's token reaches the
container through the environment, never a command line.

`ops/run-pi.ts` is the bot's `pi.command`: it asks the helper for the run, relays stdin and stdout, and exits with
Pi's exit code, writing the end of Pi's stderr to its own. Once the bot's side closes, the helper ends Pi's stdin,
which ends Pi; one still running 10 seconds later has its `docker exec` killed. Killing `docker exec` doesn't stop a
process inside the container, but such a Pi can't reach a model: the forwarder forgets the run's token once the bot's
run ends.

The bot's unit gives it no view of `/home` and nothing to write but `/var/lib/assistant`. While it runs, the bot pings
its healthchecks.io check every 5 minutes (`bot/README.md`), so once it stops, the email goes out within 15 minutes.
It restarts 120 seconds after it stops, so even a crash loop stays at 720 Discord logins a day, and after 10 failed
starts in an hour it stops and `assistant-alert@bot.service` signals the bot's check as failed, so the email goes out
at once.

| Unit | What it does |
|---|---|
| `assistant.service` | The bot |
| `assistant-docker.socket`, `assistant-docker@.service` | The Docker helper, one service per connection |
| `assistant-firewall.service` | `ops/firewall apply`, before Docker starts |
| `assistant-backup.timer`, `assistant-backup.service` | The backup, at 00:30 Pacific, or at boot when a night was missed |
| `assistant-alert@.service` | The alert, for `bot` or `backup` |

The Miner has no timer: the bot schedules it at 01:00 Pacific, and every start of the bot catches up a date missed
while the VM was off (settled on #71). The weekly check's timer comes with #52, and the Miner's, the backup's and the
weekly check's healthchecks.io pings with #70.

## The backup

`assistant-backup.timer` runs `ops/backup` each night: a `sqlite3 .backup` of the live store and a `pg_dump` of
new-api's database, into `/var/backups/assistant/<Pacific date>/`, keeping the 7 latest nights. The dump holds the
plans' provider keys, so the folder is root's alone. Tokens are never backed up: if the VM is lost, each is obtained
again with `ops/token`. `ops/backup --dry-run` says what it would back up, and whether each part is there.

To restore a night:

```sh
sudo systemctl stop assistant.service
# A crash leaves the old store's write-ahead log behind, which SQLite would replay onto the restored store.
sudo rm -f /var/lib/assistant/assistant.sqlite-wal /var/lib/assistant/assistant.sqlite-shm
sudo install -o assistant -g assistant -m 600 /var/backups/assistant/<night>/assistant.sqlite /var/lib/assistant/assistant.sqlite
sudo systemctl start assistant.service
sudo docker stop new-api
# Only root can read the backups, so root's shell opens the dump.
sudo sh -c 'docker exec -i postgres pg_restore --username root --dbname new-api --clean --if-exists < /var/backups/assistant/<night>/new-api.dump'
sudo docker start new-api
```

## The browser's firewall

`ops/firewall apply` drops each packet the browser container sends to anything but the public internet: the private
ranges, Tailscale's range, link-local addresses with Oracle's instance metadata among them, the host's own addresses
and IPv6's local ranges. It works in the raw table, ahead of the chains Docker and Tailscale add. The container's DNS
still works: Docker's resolver forwards its queries from the host, not from the browser's bridge.

`ops/firewall check`, which needs Docker but not root, tries each kind of blocked address and two public ones from a
throwaway container on the browser's network, and fails on any that comes out wrong. In #71 it was tried on a
throwaway network: without the firewall, such a container reached the instance metadata, sshd, new-api's network and
Tailscale's resolver; with it, only the public internet. `ops/firewall --dry-run` prints the rules.

It also lets Pi's container reach the bot's forwarder. Pi runs on Docker's default bridge, `docker0`, and reaches the
forwarder on that bridge's gateway, but Oracle's Ubuntu image ends the filter table's `INPUT` with a `REJECT` of all
but ssh, http and https, which refused every Miner run at go-live (#85). So `apply` puts an `ACCEPT` for the
forwarder's port, from `docker0` alone, at the top of `INPUT`, and `check` also tries the forwarder from a throwaway
container on that bridge, which must reach it. There, as for every target, a refused connection counts as reached,
since it got to the host. The forwarder's address in `ops/firewall` is the one in `config/assistant.json`:
`ops/test/firewall.test.ts` fails while the two differ.

## Coding sessions

Coding sessions run as `ubuntu`, which keeps sudo. `ops/install` writes
`/etc/claude-code/managed-settings.d/assistant.json` and `/etc/codex/requirements.toml`, which deny every Claude Code
and Codex session the credentials folder, the credentials systemd hands its services in `/run/credentials`, and the
backups. A `requirements.toml` that `ops/install` didn't write is left as it is, and named, for the person to merge by
hand. Claude Code's Bash rules refuse any command that names those folders, a `grep` for them in the code included
(settled on #71). Once that gets in the way of an ops session, they narrow to commands that name `sudo` with those
folders.

## Test

`npm test` runs `ops/test/` with the rest. The tests put the VM in a throwaway folder (`OPS_ROOT`), with fakes of the
system's commands and of every outside service, and dummy tokens only:

- `install.test.ts` installs twice, and checks the second run changes nothing; it also covers the dry run, the
  Personal database through a fake GitHub that lets in only the deploy keys added, `--deploy`, the unit files as
  `systemd-analyze verify` reads them, and that `ops/install` makes no change where bash ignores `set -e`;
- `token.test.ts` types each kind of token, including one under a terminal that would echo it, and checks what is
  written and restarted;
- `docker-helper.test.ts` runs the helper behind `systemd-socket-activate`, as systemd does, with a fake `docker`;
- `alert.test.ts` runs the alert against a fake healthchecks.io that fails as often as the test says;
- `backup.test.ts` and `firewall.test.ts`, the latter in a network namespace of the test's own.

On the VM, agents run the dry runs: `ops/install --dry-run`, `ops/token --dry-run <name>` with a dummy value,
`ops/backup --dry-run`, `ops/firewall --dry-run`, and `ops/firewall check` once the firewall is in.
