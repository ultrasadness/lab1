// The Miner: turns a Pacific date's Featured Launches into a judged day and posts the day's list. Each step is kept
// in the store as it happens, so running a date again picks up where it stopped: Launches already fetched aren't
// fetched again, Launches already judged aren't judged again, and a post already started isn't started again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from '../clock.ts';
import type { Config } from '../config.ts';
import type { DiscordRest } from '../discord/rest.ts';
import type { RecordResult } from '../forwarder.ts';
import type { Log } from '../log.ts';
import { pacificDay } from '../pacific.ts';
import type { PiRunner } from '../pi-runs.ts';
import type { ProductHunt } from '../product-hunt.ts';
import type { Launch, Store } from '../store.ts';
import { drawDayLine } from './day-line.ts';
import { renderDayPost } from './day-post.ts';
import { judgingPrompt, readJudgment } from './judging.ts';

// No Product has a Registration yet, so no Launch is a re-Launch of a registered Product; they arrive with #66.
const reLaunchOfRegistered = (_launch: Launch) => false;

export class Miner {
  #config: Config;
  #store: Store;
  #productHunt: ProductHunt;
  #pi: PiRunner;
  #discord: DiscordRest;
  #clock: Clock;
  #log: Log;

  constructor(options: { config: Config; store: Store; productHunt: ProductHunt; pi: PiRunner; discord: DiscordRest; clock: Clock; log: Log }) {
    this.#config = options.config;
    this.#store = options.store;
    this.#productHunt = options.productHunt;
    this.#pi = options.pi;
    this.#discord = options.discord;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  /** Whether the date's list is out on Discord. */
  posted(date: string): boolean {
    return Boolean(this.#store.dayPost(date).postedAt);
  }

  async mine(date: string): Promise<void> {
    const launches = await this.#launches(date);
    if (!launches) return;
    await this.#judge(date, launches);

    const judgments = this.#store.judgmentsFor(date);
    const missing = launches.filter((l) => !judgments.some((j) => j.postId === l.postId));
    if (missing.length > 0) {
      this.#log('miner.date-unfinished', { date, featured: launches.length, withoutJudgment: missing.map((l) => l.postId) });
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
    await this.#post(date, launches);
  }

  /** The date's fixed set of Featured Launches, or undefined while Product Hunt shows none for it. */
  async #launches(date: string): Promise<Launch[] | undefined> {
    const known = this.#store.launchesFor(date);
    if (known) return known;
    const launches = await this.#productHunt.featuredLaunches(date);
    // Product Hunt features Launches every day, so an empty answer is a fault, not the date's set: keep nothing
    // and read the date again next time.
    if (launches.length === 0) {
      this.#log('miner.nothing-featured', { date });
      return undefined;
    }
    this.#store.saveLaunches(date, launches, this.#clock.now().toISOString());
    this.#log('miner.fetched', { date, featured: launches.length });
    return launches;
  }

  /** Judges the Launches without a judgment, in Product Hunt order, a few per run. */
  async #judge(date: string, launches: Launch[]): Promise<void> {
    const missing = launches.filter((l) => !this.#store.hasJudgment(l.postId));
    if (missing.length === 0) return;
    const interestScope = readFileSync(join(this.#config.personalDatabaseDir, 'profile', 'interest-scope.md'), 'utf8');
    const perRun = this.#config.miner.launchesPerRun;
    for (let i = 0; i < missing.length; i += perRun) {
      const batch = missing.slice(i, i + perRun);
      const expected = new Set(batch.map((l) => l.postId));
      const result = await this.#pi.run({
        kind: 'miner-judging',
        role: 'miner',
        item: date,
        prompt: judgingPrompt(interestScope, batch),
        wallClockMs: this.#config.miner.runWallClockMinutes * 60_000,
        onRecord: (record, runId) => this.#keepJudgment(date, expected, record, runId),
      });
      if (result.outcome !== 'settled') this.#log('miner.run-failed', { date, runId: result.runId, outcome: result.outcome, error: result.error });
    }
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

  /**
   * Posts the day's list once. Each part is marked before it is sent; a part marked but not known to have gone out
   * is looked for on Discord first, so a stop between Discord taking it and the store hearing back sends nothing twice.
   */
  async #post(date: string, launches: Launch[]): Promise<void> {
    if (this.posted(date)) return;
    const line = this.#store.dayLine(date)!;
    const judgments = new Map(this.#store.judgmentsFor(date).map((j) => [j.postId, j]));
    const rendered = renderDayPost({
      date,
      line,
      floor: this.#config.miner.lineFloor,
      launches: launches.map((l) => {
        const j = judgments.get(l.postId)!;
        return {
          postId: l.postId,
          rank: l.rank,
          name: l.name,
          slug: l.slug,
          fit: j.fit,
          notAProduct: j.notAProduct,
          reLaunchOfRegistered: reLaunchOfRegistered(l),
          reason: j.reason,
        };
      }),
    });
    const forumId = this.#config.discord.minerDaysForumId;
    const [summary, ...bands] = rendered.messages;

    let post = this.#store.dayPost(date);
    if (!post.threadId && post.postIntended) {
      // The date's post can't have been archived before the date began.
      const found = await this.#discord.findForumPost(forumId, rendered.title, pacificDay(date).start);
      if (found) {
        this.#log('miner.post-read-back', { date, threadId: found });
        this.#store.saveDayPostThread(date, found);
      }
    }
    post = this.#store.dayPost(date);
    if (!post.threadId) {
      this.#store.saveDayPostIntended(date, 0);
      const { threadId } = await this.#discord.createForumPost(forumId, rendered.title, summary!);
      this.#store.saveDayPostThread(date, threadId);
      post = this.#store.dayPost(date);
    }
    const threadId = post.threadId!;

    if (post.messagesIntended > post.messageIds.length) {
      const sent = await this.#discord.ownMessages(threadId);
      for (const [i, messageId] of sent.filter((id) => id !== threadId).entries()) {
        if (!post.messageIds[i + 1]) this.#store.saveDayPostMessage(date, i + 1, messageId);
      }
      post = this.#store.dayPost(date);
    }
    for (const [i, message] of bands.entries()) {
      if (post.messageIds[i + 1]) continue;
      this.#store.saveDayPostIntended(date, i + 1);
      const { messageId } = await this.#discord.sendMessage(threadId, message);
      this.#store.saveDayPostMessage(date, i + 1, messageId);
    }
    this.#store.saveDayPosted(date, this.#clock.now().toISOString());
    this.#log('miner.posted', { date, threadId, title: rendered.title, messages: rendered.messages.length });
  }
}
