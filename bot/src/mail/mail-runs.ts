// Mail runs (#61, #32): every mail matched to a Registration and within the cap goes to a run of the mail role, which
// sees it with each Secret as a placeholder, beside its Registration, and sorts it into *asks for a reply*, *needs the
// person* or *for the record* (ADR 0010). Plain code then gives each kind its treatment:
// - asks for a reply, not bulk: queued for a Reply draft, which #62's run writes;
// - asks for a reply, bulk, or from a no-reply address: a silent message in the Product post with the sender, the
//   subject and the mail's own text, with **Draft reply** unless its reply address is a no-reply one, and **Correct**;
// - needs the person: a `#needs-you` card saying what the mail wants done, with **Done**, **Correct** and **Draft
//   reply**, lapsing after 14 days;
// - for the record: no message of its own, for #64's digest.
// Plain code works out the reply address, `Reply-To` or else `From`, and a no-reply one gets no Reply draft and no
// Draft reply, whatever the model concluded. With no mail route left, a mail waits as *not handled · waiting* and its
// run is tried again every 30 minutes, never on another role's route (ADR 0013). A run that stops at a cap or fails
// leaves the mail *not handled · stopped*, with a notice in the Product post carrying the only **Retry** (#26; a
// failure that isn't a cap was settled by the person on #61). A mail a Registration may still take as its
// verification mail is plain code's, and waits until it is taken or turns out not to be (#58).
//
// **Correct** on a mail's message runs the mail run again under the mail role with what the person wrote: a draft is
// queued, or the card closes. A sorting run of the mail role then sorts the Correction, and may propose a mail Rule,
// which plain code refuses while it quotes the mail or names its sender or an address. Nothing of the mail reaches the
// Personal database: its states, dates and message ids stay in the live store.
import { createHash } from 'node:crypto';
import { inMinutes, type Clock } from '../clock.ts';
import { asEdit, cut, escapeMarkdown, popup, type MessagePayload, type Popup } from '../discord/components.ts';
import { refused, type DiscordRest } from '../discord/rest.ts';
import { fence } from '../fence.ts';
import { errorText, type Log } from '../log.ts';
import { CORRECTION_FIELD } from '../miner/corrections.ts';
import type { NeedsYou } from '../needs-you.ts';
import { dayLabel, pacificDate } from '../pacific.ts';
import type { PersonalDatabase } from '../personal-database.ts';
import { NoProviderLeft } from '../providers.ts';
import type { PiRunner } from '../pi-runs.ts';
import type { RawInputs } from '../raw-inputs.ts';
import type { Proposals } from '../rules/proposals.ts';
import { runSort, unrecorded } from '../rules/sort-run.ts';
import { INTEREST_SCOPE_PATH, sortingPrompt, sortKey, type Proposal, type SortedItem } from '../rules/sorting.ts';
import { MAIL_KINDS, type LedgerMail, type MailCorrection, type MailItem, type MailKind, type MailSort, type Store } from '../store.ts';
import { holdsSecret, keptCopy, mailDataIn, noReply, readKept, type KeptMail } from './kept-mail.ts';
import { cardLine, cardOf, closedPost, CORRECT, DONE, DRAFT, noticePayload, postPayload, RETRY, type MailView } from './mail-messages.ts';
import type { MailContent } from './signup-mailbox.ts';

/** How long a card of mail that needs the person waits before it lapses. */
const LAPSE_MS = 14 * 24 * 60 * 60_000;
/** How long a message Discord didn't take waits before it is tried again. */
const RETRY_MINUTES = 5;
/** How long a gist and a line of what a mail wants may be. */
const GIST_CHARS = 80;
const WANTS_CHARS = 200;

/**
 * What a tap or a pop-up answers with, or why it is refused, and the work it leaves to do. With no update, the tapped
 * message stays as it is until the work shows it anew.
 */
export type MailTapped = { update?: MessagePayload; work?: () => Promise<void> } | { popup: Popup } | { refused: string };

/** What came of one try at a mail's run. */
type Ran = 'sorted' | 'stopped' | 'waiting' | 'bot-stopping';

export class MailRuns {
  #store: Store;
  #pi: PiRunner;
  #discord: DiscordRest;
  #needsYou: NeedsYou;
  #rawInputs: RawInputs;
  #personalDatabase: PersonalDatabase;
  #proposals: Proposals;
  #content: (messageId: string) => Promise<MailContent>;
  #mayTake: (productId: number, receivedAt: string) => boolean;
  #correctionsDue: () => void;
  #mailDue: () => void;
  #plainWork: (work: () => Promise<void>) => void;
  #clock: Clock;
  #log: Log;
  #cancelLapse = () => {};
  #cancelRetry: (() => void) | undefined;
  #stopped = false;
  /** Shows under way, one at a time for each mail. */
  #shows = new Map<string, Promise<void>>();

