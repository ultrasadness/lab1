# The forwarder picks each request's provider and holds the spending budgets

English | [中文](0011-the-forwarder-picks-each-requests-provider-and-holds-the-spending-budgets.zh.md)

The bot's forwarder ([ADR 0009](./0009-the-bot-runs-as-its-own-user-and-holds-every-token-outside-the-containers.md)) chooses which provider serves each model request, and admits each run against a spending budget. new-api still holds the channels, keys and model names, but it no longer decides anything when a provider fails. With new-api's default `RetryTimes` of 0, a Plus 429 simply failed the run, so [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.md)'s two providers per role did nothing until someone changed the mapping. CPA's ChatGPT login is the person's own account, so the Assistant shares their Plus allowance. Its usage headers never reach the bot (CPA's `passthrough-headers` is off by default, and new-api's streaming path forwards only `X-Reasoning-Included` and `X-Codex-Turn-State`), so nothing can see how much of that allowance is left. The forwarder already knows each run's role and counts its tokens exactly, so it is the one place that can fail over on purpose and bound what the Assistant spends. Budgets are a guard against runaways, such as a mail flood, a loop of runs or a fallback onto a pricier model, sized so that an ordinary day never touches them. Decided in [What may each kind of run spend, and what happens when a budget runs out?](https://github.com/ultrasadness/lab1/issues/39).

## Considered Options

- **new-api failing over (`RetryTimes` above 0):** rejected. During a cooldown it tries Plus first on every request, it doesn't retry 402 or 403, and the bot would learn which provider served only afterwards, from the token log.
- **A ration instead of a guard**, a spending target the Assistant meets by doing less: the Day's line needs every Fit, and the Assistant would quietly do less.
- **Budgets in raw tokens:** Luna and Sol differ about 20× in price, so a token budget either blocks the cheap model or lets the expensive one run away.
- **new-api key quotas as the budgets:** a key's quota is a lifetime pool that never resets, the bot holds no admin token to top it up, and a spent key answers 401 "Invalid token" like a wrong one.
- **One budget for everything:** a mail flood would stop the Miner.
- **A second Plus subscription for the Assistant alone:** another $20 a month, to protect an allowance the Plus share already protects.
- **Unlimited role keys in new-api:** a counting bug in the forwarder would then be stopped only by the prepaid balances, and on Plus only by OpenAI's window, which is also the person's.
- **Cutting a run off when its budget runs out:** the money already spent is wasted, and items are left half done.

## Consequences

- **Routing:**
  - The forwarder sends each request to a `role@provider` model name, in `ops/pins` order. Exactly one channel serves each name, so new-api can't switch providers, whatever `RetryTimes` the person sets for their other uses. The plain role names go away.
  - It skips a provider that is cooling down (until the reset time when the error gives one, otherwise trying it again every 30 minutes), out of balance (402), failing, or past the Plus share. A run whose provider drops out carries on with the next one.
  - Mail roles have `@provider` names only for routes in the `mail` group ([ADR 0010](./0010-mail-text-reaches-only-mail-cleared-roles-on-routes-that-dont-train.md)), so failover never leaves it.
  - The forwarder records which provider served each request, so a Miner judgment's provider no longer needs the token-log lookup from [How do we catch a Miner provider whose Fits run higher or lower than the others?](https://github.com/ultrasadness/lab1/issues/35).
  - A provider dropping out gets one silent line in `#status` naming it, why, until when, and which provider took over, and another when it's back. A role left with no provider is an outage, handled as [How are the bot, the container and the gateway kept running and upgraded, and what happens while one is down?](https://github.com/ultrasadness/lab1/issues/26) says. An empty balance gets a `#needs-you` card only when it leaves a role with no provider.
- **The unit** is notional dollars at list price: each request's exact tokens × the price per 1M input, cached and output tokens that `ops/pins` records for that provider's model. Plus is priced at OpenAI's API list price for the same model, so its volume is bounded even though it costs nothing extra.
- **The budgets:**
  - registration, mail and question, each per Pacific day;
  - the Miner, per Miner date, so a 3-day catch-up gets three dates' worth;
  - checks, per week: the weekly check, the daily probes, and the check when a Rule is kept or edited;
  - the **Plus share**: the notional dollars the Assistant spent on Plus over a rolling 7 days, across every role and check. Reaching it moves work to the next provider and stops nothing.

  Values live in the bot's config in git and change only through `ops/upgrade`. They start at about twice the estimates in [What limits and prices apply to the model routes, Product Hunt and Gmail at the Assistant's volume?](https://github.com/ultrasadness/lab1/issues/36). After 14 measured days, the weekly note proposes 3× the costliest day for each role and 2× the costliest week for checks. The person sets the Plus share after comparing a week against ChatGPT's own usage page.
- **Admission:** a budget is checked when a run starts. A started run finishes within its own caps, so a budget overshoots by at most one run's token cap. The Plus share is checked on every request.
- **Never held, but counted:** work for an approved Registration (fill runs, an amended Walkthrough), mail for a Registration waiting on its verification, checks the person starts, a Correction's run, and `ops/upgrade` gates, which print their running spend. A Correction runs under the role of the item it corrects and counts against that role's budget, a Skip's against its Miner date (decided in [What is left to decide before the spec is written?](https://github.com/ultrasadness/lab1/issues/40)).
- **When a budget is spent, work waits, and nothing new is dropped:**
  - a Miner date waits, and is dropped only by the existing 3-day window;
  - Walkthrough preparations and Retry taps run after 00:00 PT, oldest Dossier first;
  - mail waits in the ledger and shows in the digest as not handled;
  - a question is refused at once, with nothing queued;
  - the weekly check lists what it didn't reach as *not run*, never as a failure, after running the Miner Fit check first, then Rule cases on each role's primary provider, then fallbacks.
- **The person hears once per spent budget,** through a `#needs-you` card that leads with the 3 costliest runs, says what waits and when it resets, and offers **Allow one more day**. A spent question budget puts the same button in the Question post instead.
- **Money ceilings below the forwarder:**
  - **Prepaid balances** on pay-per-token routes, with auto top-up off.
  - **new-api key quotas.** `ops/upgrade role` prices them with ratios from the same `ops/pins` prices, and each role key starts with 4 weeks of its budgets.

  The person tops up both by hand. The weekly note shows each balance and quota, with a line when less than 2 weeks remain. On a 401 from new-api, the forwarder reads `GET /api/usage/token/` with that key, which still answers once the quota is spent. A spent quota is then reported as spent, not as a dead token.
- **Product Hunt and Gmail have no budget.** Plain code obeys their rate-limit replies.
- **"Budget" is not a glossary term.** On Discord and in the docs a spending budget is always named by its role (*mail budget*, *checks budget*), and the 4k-token budget of [ADR 0002](./0002-rules-are-files-proven-by-their-own-case.md) is always **the Rule budget**.
