# The Personal database is its own repo, and code reaches the running Assistant only through `ops/upgrade`

The Personal database (the Profile, Dossiers and Registration history, Miner days, and Rules with their cases) lives in a private git repo of its own. `lab1` holds the code, `ops/` and the docs. The running Assistant runs from its own checkout of `lab1`, at the commit `ops/upgrade` last deployed, never from the checkout where coding sessions work. The bot fast-forwards the Personal database before each run and pushes after each commit, as [How does a Correction become a Rule, and how do we prove it carries over?](https://github.com/ultrasadness/lab1/issues/14) settled. If that repo also held the code, every fast-forward would deploy untested code past the upgrade gate. Development pushes would also keep diverging from the bot's, and a diverged history stops the bot committing. The brief asks for the implementation and the Rules to be managed in git, and two repos still meet that. Decided in [How are the bot, the container and the gateway kept running and upgraded, and what happens while one is down?](https://github.com/ultrasadness/lab1/issues/26).

## Considered Options

- **One repo, one checkout** (`~/lab1` as it is today): rejected. A fast-forward would deploy code too, and coding sessions and the bot would write the same working tree.
- **One repo, two checkouts** (code at a pinned commit, the bot's data checkout tracking `main`): rejected. The bot and the person would push to the same branch, so histories would diverge often while the person develops, and each time the bot would stop committing.

## Consequences

- **Only `ops/upgrade <part> <version>` changes the running Assistant.** The person runs it on the VM, never from Discord. It works in this order:
  - it builds or pulls the candidate beside the running one;
  - it runs that part's gate against the candidate;
  - only if the gate passes, it writes the pin, commits it to `lab1`, switches over and posts the result to Discord.

  A failing gate changes nothing, unless the person overrides a failing Rule case or a drifting Miner provider from Discord, as [ADR 0002](./0002-rules-are-files-proven-by-their-own-case.md) and the Miner dry run allow.
- **The gates**, refining [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.md)'s rule:
  - **anything that changes what a model sees or which model sees it** (Pi, its image, our extensions, prompts and schemas, new-api, CPA, a role's models): the Rule carry-over check and a Miner dry run. In the Miner dry run, every provider of the Miner role judges a frozen set of 24 past Featured Launches whose Fits the person confirmed. It fails when a provider's Fits average a point or more above or below theirs. Until the person has confirmed the set, it checks only that a day completes with valid records. Decided in [How do we catch a Miner provider whose Fits run higher or lower than the others?](https://github.com/ultrasadness/lab1/issues/35);
  - **the browser image:** the fill smoke test from [ADR 0006](./0006-registration-browser-in-its-own-container-driven-through-fixed-actions.md);
  - **bot-only code:** its own tests.
- **`ops/rollback <part>`** reverts that part's last pin commit and switches back to the previous image, which stays on the VM.
- **`ops/pins` in `lab1` records every pin:**
  - the image digests for Pi, the browser, new-api and CPA;
  - Pi's npm version;
  - each role's providers and models, in priority order, with each model's price per 1M input, cached and output tokens.

  The bot checks the running images and Pi's version against it when it starts and in the weekly check, and posts any drift. A role's mapping changes only through `ops/upgrade role <role>`, so the bot holds no new-api admin token. That command also sets new-api's ratios from the recorded prices, so new-api's quotas and the forwarder's spending budgets count the same dollars ([ADR 0011](./0011-the-forwarder-picks-each-requests-provider-and-holds-the-spending-budgets.md)). The weekly check names the provider and model each case actually ran on.
- **new-api moves off `:latest`** to a pinned digest. It stays in its own compose project, which also serves the person's other uses.
- **Off the VM, only git survives:** `lab1` and the Personal database repo, which the bot pushes after each commit. The SQLite store and new-api's database are backed up nightly, on the VM only. If the VM is lost, it is rebuilt from both repos and every token is obtained again.
