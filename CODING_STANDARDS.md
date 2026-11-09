# Coding standards

The judgement calls a review checks a diff against. Each one is a bug a review caught that no check could have:
whatever a check can catch belongs in the typecheck, the tests or `npm run check:docs` instead, not here.

Each **Why it matters** tells what happened, in the past tense, and names the commit that settled it, as in
"`ff338bd` made stopping signal the run's whole process group": a later change to that code adds a story of its own
rather than making this one false. A story is checked against the commits it names, with `git log -S` on the test or
line it's about, as well as against the ticket that tells it. #92's ticket said `b03ecbf` kept four prompt tests, where
`ff338bd` had added three of them and `b03ecbf` tightened one, and only a reviewer told to check it found that.

## Every wait has a bound

A wait on a process, socket or event ends by itself: when the awaited thing happens, or after a time limit, whichever
comes first.

**Why it matters:** a wait that only the other side can end hangs the bot when that side never answers. In #42,
stopping sent each Pi run SIGTERM and waited for it to exit. A command that wraps Pi and ignores SIGTERM kept that
wait open, so the bot couldn't shut down. `ff338bd` made stopping signal the run's whole process group and kill it
after a grace time.

**In a diff, look for:**

- an `await` on a child's `exit` or `close`, on a socket, or on a `new Promise` that only an event handler resolves,
  with no timer that ends it;
- a timer whose path doesn't free the wait it guards, such as killing one process while another still holds its pipes.

## A retry that starts a run is bounded in what it spends

Work tried again on a timer, starting a model run each time, stops by itself: after a count of tries kept in the
store, or once a budget checked before each run is spent. A run no provider served spent nothing, so trying it again
needs neither.

