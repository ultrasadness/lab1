// Corrections of Miner judgments (#48): Correct on a line of a day post opens a one-field pop-up showing the line's
// judgment. The person's Correction re-judges only that Launch, in a Miner run of its own counted against the date's
// Miner budget but never held by it, against the date's stored line, which never moves. The line shows "re-judging…"
// at once, then the new judgment in place. Each Correction is kept in the store as it is sent and as its work goes,
// so a stop picks up where it left off: what its run recorded stands, and only what it changed is shown again. The
// day's file is queued before Discord changes and written after. Once all of that is done, another Miner run sorts the
// Correction (#49): the day's file says what came of it, a Hard limit that declined it shows on its line too, and a
// proposed Rule or Interest scope change goes to its card in #needs-you.
import type { Clock } from '../clock.ts';
import { asEdit, popup, type MessagePayload, type Popup } from '../discord/components.ts';
import type { DiscordRest } from '../discord/rest.ts';
import type { Dossiers } from '../dossier/dossiers.ts';
import type { RecordResult } from '../forwarder.ts';
import { errorText, type Log } from '../log.ts';
import { NoProviderLeft } from '../providers.ts';
import type { PersonalDatabase } from '../personal-database.ts';
import { dayLabel, fullDate } from '../pacific.ts';
import type { PiRunner } from '../pi-runs.ts';
import type { Proposals } from '../rules/proposals.ts';
import { runSort, unrecorded } from '../rules/sort-run.ts';
import { decidedText, INTEREST_SCOPE_PATH, sortingPrompt, sortKey, type SortedItem } from '../rules/sorting.ts';
import type { Correction, Judgment, Store } from '../store.ts';
import { outcomeOf } from './day-line.ts';
import { correctId, judgmentText, plainJudgment, renderWithdrawn } from './day-post.ts';
import { dayFileOf, dayLaunches, dayPostOf, judgmentBefore, reLaunchOfRegistered, rewriteDayPost, type DayLaunch, type ProviderLabel } from './day-view.ts';
import { correctionPrompt, launchParts, readJudgment } from './judging.ts';

/** The pop-up's one field. */
export const CORRECTION_FIELD = { customId: 'what', label: 'What did it get wrong?', maxLength: 1000 };

export class Corrections {
  #store: Store;
  #pi: PiRunner;
  #discord: DiscordRest;
  #personalDatabase: PersonalDatabase;
  #dossiers: Dossiers;
  #proposals: Proposals;
  #providerLabel: ProviderLabel;
  #clock: Clock;
  #log: Log;

