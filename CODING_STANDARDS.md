# Coding standards

The judgement calls a review checks a diff against. Each one is a bug a review caught that no check could have:
whatever a check can catch belongs in the typecheck, the tests or `npm run check:docs` instead, not here.

## Every wait has a bound

A wait on a process, socket or event ends by itself: when the awaited thing happens, or after a time limit, whichever
comes first.

**Why it matters:** a wait that only the other side can end hangs the bot when that side never answers. In #42,
stopping sent each Pi run SIGTERM and waited for it to exit. A command that wraps Pi and ignores SIGTERM kept that
wait open, so the bot couldn't shut down. Stopping now signals the run's whole process group and kills it after a
grace time (`ff338bd`).

**In a diff, look for:**

- an `await` on a child's `exit` or `close`, on a socket, or on a `new Promise` that only an event handler resolves,
  with no timer that ends it;
- a timer whose path doesn't free the wait it guards, such as killing one process while another still holds its pipes.

## Outside input is parsed totally

Code that reads outside input, from Product Hunt, Discord, a model, a page or mail, has an answer for every value it
can receive. A bad value degrades that value, to a placeholder, a skipped item or a logged fault, never the whole
batch.

**Why it matters:** outside data holds values nobody planned for, and one of them shouldn't cost every other one. In
#42, turning a Launch's HTML into text called `String.fromCodePoint` on each `&#…;` character code. It throws on a
code past U+10FFFF, so one such code aborted the day's fetch. Any code that names no character now reads as U+FFFD,
as a browser does (`ff338bd`).

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
was then an earlier one or none. The forwarder now stores the request when it reads the last event, before passing
it on (`ff338bd`).

**In a diff, look for:**

- a store write placed after a `res.write`, `res.end`, send or `resolve` that hands the other side what it needs to
  call back, such as a write in a `finally` after a loop that already relayed the last chunk;
- a handler that looks up a record another path writes, with nothing ordering the write first.

## Queued work lives in the store

The lane lives only in memory, so what a queued job must still do is kept in the store, and marked done only once
the job has done it. The job checks its preconditions when it runs, not only when it's queued.

**Why it matters:** a restart drops the whole lane, and a job queued earlier can run first and change what a later
one finds. In #45, a draft of the Miner's Retry marked itself done when the person tapped it, before its job ran. A
catch-up pass already in the lane then judged those Launches as ordinary ones, batched and retried automatically,
where a Retry gets a run of its own and no automatic retry. Now the tap stores only when it was tapped, and the Retry
is marked as run once its run is over (`83d2677`).

**In a diff, look for:**

- work added to the lane or a timer whose only record of what's left to do is the job's closure or arguments;
- a store write that marks work done, run or sent in the code that queues it, rather than in the job once the work
  is done;
- a job that acts on what its caller checked at queue time (a window, a state, a tap) without reading it again when it
  starts.

## Pages don't move

A paged read uses an order the read itself can't change, such as posting time or id, and drops duplicates by id. Any
other order the caller needs is sorted after the last page.

**Why it matters:** a page is an offset into an order. When the order moves between pages, an item that rose is read
twice and one that fell is never read. In #42, a day's Featured Launches were paged by ranking, and votes moved
Launches between pages while the day was read. The day is now paged by posting time, each Launch is kept once by its
Product Hunt Post id, and the ranking is sorted at the end (`ff338bd`).

**In a diff, look for:**

- a cursor or offset loop whose order is a rank, a score, a count or a last-update time;
- pages appended to a list with no check by id;
- a position or rank read from a page, where pages were read at different moments.

## A Chinese side says what its English side says

In each section of a doc pair that a diff changes, the Chinese side changes, drops or adds no meaning. A word that
recurs across the docs in one sense keeps the rendering the other `.zh.md` sides already use for that sense (`门禁`
for an `ops/upgrade` gate, `填表运行` for fill run, `台账` for ledger).

**Why it matters:** `npm run check:docs` checks a pair's shape and that someone recorded it, not what the Chinese side
says, and the person reads the Chinese side. In #83, a spec reviewer found six such faults in the ADRs' Chinese
sides, but only because its prompt asked it to read three of them in full. One: ADR 0009's "checked against the key's
remaining quota before the key is reported dead" became "check, then report it dead".

**In a diff, look for:**

- each changed `.zh.md` section, read against the same section of its English side;
- each recurring word, compared with its rendering for the same sense in the other Chinese sides.

## A new check is tried on everything it judges

A diff that adds or widens a check, a hook or a rule that refuses input shows what it says about each case the repo
already holds: every commit message in the history for a commit-msg hook, every doc for a doc check, every file for a
code check. Each refusal there is either a real fault, which the diff fixes too where it can, or a false positive the
check is narrowed to let through. When telling them apart turns on how another system behaves, such as what makes
GitHub close an issue, the diff tries that system before it narrows the check.

**Why it matters:** a check's tests hold the cases its author thought of, and the repo holds the ones nobody did. In
#90, the first commit-msg hook read a closing keyword that ends one line with an issue reference that opens the next,
even across a blank line. Its tests passed, but it refused 7310714, whose subject ends in "closes" and whose body
opens with `#76's`. A spec reviewer found it only by running the hook over all 50 commit messages. #90 took it for a
false positive without trying GitHub, and read one line at a time, until #91 tried it: GitHub closes across a line
break and a blank line alike, so 7310714 would have closed #76 had #76 still been open. The hook reads across lines
again, and refuses 7310714's message in its tests (#91).

**In a diff, look for:**

- a new or widened hook, check script or enforced rule: run it over the history, docs or code it applies to, and
  read each refusal;
- a pattern wider than the spec asked for (spanning lines, an optional part, a looser boundary), since the cases the
  repo already holds are where it misfires;
- a check narrowed to let a case through because of what another system is said to do: find the trial that showed
  it, or ask for one.