**Why it matters:** a run that fails the same way each time spends about the same each time, and a retry every 30
minutes is 48 runs a day. In #53, a Walkthrough preparation whose run failed, or hit its cap without recording a
Walkthrough, was queued again every 30 minutes with no end. The registration budget counts that spend but holds no run
until #69. Neither #53's reviewers nor #99's caught it; the person's question in #99 did. Tried over the bot, the rule
found two more. A Dossier run that failed was run again at each 30-minute pass of its date, for as long as the date
stayed in the 3-date catch-up window. One a Miner Correction asked for was run again every 30 minutes with no end. #99
shipped Walkthroughs off and left them to #69, and `d093b01` gave each Launch's Dossier at most 3 tries that end
without one, counted in the store and tried once a day (#100). In #46, the person settled what this rule doesn't
bound. On 2026-11-06 and 11-07, 38 Dossier runs failed because every provider failed, and each counted as a try, though
a refusal costs nothing. `773bd87` counts no try for a run no provider served, which `PiRunner.run` tells by
`totals.providers`, so a date whose providers all refuse still starts a run at each 30-minute pass, at $0 (ADR 0013).
The person's first answer let off a run that ran out of providers part way too. That run had spent, so this rule kept
it a failed run that counts.

**In a diff, look for:**

- a job that re-arms its timer (`inMinutes(…, retryMinutes, …)`) while work is left, where the work left can be a run
  that failed or hit its cap, with no count of tries in the store and no budget checked before the next run starts;
- a window or a date standing in for that bound: 3 dates of 30-minute passes are 144 runs;
- a failed run recorded only as a problem to retry, where a Correction's sorting run records it as the outcome
  (`unsorted`), and so runs once;
- a run left uncounted because it spent nothing, where a provider served part of it: only a run whose
  `totals.providers` is empty spent nothing.

## Outside input is parsed totally

Code that reads outside input, from Product Hunt, Discord, a model, a page or mail, has an answer for every value it
can receive. A bad value degrades that value, to a placeholder, a skipped item or a logged fault, never the whole
batch.

**Why it matters:** outside data holds values nobody planned for, and one of them shouldn't cost every other one. In
#42, turning a Launch's HTML into text called `String.fromCodePoint` on each `&#…;` character code. It throws on a
code past U+10FFFF, so one such code aborted the day's fetch. `ff338bd` made any code that names no character read
as U+FFFD, as a browser does.

**In a diff, look for:**

- a call that throws on input it doesn't accept (`String.fromCodePoint`, `JSON.parse`, `new URL`,
  `decodeURIComponent`, a schema's parse), applied to outside data in a loop or a batch with no fallback for that one
  value;
- a `try` around the whole batch where each item needs its own.

## Record before relay

Anything a later request depends on is stored before the reply that triggers that request goes out.

**Why it matters:** the other side can act on a reply the moment it arrives, before the code that sent it runs its
next line. In #42, the forwarder stored each model request only after passing on the reply's last event. Pi acts on
that event at once, and its `record_judgment` call files the judgment under the run's latest stored request, which
was then an earlier one or none. `ff338bd` made the forwarder store the request on reading the last event, before
passing it on.

**In a diff, look for:**

- a store write placed after a `res.write`, `res.end`, send or `resolve` that hands the other side what it needs to
  call back, such as a write in a `finally` after a loop that already relayed the last chunk;
- a handler that looks up a record another path writes, with nothing ordering the write first.

## Queued work lives in the store

The lane lives only in memory, so what a queued job must still do is kept in the store, and marked done only once
the job has done it. The job checks its preconditions when it runs, not only when it's queued.

**Why it matters:** a restart drops the whole lane, and a job queued earlier can run first and change what a later one
finds. In #45, a draft of the Miner's Retry marked itself done when the person tapped it, before its job ran. A
catch-up pass already in the lane then judged those Launches as ordinary ones, batched and retried automatically,
where a Retry gets a run of its own and no automatic retry. `83d2677` made the tap store only when it was tapped, and
the Retry count as run once its run was over. A query of the store can mark work done too. In #100, a draft of the
queue of Dossiers to try again was a query for Launches with a failed try and no Product. A try that wrote the
Dossier, but whose post Discord didn't take, left its Launch with a Product and no post: the query no longer matched
it, and nothing would ever post it. The session caught it in its own read of the diff, and `d093b01` landed the queue
matching a Launch whose Product's post isn't up too.

**In a diff, look for:**

- work added to the lane or a timer whose only record of what's left to do is the job's closure or arguments;
- a store write that marks work done, run or sent in the code that queues it, rather than in the job once the work
  is done;
- a job that acts on what its caller checked at queue time (a window, a state, a tap) without reading it again when it
  starts;
- a queue read from the store whose query stops matching an item once its first step leaves a record, such as a
  Product row, while a later step, such as its post, is still undone.

## Pages don't move

A paged read uses an order the read itself can't change, such as posting time or id, and drops duplicates by id. Any
other order the caller needs is sorted after the last page.

**Why it matters:** a page is an offset into an order. When the order moves between pages, an item that rose is read
twice and one that fell is never read. In #42, a day's Featured Launches were paged by ranking, and votes moved
Launches between pages while the day was read. `ff338bd` paged the day by posting time instead, kept each Launch once
by its Product Hunt Post id, and sorted the ranking at the end.

**In a diff, look for:**

- a cursor or offset loop whose order is a rank, a score, a count or a last-update time;
- pages appended to a list with no check by id;
- a position or rank read from a page, where pages were read at different moments.

## What a test asserts on

A test of the bot asserts on what something outside the bot sees, such as the person, Gmail, Product Hunt, Bitwarden,
the browser, git, healthchecks.io or the model provider, or on a line of the bot's log, in glossary terms. It never
inspects internal tables or function calls. It may assert on a model request as the provider receives it, never on how
the bot builds it, and on any log line as the bot writes it to stdout, where `world.logs` takes stdout's place in the
harness. Only `bot/test/store-schema.test.ts` reads the store's tables, because #98 asks it to. A test may compare the
store's files byte for byte to show that nothing wrote to them, as `bot/test/kill.test.ts` does, since that reads
nothing they hold. It may also search them for one Secret's bytes to show that the value isn't there, as
`bot/test/harness/secrets.ts` does, since that says nothing else about what they hold.

**Why it matters:** a rule a review can't read gets argued again on each ticket. In #42, a review flagged the test of
Maker comments under #41's wording ("never inspects internal tables, function calls or prompts"), and the test stayed.
`ff338bd` added three more that read what the fake provider received, and `b03ecbf` tightened one of them. #45's
Standards reviewer had to be told that asserting on log lines and on model requests was established practice: no doc a
review reads said so, and #41, which a review doesn't read, still said the opposite about prompts. In #96, a Standards
reviewer read `kill.test.ts`'s comparison of the store's files as a way round this rule, since it passes
`scripts/bot-test-store.test.ts` only by not naming `node:sqlite`. It shows the ticket's "no store write" and reads no
table, and `9d595f0` landed it. In #54, a criterion asked that a password show nowhere outside `bw`, and only a search of
the store's files could show that. A Standards reviewer read it as breaking this rule as written, and the person
settled that the rule allows it.

**In a diff, look for:**

- a test that opens the live store's SQLite file: `npm test` fails a file under `bot/test/` that names `node:sqlite`
  (`scripts/bot-test-store.test.ts`), so look for a file added to that check's list, a listed test that starts reading
  tables, or a way round it, such as the `sqlite3` command or parsing the file's bytes;
- a test that rebuilds a prompt the way the bot does instead of reading the request the fake provider received;
- a log line added only so a test can read internal state: the sign to narrow this rule to the events `bot/README.md`
  documents, the fallback the person named on #92;
- an assertion on something outside the bot that shows internal state all the same: the sign to close this rule's
  list, the other fallback the person named there.

## A test of a fallback shows it ran

A test of a fallback, a cut or a limit, such as a message shortened to fit Discord or a run retried after its cap,
asserts that its input reached that path, not only that nothing failed. A test that never reaches the path passes the
same with the path taken out.

**Why it matters:** a test that passes for the wrong reason looks the same as one that passes for the right one. In
#48, a test of a long Correction, on a day of long names and reasons, asserted only that Discord refused nothing. It
passed with the code that cuts a corrected line to fit, and passed again with that cut taken out, because the line's
message had room to spare. Only taking the cut out by hand showed it. `f871f7d` landed the test correcting a line in
the day's fullest message, over 3,700 characters, where it fails once the cut is taken out. The test of long names and
reasons that `ee12dc3` landed in #42 already showed its path: it asserts that the bands split into more than 8
messages.

**In a diff, look for:**

- a test whose only assertions are that nothing was refused, failed or went over a limit, with nothing showing its
  input came near the limit or took the fallback;
- a fallback the diff adds, such as a shorter text, a retry or a default, that no test shows running.

## Plain code judges a page that has held still

When plain code reads a page to decide whether to act on it after a session has acted on it, as the page check does
before a press, it reads the page once the page has stopped changing, within a time limit. A read that follows such
a decision, such as the screenshot and fingerprint a failed check leads to, reads the page that decision waited for.

**Why it matters:** a page's script may react to a fill on a timer of its own, as a debounced field does, and a busy
machine runs those timers late. Only a machine slow enough shows the race, so no test can be counted on to catch it.
In #55, a test page changed a custom list's choice 0 ms after it was made. Locally the page check saw the change and
failed, as the test asked. On CI's runner the timer ran about a second late, so the check read the page first and
passed, and the test failed there on two commits in a row. Neither of #55's reviewers raised it. `8ba9f48` made the
page check read until the page has held still for 1.5 s, or for at most 5 s, and moved the test page's change to
500 ms, so that the test needs the wait on any machine.

**In a diff, look for:**

- a read that decides whether to act on a page, such as a check before a press, made right after an action on the
  page with no wait for it to hold still;
- a test that asserts on a page script's reaction to an action, on a timer or a debounce, through a read that
  doesn't wait for it.

## A doc that describes changed behaviour changes with it

When a diff changes what the code does, each sentence of a README or doc that describes the old behaviour changes in
the same diff.

**Why it matters:** the person and later sessions read the docs as true. In #48, Corrections began tagging a withdrawn
Dossier's post *Skipped*, while `bot/README.md` still said the bot "for now applies *no account* alone". The Standards
review didn't flag it, and the Spec reviewer noticed it in passing. `f871f7d` landed both sides of the README saying
the bot applies *Skipped* too.

**In a diff, look for:**

- each tag, config key, command, file, log event or behaviour the diff adds or changes: search the docs (`*.md`
  outside `node_modules`) for it and for what it replaces, and read the sentences that describe it;
- "for now", "only", "alone", "not yet" or "until #<number>" in a doc sentence about what the diff changes;
- an "until" that names no ticket or condition, such as "until their sprint": a later diff can't check it, so the
  sentence names what it waits on, as `bot/README.md` keeps Walkthroughs off "until #56 lets an Approval fill the
  form" (#99).

## A Chinese side says what its English side says

In each section of a doc pair that a diff changes, the Chinese side changes, drops or adds no meaning. A word that
recurs across the docs in one sense keeps the rendering the other `.zh.md` sides already use for that sense:
`npm run check:docs` holds the phrases in its table of renderings (`docs/agents/doc-pairs.md`), and review the rest.

**Why it matters:** `npm run check:docs` checks a pair's shape, that someone recorded it and the table's renderings,
not what the Chinese side says, and the person reads the Chinese side. In #83, a spec reviewer found six such faults
in the ADRs' Chinese sides, but only because its prompt asked it to read three of them in full. One: ADR 0009's
"checked against the key's remaining quota before the key is reported dead" became "check, then report it dead".
`1bfe5c3` landed the ADRs' Chinese sides with all six fixed. In #49, `bot/README.zh.md` rendered "plain code" as
`纯代码`. Only the Standards review caught it, `4e3e5cf` landed that side with `普通代码`, and #97 moved such lookups into
the check.

**In a diff, look for:**

- each changed `.zh.md` section, read against the same section of its English side;
- each recurring word the table of renderings doesn't hold, compared with its rendering for the same sense in the
  other Chinese sides;
- wording an entry's `except` lets through that really uses the phrase in the table's sense, and a second rendering
  beside the table's in one section: the check sees neither.

## A rule a doc states comes with its check

When a diff writes a rule into a doc about what a commit, a file or a test may do, a check that fails on a breach
comes with it, and the doc names the check. A rule whose breach takes judgement to tell, as a translation's fidelity
does, stays with review.

**Why it matters:** a rule only a doc states holds only while each later session reads that doc. In #98,
`bot/README.md` said a schema fixture on `main` never changes, and nothing else did: a commit that changed `SCHEMA`
and edited `bot/test/fixtures/store-schemas/1.sql` with it passed `npm test`, leaving a store at version 1 with no
migration. The Spec reviewer raised it, and `4726d33` landed `.githooks/pre-commit` refusing a commit that changes a
fixture `main` holds. In #83, `33648b1` had turned the doc pairs' written rules into failures of `npm run check:docs`
the same way.

**In a diff, look for:**

- a sentence the diff adds to a doc saying what a commit, file, path or test may or must do ("never changes",
  "always", "only");
- for each one, the test, hook or `check:docs` rule that fails on a breach; with none, whether a breach is a pattern
  a check could find.

## A new check is tried on everything it judges

A diff that adds or widens a check, a hook or a rule that refuses input shows what it says about each case the repo
already holds: every commit message in the history for a commit-msg hook, every doc for a doc check, every file for a
code check. Each refusal there is either a real fault, which the diff fixes too where it can, or a false positive the
check is narrowed to let through. When telling them apart turns on how another system behaves, such as what makes
GitHub close an issue, the diff tries that system before it narrows the check. A new standard in this file is such a
rule: the diff shows what it says about each case it reaches.

**Why it matters:** a check's tests hold the cases its author thought of, and the repo holds the ones nobody did. In
#90, the first commit-msg hook read a closing keyword that ends one line with an issue reference that opens the next,
even across a blank line. Its tests passed, but it refused 7310714, whose subject ends in "closes" and whose body
opens with `#76's`. A spec reviewer found it only by running the hook over all 50 commit messages. #90 took it for a
false positive without trying GitHub, and `4b2a9b3` landed the hook reading one line at a time. #91 then tried GitHub,
which closed an issue across a line break and across a blank line alike, so 7310714 would have closed #76 had #76
still been open. `938e307` made the hook read across lines again, with 7310714's message among those its tests
refuse. In #92, a standard on what a test asserts on was tried on the twelve tests its ticket named. A grep of `bot/test`
found others it reached, such as the tests of healthchecks.io's pings, and the person made its list an open one before
`ad0a5c5` landed it.

**In a diff, look for:**

- a new standard in this file: search the repo for what it reaches, and read each case it would flag;
- a new or widened hook, check script or enforced rule: run it over the history, docs or code it applies to, and
  read each refusal;
- a pattern wider than the spec asked for (spanning lines, an optional part, a looser boundary), since the cases the
  repo already holds are where it misfires;
- a check narrowed to let a case through because of what another system is said to do: find the trial that showed
  it, or ask for one.

## A fake or a check of an outside service is anchored to the real one

A fake that stands in for an outside service, such as GitHub, new-api, Product Hunt or the VM's network, behaves as
the real one was seen to behave, and says where it was seen: a trial on the real service, recorded in the fake's
comment, or a capture of it, as the fake Product Hunt answers only what the live schema accepts. A check of a service
or of the VM asks what the code will ask of it, the way the code asks it, and tries the paths that must get through as
well as those that must be refused.

**Why it matters:** a fake built from what a service is assumed to do passes tests the real service fails, and the
failure shows only at go-live. In #71, the fake GitHub served a push through a local `git receive-pack`, which takes
input before it has sent its refs. GitHub ends such a session with status 1 and no output, so at #85's go-live
`ops/token` refused a deploy key with write access as read-only. `e5e77e9` sent the push once the refs had come, and
the fake now ends a session whose input comes first. #71 also tried `ops/firewall` in a network namespace, which lacks
the REJECT that Oracle's Ubuntu image ends `INPUT` with, and `ops/firewall check` tried only what the browser must not
reach. Nothing tried Pi's way to the forwarder, and every Miner run failed at go-live until `dd25c9f` let it in and the
check tried it. `90fa152` (#78) had anchored the fake Product Hunt the same way, to a capture of the live schema. In
#54, `ops/token` checked the Bitwarden API key with a request of its own to Bitwarden's token endpoint, where the bot
logs in through `bw`. It asked what the bot asks, whether the key logs in, a case this section's words didn't name yet,
and neither reviewer raised it. The test's fake endpoint took the request. The real one answered 400 to every good key,
for lacking a header `bw` sends. `5a13f68` checked the key through `bw login`. In #46, the fake model wrote a reply's
error and the usage after it in one write, and the forwarder, reading chunks as they came, stopped at the error. The
trial had shown new-api sending usage after the error, so a real reply's spend would have gone uncounted with the test
green. The Spec reviewer split the write by 100 ms and got `forwarder.usage-missing`, and Codex found it too, where the
Standards reviewer didn't. `773bd87` reads a failed reply on for up to 5 seconds, and the fake sends the usage 50 ms
later.

**In a diff, look for:**

- a fake, or a new behaviour of one, with no trial on the real service and no capture of it behind it: ask where the
  behaviour was seen, and for the comment that says so;
- a fake that hands the request to a local stand-in, such as git, a stub server or a network namespace, which behaves
  unlike the real service in the case the test is about;
- a fake that writes at once what the real service sends apart, where the code reads chunks as they come, such as a
  stream's error and the usage after it;
- a check of a token or a service that asks it something other than what the code will, such as how many models a
  key lists where the bot asks for one by name;
- a check that asks through a client of its own where the code goes through the service's, such as a request to a token
  endpoint where the bot runs `bw`;
- a check that only tries what must be refused, such as a firewall's blocked addresses, beside a path that must get
  through.
