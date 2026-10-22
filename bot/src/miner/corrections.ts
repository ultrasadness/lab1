// Corrections of Miner judgments (#48): Correct on a line of a day post opens a one-field pop-up showing the line's
// judgment. The person's Correction re-judges only that Launch, in a Miner run of its own counted against the date's
// Miner budget but never held by it, against the date's stored line, which never moves. The line shows "re-judging…"
// at once, then the new judgment in place. Each Correction is kept in the store as it is sent and as its work goes,
// so a stop picks up where it left off: what its run recorded stands, and only what it changed is shown again. The
// day's file is queued before Discord changes and written after.
import type { Clock } from '../clock.ts';
import { asEdit, popup, type MessagePayload, type Popup } from '../discord/components.ts';
import type { DiscordRest } from '../discord/rest.ts';
import type { Dossiers } from '../dossier/dossiers.ts';
import type { RecordResult } from '../forwarder.ts';
import { errorText, type Log } from '../log.ts';
import type { PersonalDatabase } from '../personal-database.ts';
import { capText, type PiRunner, type RunResult } from '../pi-runs.ts';
import type { Correction, Store } from '../store.ts';
import { outcomeOf } from './day-line.ts';
import { correctId, judgmentText, renderWithdrawn } from './day-post.ts';
import { dayFileOf, dayLaunches, dayPostOf, type DayLaunch } from './day-view.ts';
import { correctionPrompt, readJudgment } from './judging.ts';

/** The pop-up's one field. */
export const CORRECTION_FIELD = { customId: 'what', label: 'What did it get wrong?', maxLength: 1000 };

export class Corrections {
  #store: Store;
  #pi: PiRunner;
  #discord: DiscordRest;
  #personalDatabase: PersonalDatabase;
  #dossiers: Dossiers;
  #clock: Clock;
  #log: Log;

  constructor(options: {
    store: Store;
    pi: PiRunner;
    discord: DiscordRest;
    personalDatabase: PersonalDatabase;
    dossiers: Dossiers;
    clock: Clock;
    log: Log;
  }) {
    this.#store = options.store;
    this.#pi = options.pi;
    this.#discord = options.discord;
    this.#personalDatabase = options.personalDatabase;
    this.#dossiers = options.dossiers;
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
    return { update: index >= 0 ? asEdit(dayPostOf(this.#store, date).messages[index]!) : undefined };
  }

  /**
   * Works through every Correction whose work isn't done, oldest first. Returns whether one is left for later, such
   * as a Dossier that couldn't be written.
   */
  async work(): Promise<boolean> {
    let left = false;
    for (const { id } of this.#store.unfinishedCorrections()) {
      let finished: Finished;
      try {
        finished = await this.#finish(id);
      } catch (error) {
        finished = { problem: `the Assistant hit an error (${errorText(error)})` };
      }
      if (finished === 'stopped') return false;
      if (finished !== 'done') {
        left = true;
        this.#store.saveCorrectionProblem(id, finished.problem);
        this.#log('correction.unfinished', { id, problem: finished.problem });
      }
    }
    return left;
  }

  async #finish(id: number): Promise<Finished> {
    let correction = this.#store.correction(id)!;
    if (!correction.judgment && !correction.unjudged) {
      if ((await this.#rejudge(correction)) === 'stopped') return 'stopped';
      correction = this.#store.correction(id)!;
    }
    const { date, postId } = correction;
    // Queued before Discord changes and written after, so a stop between the two loses nothing.
    this.#personalDatabase.queue(dayFileOf(this.#store, date, correction.judgment ? this.#store.launch(postId)!.name : undefined));
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
    const why = unjudged(result);
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

  /**
   * Rewrites the day post as the store now has it: its title and summary, and each message holding a corrected
   * line. An archived post can't be edited, so the rename unarchives it too.
   */
  async #show(date: string): Promise<void> {
    const post = this.#store.dayPost(date);
    const threadId = post.threadId!;
    const rendered = dayPostOf(this.#store, date);
    const corrected = new Set(this.#store.correctionsFor(date).map((c) => c.postId));
    await this.#discord.editThread(threadId, { name: rendered.title, archived: false });
    this.#store.saveDayPostTitle(date, rendered.title);
    for (const [i, message] of rendered.messages.entries()) {
      if (i > 0 && !rendered.launchesIn[i]!.some((id) => corrected.has(id))) continue;
      await this.#discord.editMessage(threadId, post.messageIds[i]!, asEdit(message));
    }
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

/** Why a Correction's run recorded no judgment, as its line says. */
function unjudged(result: RunResult): string {
  if (result.outcome === 'capped') return `its run hit its ${capText(result.cap!)}`;
  if (result.outcome === 'failed') return `its run failed (${result.error ?? 'no reason given'})`;
  return 'its run recorded no judgment';
}
