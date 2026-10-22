// Proposals (#49, #12): an Interest scope change or a Rule that a Correction's sorting run proposed, on a purple card
// in #needs-you headed "… · not an Approval", with Keep (blue, never green), Edit and Discard. Only Keep changes the
// Personal database: once plain code finds the proposal still fits what git holds, and a Rule still fits the Rule
// budget, it commits the Rule file or the Interest scope under the write lock. A Keep it can't do says why on the card,
// which stays open. Discard leaves the Correction fix only. Each tap is kept in the store before its work, which runs
// at once as plain code, one Keep at a time, so a stop picks up where it left off.
import type { Clock } from '../clock.ts';
import {
  Accent,
  button,
  ButtonStyle,
  cut,
  escapeMarkdown,
  fits,
  popup,
  text,
  type Button,
  type MessagePayload,
  type Popup,
  type TextDisplay,
} from '../discord/components.ts';
import { refused } from '../discord/rest.ts';
import { errorText, type Log } from '../log.ts';
import { needsYouCard, type NeedsYou } from '../needs-you.ts';
import { fullTime } from '../pacific.ts';
import type { PersonalDatabase } from '../personal-database.ts';
import type { StoredSort, Store } from '../store.ts';
import {
  amendedRuleFile,
  heaviestLoad,
  loadRules,
  RULE_SCOPES,
  ruleFile,
  ruleSlug,
  sameName,
  SCOPE_NAMES,
  type Rule,
  type RuleScope,
} from './rules.ts';
import { checkRuleText, INTEREST_SCOPE_PATH, RULE_LIMITS, type Proposal, type SortedItem } from './sorting.ts';

/** How much of what the person wrote a card quotes. */
const QUOTE_CHARS = 300;

/** Discord's limit on what a pop-up field holds. */
const FIELD_CHARS = 4000;

/** Room a card keeps for the line saying why a Keep wasn't done, longer than any such line. */
const NOTE_ROOM = 400;

/**
 * Whether the card of a proposal, from a sort that applied these Rules, fits one Discord message, with room for a line
 * saying why a Keep wasn't done.
 */
export function cardFits(proposal: Proposal, item: SortedItem, rulesApplied: string[]): boolean {
  const open = { correctionId: 0, version: 2, proposal, item, rulesApplied, keepTappedAt: null, notKept: 'x'.repeat(NOTE_ROOM) };
  const { heading, body, buttons } = cardOf(open);
  // A Discord user id has at most 20 digits.
  return fits(needsYouCard('0'.repeat(20), heading, body, { accent: Accent.rule, buttons }));
}

/** What a tap on a card answers with, or why it is refused, and the plain-code work it leaves to do. */
export type Tapped = { update: MessagePayload; work?: () => Promise<void> } | { popup: Popup } | { refused: string };

const cardId = (action: 'keep' | 'edit' | 'discard', sort: Pick<StoredSort, 'correctionId' | 'version'>) =>
  `${action}:sort:${sort.correctionId}:${sort.version}`;

export class Proposals {
  #store: Store;
  #personalDatabase: PersonalDatabase;
  #needsYou: NeedsYou;
  #budgetTokens: number;
  #showDecision: (correctionId: number) => Promise<void>;
  #clock: Clock;
  #log: Log;
  /** Keeps run one at a time, so each one measures the Rules the one before it kept. */
  #keeping: Promise<void> = Promise.resolve();

