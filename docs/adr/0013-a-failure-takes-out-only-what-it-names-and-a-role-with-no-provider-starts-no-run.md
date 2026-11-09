# A failure takes out only what it names, and a role with no provider starts no run

English | [中文](0013-a-failure-takes-out-only-what-it-names-and-a-role-with-no-provider-starts-no-run.zh.md)

[ADR 0011](./0011-the-forwarder-picks-each-requests-provider-and-holds-the-spending-budgets.md) has the forwarder skip a provider that is cooling down, out of balance or failing, and send each request in the role's order. It doesn't say how much one failure takes out of use, how a provider further down the order is ever tried again, or what a role with no provider left does to the work waiting on it. All three mattered on 2026-11-06 and 2026-11-07, when `registration@openrouter` had no channel on new-api: 152 chat requests answered 503 while the Miner's name beside it worked, and 38 Dossier runs failed, each spending a try. Seven Dossiers stopped at their limit, and the person gave them one more try with a one-time edit of the live store. So a failure takes out only what it names, a provider due to be tried again is asked ahead of the order, and a role with no provider left starts no run. Decided in [Fail over between a role's providers](https://github.com/ultrasadness/lab1/issues/46). This narrows ADR 0011, and changes the third answer on [Bound the runs of a Dossier that can't be written](https://github.com/ultrasadness/lab1/issues/100).

## Considered Options

- **Any failure takes out the whole provider:** one `#status` line per provider, as ADR 0011 has it, but a name with no channel would stop every role on that provider, 30 minutes at a time.
- **Strictly the role's order:** no request goes out of order, but a provider further down is asked only when every one above it is out, so a top-up goes unnoticed and its card stays up.
- **A probe of a provider that is due:** a request of its own, where the next real request costs nothing extra. The daily probe is the work of [Keep running through outages and dead tokens](https://github.com/ultrasadness/lab1/issues/70).
- **Three failures in a row before a name drops out:** kinder to a one-off 5xx, which on a role with one provider costs a run. No upstream 5xx showed in the 10 days to 2026-11-09, so this stays the fallback.
- **Runs that start and fail with no provider left, and count:** what #100 settled, since the bot couldn't tell such a run from a Dossier's own failure. The forwarder now can, and counting cost that hand edit.
- **A dead role key left to #70:** runs would go on failing and spending tries until it is built.

## Consequences

- **What a failure takes out of use:**
  - A 429 or a 402: the whole provider, for every role that lists it.
  - Any other failure: only that `role@provider` name, so a provider really down gets one `#status` line per role, where ADR 0011 has one per provider. That includes a 401 whose `GET /api/usage/token/` shows quota left, which is the provider refusing its own key.
  - A 401 whose `GET /api/usage/token/` shows no quota left, a 403 `pre_consume_token_quota_failed`, or a key new-api refuses there too: all of that role's providers, which share its key.
  - A 403 `insufficient_user_quota`: every role, since one new-api user holds every key.
  - One such answer is enough.
- **The order:** a provider whose time to be tried again has come is asked first, ahead of the role's order. That is at most one request per 30 minutes out of order. A refusal costs nothing, and once it serves the order is as configured. A day's summary names its providers when that request judges Launches.
- **A reset time:** through new-api only a 429's `error.metadata` survives, which carries OpenRouter's `X-RateLimit-Reset`. It drops CPA's `Retry-After` and `reset_seconds` (the trial on #46), so ChatGPT Plus is tried again every 30 minutes, and its line says when it next is, not until when it is out.
- **A role with no provider left starts no run,** and a run no provider served counts the same, since neither spent anything:
  - a Miner date waits, and its late line names why;
  - a Dossier spends no try: its list still goes out naming it and why, and each 30-minute pass tries again;
  - a Correction or a Walkthrough preparation waits for the next 30-minute try.
- **A run a provider served before its role ran out** is a failed run and counts, so a retry can't spend without end.
- **The person hears:** a spent gateway quota gets the `#needs-you` card ADR 0011 gives an empty balance that leaves a role with no provider. A dead key gets a `#status` line naming its `ops/token` command, and #70 adds its notice.