  constructor(options: {
    store: Store;
    pi: PiRunner;
    discord: DiscordRest;
    personalDatabase: PersonalDatabase;
    dossiers: Dossiers;
    proposals: Proposals;
    providerLabel: ProviderLabel;
    clock: Clock;
    log: Log;
  }) {
    this.#store = options.store;
    this.#pi = options.pi;
    this.#discord = options.discord;
    this.#personalDatabase = options.personalDatabase;
    this.#dossiers = options.dossiers;
    this.#proposals = options.proposals;
    this.#providerLabel = options.providerLabel;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  /** The person tapped Correct on a day line: the pop-up to open, or why it can't. */
  popup(postId: string): { popup: Popup } | { refused: string } {
    const found = this.#line(postId);
    if ('refused' in found) return found;
    const { launch, line } = found;
    return { popup: popup(correctId(postId), `Correct · ${launch.name.trim()}`, [judgmentText(launch, line)], CORRECTION_FIELD) };
  }

  /**
   * The person sent the pop-up, from the message holding the Launch's line. Keeps the Correction for its run, and
   * returns that message as it now reads, with the line re-judging.
   */
  submit(postId: string, text: string, messageId: string | undefined): { update: MessagePayload | undefined } | { refused: string } {
    const found = this.#line(postId);
    if ('refused' in found) return found;
    const { date } = found;
    const what = text.trim();
    if (!what) return { refused: 'Say what the judgment got wrong, and Correct again.' };
    const id = this.#store.saveCorrection({ postId, date, text: what, submittedAt: this.#clock.now().toISOString() });
    this.#log('correction.submitted', { id, date, postId });
    const index = messageId ? this.#store.dayPost(date).messageIds.indexOf(messageId) : -1;
    return { update: index >= 0 ? asEdit(dayPostOf(this.#store, date, this.#providerLabel).messages[index]!) : undefined };
  }

  /**
   * Works through every Correction whose work isn't done, oldest first, then sorts each one re-judged that isn't sorted
   * yet. Returns whether one is left for later, such as a Product post Discord didn't take. A Dossier that couldn't be
   * written is kept for the Miner's next start, and leaves the Correction done.
   */
  async work(): Promise<boolean> {
    let left = false;
    for (const { id } of this.#store.unfinishedCorrections()) {
      let finished: Finished;
      try {
        finished = await this.#finish(id);
      } catch (error) {
        finished = { problem: error instanceof NoProviderLeft ? error.message : `the Assistant hit an error (${errorText(error)})` };
      }
      if (finished === 'stopped') return false;
      if (finished !== 'done') {
        left = true;
        this.#store.saveCorrectionProblem(id, finished.problem);
        this.#log('correction.unfinished', { id, problem: finished.problem });
      }
    }
    for (const correction of this.#store.unsortedCorrections()) {
      let sorted: 'done' | 'stopped';
      try {
        sorted = await this.#sort(correction);
      } catch (error) {
        left = true;
        this.#log('correction.unsorted', { id: correction.id, error: errorText(error) });
        continue;
      }
      if (sorted === 'stopped') return false;
    }
    return left;
  }

  /**
   * Once a Correction's Launch is re-judged and shown, a Miner-role run sorts it, counted against the date's Miner
   * budget and never held, and the item's history shows what came of it.
   */
  async #sort(correction: Correction): Promise<'done' | 'stopped'> {
    const key = sortKey('miner', correction.id);
    let sort = this.#store.sortOf(key);
    if (!sort) {
      if ((await this.#runSort(correction)) === 'stopped') return 'stopped';
      sort = this.#store.sortOf(key)!;
    }
    if (sort.outcome === 'proposed') await this.#proposals.post(sort);
    else await this.#showSort(correction, sort.outcome === 'declined' ? 'is declined' : 'is fix only');
    // A declined Correction says so on its line, where the person made it.
    if (sort.outcome === 'declined') await this.#show(correction.date);
    this.#store.saveSortShown(key, this.#clock.now().toISOString());
    this.#log('correction.sorted', { id: correction.id, outcome: sort.outcome });
    return 'done';
  }

  /** Shows in the day's file what the person decided on the proposal a Correction's sort made. */
  async showDecision(correctionId: number): Promise<void> {
    const sort = this.#store.sortOf(sortKey('miner', correctionId))!;
    await this.#showSort(this.#store.correction(correctionId)!, decidedText(sort));
  }

  /** Writes the day's file with what came of a Correction's sort, `what` saying it in the commit's message. */
  async #showSort(correction: Correction, what: string): Promise<void> {
    const name = this.#store.launch(correction.postId)!.name.trim();
    this.#personalDatabase.queue(dayFileOf(this.#store, correction.date, `${name}'s Correction ${what}`));
    await this.#personalDatabase.sync();
  }

  /** The Correction's sorting run, given the Launch, its line before and after, and the Miner Rules kept. */
  async #runSort(correction: Correction): Promise<'stopped' | void> {
    const { id, date, postId, text } = correction;
    const launch = this.#store.launch(postId)!;
    const item: SortedItem = {
      name: launch.name.trim(),
      day: dayLabel(date),
      taughtOn: `Launch ${postId} (${launch.name.trim()}) of ${fullDate(date)}`,
      scope: 'miner',
      correction: text,
    };
    const line = this.#store.dayLine(date)!.line;
    const shown = (j: Judgment) => plainJudgment({ ...j, reLaunchOfRegistered: reLaunchOfRegistered(launch) }, line);
    await this.#personalDatabase.sync();
    const interestScope = this.#personalDatabase.read(INTEREST_SCOPE_PATH);
    const prompt = sortingPrompt({
      interestScope,
      what: `the Miner's judgment of a Launch on ${dayLabel(date)}`,
      scope: 'miner',
      item: launchParts(launch),
      before: shown(judgmentBefore(this.#store, correction)),
      correction: text,
      after: shown(correction.judgment!),
    });
    return runSort({
      pi: this.#pi,
      store: this.#store,
      clock: this.#clock,
      log: this.#log,
      correction: sortKey('miner', id),
      role: 'miner',
      runItem: date,
      scope: 'miner',
      item,
      interestScope,
      prompt,
    });
  }

  async #finish(id: number): Promise<Finished> {
    let correction = this.#store.correction(id)!;
    if (!correction.judgment && !correction.unjudged) {
      if ((await this.#rejudge(correction)) === 'stopped') return 'stopped';
      correction = this.#store.correction(id)!;
    }
    const { date, postId } = correction;
    // Queued before Discord changes and written after, so a stop between the two loses nothing.
    const corrected = correction.judgment ? `${this.#store.launch(postId)!.name.trim()} corrected` : undefined;
    this.#personalDatabase.queue(dayFileOf(this.#store, date, corrected));
    let problem: string | null = null;
    try {
      if (correction.judgment) {
        const matched = await this.#matchProductPost(date, postId);
        if (matched === 'stopped') return 'stopped';
        if (matched !== 'done') problem = matched.problem;
        this.#store.saveCorrectionProblem(id, problem);
      }
      await this.#show(date);
    } finally {
      await this.#personalDatabase.sync();
    }
    if (problem) return { problem };
    this.#store.saveCorrectionDone(id, this.#clock.now().toISOString());
    this.#log('correction.done', { id, date, postId, rejudged: Boolean(correction.judgment) });
    return 'done';
  }

  /** The Correction's run: the Launch judged again, with what the person wrote. Never held by the Miner budget. */
  async #rejudge(correction: Correction): Promise<'stopped' | void> {
    const { id, date, postId, text } = correction;
    const launch = this.#store.launch(postId)!;
    const corrected = this.#shown(date, postId);
    // The run reads the Interest scope as GitHub has it, like any Miner run.
    await this.#personalDatabase.sync();
    const interestScope = this.#personalDatabase.read('profile/interest-scope.md');
    const result = await this.#pi.run({
      kind: 'miner-judging',
      role: 'miner',
      item: date,
      prompt: correctionPrompt(interestScope, launch, corrected, text),
      onRecord: (record, runId) => this.#keepJudgment(correction, record, runId),
    });
    if (result.outcome === 'stopped') return 'stopped';
    if (this.#store.correction(id)!.judgment) return;
    const why = unrecorded(result, 'judgment');
    this.#store.saveCorrectionUnjudged(id, why);
    this.#log('correction.unjudged', { id, date, postId, runId: result.runId, why });
  }

  #keepJudgment(correction: Correction, record: unknown, runId: string): RecordResult {
    const read = readJudgment(record, new Set([correction.postId]));
    if (!read.ok) return read;
    // The forwarder records each model reply before it ends, so the reply holding this tool call is the latest.
    const request = this.#store.lastModelRequest(runId);
    if (!request) return { ok: false, error: 'No model request of this run is on record.' };
    const { id: requestId, provider, model } = request;
    const kept = this.#store.saveCorrectionJudgment(correction.id, {
      ...read.judgment,
      date: correction.date,
      runId,
      role: 'miner',
      provider,
      model,
      requestId,
      judgedAt: this.#clock.now().toISOString(),
    });
    if (!kept) return { ok: false, error: `Post id ${correction.postId} is re-judged already; the first judgment stands.` };
    this.#log('correction.judged', { id: correction.id, postId: correction.postId, fit: read.judgment.fit, runId, provider, model, requestId });
    return { ok: true, message: `Recorded the judgment of Post id ${correction.postId}.` };
  }

  /**
   * Brings the Launch's Product post in line with the judgment it now shows: at or above the line it has a Dossier,
   * and below it any Dossier it had is withdrawn.
   */
  async #matchProductPost(date: string, postId: string): Promise<Finished> {
    const line = this.#store.dayLine(date)!;
    const shown = this.#shown(date, postId);
    if (outcomeOf(shown, line.line) !== 'dossier') {
      return this.#dossiers.withdraw(postId, (product) => renderWithdrawn({ title: product.title, date, line: line.line, launch: shown }));
    }
    return this.#dossiers.writeFor([{ launch: this.#store.launch(postId)!, date, fit: shown.fit, featuredCount: line.featuredCount }]);
  }

