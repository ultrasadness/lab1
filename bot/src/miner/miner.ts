// The Miner: turns a Pacific date's Featured Launches into a judged day and posts the day's list. Each step is kept
// in the store as it happens, so running a date again picks up where it stopped: Launches already fetched aren't
// fetched again, Launches already judged aren't judged again, and a post already started isn't started again.
// A judging run that hits a cap is retried once on its own (#26). If the retry is capped too, its Launches wait for
// the person's Retry, on a notice in the day's post, which opens early for it.
// It catches up on the latest 3 dates, oldest first, and drops older ones with a #status line. A date that can't
// finish is tried again by the caller's 30-minute retry, and gets one #status line if its list isn't out by 06:00 PT.
// Launches tapped for Retry are judged at the date's next pass, in a run of their own, with no automatic retry.
// A run starts only while the date's spend is under its Miner budget (ADR 0011). A run that starts under it finishes,
// and once the Miner budget is spent the date's remaining runs wait, until it is raised and the bot restarts.
// Each run fast-forwards the Personal database first and reads the Interest scope there. Once the date is judged, its
// `days/` file is queued in the store, then every Launch at or above the line gets its Dossier, and the day's post,
// which links each Dossier's Product post, goes out once each one is posted or couldn't be written, naming those not
// written (#100); the files are committed after. Each pass also tries again every Dossier not written, once per start
// of the Miner, and shows in its date's posted list how each try went.
import type { Clock } from '../clock.ts';
import type { Config } from '../config.ts';
import type { Dossiers, DossierLaunchInput, Written } from '../dossier/dossiers.ts';
import { asEdit, type MessagePayload } from '../discord/components.ts';
import { refused, type DiscordRest } from '../discord/rest.ts';
import type { RecordResult } from '../forwarder.ts';
import { errorText, type Log } from '../log.ts';
import type { PersonalDatabase } from '../personal-database.ts';
import { addDays, dayLabel, nextDate, pacificDate, pacificDay, pacificInstant, pacificTime } from '../pacific.ts';
import type { PiRunner, RunResult } from '../pi-runs.ts';
import type { ProductHunt } from '../product-hunt.ts';
import type { Status } from '../status.ts';
import type { CappedRun, Launch, Store } from '../store.ts';
import { catchUpWindow, droppedLine, lateLine, type BudgetHold } from './catch-up.ts';
import { drawDayLine, outcomeOf } from './day-line.ts';
import { renderDroppedPost, renderRetryNotice, renderWaitingPost } from './day-post.ts';
import { dayFileOf, dayLaunches, dayPostOf, reLaunchOfRegistered, rewriteDayPost } from './day-view.ts';
import { judgingPrompt, readJudgment } from './judging.ts';

export class Miner {
  #config: Config;
  #store: Store;
  #productHunt: ProductHunt;
  #pi: PiRunner;
  #discord: DiscordRest;
  #status: Status;
  #personalDatabase: PersonalDatabase;
  #dossiers: Dossiers;
  #clock: Clock;
  #log: Log;
  /** Dates whose latest pass ran into a problem. */
  #troubled = new Set<string>();