  constructor(options: {
    store: Store;
    personalDatabase: PersonalDatabase;
    needsYou: NeedsYou;
    /** The Rule budget, in tokens: what the Rules loaded into one run may take. */
    budgetTokens: number;
    /** Shows what the person decided in the history of the item the Correction was made on. */
    showDecision(correctionId: number): Promise<void>;
    clock: Clock;
    log: Log;
  }) {
    this.#store = options.store;
    this.#personalDatabase = options.personalDatabase;
    this.#needsYou = options.needsYou;
    this.#budgetTokens = options.budgetTokens;
    this.#showDecision = options.showDecision;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  /** Posts a proposal's card, once. It is marked before it is sent, and an uncertain send counts as sent (ADR 0007). */
  async post(sort: StoredSort): Promise<void> {
    if (sort.cardIntended) return;
    const { heading, body, buttons } = cardOf(sort);
    this.#store.saveSortCardIntended(sort.correctionId, true);
    try {
      const { messageId } = await this.#needsYou.post(heading, body, { accent: Accent.rule, buttons });
      this.#store.saveSortCard(sort.correctionId, messageId);
    } catch (error) {
      if (refused(error)) this.#store.saveSortCardIntended(sort.correctionId, false);
      throw error;
    }
  }

  /** The person tapped a button on a proposal's card, the message `messageId`. Undefined if it isn't one. */
  tap(customId: string, messageId: string | undefined): Tapped | undefined {
    const m = customId.match(/^(keep|edit|discard):sort:(\d+):(\d+)$/);
    if (!m) return undefined;
    const [, action, id, version] = m;
    const sort = this.#store.sortOf(Number(id));
    if (!sort?.proposal) return { refused: 'That proposal is no longer on record.' };
    if (sort.keptAt) return { refused: 'It is kept already.' };
    if (sort.discardedAt) return { refused: 'It was discarded already.' };
    if (sort.keepTappedAt) return { refused: 'It is being kept.' };
    if (sort.version !== Number(version)) return { refused: 'It was edited since; the card now shows it as edited.' };
    if (!sort.cardMessageId && messageId) this.#store.saveSortCard(sort.correctionId, messageId);
    const at = this.#clock.now().toISOString();
    const { correctionId } = sort;
    if (action === 'keep') {
      if (!this.#store.saveSortKeepTapped(correctionId, sort.version, at)) return { refused: 'It is being kept.' };
      this.#log('proposal.keep-tapped', { correctionId, version: sort.version });
      return { update: this.#cardPayload(this.#store.sortOf(correctionId)!), work: () => this.#keepInTurn(correctionId) };
    }
    if (action === 'discard') {
      if (!this.#store.saveSortDiscarded(correctionId, sort.version, at)) return { refused: 'It was decided already.' };
      this.#log('proposal.discarded', { correctionId, version: sort.version });
      const discarded = this.#store.sortOf(correctionId)!;
      return { update: this.#needsYou.shrunk(settledLine(discarded, undefined)), work: () => this.#settle(correctionId) };
    }
    return editPopup(sort);
  }

  /**
   * The person sent the Edit pop-up of a proposal's card, whose fields `field` reads by id. The card becomes the
   * proposal as edited, as its next version.
   */
  submitEdit(customId: string, field: (customId: string) => string | undefined): Tapped | undefined {
    const m = customId.match(/^edit:sort:(\d+):(\d+)$/);
    if (!m) return undefined;
    const [correctionId, version] = [Number(m[1]), Number(m[2])];
    const p = this.#store.sortOf(correctionId)?.proposal;
    if (!p) return { refused: 'That proposal is no longer on record.' };
    let edited: Proposal;
    if (p.kind === 'interest-scope') {
      const after = (field('interest-scope') ?? '').replace(/\r\n?/g, '\n').trimEnd();
      if (!after.trim()) return { refused: 'The Interest scope can’t be empty. Edit it again, or Discard the proposal.' };
      if (after === p.before.trimEnd()) return { refused: 'That is the Interest scope as it is now. Edit it again, or Discard the proposal.' };
      edited = { ...p, after: `${after}\n` };
    } else {
      const checked = checkRuleText(p.kind === 'rule' ? field('name') : p.name, field('statement'));
      if (!checked.ok) return { refused: `${checked.error} Edit it again.` };
      edited = p.kind === 'rule' ? { ...p, name: checked.name, statement: checked.statement } : { ...p, statement: checked.statement };
    }
    const { item, rulesApplied } = this.#store.sortOf(correctionId)!;
    if (!cardFits(edited, item, rulesApplied)) {
      return { refused: 'That is too long to show on one Discord card. Edit it shorter.' };
    }
    if (!this.#store.saveSortEdited(correctionId, version, edited)) {
      return { refused: 'It was edited or decided since; the card shows where it stands.' };
    }
    this.#log('proposal.edited', { correctionId, version: version + 1 });
    return { update: this.#cardPayload(this.#store.sortOf(correctionId)!) };
  }

  /**
   * As after a stop: does each Keep tapped and not done, shows each decision not yet shown, and redraws each card a
   * Keep it couldn't do left, in case Discord didn't take that edit.
   */
  async resume(): Promise<void> {
    for (const sort of this.#store.undoneProposals()) {
      const { correctionId } = sort;
      try {
        if (sort.keepTappedAt && !sort.keptAt) await this.#keepInTurn(correctionId);
        else if (sort.keptAt || sort.discardedAt) await this.#settle(correctionId);
        else if (sort.cardMessageId) await this.#needsYou.edit(sort.cardMessageId, this.#cardPayload(sort));
      } catch (error) {
        this.#log('proposal.resume-failed', { correctionId, error: errorText(error) });
      }
    }
  }

  #keepInTurn(correctionId: number): Promise<void> {
    const run = this.#keeping.then(() =>
      this.#keep(correctionId).catch((error: unknown) => this.#log('proposal.keep-failed', { correctionId, error: errorText(error) })),
    );
    this.#keeping = run;
    return run;
  }

  /**
   * Checks the proposal against what the Personal database holds and commits it, or says on the card why it can't.
   * The check and the file it writes happen under the write lock, on the checkout just fast-forwarded, so nothing the
   * person pushes meanwhile is written over. The proposal is recorded kept as its file is queued, so a stop after
   * that commits the file at the next start, and never checks it again.
   */
  async #keep(correctionId: number): Promise<void> {
    const sort = this.#store.sortOf(correctionId)!;
    if (!sort.keepTappedAt || sort.keptAt) return;
    let checked: 'kept' | { notKept: string } | { error: unknown } | undefined;
    await this.#personalDatabase.sync(async () => {
      try {
        checked = await this.#write(sort);
      } catch (error) {
        checked = { error };
      }
    });
    if (!checked) throw new Error("the Personal database's checkout couldn't be brought up to date");
    if (typeof checked === 'object' && 'error' in checked) throw checked.error;
    if (typeof checked === 'object') {
      this.#store.saveSortNotKept(correctionId, checked.notKept);
      this.#log('proposal.not-kept', { correctionId, why: checked.notKept });
      const cardMessage = this.#store.sortOf(correctionId)!.cardMessageId;
      if (cardMessage) await this.#needsYou.edit(cardMessage, this.#cardPayload(this.#store.sortOf(correctionId)!));
      return;
    }
    this.#log('proposal.kept', { correctionId, kind: sort.proposal!.kind, path: this.#store.sortOf(correctionId)!.keptPath });
    await this.#settle(correctionId);
  }

  /** Records the proposal kept with the file Keep writes queued, or says why it can't be kept. */
  async #write(sort: StoredSort): Promise<'kept' | { notKept: string }> {
    const p = sort.proposal!;
    const now = fullTime(this.#clock.now());
    const { item } = sort;
    let write: { path: string; content: string; message: string };
    if (p.kind === 'interest-scope') {
      if (this.#personalDatabase.read(INTEREST_SCOPE_PATH) !== p.before) {
        return { notKept: 'the Interest scope changed in git since this was proposed. Discard it, and Correct again for a new proposal.' };
      }
      write = { path: INTEREST_SCOPE_PATH, content: p.after, message: `Interest scope changed by your Correction on ${item.name}, ${item.day}` };
    } else {
      const { rules } = await loadRules(this.#personalDatabase, RULE_SCOPES);
      if (p.kind === 'rule') {
        const clash = rules.find((r) => sameName(r.name, p.name) && (p.scope === 'all' || r.scope === 'all' || r.scope === p.scope));
        if (clash) return { notKept: `a Rule named "${clash.name}" is kept already, in ${clash.path}. Edit this one's name, or Discard it.` };
        const path = freePath(rules, p.scope, ruleSlug(p.name));
        const over = this.#overBudget(rules, { name: p.name, scope: p.scope, path, statement: p.statement, frontMatter: [] });
        if (over) return { notKept: over };
        const content = ruleFile({ ...p, taughtOn: item.taughtOn, created: now });
        write = { path, content, message: `Rule kept: ${p.name} (${SCOPE_NAMES[p.scope]})` };
      } else {
        const kept = rules.find((r) => r.path === p.path);
        if (!kept) return { notKept: `the Rule "${p.name}" is no longer in git.` };
        if (kept.statement !== p.was) {
          return { notKept: `the Rule "${p.name}" changed in git since this was proposed. Discard this, and Correct again for a new proposal.` };
        }
        const over = this.#overBudget(rules, { ...kept, statement: p.statement });
        if (over) return { notKept: over };
        const content = amendedRuleFile(kept, { statement: p.statement, taughtOn: item.taughtOn, amended: now });
        write = { path: kept.path, content, message: `Rule amended: ${kept.name} (${SCOPE_NAMES[kept.scope]})` };
      }
    }
    this.#store.saveSortKept(sort.correctionId, { ...write, queuedAt: this.#clock.now().toISOString() });
    return 'kept';
  }

  /** Why keeping the Rule would take a run past the Rule budget, if it would. */
  #overBudget(rules: readonly Rule[], changed: Rule): string | undefined {
    const { scope, tokens } = heaviestLoad(rules, changed);
    if (tokens <= this.#budgetTokens) return undefined;
    const runs = changed.scope === 'all' && scope !== 'all' ? `${SCOPE_NAMES[scope]} runs, with the all scope's,` : `${SCOPE_NAMES[scope]} runs`;
    return (
      `keeping it would put the Rules of ${runs} at about ${tokens.toLocaleString('en-US')} tokens, past the Rule budget of about ` +
      `${this.#budgetTokens.toLocaleString('en-US')}. Edit it shorter, or Discard it.`
    );
  }

  /** The item's history shows what the person decided, and the card shrinks to one line saying it. */
  async #settle(correctionId: number): Promise<void> {
    const sort = this.#store.sortOf(correctionId)!;
    await this.#showDecision(correctionId);
    const url = sort.keptPath ? await this.#personalDatabase.fileUrl(sort.keptPath) : undefined;
    if (sort.cardMessageId) await this.#needsYou.shrink(sort.cardMessageId, settledLine(sort, url));
    this.#store.saveSortSettled(correctionId, this.#clock.now().toISOString());
    this.#log('proposal.settled', { correctionId, kept: Boolean(sort.keptAt) });
  }

  /** The open card as it now stands, for an edit. */
  #cardPayload(sort: StoredSort): MessagePayload {
    const { heading, body, buttons } = cardOf(sort);
    return this.#needsYou.card(heading, body, { accent: Accent.rule, buttons });
  }
}