  /** The Launch's line as its day now shows it. */
  #shown(date: string, postId: string): DayLaunch {
    return dayLaunches(this.#store, date).find((l) => l.postId === postId)!;
  }

  /** Rewrites the day post as the store now has it: its title and summary, and each message holding a corrected line. */
  async #show(date: string): Promise<void> {
    await rewriteDayPost(this.#store, this.#discord, date, new Set(this.#store.correctionsFor(date).map((c) => c.postId)), this.#providerLabel);
  }

  /** The Launch's line on its posted day, and the day's stored line, unless the line can't be corrected now. */
  #line(postId: string): { date: string; launch: DayLaunch; line: number } | { refused: string } {
    const date = this.#store.launch(postId)?.date;
    const line = date && this.#store.dayLine(date);
    if (!date || !line || !this.#store.dayPost(date).postedAt) return { refused: 'That Launch isn’t on a posted day’s list.' };
    const launch = this.#shown(date, postId);
    if (launch.correction?.state === 're-judging') return { refused: `${launch.name.trim()} is being re-judged after your Correction already.` };
    return { date, launch, line: line.line };
  }
}

/** Whether a Correction's work is done, the Assistant stopped it, or why some of it isn't done yet. */
type Finished = 'done' | 'stopped' | { problem: string };