  constructor(options: {
    config: Config;
    store: Store;
    productHunt: ProductHunt;
    pi: PiRunner;
    discord: DiscordRest;
    status: Status;
    personalDatabase: PersonalDatabase;
    dossiers: Dossiers;
    clock: Clock;
    log: Log;
  }) {
    this.#config = options.config;
    this.#store = options.store;
    this.#productHunt = options.productHunt;
    this.#pi = options.pi;
    this.#discord = options.discord;
    this.#status = options.status;
    this.#personalDatabase = options.personalDatabase;
    this.#dossiers = options.dossiers;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  /** Whether the date's list is out on Discord. */
  posted(date: string): boolean {
    return Boolean(this.#store.dayPost(date).postedAt);
  }

  /**
   * Takes on each date whose start has passed since the last one taken on, drops dates the window has moved past
   * (naming them in #status), then works on each date still in the window, oldest first. Returns whether one is
   * still unfinished, so the caller tries again later.
   */
  async catchUp(): Promise<boolean> {
    const now = this.#clock.now();
    const at = now.toISOString();
    const window = catchUpWindow(now, this.#config.miner);
    const [oldest, latest] = [window[0]!, window.at(-1)!];
    // A new store has missed nothing: its first date is the first whose start it sees.
    const cursor = this.#store.minerCursor() ?? addDays(pacificDate(now), -1);
    for (let date = nextDate(cursor); date <= latest; date = nextDate(date)) {
      this.#store.addMinerDay(date, at, date < oldest ? at : null);
    }
    this.#store.saveMinerCursor(latest > cursor ? latest : cursor);
    for (const day of this.#store.minerDays()) {
      if (day.date < oldest && !day.droppedAt && !this.posted(day.date)) this.#store.saveMinerDayDropped(day.date, at);
    }
    await this.#noteDropped(at);

    for (const date of this.#unfinished(window)) {
      this.#troubled.delete(date);
      try {
        await this.mine(date);
      } catch (error) {
        this.#problem(date, `the Miner hit an error (${errorText(error)})`);
      }
      // A pass that ran into nothing leaves no reason standing from an earlier one.
      if (!this.#troubled.has(date)) this.#store.saveMinerDayProblem(date, null);
    }
    const dossiersLeft = await this.#retryDossiers(pacificInstant(latest, this.#config.miner.startsAt));
    const unshownLeft = await this.#showRetriedDossiers();
    await this.noteLate();
    // A date held by its Miner budget can go on only once it is raised, which takes a restart.
    return dossiersLeft || unshownLeft || this.#unfinished(window).some((date) => !this.#heldByBudget(date));
  }

  /**
   * The queue's pass: tries again each Dossier kept for a later try and not tried since the Miner's latest start,
   * highest Fit first, then oldest Launch. One whose Launch a Correction has put below its line, or whose date was
   * dropped, is left. Returns whether one ran into a problem other than its Dossier not being written.
   */
  async #retryDossiers(since: Date): Promise<boolean> {
    const queued = new Set(this.#dossiers.queued(since));
    const dates = [...new Set([...queued].map((postId) => this.#store.launch(postId)!.date))];
    const launches = dates
      .filter((date) => !this.#store.minerDay(date)?.droppedAt)
      .flatMap((date) => this.#dossierLaunches(date, this.#store.launchesFor(date)!).filter((l) => queued.has(l.launch.postId)))
      .sort((a, b) => b.fit - a.fit || a.date.localeCompare(b.date) || a.launch.rank - b.launch.rank);
    if (launches.length === 0) return false;
    const postIds = launches.map((l) => l.launch.postId);
    this.#log('dossier.queue-pass', { postIds });
    // Marked before they are tried, so their lists show how the tries went even after a stop or a failed edit.
    this.#store.saveDossiersUnshown(postIds, true);
    let written: Written;
    try {
      written = await this.#dossiers.writeFor(launches, { queued: true });
    } finally {
      await this.#personalDatabase.sync();
    }
    if (written === 'stopped') return false;
    if (written !== 'done') this.#log('dossier.queue-problem', { problem: written.problem });
    return written !== 'done';
  }

  /**
   * Shows in each date's posted list how the queue's tries at its Dossiers went: its summary, and each message holding
   * one of their lines. A list not posted yet shows them once it is. Returns whether one is left to show.
   */
  async #showRetriedDossiers(): Promise<boolean> {
    let left = false;
    for (const { date, postIds } of this.#store.unshownDossiers()) {
      try {
        if (this.posted(date)) {
          await rewriteDayPost(this.#store, this.#discord, date, new Set(postIds));
          this.#log('miner.post-reshown', { date, postIds });
        }
        this.#store.saveDossiersUnshown(postIds, false);
      } catch (error) {
        left = true;
        this.#log('miner.post-reshow-failed', { date, error: errorText(error) });
      }
    }
    return left;
  }


  /** Dates in the window, taken on and not yet posted. */
  #unfinished(window: string[]): string[] {
    return window.filter((date) => {
      const day = this.#store.minerDay(date);
      return day && !day.droppedAt && !this.posted(date);
    });
  }

  /** Names the dates dropped since the last line in one #status line, and closes any post they opened early. */
  async #noteDropped(at: string): Promise<void> {
    const days = this.#store.minerDays().filter((d) => d.droppedAt);
    const dropped = days.filter((d) => !d.dropNotedAt).map((d) => d.date);
    if (dropped.length > 0) {
      this.#log('miner.dropped', { dates: dropped });
      // Marked before it is said; an uncertain send counts as said (ADR 0007).
      this.#store.saveMinerDaysDropNoted(dropped, at);
      try {
        await this.#status.say(droppedLine(dropped, this.#config.miner.catchUpDates));
      } catch (error) {
        if (refused(error)) this.#store.saveMinerDaysDropNoted(dropped, null);
        this.#log('miner.status-failed', { error: errorText(error) });
      }
    }
    for (const day of days) {
      try {
        await this.#closeDropped(day.date, new Date(day.droppedAt!));
      } catch (error) {
        this.#log('miner.post-close-failed', { date: day.date, error: errorText(error) });
      }
    }
  }

  /** Says once in #status, for each date past its deadline without its list, that it's late and why. */
  async noteLate(): Promise<void> {
    const now = this.#clock.now();
    const { lateAt, retryMinutes } = this.#config.miner;
    for (const date of this.#unfinished(catchUpWindow(now, this.#config.miner))) {
      const day = this.#store.minerDay(date)!;
      if (day.lateNotedAt || now < pacificInstant(date, lateAt)) continue;
      // Marked before it is said: the deadline's timer and a catch-up pass may both get here. An uncertain send
      // counts as said (ADR 0007).
      this.#store.saveMinerDayLateNoted(date, now.toISOString());
      const retry = this.#store.minerRetries(date).filter((r) => !r.tappedAt).at(-1);
      const line = lateLine({
        date,
        heldByBudget: this.#heldByBudget(date),
        waiting: retry && { retry, threadId: this.#store.dayPost(date).threadId },
        problem: day.problem,
        retryMinutes,
        catchUp: this.#config.miner,
      });
      try {
        await this.#status.say(line);
        this.#log('miner.late', { date, line });
      } catch (error) {
        if (refused(error)) this.#store.saveMinerDayLateNoted(date, null);
        this.#log('miner.status-failed', { date, error: errorText(error) });
      }
    }
  }

  /** What the date has spent, and its Miner budget, once the spend has reached it. */
  #budgetSpent(date: string): { spent: number; budget: number } | undefined {
    const spent = this.#store.spentOn('miner', date);
    const budget = this.#config.budgets.miner;
    return spent >= budget ? { spent, budget } : undefined;
  }

  /** How the date's Miner budget holds it up, if it does: it is spent, and Launches still wait to be judged. */
  #heldByBudget(date: string): BudgetHold | undefined {
    const spent = this.#budgetSpent(date);
    const launches = this.#store.launchesFor(date) ?? [];
    const waiting = launches.filter((l) => !this.#store.hasJudgment(l.postId)).length;
    return spent && waiting > 0 ? { ...spent, waiting, featured: launches.length } : undefined;
  }

  #problem(date: string, problem: string): void {
    this.#troubled.add(date);
    this.#store.saveMinerDayProblem(date, problem);
    this.#log('miner.date-problem', { date, problem });
  }

  async mine(date: string): Promise<void> {
    if (this.#store.minerDay(date)?.droppedAt) return;
    const launches = await this.#launches(date);
    if (!launches) return;
    if (!(await this.#judge(date, launches))) return;

    const judgments = this.#store.judgmentsFor(date);
    const missing = launches.filter((l) => !judgments.some((j) => j.postId === l.postId));
    if (missing.length > 0) {
      this.#log('miner.date-unfinished', { date, featured: launches.length, withoutJudgment: missing.map((l) => l.postId) });
      if (this.#store.minerRetries(date).length > 0) await this.#openEarly(date, launches);
      return;
    }

    if (!this.#store.dayLine(date)) {
      const judged = new Map(judgments.map((j) => [j.postId, j]));
      const line = drawDayLine(
        launches.map((l) => ({ ...judged.get(l.postId)!, reLaunchOfRegistered: reLaunchOfRegistered(l) })),
        launches.length,
        this.#config.miner.lineFloor,
      );
      this.#store.saveDayLine({ date, ...line, drawnAt: this.#clock.now().toISOString() });
      this.#log('miner.line-drawn', { date, ...line });
    }
    // Queued before the post goes out and written after it, so the post never waits on git and nothing is lost.
    this.#personalDatabase.queue(dayFileOf(this.#store, date));
    try {
      // The day's post links each Dossier's Product post, so it waits until each one is posted or kept for a later try.
      const written = await this.#dossiers.writeFor(this.#dossierLaunches(date, launches));
      if (written === 'stopped') return;
      if (written !== 'done') return this.#problem(date, written.problem);
      await this.#post(date);
    } finally {
      await this.#personalDatabase.sync();
    }
  }

  /** The date's Launches at or above its line, as the Dossiers band lists them: by Fit, then Product Hunt rank. */
  #dossierLaunches(date: string, launches: Launch[]): DossierLaunchInput[] {
    const line = this.#store.dayLine(date)!.line;
    const judged = new Map(dayLaunches(this.#store, date).map((l) => [l.postId, l]));
    return launches
      .filter((l) => outcomeOf(judged.get(l.postId)!, line) === 'dossier')
      .sort((a, b) => judged.get(b.postId)!.fit - judged.get(a.postId)!.fit || a.rank - b.rank)
      .map((launch) => ({ launch, date, fit: judged.get(launch.postId)!.fit, featuredCount: launches.length }));
  }

  /** The date's fixed set of Featured Launches, or undefined while Product Hunt shows none for it. */
  async #launches(date: string): Promise<Launch[] | undefined> {
    const known = this.#store.launchesFor(date);
    if (known) return known;
    let launches: Launch[];
    try {
      launches = await this.#productHunt.featuredLaunches(date);
    } catch (error) {
      this.#problem(date, `Product Hunt didn't answer (${errorText(error)})`);
      return undefined;
    }
    // Product Hunt features Launches every day, so an empty answer is a fault, not the date's set: keep nothing
    // and read the date again next time.
    if (launches.length === 0) {
      this.#log('miner.nothing-featured', { date });
      this.#problem(date, 'Product Hunt shows no Featured Launches for it');
      return undefined;
    }
    this.#store.saveLaunches(date, launches, this.#clock.now().toISOString());
    this.#log('miner.fetched', { date, featured: launches.length });
    return launches;
  }

  /**
   * The person tapped Retry on a notice. The first tap rewrites the notice, and the date's next pass starts a fresh
   * run of the Launches still without a judgment, under the same caps. A later tap is refused, and so is a tap once
   * the window has moved past the date.
   */
  tapRetry(id: number): { update: MessagePayload; work: () => Promise<void> } | { refused: string } {
    const retry = this.#store.minerRetry(id);
    if (!retry) return { refused: 'That Retry is no longer on record.' };
    const { catchUpDates } = this.#config.miner;
    if (this.#store.minerDay(retry.date)?.droppedAt || retry.date < catchUpWindow(this.#clock.now(), this.#config.miner)[0]!) {
      return { refused: `${dayLabel(retry.date)} left the ${catchUpDates}-day catch-up and was dropped, so there's nothing to retry.` };
    }
    const at = this.#clock.now().toISOString();
    if (!this.#store.saveMinerRetryTapped(id, at)) return { refused: `Already retried at ${pacificTime(new Date(retry.tappedAt!))} PT.` };
    this.#log('miner.retry-tapped', { date: retry.date, retry: id });
    return { update: asEdit(renderRetryNotice({ ...retry, tappedAt: at })), work: () => this.mine(retry.date) };
  }

  /**
   * Judges the Launches without a judgment, in Product Hunt order, a few per run. Launches the person tapped Retry
   * for go first, each Retry in one run; Launches still waiting on a Retry wait. Once the date's Miner budget is
   * spent, the runs left wait. Returns false if the Assistant stopped the work.
   */
  async #judge(date: string, launches: Launch[]): Promise<boolean> {
    const unjudged = (ls: Launch[]) => ls.filter((l) => !this.#store.hasJudgment(l.postId));
    const retries = this.#store.minerRetries(date);
    for (const retry of retries.filter((r) => r.tappedAt && !r.ranAt)) {
      const left = unjudged(launches.filter((l) => retry.postIds.includes(l.postId)));
      if (left.length > 0) {
        // A run the person started has no automatic retry: if it is capped too, they are asked again.
        const outcome = await this.#lastTry(date, left, [], true);
        if (outcome === 'stopped') return false;
        // The tap still waits on its run.
        if (outcome === 'held') return true;
      }
      this.#store.saveMinerRetryRan(retry.id, this.#clock.now().toISOString());
    }

    const waiting = new Set(retries.flatMap((r) => (r.ranAt ? [] : r.postIds)));
    const missing = unjudged(launches).filter((l) => !waiting.has(l.postId));
    const perRun = this.#config.miner.launchesPerRun;
    for (let i = 0; i < missing.length; i += perRun) {
      const batch = missing.slice(i, i + perRun);
      const first = await this.#run(date, batch);
      if (first === 'held') return true;
      if (first.outcome === 'stopped') return false;
      // The Day's line needs every Fit, so a capped run gets one fresh run of its own, under the same caps.
      const left = unjudged(batch);
      if (first.outcome !== 'capped' || left.length === 0) continue;
      const earlier = [{ launches: batch.length, cap: first.cap! }];
      const last = await this.#lastTry(date, left, earlier, false);
      if (last === 'stopped') return false;
      if (last === 'held') return true;
    }
    return true;
  }

  /** Runs these Launches once more. If that run is capped too, the ones still unjudged wait for the person's Retry. */
  async #lastTry(date: string, launches: Launch[], earlier: CappedRun[], afterRetry: boolean): Promise<RunResult['outcome'] | 'held'> {
    const result = await this.#run(date, launches);
    if (result === 'held') return result;
    const still = launches.filter((l) => !this.#store.hasJudgment(l.postId)).map((l) => l.postId);
    if (result.outcome === 'capped' && still.length > 0) {
      const cappedRuns = [...earlier, { launches: launches.length, cap: result.cap! }];
      const id = this.#store.saveMinerRetry({ date, postIds: still, cappedRuns, afterRetry, createdAt: this.#clock.now().toISOString() });
      this.#log('miner.waiting-on-retry', { date, retry: id, postIds: still, cappedRuns, afterRetry });
    }
    return result.outcome;
  }

  /** Runs these Launches, unless the date's spend has reached its Miner budget: then the run waits. */
  async #run(date: string, batch: Launch[]): Promise<RunResult | 'held'> {
    const spent = this.#budgetSpent(date);
    if (spent) {
      this.#log('miner.run-held', { date, postIds: batch.map((l) => l.postId), ...spent });
      return 'held';
    }
    const expected = new Set(batch.map((l) => l.postId));
    // Each run reads the Interest scope as GitHub has it, so an edit the person made there counts from the next run.
    await this.#personalDatabase.sync();
    const interestScope = this.#personalDatabase.read('profile/interest-scope.md');
    const result = await this.#pi.run({
      kind: 'miner-judging',
      role: 'miner',
      item: date,
      prompt: judgingPrompt(interestScope, batch),
      onRecord: (record, runId) => this.#keepJudgment(date, expected, record, runId),
    });
    if (result.outcome !== 'settled') {
      this.#log('miner.run-failed', { date, runId: result.runId, outcome: result.outcome, cap: result.cap, error: result.error });
    }
    if (result.outcome === 'failed') this.#problem(date, `its judging runs are failing (${result.error ?? 'no reason given'})`);
    return result;
  }

  #keepJudgment(date: string, expected: ReadonlySet<string>, record: unknown, runId: string): RecordResult {
    const read = readJudgment(record, expected);
    if (!read.ok) return read;
    const j = read.judgment;
    if (this.#store.hasJudgment(j.postId)) return { ok: false, error: `Post id ${j.postId} already has a judgment; the first one stands.` };
    // The forwarder records each model reply before it ends, so the reply holding this tool call is the latest.
    const request = this.#store.lastModelRequest(runId);
    if (!request) return { ok: false, error: 'No model request of this run is on record.' };
    const { id: requestId, provider, model, tokens } = request;
    this.#store.saveJudgment({ ...j, date, runId, role: 'miner', provider, model, requestId, judgedAt: this.#clock.now().toISOString() });
    this.#log('miner.judged', {
      date,
      postId: j.postId,
      fit: j.fit,
      notAProduct: j.notAProduct,
      runId,
      role: 'miner',
      provider,
      model,
      // The exact tokens of the request whose reply held the judgment, which may hold other judgments too.
      requestId,
      requestTokens: tokens,
    });
    return { ok: true, message: `Recorded the judgment of Post id ${j.postId}.` };
  }

  /** Opens the day's post before its list, with a notice and Retry for each capped run. */
  async #openEarly(date: string, launches: Launch[]): Promise<void> {
    const waiting = renderWaitingPost({ date, judged: this.#store.judgmentsFor(date).length, featured: launches.length });
    const { threadId, created } = await this.#ensurePost(date, waiting.title, waiting.summary);
    const notices = this.#notices(date);
    const sentBefore = this.#store.dayPost(date).messageIds.length;
    await this.#sendInOrder(date, threadId, notices);
    // A new notice brings the waiting summary's count up to date. Sending it unarchived the post.
    if (!created && this.#store.dayPost(date).messageIds.length > sentBefore) {
      await this.#discord.editMessage(threadId, threadId, asEdit(waiting.summary));
    }
  }

  #notices(date: string, dropped = false): MessagePayload[] {
    return this.#store.minerRetries(date).map((retry) => renderRetryNotice(retry, dropped));
  }

  /** A dropped date's post that opened early says it was dropped, and its Retry buttons go off. */
  async #closeDropped(date: string, at: Date): Promise<void> {
    const post = this.#store.dayPost(date);
    const closed = renderDroppedPost({ date, at, catchUpDates: this.#config.miner.catchUpDates });
    if (!post.threadId || post.postedAt || post.title === closed.title) return;
    // An archived post can't be edited, so the rename unarchives it too.
    await this.#discord.editThread(post.threadId, { name: closed.title, archived: false });
    await this.#discord.editMessage(post.threadId, post.threadId, asEdit(closed.summary));
    for (const [i, notice] of this.#notices(date, true).entries()) {
      const messageId = post.messageIds[i + 1];
      if (messageId) await this.#discord.editMessage(post.threadId, messageId, asEdit(notice));
    }
    this.#store.saveDayPostTitle(date, closed.title);
    this.#log('miner.post-closed', { date, threadId: post.threadId });
  }

  /**
   * Posts the day's list once. Each part is marked before it is sent; a part marked but not known to have gone out
   * is looked for on Discord first, so a stop between Discord taking it and the store hearing back sends nothing twice.
   * A post that opened early takes the day's title and summary in place, and its bands follow its notices.
   */
  async #post(date: string): Promise<void> {
    if (this.posted(date)) return;
    const rendered = dayPostOf(this.#store, date);
    const [summary, ...rest] = rendered.messages;

    const { threadId } = await this.#ensurePost(date, rendered.title, summary!);
    if (this.#store.dayPost(date).title !== rendered.title) {
      // An archived post can't be edited, so the rename unarchives it too.
      await this.#discord.editThread(threadId, { name: rendered.title, archived: false });
      await this.#discord.editMessage(threadId, threadId, asEdit(summary!));
      this.#store.saveDayPostTitle(date, rendered.title);
      this.#log('miner.post-rewritten', { date, threadId, title: rendered.title });
    }
    await this.#sendInOrder(date, threadId, rest);
    this.#store.saveDayPosted(date, this.#clock.now().toISOString());
    this.#log('miner.posted', {
      date,
      threadId,
      title: rendered.title,
      messages: rendered.messages.length,
      spent: this.#store.spentOn('miner', date),
    });
  }

  /** The date's post, created under this title and first message unless it exists already. */
  async #ensurePost(date: string, title: string, first: MessagePayload): Promise<{ threadId: string; created: boolean }> {
    const forumId = this.#config.discord.minerDaysForumId;
    let post = this.#store.dayPost(date);
    if (!post.threadId && post.postIntended) {
      // The date's post can't have been archived before the date began.
      const found = await this.#discord.findForumPost(forumId, post.title ?? title, pacificDay(date).start);
      if (found) {
        this.#log('miner.post-read-back', { date, threadId: found });
        this.#store.saveDayPostThread(date, found);
      }
    }
    post = this.#store.dayPost(date);
    if (post.threadId) return { threadId: post.threadId, created: false };
    this.#store.saveDayPostCreating(date, title);
    const { threadId } = await this.#discord.createForumPost(forumId, title, first);
    this.#store.saveDayPostThread(date, threadId);
    return { threadId, created: true };
  }

  /** Sends the messages that follow the post's first, in order, each once. */
  async #sendInOrder(date: string, threadId: string, messages: MessagePayload[]): Promise<void> {
    let post = this.#store.dayPost(date);
    if (post.messagesIntended > post.messageIds.length) {
      const sent = await this.#discord.ownMessages(threadId);
      for (const [i, messageId] of sent.filter((id) => id !== threadId).entries()) {
        if (!post.messageIds[i + 1]) this.#store.saveDayPostMessage(date, i + 1, messageId);
      }
      post = this.#store.dayPost(date);
    }
    for (const [i, message] of messages.entries()) {
      if (post.messageIds[i + 1]) continue;
      this.#store.saveDayPostIntended(date, i + 1);
      const { messageId } = await this.#discord.sendMessage(threadId, message);
      this.#store.saveDayPostMessage(date, i + 1, messageId);
    }
  }
}