/** The line a decided card shrinks to, linking the file Keep wrote at `url` if it has one. */
function settledLine(sort: StoredSort, url: string | undefined): string {
  const p = sort.proposal!;
  if (!sort.keptAt) return `Discarded · your Correction on **${escapeMarkdown(sort.item.name)}** (${sort.item.day}) stays fix only`;
  const path = sort.keptPath!;
  const file = url ? `[${path}](${url})` : `\`${path}\``;
  if (p.kind === 'interest-scope') return `✓ Interest scope changed · ${file}`;
  return `✓ Rule ${p.kind === 'rule' ? 'kept' : 'amended'} · **${escapeMarkdown(p.name)}** · ${SCOPE_NAMES[p.scope]} · ${file}`;
}

/** The Edit pop-up, holding the proposal as it now stands, or why it can't be edited on Discord. */
function editPopup(sort: StoredSort): Tapped {
  const p = sort.proposal!;
  const id = cardId('edit', sort);
  if (p.kind === 'interest-scope') {
    if (p.after.length > FIELD_CHARS) {
      return { refused: `It is too long to edit on Discord. Keep or Discard it, then edit ${INTEREST_SCOPE_PATH} in git.` };
    }
    const scope = { customId: 'interest-scope', label: 'Interest scope', maxLength: FIELD_CHARS, value: p.after };
    return { popup: popup(id, 'Edit proposed Interest scope', [], scope) };
  }
  const statement = { customId: 'statement', label: 'Rule', maxLength: RULE_LIMITS.statement, value: p.statement };
  if (p.kind === 'amendment') return { popup: popup(id, `Edit amendment · ${p.name}`, [], statement) };
  const name = { customId: 'name', label: 'Name', maxLength: RULE_LIMITS.name, oneLine: true, value: p.name };
  return { popup: popup(id, 'Edit proposed Rule', [], name, statement) };
}

