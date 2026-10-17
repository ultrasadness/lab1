# The bot runs as its own user and holds every token outside the containers

Every key and token the Assistant uses is a Secret, and none sits in a container. Each fixed token is a root-owned file in `/etc/assistant/credentials/` (mode 600), which systemd hands to the service that needs it through `LoadCredential=`. The bot runs as a dedicated `assistant` system user with no sudo, no `docker` group and no view of `/home/ubuntu`. Today everything runs as `ubuntu`, which has passwordless sudo and the `docker` group, and coding sessions run as `ubuntu` too: a coding agent that read a token file would put a Secret into a model's input. The Pi container reaches new-api only through a forwarder in the bot, which adds the run's key. Decided in [Where do the Assistant's Secrets and tokens live, and how is each one obtained and replaced?](https://github.com/ultrasadness/lab1/issues/25).

## Considered Options

- **The bot as `ubuntu`:** rejected. Every coding session could read the bot's tokens, and the bot could read `gh`'s token for the whole GitHub account.
- **Rootless Docker for the bot's user:** rejected. Container traffic would leave as the user's own process, which breaks [ADR 0006](./0006-registration-browser-in-its-own-container-driven-through-fixed-actions.md)'s host firewall.
- **Tokens kept in Bitwarden:** the bot would still need its Bitwarden login on disk to fetch them, and a Bitwarden outage would stop everything.
- **Tokens encrypted with sops or age:** unattended starts need the key on the same disk, so encryption guards copies, not the running VM. Ubuntu 22.04's systemd (249) also lacks `systemd-creds`.
- **Environment variables in compose files,** as new-api has today: anyone with Docker reads them through `docker inspect`.
- **The new-api key in the Pi container's environment:** Pi's `bash` could read it, against [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.md). A proxy sidecar holding one key would give neither a key per role nor an exact count of each run's tokens.
- **`bw serve`:** an API with no authentication, kept unlocked. The bot runs `bw` for each operation instead, with the session key in memory only, so nothing listens.
- **A fine-grained GitHub token for the Personal database's repo:** it expires, so it would be one more token to die. A deploy key doesn't.

## Consequences

- **Docker only through a fixed helper.** A root-owned helper offers the bot two commands:
  - start one `pi --mode rpc` process for a role;
  - report the running image digests for the `ops/pins` check.

  [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.md)'s `docker exec` still happens, but the bot can run no other Docker command. The person keeps sudo, and Claude Code's and Codex's settings deny the credential directory to coding sessions.
- **Where each token lives:**
  - **The credential directory:**
    - the Discord bot token;
    - the Gmail client secret and refresh token;
    - the Product Hunt token;
    - one new-api key per role, plus a probe key;
    - the bot's Bitwarden API key and master password;
    - the healthchecks.io ping URLs;
    - a deploy key with write access to the Personal database's repo only.
  - **With whatever renews it:** CPA's ChatGPT login in CPA's volume, and `bw`'s data directory with the bot.
  - **In new-api's database:** the plans' provider keys, and the CPA API key its channel uses. CPA's config file is root-owned, mode 600, and its management API is off. CPA is reachable only from new-api, on the internal Docker network.
  - **Never** in git, a command line, a container's environment or a log. Tokens aren't backed up: if the VM is lost, each is obtained again. The nightly new-api dump, which holds the provider keys, is readable by root only.
- **The forwarder** refines [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.md): the Pi container's one endpoint is the bot, not new-api.
  - **Keys:** the bot knows each run's role, so it uses that role's new-api key. Each key is limited in new-api to its role's models, a quota and the bot's address. The mail role's key is also bound to new-api's `mail` group, which holds only routes that don't train on inputs ([ADR 0010](./0010-mail-text-reaches-only-mail-cleared-roles-on-routes-that-dont-train.md)).
  - **Counting:** the bot counts each run's tokens exactly, for the per-run cap from [ADR 0008](./0008-the-personal-database-is-its-own-repo-and-code-ships-only-through-ops-upgrade.md).
  - **Routing and budgets:** the forwarder also picks each request's provider and admits each run against a spending budget ([ADR 0011](./0011-the-forwarder-picks-each-requests-provider-and-holds-the-spending-budgets.md)). A 401 from new-api is checked against the key's remaining quota before the key is reported dead.
  - **The public gateway:** the Assistant's traffic never passes through Caddy. `na.pot.dpdns.org` stays public for the person's other uses, and a leaked Assistant key is useless from outside. new-api keeps its usage logs, with content logging off.
- **`ops/token <name>` is the only way a token is obtained or replaced.** The person runs it on the VM, from the iPhone through an SSH app over Tailscale. It:
  1. reads the value without echo, or the failed `127.0.0.1` or `localhost:1455` address pasted after the Gmail or CPA login;
  2. writes the credential file;
  3. checks the token with a harmless call;
  4. restarts the service that uses it.

  Together, these commands are the runbook for rebuilding the VM.
- **The bot refuses any model request or Discord message holding the exact value of a Secret it holds**, and posts a notice to replace that token. This extends [ADR 0006](./0006-registration-browser-in-its-own-container-driven-through-fixed-actions.md)'s exact-value redaction of snapshots to the Assistant's own keys and to every way out.