  constructor(options: {
    store: Store;
    pi: PiRunner;
    discord: DiscordRest;
    needsYou: NeedsYou;
    /** Where the text of matched mail waits for its run, with its Secrets as placeholders. */
    rawInputs: RawInputs;
    personalDatabase: PersonalDatabase;
    proposals: Proposals;
    /** Reads a mail of the ledger again from Gmail, for a copy kept before #61 or one that expired. */
    content(messageId: string): Promise<MailContent>;
    /** Whether a mail may still be taken as its Registration's verification mail (#58). */
    mayTake(productId: number, receivedAt: string): boolean;
    /** Queues the work of the mail Corrections sent, in the background lane. */
    correctionsDue(): void;
    /** Queues the mail runs of the mail waiting for them, in the background lane. */
    mailDue(): void;
    /** Does plain-code work at once, outside the lane. */
    plainWork(work: () => Promise<void>): void;
    clock: Clock;
    log: Log;
  }) {
    this.#store = options.store;
    this.#pi = options.pi;
    this.#discord = options.discord;
    this.#needsYou = options.needsYou;
    this.#rawInputs = options.rawInputs;
    this.#personalDatabase = options.personalDatabase;
    this.#proposals = options.proposals;
    this.#content = options.content;
    this.#mayTake = options.mayTake;
    this.#correctionsDue = options.correctionsDue;
    this.#mailDue = options.mailDue;
    this.#plainWork = options.plainWork;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  /** As after a stop: each mail's messages are brought up to date, and each card's lapse is armed or done. */
  resume(): void {
    this.#plainWork(async () => {
      await this.#showRecent();
      await this.#lapse();
    });
  }

  /** Shows each mail whose messages may still have to go out or change. */
  async #showRecent(): Promise<void> {
    const since = new Date(this.#clock.now().getTime() - LAPSE_MS).toISOString();
    for (const item of this.#store.mailItemsToShow(since)) await this.#show(item.messageId);
  }

  stop(): void {
    this.#stopped = true;
    this.#cancelLapse();
    this.#cancelRetry?.();
  }

  // ---------- Mail runs ----------

  /**
   * Runs each mail waiting for its mail run, oldest first, and gives it its treatment. Returns whether one is left for
   * later: waiting for a mail route, or for its Registration's verification to take it or pass it over.
   */
  async work(): Promise<boolean> {
    let left = false;
    const passed = new Set<string>();
    // Read again for each mail, since a Registration's verification, outside the lane, may take one meanwhile.
    for (let mail = this.#nextQueued(passed); mail; mail = this.#nextQueued(passed)) {
      if (this.#stopped) return false;
      // A mail its Registration may take as its verification mail, with a code or link in it, is plain code's (#58).
      if (this.#mayTake(mail.productId, mail.receivedAt)) {
        const kept = await this.#kept(mail.messageId).catch(() => undefined);
        if (kept === undefined || (typeof kept !== 'string' && holdsSecret(kept))) {
          passed.add(mail.messageId);
          left = true;
          continue;
        }
      }
      const ran = await this.#runOne(mail);
      if (ran === 'bot-stopping') return false;
      if (ran === 'waiting') {
        // The role has no route left, so every mail behind this one waits too.
        for (const rest of this.#store.queuedMail()) if (!passed.has(rest.messageId)) this.#wait(rest.messageId, this.#pi.noProviderLeft('mail') ?? 'no mail route answered');
        return true;
      }
      await this.#show(mail.messageId);
    }
    return left;
  }

  /** The oldest mail waiting for its run, but those passed over in this pass. */
  #nextQueued(passed: Set<string>): LedgerMail | undefined {
    return this.#store.queuedMail().find((m) => !passed.has(m.messageId));
  }

  /** One mail's run, and what came of it. */
  async #runOne(mail: LedgerMail, correction?: MailCorrection): Promise<Ran | { unapplied: string }> {
    const product = this.#store.product(mail.productId)!;
    const kept = await this.#kept(mail.messageId);
    if (typeof kept === 'string') {
      const why = kept === 'gone' ? 'it was deleted from Gmail before its run, and its kept text has expired' : "Gmail sent it malformed, and its kept text has expired";
      if (correction) return { unapplied: why };
      this.#stop(mail.messageId, why, null);
      return 'stopped';
    }
    const noProvider = this.#pi.noProviderLeft('mail');
    if (noProvider) {
      if (correction) return 'waiting';
      this.#wait(mail.messageId, noProvider);
      return 'waiting';
    }
    const before = correction ? this.#store.latestMailSort(mail.messageId) : undefined;
    let result;
    try {
      result = await this.#pi.run({
        kind: 'mail',
        role: 'mail',
        item: mail.messageId,
        prompt: mailPrompt({ name: this.#name(mail.productId), rootDomain: product.rootDomain }, this.#registrationLine(mail.productId), mail, kept, correction && before ? { before, text: correction.text } : undefined),
        onRecord: (record, runId) => this.#record(record, runId, mail, kept, correction),
      });
    } catch (error) {
      if (!(error instanceof NoProviderLeft)) throw error;
      if (!correction) this.#wait(mail.messageId, error.message);
      return 'waiting';
    }
    if (result.outcome === 'stopped') return 'bot-stopping';
    const sorted = correction ? this.#store.mailSortOfCorrection(correction.id) : this.#store.latestMailSort(mail.messageId);
    if (sorted) return 'sorted';
    const why = unrecorded(result, 'sort');
    if (correction) return { unapplied: why };
    this.#stop(mail.messageId, why, result.runId);
    return 'stopped';
  }

  /** Checks a sort the run recorded and keeps it, with the Reply draft its kind queues. */
  #record(record: unknown, runId: string, mail: LedgerMail, kept: KeptMail, correction: MailCorrection | undefined) {
    const r = (record as { kind?: unknown; record?: Record<string, unknown> } | null) ?? {};
    if (r.kind !== 'mail' || typeof r.record !== 'object' || r.record === null) return { ok: false as const, error: 'Expected a mail record.' };
    const { kind, gist, wants, invite, rulesApplied } = r.record;
    if (!MAIL_KINDS.includes(kind as MailKind)) return { ok: false as const, error: `kind must be ${MAIL_KINDS.join(', ')}.` };
    const oneLine = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max && !/[\r\n]/.test(v) ? v.replace(/\s+/g, ' ').trim() : undefined);
    const g = oneLine(gist, GIST_CHARS);
    if (!g) return { ok: false as const, error: `gist says what the mail is in a few words, on one line of at most ${GIST_CHARS} characters.` };
    const w = oneLine(wants, WANTS_CHARS);
    if (kind === 'needs-the-person' && !w) return { ok: false as const, error: `For needs-the-person, wants says what the mail wants the person to do, on one line of at most ${WANTS_CHARS} characters.` };
    const waitlisted = this.#store.registration(mail.productId)?.state === 'waitlisted';
    if (waitlisted && typeof invite !== 'boolean') return { ok: false as const, error: 'The person is on this Product’s waitlist, so invite must be true or false.' };
    const already = correction ? this.#store.mailSortOfCorrection(correction.id) : this.#store.latestMailSort(mail.messageId);
    if (already) return { ok: false as const, error: 'The mail is sorted already; the first sort stands.' };
    const before = correction ? this.#store.latestMailSort(mail.messageId) : undefined;
    const sortedAt = this.#clock.now().toISOString();
    const sort: Omit<MailSort, 'id'> = {
      messageId: mail.messageId,
      kind: kind as MailKind,
      gist: g,
      wants: kind === 'needs-the-person' ? w! : null,
      invite: waitlisted ? (invite as boolean) : null,
      rulesApplied: Array.isArray(rulesApplied) ? rulesApplied.filter((n): n is string => typeof n === 'string') : [],
      runId,
      correctionId: correction?.id ?? null,
      sortedAt,
    };
    const noReplyAddress = noReply(kept);
    // A Reply draft is queued for mail that asks for one: on arrival when it isn't bulk, and when a Correction finds it
    // asks for one after all. A Correction that finds it doesn't withdraws a draft still queued: the person's latest
    // word stands, and Draft reply can queue it again.
    const asks = sort.kind === 'asks-for-reply' && !noReplyAddress;
    const draft = correction
      ? asks && before?.kind !== 'asks-for-reply'
        ? ({ queue: 'correction' } as const)
        : sort.kind !== 'asks-for-reply'
          ? ('withdraw' as const)
          : null
      : asks && !mail.bulk
        ? ({ queue: 'arrival' } as const)
        : null;
    const queuedBefore = Boolean(this.#store.replyDraftQueued(mail.messageId));
    this.#store.saveMailSort(sort, noReplyAddress, draft);
    const queued = this.#store.replyDraftQueued(mail.messageId);
    if (queued && !queuedBefore) this.#log('mail.reply-draft-queued', { messageId: mail.messageId, cause: queued.cause });
    if (!queued && queuedBefore) this.#log('mail.reply-draft-withdrawn', { messageId: mail.messageId, correction: correction!.id });
    this.#log('mail.sorted', {
      messageId: mail.messageId,
      product: this.#store.product(mail.productId)!.rootDomain,
      kind: sort.kind,
      ...(sort.invite !== null ? { invite: sort.invite } : {}),
      noReply: noReplyAddress,
      rulesApplied: sort.rulesApplied,
      runId,
      ...(correction ? { correction: correction.id } : {}),
    });
    return { ok: true as const, message: 'Recorded the sort.' };
  }

  #wait(messageId: string, why: string): void {
    if (this.#store.saveMailWaiting(messageId, this.#clock.now().toISOString())) this.#log('mail.waiting', { messageId, why });
  }

  #stop(messageId: string, why: string, runId: string | null): void {
    this.#store.saveMailStopped(messageId, why, this.#clock.now().toISOString());
    this.#log('mail.stopped', { messageId, why, ...(runId ? { runId } : {}) });
  }

  /** How a mail run is told of its Registration. */
  #registrationLine(productId: number): string {
    const state = this.#store.registration(productId)?.state;
    switch (state) {
      case 'registered':
        return 'Its Registration is registered: the person has an account there.';
      case 'waitlisted':
        return 'Its Registration is waitlisted: the person is on the Product’s waitlist, with no account yet.';
      case 'awaiting-verification':
        return 'Its Registration is awaiting verification: the form is submitted, and the Product’s mail confirming the address is awaited.';
      case 'handed-off':
        return 'Its Registration is handed off: the person finishes it on their own device.';
      case 'abandoned':
        return 'Its Registration is abandoned: as far as the Assistant knows, no account was made.';
      default:
        return 'Its Registration is under way: the Assistant is filling in its signup form.';
    }
  }

  /**
   * A mail's kept text, or read again from Gmail when its copy expired or was kept before #61, which then keeps it
   * again; `gone` or `unreadable` when Gmail can't give it. Throws while Gmail can't be asked.
   */
  async #kept(messageId: string): Promise<KeptMail | 'gone' | 'unreadable'> {
    const kept = readKept(this.#rawInputs.latest('gmail', messageId));
    if (kept) return kept;
    const content = await this.#content(messageId);
    if (typeof content === 'string') return content;
    const copy = keptCopy(content.mail);
    this.#rawInputs.keep('gmail', messageId, `${JSON.stringify(copy, null, 2)}\n`);
    return copy;
  }

  // ---------- Discord ----------

  /** Brings a mail's messages up to date, after any showing of it under way. One Discord didn't take is tried again later. */
  #show(messageId: string): Promise<void> {
    const next = (this.#shows.get(messageId) ?? Promise.resolve())
      .then(() => this.#showNow(messageId))
      .catch((error: unknown) => {
        this.#log('mail.show-failed', { messageId, error: errorText(error) });
        this.#tryAgainLater();
      });
    this.#shows.set(messageId, next);
    return next;
  }

  /**
   * Sends each message a mail's state calls for that hasn't gone out, each marked before it is sent (ADR 0007), and
   * edits each one that has when what it shows has changed.
   */
  async #showNow(messageId: string): Promise<void> {
    const view = await this.#view(messageId);
    if (!view) return;
    const { item, product } = view;
    const shown = shownOf(item);
    const keep = (part: string, payload: MessagePayload) => this.#markShown(messageId, part, payload);
    const send = async (part: 'post' | 'card' | 'notice', payload: MessagePayload, sending: () => Promise<{ messageId: string }>) => {
      const intended = `${part}Intended` as const;
      // A card lapses 14 days from the moment it may have gone out, even when Discord's answer never came.
      this.#store.saveMailItem(messageId, { [intended]: true, ...(part === 'card' ? { cardPostedAt: this.#clock.now().toISOString() } : {}) });
      try {
        const { messageId: sentId } = await sending();
        this.#store.saveMailItem(messageId, { [`${part}MessageId`]: sentId });
        keep(part, payload);
        this.#log('mail.message-sent', { messageId, message: part });
      } catch (error) {
        if (refused(error)) this.#store.saveMailItem(messageId, { [intended]: false, ...(part === 'card' ? { cardPostedAt: null } : {}) });
        throw error;
      }
    };
    const edit = async (part: 'post' | 'card' | 'notice', payload: MessagePayload, editing: () => Promise<void>) => {
      if (shown[part] === hashOf(payload)) return;
      await editing();
      keep(part, payload);
    };

    const thread = product.threadId;
    const post = postPayload(view);
    if (post && !item.postIntended && thread) await send('post', post, () => this.#discord.sendMessage(thread, post));
    else if (item.postMessageId && thread) {
      const now = post ?? closedPost(view);
      await edit('post', now, () => this.#discord.editMessage(thread, item.postMessageId!, asEdit(now)));
    }

    const card = cardOf(view);
    if (card && !item.cardIntended) {
      const payload = this.#needsYou.card(card.heading, card.body, { buttons: card.buttons });
      await send('card', payload, () => this.#needsYou.post(card.heading, card.body, { buttons: card.buttons }));
      this.#armLapse();
    } else if (item.cardMessageId) {
      // A card a Correction opens again lapses 14 days from when it first went out, as the same message.
      if (card) this.#armLapse();
      const now = card ? this.#needsYou.card(card.heading, card.body, { buttons: card.buttons }) : this.#needsYou.shrunk(cardLine(view));
      await edit('card', now, () => (card ? this.#needsYou.edit(item.cardMessageId!, now) : this.#needsYou.shrink(item.cardMessageId!, cardLine(view))));
    }

    const notice = noticePayload(view);
    if (notice && !item.noticeIntended && thread) await send('notice', notice, () => this.#discord.sendMessage(thread, notice));
    else if (notice && item.noticeMessageId && thread) await edit('notice', notice, () => this.#discord.editMessage(thread, item.noticeMessageId!, asEdit(notice)));
  }

  /** Keeps what a mail's message now shows, so that it is edited again only once that changes. */
  #markShown(messageId: string, part: string, payload: MessagePayload): void {
    const shown = shownOf(this.#store.mailItem(messageId)!);
    shown[part] = hashOf(payload);
    this.#store.saveMailItem(messageId, { shownKey: JSON.stringify(shown) });
  }

  /** In a few minutes, each mail's messages are shown again, after Discord didn't take one. */
  #tryAgainLater(): void {
    if (this.#stopped || this.#cancelRetry) return;
    this.#cancelRetry = inMinutes(this.#clock, RETRY_MINUTES, () => {
      this.#cancelRetry = undefined;
      this.#plainWork(() => this.#showRecent());
    });
  }

  /** What a mail's messages show, from the store. Undefined for a mail with nothing to show. */
  async #view(messageId: string): Promise<MailView | undefined> {
    const item = this.#store.mailItem(messageId);
    const mail = this.#store.ledgerMail(messageId);
    if (!item || !mail) return undefined;
    const product = this.#store.product(mail.productId)!;
    const sort = this.#store.latestMailSort(messageId);
    // The sender and subject a message shows: none for a mail sorted for the record that has no message.
    const shows = item.stoppedWhy !== null || item.noticeIntended || (sort && (sort.kind !== 'for-the-record' || item.postIntended || item.cardIntended));
    const kept = shows ? await this.#kept(messageId) : undefined;
    if (typeof kept === 'string') this.#log('mail.text-unread', { messageId, why: kept });
    const correction = this.#store.openMailCorrection(messageId);
    const lastSorted = this.#lastCorrectionSort(messageId);
    const lastCorrection = this.#store.mailCorrectionIds(messageId).at(-1);
    return {
      mail,
      item,
      product,
      sort,
      kept: typeof kept === 'object' ? kept : undefined,
      queued: Boolean(this.#store.replyDraftQueued(messageId)),
      correcting: Boolean(correction),
      declined: lastSorted?.outcome === 'declined' ? lastSorted.hardLimit : null,
      unapplied: lastCorrection === undefined ? null : (this.#store.mailCorrection(lastCorrection)?.unapplied ?? null),
      name: escapeMarkdown(this.#name(mail.productId)),
    };
  }

  /** The Product's name, as its approved Walkthrough gives it. */
  #name(productId: number): string {
    const r = this.#store.registration(productId);
    const name = (r && this.#store.walkthrough(productId, r.version)?.walkthrough.product) || this.#store.product(productId)!.title;
    return cut(name.replace(/\s+/g, ' ').trim(), 60);
  }

  #lastCorrectionSort(messageId: string) {
    const ids = this.#store.mailCorrectionIds(messageId);
    const last = ids.at(-1);
    return last === undefined ? undefined : this.#store.sortOf(sortKey('mail', last));
  }

  // ---------- Taps ----------

  /** A tap on a mail's message: Done, Draft reply, Retry or Correct. Undefined if the tap isn't one. */
  tap(customId: string, messageId: string | undefined): MailTapped | undefined {
    for (const [prefix, act] of [
      [DONE, (id: string) => this.#done(id)],
      [DRAFT, (id: string) => this.#draftReply(id)],
      [RETRY, (id: string) => this.#retry(id)],
      [CORRECT, (id: string) => this.#correctPopup(id)],
    ] as const) {
      if (!customId.startsWith(prefix)) continue;
      const id = customId.slice(prefix.length);
      this.#learnMessage(id, prefix, messageId);
      return act(id);
    }
    return undefined;
  }

  /**
   * A message whose send was uncertain is known by a tap on it (ADR 0007): Done is on the card, Retry on the notice,
   * and Correct and Draft reply on whichever of the card and the Product post's message the mail's kind shows them on.
   */
  #learnMessage(id: string, prefix: string, tappedOn: string | undefined): void {
    const item = this.#store.mailItem(id);
    if (!item || !tappedOn) return;
    const onCard = prefix === DONE || (prefix !== RETRY && this.#store.latestMailSort(id)?.kind === 'needs-the-person');
    const part = prefix === RETRY ? 'notice' : onCard ? 'card' : 'post';
    if (item[`${part}Intended`] && !item[`${part}MessageId`]) this.#store.saveMailItem(id, { [`${part}MessageId`]: tappedOn });
  }

  /** The Correct pop-up sent: undefined if it isn't a mail's. */
  submit(customId: string, field: (customId: string) => string | undefined, messageId: string | undefined): MailTapped | undefined {
    if (!customId.startsWith(CORRECT)) return undefined;
    const id = customId.slice(CORRECT.length);
    this.#learnMessage(id, CORRECT, messageId);
    const refusal = this.#correctable(id);
    if (refusal) return { refused: refusal };
    const correction = (field(CORRECTION_FIELD.customId) ?? '').trim();
    if (!correction) return { refused: 'Say what it got wrong, and Correct again.' };
    const correctionId = this.#store.saveMailCorrection({ messageId: id, text: correction, submittedAt: this.#clock.now().toISOString() });
    this.#log('mail.correction-submitted', { messageId: id, correction: correctionId });
    return {
      work: async () => {
        await this.#show(id);
        this.#correctionsDue();
      },
    };
  }

  #done(id: string): MailTapped {
    const item = this.#store.mailItem(id);
    const mail = this.#store.ledgerMail(id);
    if (!item?.cardIntended || !mail) return { refused: 'That card is no longer on record.' };
    if (!this.#store.endMailCard(id, 'done', this.#clock.now().toISOString())) {
      return { refused: item.cardEndedBy === 'lapse' ? 'It lapsed already; the mail is still in Gmail.' : 'Done already.' };
    }
    this.#log('mail.card-done', { messageId: id });
    return { update: this.#needsYou.shrunk(`Mail from ${escapeMarkdown(this.#name(mail.productId))} · done`), work: () => this.#show(id) };
  }

  #draftReply(id: string): MailTapped {
    const item = this.#store.mailItem(id);
    const sort = this.#store.latestMailSort(id);
    if (!item || !sort) return { refused: 'That mail is no longer on record.' };
    if (item.noReply) return { refused: 'Its reply address is a no-reply one, so no Reply draft can go to it.' };
    if (sort.kind === 'needs-the-person' && item.cardEndedBy) return { refused: 'That card is closed.' };
    if (!this.#store.queueReplyDraft(id, 'draft-reply', this.#clock.now().toISOString())) return { refused: 'A Reply draft is queued already.' };
    this.#log('mail.reply-draft-queued', { messageId: id, cause: 'draft-reply' });
    return { work: () => this.#show(id) };
  }

  #retry(id: string): MailTapped {
    const item = this.#store.mailItem(id);
    if (!item?.stoppedWhy) return { refused: 'That mail isn’t waiting for a Retry.' };
    if (!this.#store.saveMailRetry(id, this.#clock.now().toISOString())) return { refused: 'Retried already.' };
    this.#log('mail.retry', { messageId: id });
    return {
      work: async () => {
        await this.#show(id);
        this.#mailDue();
      },
    };
  }

  #correctPopup(id: string): MailTapped {
    const refusal = this.#correctable(id);
    if (refusal) return { refused: refusal };
    const mail = this.#store.ledgerMail(id)!;
    return { popup: popup(`${CORRECT}${id}`, `Correct · Mail from ${this.#name(mail.productId)}`, [], CORRECTION_FIELD) };
  }

  /** Why a mail's sort can't be corrected now, if it can't. */
  #correctable(id: string): string | undefined {
    const item = this.#store.mailItem(id);
    const sort = this.#store.latestMailSort(id);
    if (!item || !sort) return 'That mail is no longer on record.';
    // A card is closed once Done or its lapse ends it; the Product post's message of mail sorted otherwise isn't.
    if (sort.kind === 'needs-the-person' && item.cardEndedBy) return 'That card is closed.';
    if (this.#store.openMailCorrection(id)) return 'It is being sorted again after your Correction.';
    return undefined;
  }

  // ---------- Corrections ----------

  /**
   * Works through each mail Correction whose work isn't done, oldest first: its run sorts the mail again under the
   * mail role. Then sorts each Correction whose mail was sorted again. Returns whether one is left for later.
   */
  async workCorrections(): Promise<boolean> {
    let left = false;
    for (const c of this.#store.unfinishedMailCorrections()) {
      const mail = this.#store.ledgerMail(c.messageId)!;
      let ran: Ran | { unapplied: string };
      try {
        // A Correction whose run recorded its sort before a stop is done with no second run.
        ran = this.#store.mailSortOfCorrection(c.id) ? 'sorted' : await this.#runOne(mail, c);
      } catch (error) {
        left = true;
        this.#log('mail.correction-unfinished', { correction: c.id, error: errorText(error) });
        continue;
      }
      if (ran === 'bot-stopping') return false;
      if (ran === 'waiting') {
        left = true;
        continue;
      }
      if (typeof ran === 'object') {
        this.#store.saveMailCorrectionUnapplied(c.id, ran.unapplied);
        this.#log('mail.correction-unapplied', { correction: c.id, why: ran.unapplied });
      }
      this.#store.saveMailCorrectionDone(c.id, this.#clock.now().toISOString());
      await this.#show(c.messageId);
    }
    for (const c of this.#store.unsortedMailCorrections()) {
      try {
        if ((await this.#sort(c)) === 'stopped') return false;
      } catch (error) {
        left = true;
        this.#log('mail.correction-unsorted', { correction: c.id, error: errorText(error) });
      }
    }
    return left;
  }

  /** A mail-role run sorts a Correction of mail, and a proposal goes to the person; a Rule may not carry the mail. */
  async #sort(c: MailCorrection): Promise<'done' | 'stopped'> {
    const key = sortKey('mail', c.id);
    let sort = this.#store.sortOf(key);
    if (!sort) {
      const ran = await this.#runSort(c);
      if (ran === 'stopped') return 'stopped';
      sort = this.#store.sortOf(key)!;
    }
    if (sort.outcome === 'proposed') await this.#proposals.post(sort);
    this.#store.saveSortShown(key, this.#clock.now().toISOString());
    this.#log('mail.correction-sorted', { correction: c.id, outcome: sort.outcome });
    if (sort.outcome === 'declined') await this.#show(c.messageId);
    return 'done';
  }

  async #runSort(c: MailCorrection): Promise<'stopped' | void> {
    const mail = this.#store.ledgerMail(c.messageId)!;
    const product = this.#store.product(mail.productId)!;
    const kept = await this.#kept(c.messageId);
    const after = this.#store.mailSortOfCorrection(c.id)!;
    const before = this.#store.mailSortBefore(c.messageId, after.id)!;
    const name = this.#name(mail.productId);
    const item: SortedItem = {
      name: `Mail from ${name}`,
      day: dayLabel(pacificDate(new Date(mail.receivedAt))),
      taughtOn: `Gmail message ${mail.messageId} (mail from ${name}) of ${pacificDate(new Date(mail.receivedAt))}`,
      scope: 'mail',
      correction: c.text,
    };
    if (typeof kept === 'string') {
      // With the mail gone, no run could check a proposal against it, so the Correction is fix only, once.
      const why = `the mail can't be read again (${kept})`;
      this.#store.saveSort({ correction: sortKey('mail', c.id), item, outcome: 'unsorted', hardLimit: null, proposal: null, why, rulesApplied: [], runId: null, sortedAt: this.#clock.now().toISOString() });
      this.#log('correction.unsorted', { correction: sortKey('mail', c.id), why });
      return;
    }
    await this.#personalDatabase.sync();
    const interestScope = this.#personalDatabase.read(INTEREST_SCOPE_PATH);
    const prompt = sortingPrompt({
      interestScope,
      what: 'how the Assistant sorted a mail a Product sent to the Signup mailbox',
      scope: 'mail',
      note: 'A Rule or an Interest scope change drawn from mail quotes no mail text and names no sender or address: say it in general words.',
      item: ['The Product:', fence(name), `Root domain: ${product.rootDomain}`, '', ...mailLines(mail, kept)],
      before: sortText(before),
      correction: c.text,
      after: sortText(after),
    });
    return runSort({
      pi: this.#pi,
      store: this.#store,
      clock: this.#clock,
      log: this.#log,
      correction: sortKey('mail', c.id),
      role: 'mail',
      runItem: mail.messageId,
      scope: 'mail',
      item,
      interestScope,
      prompt,
      check: (proposal) => {
        const carried = mailDataIn(proposedText(proposal), kept);
        return carried && `A Rule or Interest scope change from a Correction of mail quotes no mail text and names no sender or address, and ${carried}. Say it in general words, or sort the Correction otherwise.`;
      },
    });
  }

  /** What the person decided on a proposal from a Correction of mail: nothing of it goes to the Personal database. */
  async showDecision(correctionId: number): Promise<void> {
    this.#log('mail.correction-decided', { correction: correctionId });
  }

  // ---------- Lapses ----------

  /** Lapses each card of mail that needs the person after 14 days, then arms the next lapse. */
  async #lapse(): Promise<void> {
    const now = this.#clock.now();
    for (const item of this.#store.openMailCards()) {
      if (Date.parse(item.cardPostedAt!) + LAPSE_MS > now.getTime()) continue;
      if (this.#store.endMailCard(item.messageId, 'lapse', now.toISOString())) {
        this.#log('mail.card-lapsed', { messageId: item.messageId });
        await this.#show(item.messageId);
      }
    }
    this.#armLapse();
  }

  #armLapse(): void {
    this.#cancelLapse();
    if (this.#stopped) return;
    const due = this.#store.openMailCards().map((item) => Date.parse(item.cardPostedAt!) + LAPSE_MS);
    if (due.length === 0) return;
    this.#cancelLapse = this.#clock.at(new Date(Math.min(...due)), () => this.#plainWork(() => this.#lapse()));
  }
}

/** What each of a mail's messages last showed, by a hash of it. */
const shownOf = (item: MailItem): Record<string, string> => (item.shownKey ? (JSON.parse(item.shownKey) as Record<string, string>) : {});

const hashOf = (payload: MessagePayload) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

/** The lines of a mail run's prompt that give the mail, its text fenced. */
function mailLines(mail: LedgerMail, kept: KeptMail): string[] {
  return [
    'The mail:',
    'From:',
    fence(kept.sender ?? kept.from ?? '(none)'),
    ...(kept.replyTo ? ['Reply-To:', fence(kept.replyTo)] : []),
    'Subject:',
    fence(kept.subject || '(none)'),
    `Received: ${new Date(mail.receivedAt).toISOString()}`,
    `Bulk: ${mail.bulk ? 'yes, it carries List-Unsubscribe' : 'no'}`,
    `In Spam: ${mail.spam ? 'yes' : 'no'}`,
    'Its text:',
    fence(kept.text || '(none)'),
  ];
}

/** A mail run's prompt: the Product, its Registration, and the mail; for a Correction, the earlier sort and what the person wrote. */
function mailPrompt(product: { name: string; rootDomain: string }, registration: string, mail: LedgerMail, kept: KeptMail, correction?: { before: MailSort; text: string }): string {
  return [
    'The Product:',
    fence(product.name),
    `Root domain: ${product.rootDomain}`,
    registration,
    '',
    ...mailLines(mail, kept),
    '',
    ...(correction
      ? [
          'The Assistant sorted this mail before as:',
          fence(sortText(correction.before)),
          'The person corrected that. Their Correction, what they say it got wrong:',
          fence(correction.text),
          '',
          'Sort the mail again with their Correction, and record it with record_mail.',
        ]
      : ['Sort the mail, and record it with record_mail.']),
  ].join('\n');
}

/** A sort as a prompt gives it. */
function sortText(sort: MailSort): string {
  return [`kind: ${sort.kind}`, `gist: ${sort.gist ?? '(forgotten)'}`, ...(sort.wants ? [`wants: ${sort.wants}`] : [])].join('\n');
}

/** The text a proposal would put in the Personal database, which may not carry the mail. */
function proposedText(proposal: Proposal): string {
  if (proposal.kind === 'interest-scope') {
    const before = new Set(proposal.before.split('\n'));
    return proposal.after
      .split('\n')
      .filter((line) => !before.has(line))
      .join('\n');
  }
  return `${proposal.kind === 'rule' ? `${proposal.name}\n` : ''}${proposal.statement}`;
}