/** A proposal's card while it is open: what it proposes, from which Correction, and whether a Keep is under way. */
function cardOf(
  sort: Pick<StoredSort, 'correctionId' | 'version' | 'proposal' | 'item' | 'rulesApplied' | 'keepTappedAt' | 'notKept'>,
): { heading: string; body: TextDisplay[]; buttons: Button[] } {
  const p = sort.proposal!;
  const { item } = sort;
  const from = `-# From your Correction on **${escapeMarkdown(item.name)}** (${item.day}): “${cut(escapeMarkdown(item.correction), QUOTE_CHARS)}”`;
  const approvesNothing = 'Keeping it approves nothing: nothing is registered or sent.';
  let heading = 'Proposed Rule · not an Approval';
  let what: string;
  let keep: string;
  if (p.kind === 'interest-scope') {
    heading = 'Proposed Interest scope change · not an Approval';
    what = scopeChange(p.before, p.after);
    keep = `-# Keep commits it to the Interest scope in your Profile, which every later Miner and Dossier run reads. ${approvesNothing}`;
  } else if (p.kind === 'rule') {
    what = `**${escapeMarkdown(p.name)}** · ${SCOPE_NAMES[p.scope]}\n> ${escapeMarkdown(p.statement)}`;
    keep = `-# Keep adds it to ${laterRuns(p.scope)}. ${approvesNothing}`;
  } else {
    what = [
      `Amends **${escapeMarkdown(p.name)}** · ${SCOPE_NAMES[p.scope]}`,
      'Now:',
      `> ${escapeMarkdown(p.was)}`,
      'Would be:',
      `> ${escapeMarkdown(p.statement)}`,
    ].join('\n');
    keep = `-# Keep rewrites it for ${laterRuns(p.scope)}; a kept Rule never changes without you. ${approvesNothing}`;
  }
  const rules = sort.rulesApplied.length > 0 ? [`-# Rules applied: ${sort.rulesApplied.map(escapeMarkdown).join(', ')}`] : [];
  const state = sort.keepTappedAt ? ['-# Keeping…'] : sort.notKept ? [`-# Not kept: ${sort.notKept}`] : sort.version > 1 ? ['-# You edited it.'] : [];
  const busy = Boolean(sort.keepTappedAt);
  return {
    heading,
    body: [text(what), text([from, keep, ...rules, ...state].join('\n'))],
    buttons: [
      button(cardId('keep', sort), 'Keep', ButtonStyle.Primary, busy),
      button(cardId('edit', sort), 'Edit', ButtonStyle.Secondary, busy),
      button(cardId('discard', sort), 'Discard', ButtonStyle.Secondary, busy),
    ],
  };
}

const laterRuns = (scope: RuleScope) => (scope === 'all' ? 'every later run' : `every later ${SCOPE_NAMES[scope]} run`);

/** Each section of the Interest scope a change touches, as it is now and as it would be. */
function scopeChange(before: string, after: string): string {
  const [was, will] = [sections(before), sections(after)];
  const shown = (lines: string[] | undefined) =>
    lines?.length ? lines.map((l) => (/^[-*]\s+/.test(l) ? `- ${escapeMarkdown(l.replace(/^[-*]\s+/, ''))}` : escapeMarkdown(l))) : ['*(nothing)*'];
  return [...new Set([...was.keys(), ...will.keys()])]
    .filter((heading) => (was.get(heading) ?? []).join('\n') !== (will.get(heading) ?? []).join('\n'))
    .flatMap((heading) => {
      const name = `**${escapeMarkdown(heading)}**`;
      return [`${name}, now:`, ...shown(was.get(heading)), `${name}, would be:`, ...shown(will.get(heading))];
    })
    .join('\n');
}

/** A Markdown file's lines under each heading, leaving out blank ones; lines before the first heading go under "". */
function sections(file: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let heading = '';
  for (const line of file.replace(/\r\n?/g, '\n').split('\n')) {
    const h = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (h) heading = h[1]!;
    else if (line.trim()) map.set(heading, [...(map.get(heading) ?? []), line.trim()]);
  }
  return map;
}

/** A path for a new Rule's file that no kept Rule has: its slug, then its slug with a number. */
function freePath(rules: readonly Rule[], scope: RuleScope, slug: string): string {
  const taken = new Set(rules.map((r) => r.path));
  for (let n = 1; ; n++) {
    const path = `rules/${scope}/${n === 1 ? slug : `${slug}-${n}`}.md`;
    if (!taken.has(path)) return path;
  }
}
