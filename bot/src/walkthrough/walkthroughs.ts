// Walkthroughs (#53, #10, #11, #12), while the config has them on (#99): once an open or waitlisted Product's post is
// up, plain code reads its signup page again, live, and a registration-role run prepares the Walkthrough from that
// read, the Dossier and the Profile. Card fields on the page, or a wall the run names that nothing can get past, mean
// no Walkthrough, and the Dossier says why. Otherwise its card goes to #needs-you, a copy of each version goes to the
// Product's post, the post is tagged *Walkthrough*, and the Dossier's Register line says where it is.
// The person then:
// - edits one field, which makes a new version of the same card with a fresh Approve, and is no Correction;
// - corrects it, which turns Approve off at once; a registration-role run prepares it again with their Correction, the
//   new version comes as a new card, and the Correction is sorted as a Miner one is (#49);
// - dismisses it, which ends it with no Correction;
// - or approves it, with one tap that locks the card and starts the Registration as *queued*, or as *handed off* when
//   its terms ban accounts made by a bot. A Walkthrough with a password field first gets its vault item, and while
//   Bitwarden is unavailable its Approval is held, the card saying so, until the item is saved (ADR 0004).
// An unanswered Walkthrough lapses after 14 days, with Prepare again. Every step is kept in the store before its work,
// so a stop picks up where it left off.
import type { BrowserService, PageRead } from '../browser.ts';
import { inMinutes, type Clock } from '../clock.ts';
import type { Config } from '../config.ts';
import { cut, Flags, popup, text, type MessagePayload, type Popup } from '../discord/components.ts';
import { refused, type DiscordRest } from '../discord/rest.ts';
import type { Dossier } from '../dossier/dossier.ts';
import type { Dossiers } from '../dossier/dossiers.ts';
import { fence } from '../fence.ts';
import { errorText, type Log } from '../log.ts';
import { CORRECTION_FIELD } from '../miner/corrections.ts';
import type { NeedsYou } from '../needs-you.ts';
import { dayLabel, pacificDate, pacificTime } from '../pacific.ts';
import type { PersonalDatabase } from '../personal-database.ts';
import type { PiRunner } from '../pi-runs.ts';
import type { RawInputs } from '../raw-inputs.ts';
import type { Proposals } from '../rules/proposals.ts';
import { runSort, unrecorded } from '../rules/sort-run.ts';
import { decidedText, INTEREST_SCOPE_PATH, sortingPrompt, sortKey, type SortedItem } from '../rules/sorting.ts';
import type { Product, StoredRegistration, StoredWalkthrough, Store, WalkthroughCorrection } from '../store.ts';
import { PasswordVaultUnavailable, type PasswordVault } from '../password-vault.ts';
import {
  approvedLine,
  cardText,
  CHOICE_OPTIONS,
  dismissedLine,
  editable,
  editId,
  preparedAgainLine,
  replacedLine,
  statusMessage,
  walkthroughAction,
  walkthroughCard,
  walkthroughCopy,
  withdrawnLine,
  type CardState,
  type VersionCause,
  type VersionShown,
} from './card.ts';
import { PROFILE_PATH, walkthroughPrompt } from './prompt.ts';
import { registrationFileOf } from './registration-file.ts';
import { hasPasswordField, identityOf, plusTagOf, readWalkthrough, VALUE_CHARS, versionHash, type Prepared, type Walkthrough, type WalkthroughField } from './walkthrough.ts';

/** How long a Walkthrough waits unanswered before it lapses (#11). */
const LAPSE_MS = 14 * 24 * 60 * 60 * 1000;
/** How often Bitwarden is tried again for an Approval held on it: the person has just tapped, and no run is spent. */
const HELD_RETRY_MINUTES = 5;

/** What a tap or a pop-up answers with, the work it leaves to do, or why it is refused. */
export type Tapped =
  | { update: MessagePayload; work?: () => Promise<void> }
  | { popup: Popup }
  | { refused: string }
  /** Refused, with the current version shown to the person alone. */
  | { stale: MessagePayload };

/** Whether a step's work is done, the Assistant stopped it, or why it isn't done yet. */
type Done = 'done' | 'stopped' | { problem: string };

export class Walkthroughs {
  #config: Config;
  #store: Store;
  #browser: BrowserService;
  #pi: PiRunner;
  #discord: DiscordRest;
  #needsYou: NeedsYou;
  #dossiers: Dossiers;
  #personalDatabase: PersonalDatabase;
  #proposals: Proposals;
  #rawInputs: RawInputs;
  #passwordVault: PasswordVault;
  #walkthroughsDue: () => void;
  #correctionsDue: () => void;
  #plainWork: (work: () => Promise<void>) => void;
  #clock: Clock;
  #log: Log;
  #cancelLapse = () => {};
  #cancelHeldRetry = () => {};
  /** The Products whose Registration is being started now, so a retry can't make a second vault item beside a tap's. */
  #starting = new Set<number>();
  /** The Products whose card already says it waits for Bitwarden. */
  #waitingShown = new Set<number>();
  #stopped = false;

  constructor(options: {
    config: Config;
    store: Store;
    browser: BrowserService;
    pi: PiRunner;
    discord: DiscordRest;
    needsYou: NeedsYou;
    dossiers: Dossiers;
    personalDatabase: PersonalDatabase;
    proposals: Proposals;
    rawInputs: RawInputs;
    passwordVault: PasswordVault;
    /** Queues the preparation of each Walkthrough now due, in the background lane. */
    walkthroughsDue(): void;
    /** Queues the work of the Walkthrough Corrections sent, in the background lane. */
    correctionsDue(): void;
    /** Does plain-code work at once, outside the lane, such as a lapse. */
    plainWork(work: () => Promise<void>): void;
    clock: Clock;
    log: Log;
  }) {
    this.#config = options.config;
    this.#store = options.store;
    this.#browser = options.browser;
    this.#pi = options.pi;
    this.#discord = options.discord;
    this.#needsYou = options.needsYou;
    this.#dossiers = options.dossiers;
    this.#personalDatabase = options.personalDatabase;
    this.#proposals = options.proposals;
    this.#rawInputs = options.rawInputs;
    this.#passwordVault = options.passwordVault;
    this.#walkthroughsDue = options.walkthroughsDue;
    this.#correctionsDue = options.correctionsDue;
    this.#plainWork = options.plainWork;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  stop(): void {
    this.#stopped = true;
    this.#cancelLapse();
    this.#cancelHeldRetry();
  }

  // ---------- Preparing ----------

  /**
   * Shows each prepared version not yet shown, then prepares the Walkthrough of each Product due one, oldest first. One
   * that can't be prepared doesn't stop the rest. Returns whether one is left for later, such as a page that won't load.
   */
  async prepareDue(): Promise<boolean> {
    let left = false;
    for (const v of this.#store.unshownWalkthroughs()) {
      // A Correction's version is shown by its Correction's work, and an Edit's at the start.
      if (v.shownAt || v.cause.kind === 'corrected' || v.cause.kind === 'edited') continue;
      try {
        await this.#showVersion(v);
      } catch (error) {
        left = true;
        this.#log('walkthrough.unshown', { productId: v.productId, version: v.version, error: errorText(error) });
      }
    }
    for (const product of this.#store.productsDueWalkthrough()) {
      let done: Done;
      try {
        done = await this.#prepare(product);
      } catch (error) {
        done = { problem: `the Assistant hit an error (${errorText(error)})` };
      }
      if (done === 'stopped') return false;
      if (done !== 'done') {
        left = true;
        this.#log('walkthrough.unprepared', { productId: product.id, rootDomain: product.rootDomain, problem: done.problem });
      }
    }
    return left;
  }

  async #prepare(product: Product): Promise<Done> {
    // Nothing is read for a run that can't start.
    const noProvider = this.#pi.noProviderLeft('registration');
    if (noProvider) return { problem: noProvider };
    const { dossier } = this.#store.latestDossier(product.id)!;
    const previous = this.#store.latestWalkthrough(product.id);
    const readAt = this.#clock.now();
    const read = await this.#browser.read(dossier.startUrl);
    if (!read.ok) return { problem: `its signup page won't load (${read.error})` };
    this.#rawInputs.keep('pages', product.rootDomain, JSON.stringify({ url: dossier.startUrl, readAt: readAt.toISOString(), page: read.page }));
    let prepared: Prepared;
    let runId: string | null = null;
    if (read.page.paymentFields) {
      // Card fields are a wall nothing gets past (#10), which plain code sees itself.
      prepared = { none: 'its signup page asks for card details' };
    } else {
      const ran = await this.#run(product, dossier, read.page, readAt);
      if (ran === 'stopped' || 'problem' in ran) return ran;
      ({ prepared, runId } = ran);
    }
    const at = this.#clock.now().toISOString();
    if ('none' in prepared) {
      this.#store.saveNoWalkthrough(product.id, prepared.none, at);
      this.#log('walkthrough.none', { productId: product.id, rootDomain: product.rootDomain, why: prepared.none, runId });
      await this.#showNone(product.id);
      return 'done';
    }
    const { walkthrough } = prepared;
    const version = this.#store.saveWalkthrough({
      productId: product.id,
      walkthrough,
      hash: versionHash(walkthrough),
      read: read.page,
      cause: previous ? { kind: 'prepared-again' } : { kind: 'prepared' },
      runId,
      preparedAt: at,
    });
    this.#log('walkthrough.prepared', { productId: product.id, rootDomain: product.rootDomain, version, runId });
    await this.#showVersion(this.#store.walkthrough(product.id, version)!);
    return 'done';
  }

  /** A Walkthrough preparation run over a read, or a Correction's run over the read its version was prepared from. */
  async #run(
    product: Product,
    dossier: Dossier,
    read: PageRead,
    readAt: Date,
    correction?: { version: number; shown: string; text: string },
  ): Promise<{ prepared: Prepared; runId: string } | 'stopped' | { problem: string }> {
    // The run reads the Profile as GitHub has it.
    await this.#personalDatabase.sync();
    const profile = this.#personalDatabase.find(PROFILE_PATH) ?? null;
    const identity = identityOf(this.#config.signupMailbox, this.#store.signupTag(product.id, plusTagOf(dossier.name, product.rootDomain)));
    let kept: Prepared | undefined;
    const result = await this.#pi.run({
      kind: 'walkthrough-preparation',
      role: 'registration',
      item: product.rootDomain,
      prompt: walkthroughPrompt({ profile, dossier, read, readAt, ...(correction ? { correction } : {}) }),
      onRecord: (record, runId) => {
        if (kept) return { ok: false, error: 'The Walkthrough is recorded already; reply with one short line and stop.' };
        const checked = readWalkthrough(record, { product: dossier.name.trim(), rootDomain: product.rootDomain, read, readAt, offers: dossier.record.offers, identity });
        if (!checked.ok) return checked;
        if ('walkthrough' in checked.prepared && !showable(checked.prepared.walkthrough, correction?.text, this.#config.discord.needsYouChannelId)) {
          return { ok: false, error: 'That Walkthrough is too long to show on one Discord card. Record it with shorter values.' };
        }
        kept = checked.prepared;
        this.#log('walkthrough.recorded', { productId: product.id, runId, none: 'none' in kept });
        return { ok: true, message: 'Recorded the Walkthrough.' };
      },
    });
    if (kept) return { prepared: kept, runId: result.runId };
    if (result.outcome === 'stopped') return 'stopped';
    return { problem: unrecorded(result, 'Walkthrough') };
  }

  // ---------- Showing ----------

  /**
   * Shows a new version: its card in #needs-you, once, with the card it replaces shrunk to a line; its copy in the
   * Product's post, once; and the Dossier and the post's tags saying where it is. An Edit's version is on the card it
   * edits, which its answer rewrote, so here only the card is drawn again in case Discord didn't take that.
   */
  async #showVersion(v: StoredWalkthrough): Promise<void> {
    const product = this.#store.product(v.productId)!;
    const shown = this.#shown(v);
    if (v.cause.kind === 'edited') {
      if (v.cardMessageId) await this.#needsYou.edit(v.cardMessageId, this.#cardPayload(v));
    } else if (!v.cardIntended) {
      const { heading, body, buttons } = walkthroughCard(shown, this.#cardState(v));
      this.#store.saveWalkthroughCardIntended(v.productId, v.version, true);
      try {
        const { messageId } = await this.#needsYou.post(heading, body, { buttons });
        this.#store.saveWalkthroughCard(v.productId, v.version, messageId);
      } catch (error) {
        if (refused(error)) this.#store.saveWalkthroughCardIntended(v.productId, v.version, false);
        throw error;
      }
    }
    const before = v.cause.kind === 'edited' ? undefined : this.#store.walkthrough(v.productId, v.version - 1);
    if (before?.cardMessageId) {
      const line =
        v.cause.kind === 'prepared-again'
          ? preparedAgainLine(v.walkthrough, before.version, v.version, product.threadId!)
          : replacedLine(v.walkthrough, v.version, product.threadId!);
      await this.#needsYou.shrink(before.cardMessageId, line);
    }
    await this.#postCopy(v, product);
    await this.#dossiers.restand(v.productId);
    this.#store.saveWalkthroughShown(v.productId, v.version, this.#clock.now().toISOString());
    this.#log('walkthrough.shown', { productId: v.productId, version: v.version });
    this.#armLapse();
  }

  /** The version's copy in the Product's post, without buttons, once. An uncertain send counts as sent (ADR 0007). */
  async #postCopy(v: StoredWalkthrough, product: Product): Promise<void> {
    if (v.copyIntended) return;
    this.#store.saveWalkthroughCopyIntended(v.productId, v.version, true);
    try {
      const copy = walkthroughCopy(this.#shown(v), this.#config.discord.needsYouChannelId, new Date(v.preparedAt));
      const { messageId } = await this.#discord.sendMessage(product.threadId!, copy);
      this.#store.saveWalkthroughCopy(v.productId, v.version, messageId);
    } catch (error) {
      if (refused(error)) this.#store.saveWalkthroughCopyIntended(v.productId, v.version, false);
      throw error;
    }
  }

  /** Shows that a Product gets no Walkthrough: its Dossier and `registration.md` say why. */
  async #showNone(productId: number): Promise<void> {
    await this.#dossiers.restand(productId);
    this.#personalDatabase.queue(registrationFileOf(this.#store, productId, 'no Walkthrough'));
    await this.#personalDatabase.sync();
    this.#store.saveNoWalkthroughShown(productId, this.#clock.now().toISOString());
  }

  /** Shows a version dismissed or lapsed: its card as such, and the Dossier and the post's tags. */
  async #showEnd(v: StoredWalkthrough): Promise<void> {
    const product = this.#store.product(v.productId)!;
    if (v.cardMessageId) {
      if (v.dismissedAt) await this.#needsYou.shrink(v.cardMessageId, dismissedLine(v.walkthrough, v.version, product.threadId!));
      else await this.#needsYou.edit(v.cardMessageId, this.#cardPayload(v));
    }
    await this.#dossiers.restand(v.productId);
    this.#store.saveWalkthroughEndShown(v.productId, v.version, this.#clock.now().toISOString());
  }

  /**
   * Starts a Registration its Approval asked for: its vault item first, if it is held on one, then showing it. While
   * Bitwarden is unavailable it stays held, and is tried again.
   */
  async #startRegistration(productId: number): Promise<void> {
    if (this.#starting.has(productId)) return;
    this.#starting.add(productId);
    try {
      const registration = this.#store.registration(productId)!;
      if (registration.state === 'held' && !(await this.#saveVaultItem(registration))) return;
      await this.#showRegistration(productId);
    } finally {
      this.#starting.delete(productId);
    }
  }

  /**
   * Creates the held Registration's one vault item, and starts it. A create that may have reached the Password vault, because
   * the bot stopped during one or its answer never came, is read back first, so no second item is made (ADR 0007).
   * Returns false while Bitwarden is unavailable.
   */
  async #saveVaultItem(registration: StoredRegistration): Promise<boolean> {
    const { productId } = registration;
    const v = this.#store.walkthrough(productId, registration.version)!;
    const { walkthrough: w } = v;
    const login = { name: w.product, website: `https://${w.rootDomain}`, username: w.identity.plusAddress };
    let itemId: string | undefined;
    try {
      itemId = registration.vaultItemIntended ? await this.#passwordVault.findItem(login) : undefined;
      if (itemId) {
        this.#log('vault-item.found', { productId, itemId });
      } else {
        this.#store.saveRegistrationVaultIntended(productId);
        itemId = await this.#passwordVault.createItem(login);
        this.#log('vault-item.created', { productId, itemId });
      }
    } catch (error) {
      if (!(error instanceof PasswordVaultUnavailable)) throw error;
      this.#log('password-vault.unavailable', { productId, why: error.message });
      this.#armHeldRetry();
      await this.#showWaiting(v, registration);
      return false;
    }
    this.#store.saveRegistrationVaultItem(productId, itemId, startingState(w));
    this.#waitingShown.delete(productId);
    return true;
  }

  /** Says on the card, once, that its Approval waits for Bitwarden. */
  async #showWaiting(v: StoredWalkthrough, registration: StoredRegistration): Promise<void> {
    if (this.#waitingShown.has(v.productId) || !v.cardMessageId) return;
    await this.#needsYou.edit(v.cardMessageId, this.#cardPayload(v, { kind: 'waiting-for-bitwarden', approvedAt: new Date(registration.approvedAt) }));
    this.#waitingShown.add(v.productId);
  }

  /** Tries Bitwarden again for each Approval held on it, while one is. */
  #armHeldRetry(): void {
    this.#cancelHeldRetry();
    if (this.#stopped || this.#store.heldRegistrations().length === 0) return;
    this.#cancelHeldRetry = inMinutes(this.#clock, HELD_RETRY_MINUTES, () =>
      this.#plainWork(async () => {
        for (const { productId } of this.#store.heldRegistrations()) await this.#resumed(productId, () => this.#startRegistration(productId));
        this.#armHeldRetry();
      }),
    );
  }

  /** Shows a Registration its Approval started: the card locked to its line, the status message, the tags and git. */
  async #showRegistration(productId: number): Promise<void> {
    const registration = this.#store.registration(productId)!;
    if (registration.shownAt) return;
    const v = this.#store.walkthrough(productId, registration.version)!;
    const product = this.#store.product(productId)!;
    const approvedAt = new Date(registration.approvedAt);
    if (v.cardMessageId) await this.#needsYou.shrink(v.cardMessageId, approvedLine(v.walkthrough, v.version, approvedAt, product.threadId!));
    if (!registration.statusIntended) {
      this.#store.saveRegistrationStatusIntended(productId, true);
      try {
        const status = statusMessage({ productId, walkthrough: v.walkthrough, version: v.version, approvedAt, state: registration.state === 'handed-off' ? 'handed-off' : 'queued' });
        const { messageId } = await this.#discord.sendMessage(product.threadId!, status);
        this.#store.saveRegistrationStatus(productId, messageId);
      } catch (error) {
        if (refused(error)) this.#store.saveRegistrationStatusIntended(productId, false);
        throw error;
      }
    }
    await this.#dossiers.restand(productId);
    this.#personalDatabase.queue(registrationFileOf(this.#store, productId, `Walkthrough v${v.version} approved`));
    await this.#personalDatabase.sync();
    this.#store.saveRegistrationShown(productId, this.#clock.now().toISOString());
    this.#log('registration.shown', { productId, version: v.version, state: registration.state });
  }

  /**
   * As after a stop: starts each Registration held on the Password vault, shows each Approval, Edit, dismissal and lapse whose
   * work wasn't done, and arms the lapse of each Walkthrough still waiting. The background lane shows prepared versions
   * and Corrections' work.
   */
  async resume(): Promise<void> {
    for (const r of this.#store.unshownRegistrations()) {
      await this.#resumed(r.productId, () => this.#startRegistration(r.productId));
    }
    for (const v of this.#store.unshownWalkthroughs()) {
      if (!v.shownAt && v.cause.kind === 'edited') await this.#resumed(v.productId, () => this.#showVersion(v));
      else if (v.shownAt && (v.dismissedAt || v.lapsedAt)) await this.#resumed(v.productId, () => this.#showEnd(v));
    }
    this.#armLapse();
  }

  async #resumed(productId: number, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.#log('walkthrough.resume-failed', { productId, error: errorText(error) });
    }
  }

  // ---------- Lapsing ----------

  /** Lapses each Walkthrough unanswered for 14 days: its buttons turn off, and Prepare again appears. */
  async lapse(): Promise<void> {
    const now = this.#clock.now();
    for (const v of this.#store.openWalkthroughs()) {
      if (Date.parse(v.preparedAt) + LAPSE_MS > now.getTime()) continue;
      if (!this.#store.saveWalkthroughLapsed(v.productId, v.version, now.toISOString())) continue;
      this.#log('walkthrough.lapsed', { productId: v.productId, version: v.version });
      await this.#resumed(v.productId, () => this.#showEnd(this.#store.walkthrough(v.productId, v.version)!));
    }
    this.#armLapse();
  }

  /** Arms the lapse of the Walkthrough waiting longest, if one waits. */
  #armLapse(): void {
    this.#cancelLapse();
    if (this.#stopped) return;
    const open = this.#store.openWalkthroughs();
    if (open.length === 0) return;
    const next = Math.min(...open.map((v) => Date.parse(v.preparedAt) + LAPSE_MS));
    this.#cancelLapse = this.#clock.at(new Date(next), () => this.#plainWork(() => this.lapse()));
  }

  // ---------- Taps and pop-ups ----------

  /**
   * The person tapped a button on a Walkthrough's card, the message `messageId`. Undefined if it isn't one. A card
   * whose send was uncertain is known by the tap on it.
   */
  tap(customId: string, interaction: { userId: string; interactionId: string; messageId: string | undefined }): Tapped | undefined {
    const tapped = walkthroughAction(customId);
    if (!tapped) return undefined;
    const { action, productId, version } = tapped;
    this.#keepCard(productId, version, interaction.messageId);
    if (action === 'edit') return this.#editPopup(productId, version, tapped.field!);
    const found = this.#tapped(productId, version, action === 'approve', action === 'again');
    if ('refused' in found || 'stale' in found) return found;
    const { v } = found;
    const at = this.#clock.now().toISOString();
    switch (action) {
      case 'approve': {
        const approved = this.#store.approveWalkthrough({
          productId,
          version,
          versionHash: v.hash,
          userId: interaction.userId,
          interactionId: interaction.interactionId,
          approvedAt: at,
          state: hasPasswordField(v.walkthrough) ? 'held' : startingState(v.walkthrough),
        });
        if (approved !== 'approved') return { refused: `Already approved at ${pacificTime(new Date(approved.already.approvedAt))}.` };
        this.#log('walkthrough.approved', { productId, version, interactionId: interaction.interactionId });
        return { update: this.#cardPayload(v, { kind: 'approving' }), work: () => this.#startRegistration(productId) };
      }
      case 'correct':
        return { popup: popup(customId, `Correct · Walkthrough v${version} · ${v.walkthrough.product}`, [], CORRECTION_FIELD) };
      case 'dismiss': {
        if (!this.#store.saveWalkthroughDismissed(productId, version, at)) return { refused: 'It was decided already.' };
        this.#log('walkthrough.dismissed', { productId, version });
        const product = this.#store.product(productId)!;
        return {
          update: this.#needsYou.shrunk(dismissedLine(v.walkthrough, version, product.threadId!)),
          work: () => this.#showEnd(this.#store.walkthrough(productId, version)!),
        };
      }
      default: {
        if (!this.#store.saveWalkthroughAgainTapped(productId, version, at)) return { refused: 'It is being prepared again already.' };
        this.#log('walkthrough.again-tapped', { productId, version });
        return { update: this.#cardPayload(this.#store.walkthrough(productId, version)!, { kind: 'preparing-again' }), work: async () => this.#walkthroughsDue() };
      }
    }
  }

  /**
   * The person sent a pop-up opened from a Walkthrough's card, the message `messageId`, whose fields `field` reads by
   * id. Undefined if it isn't one.
   */
  submit(customId: string, field: (customId: string) => string | undefined, messageId: string | undefined): Tapped | undefined {
    const sent = walkthroughAction(customId);
    if (sent?.action !== 'edit' && sent?.action !== 'correct') return undefined;
    const { productId, version } = sent;
    this.#keepCard(productId, version, messageId);
    if (sent.action === 'edit') return this.#saveEdit(productId, version, sent.field!, field(EDIT_FIELD) ?? '');
    const found = this.#tapped(productId, version, false, false);
    if ('refused' in found || 'stale' in found) return found;
    const text = (field(CORRECTION_FIELD.customId) ?? '').trim();
    if (!text) return { refused: 'Say what the Walkthrough got wrong, and Correct again.' };
    const id = this.#store.saveWalkthroughCorrection({ productId, version, text, submittedAt: this.#clock.now().toISOString() });
    this.#log('walkthrough.correction-submitted', { id, productId, version });
    // Approve is off the moment the Correction is kept, and stays off until the version it brings.
    return { update: this.#cardPayload(found.v, { kind: 'correcting' }), work: async () => this.#correctionsDue() };
  }

  /** Keeps the card a version is shown on, from a tap on it, when its send was uncertain (ADR 0007). */
  #keepCard(productId: number, version: number, messageId: string | undefined): void {
    const v = this.#store.walkthrough(productId, version);
    if (v && !v.cardMessageId && messageId) this.#store.saveWalkthroughCard(productId, version, messageId);
  }

  /**
   * The latest version a tap on this version may act on, or why it may not: it is out of date, approved, ended, or
   * under a Correction. A tap on an older version shows the person the current one.
   */
  #tapped(productId: number, version: number, approving: boolean, again: boolean): { v: StoredWalkthrough } | { refused: string } | { stale: MessagePayload } {
    const latest = this.#store.latestWalkthrough(productId);
    if (!latest || version > latest.version) return { refused: 'That Walkthrough is no longer on record.' };
    const approval = this.#store.walkthroughApproval(productId);
    if (approval) {
      const at = pacificTime(new Date(approval.approvedAt));
      return { refused: approving && approval.version === version ? `Already approved at ${at}.` : `v${approval.version} was approved at ${at}; nothing on it changes now.` };
    }
    const none = this.#store.noWalkthrough(productId);
    if (none) return { refused: `No Walkthrough is offered any more: ${none.why}.` };
    // What becomes of a waiting Walkthrough when its Dossier is withdrawn is #66's; until then it can't be acted on.
    if (this.#store.product(productId)?.withdrawnAt) return { refused: 'Its Dossier was withdrawn after your Correction, so nothing on it can be done now.' };
    if (version < latest.version) return { stale: this.#staleAnswer(version, latest) };
    if (latest.dismissedAt) return { refused: 'It was dismissed.' };
    if (latest.lapsedAt && !again) return { refused: latest.againTappedAt ? 'It is being prepared again.' : 'It lapsed. Tap Prepare again for a fresh one.' };
    if (!latest.lapsedAt && again) return { refused: 'Only a lapsed Walkthrough is prepared again.' };
    if (this.#underCorrection(latest)) return { refused: 'It is being prepared again after your Correction.' };
    return { v: latest };
  }

  /** The person's tap on an older version is refused, with the current version shown to them alone. */
  #staleAnswer(version: number, latest: StoredWalkthrough): MessagePayload {
    const card = this.#cardPayload(latest);
    return {
      flags: Flags.EPHEMERAL | Flags.IS_COMPONENTS_V2,
      components: [text(`Nothing was done: v${version} is out of date. This is v${latest.version}, the current version.`), ...card.components],
      allowed_mentions: { parse: [] },
    };
  }

  /** The Edit pop-up of one field: one field holding its value, or a radio group for a choice. */
  #editPopup(productId: number, version: number, index: number): Tapped {
    const found = this.#tapped(productId, version, false, false);
    if ('refused' in found || 'stale' in found) return found;
    const f = found.v.walkthrough.fields[index];
    if (!f || !editable(f)) return { refused: 'That field can’t be edited.' };
    const id = editId({ productId, version }, index);
    const title = `Edit · ${f.label}`;
    if (f.key === 'choice') return { popup: radioPopup(id, title, f) };
    return { popup: popup(id, title, [], { customId: EDIT_FIELD, label: cutLabel(f.label), maxLength: VALUE_CHARS, oneLine: true, required: false, value: f.value ?? '' }) };
  }

  /** Keeps the person's Edit of one field as a new version of the same card, with a fresh Approve. */
  #saveEdit(productId: number, version: number, index: number, entered: string): Tapped {
    const found = this.#tapped(productId, version, false, false);
    if ('refused' in found) return found;
    if ('stale' in found) return { refused: 'It changed since you opened Edit; the card shows the current version.' };
    const { v } = found;
    const f = v.walkthrough.fields[index];
    if (!f || !editable(f)) return { refused: 'That field can’t be edited.' };
    const value = entered.replace(/\s+/g, ' ').trim();
    let next: string | null;
    if (f.key === 'choice') {
      const picked = f.options!.find((o) => o === value);
      if (!picked) return { refused: `Pick one of ${f.options!.join(', ')}.` };
      next = picked;
    } else {
      if (value.length > VALUE_CHARS) return { refused: `A value is at most ${VALUE_CHARS} characters. Edit it again.` };
      next = value || null;
    }
    if (next === f.value) return { refused: 'That is its value already.' };
    // An Offer code the person types is theirs, from no Offer the Assistant knows of.
    const fields: WalkthroughField[] = v.walkthrough.fields.map((x, i) => {
      if (i !== index) return x;
      const { offer: _, ...rest } = x;
      return { ...rest, value: next };
    });
    const walkthrough = { ...v.walkthrough, fields };
    const edited = this.#store.saveWalkthrough({
      productId,
      walkthrough,
      hash: versionHash(walkthrough),
      read: v.read,
      cause: { kind: 'edited', field: f.label },
      runId: null,
      preparedAt: this.#clock.now().toISOString(),
      cardMessageId: v.cardMessageId,
    });
    this.#log('walkthrough.edited', { productId, version: edited, field: index });
    const saved = this.#store.walkthrough(productId, edited)!;
    return { update: this.#cardPayload(saved), work: () => this.#showVersion(saved) };
  }

  // ---------- Corrections ----------

  /**
   * Works through every Walkthrough Correction whose work isn't done, oldest first, then sorts each one whose item is
   * redone and isn't sorted yet. Returns whether one is left for later.
   */
  async workCorrections(): Promise<boolean> {
    let left = false;
    for (const { id } of this.#store.unfinishedWalkthroughCorrections()) {
      let done: Done;
      try {
        done = await this.#finishCorrection(id);
      } catch (error) {
        done = { problem: `the Assistant hit an error (${errorText(error)})` };
      }
      if (done === 'stopped') return false;
      if (done !== 'done') {
        left = true;
        this.#log('walkthrough.correction-unfinished', { id, problem: done.problem });
      }
    }
    for (const correction of this.#store.unsortedWalkthroughCorrections()) {
      try {
        if ((await this.#sort(correction)) === 'stopped') return false;
      } catch (error) {
        left = true;
        this.#log('walkthrough.correction-unsorted', { id: correction.id, error: errorText(error) });
      }
    }
    return left;
  }

  /**
   * A Correction's run prepares the Walkthrough again from the read its version came from, with what the person
   * wrote; what came of it is then shown: the new version as a new card, no Walkthrough at all, or the corrected
   * version open again, saying why the Correction couldn't be applied.
   */
  async #finishCorrection(id: number): Promise<Done> {
    let c = this.#store.walkthroughCorrection(id)!;
    const corrected = this.#store.walkthrough(c.productId, c.version)!;
    const product = this.#store.product(c.productId)!;
    if (c.redoneVersion === null && c.withdrawn === null && c.unapplied === null) {
      const { dossier } = this.#store.latestDossier(c.productId)!;
      const ran = await this.#run(product, dossier, corrected.read, new Date(corrected.walkthrough.readAt), {
        version: c.version,
        shown: cardText(this.#shown(corrected)),
        text: c.text,
      });
      if (ran === 'stopped') return 'stopped';
      const at = this.#clock.now().toISOString();
      if ('problem' in ran) {
        this.#store.saveWalkthroughCorrectionUnapplied(id, ran.problem);
      } else if ('none' in ran.prepared) {
        this.#store.saveWalkthroughCorrectionWithdrawn(id, ran.prepared.none, at);
      } else {
        const { walkthrough } = ran.prepared;
        const cause = { kind: 'corrected' as const, text: c.text };
        this.#store.saveWalkthrough({ productId: c.productId, walkthrough, hash: versionHash(walkthrough), read: corrected.read, cause, runId: ran.runId, preparedAt: at, correctionId: id });
      }
      c = this.#store.walkthroughCorrection(id)!;
      this.#log('walkthrough.corrected', { id, productId: c.productId, version: c.redoneVersion, withdrawn: c.withdrawn, unapplied: c.unapplied });
    }
    if (c.redoneVersion !== null) {
      const redone = this.#store.walkthrough(c.productId, c.redoneVersion)!;
      if (!redone.shownAt) await this.#showVersion(redone);
    } else if (c.withdrawn !== null) {
      if (corrected.cardMessageId) await this.#needsYou.shrink(corrected.cardMessageId, withdrawnLine(corrected.walkthrough, c.version, c.withdrawn, product.threadId!));
      await this.#showNone(c.productId);
    } else if (corrected.cardMessageId) {
      await this.#needsYou.edit(corrected.cardMessageId, this.#cardPayload(corrected, { kind: 'open', note: unappliedNote(c.unapplied!) }));
    }
    this.#store.saveWalkthroughCorrectionDone(id, this.#clock.now().toISOString());
    this.#personalDatabase.queue(registrationFileOf(this.#store, c.productId, `Walkthrough v${c.version} corrected`));
    await this.#personalDatabase.sync();
    this.#armLapse();
    return 'done';
  }

  /**
   * Once a Correction's Walkthrough is redone and shown, a registration-role run sorts it under the Walkthrough and
   * Registration Rules, and `registration.md` shows what came of it.
   */
  async #sort(c: WalkthroughCorrection): Promise<'done' | 'stopped'> {
    const key = sortKey('walkthrough', c.id);
    let sort = this.#store.sortOf(key);
    if (!sort) {
      if ((await this.#runSort(c)) === 'stopped') return 'stopped';
      sort = this.#store.sortOf(key)!;
    }
    if (sort.outcome === 'proposed') await this.#proposals.post(sort);
    else await this.#showSort(c.productId, sort.outcome === 'declined' ? 'is declined' : 'is fix only', c);
    this.#store.saveSortShown(key, this.#clock.now().toISOString());
    this.#log('walkthrough.correction-sorted', { id: c.id, outcome: sort.outcome });
    return 'done';
  }

  /** Shows in `registration.md` what the person decided on the proposal a Walkthrough Correction's sort made. */
  async showDecision(correctionId: number): Promise<void> {
    const c = this.#store.walkthroughCorrection(correctionId)!;
    await this.#showSort(c.productId, decidedText(this.#store.sortOf(sortKey('walkthrough', correctionId))!), c);
  }

  async #showSort(productId: number, what: string, c: WalkthroughCorrection): Promise<void> {
    this.#personalDatabase.queue(registrationFileOf(this.#store, productId, `your Correction of Walkthrough v${c.version} ${what}`));
    await this.#personalDatabase.sync();
  }

  async #runSort(c: WalkthroughCorrection): Promise<'stopped' | void> {
    const product = this.#store.product(c.productId)!;
    const corrected = this.#store.walkthrough(c.productId, c.version)!;
    const name = corrected.walkthrough.product;
    const item: SortedItem = {
      name: `${name} Walkthrough`,
      day: dayLabel(pacificDate(new Date(c.submittedAt))),
      taughtOn: `Walkthrough v${c.version} of ${name} (${product.rootDomain})`,
      scope: 'registration',
      correction: c.text,
    };
    const after = c.redoneVersion !== null ? cardText(this.#shown(this.#store.walkthrough(c.productId, c.redoneVersion)!)) : `No Walkthrough: ${c.withdrawn}.`;
    await this.#personalDatabase.sync();
    const interestScope = this.#personalDatabase.read(INTEREST_SCOPE_PATH);
    const prompt = sortingPrompt({
      interestScope,
      what: 'the Walkthrough it prepared for registering at a Product',
      scope: 'registration',
      item: ['The Product:', fence(name), `Root domain: ${product.rootDomain}`],
      before: cardText(this.#shown(corrected)),
      correction: c.text,
      after,
    });
    return runSort({
      pi: this.#pi,
      store: this.#store,
      clock: this.#clock,
      log: this.#log,
      correction: sortKey('walkthrough', c.id),
      role: 'registration',
      runItem: product.rootDomain,
      scope: 'registration',
      item,
      interestScope,
      prompt,
    });
  }

  // ---------- Cards ----------

  #shown(v: StoredWalkthrough): VersionShown {
    return { productId: v.productId, version: v.version, walkthrough: v.walkthrough, cause: v.cause };
  }

  /** Where a version's card stands, from the store. */
  #cardState(v: StoredWalkthrough): CardState {
    const registration = this.#store.registration(v.productId);
    if (registration?.state === 'held') return { kind: 'waiting-for-bitwarden', approvedAt: new Date(registration.approvedAt) };
    if (v.lapsedAt) return v.againTappedAt ? { kind: 'preparing-again' } : { kind: 'lapsed' };
    if (this.#underCorrection(v)) return { kind: 'correcting' };
    const unapplied = this.#store
      .walkthroughCorrectionsOf(v.productId)
      .filter((c) => c.version === v.version && c.unapplied)
      .at(-1);
    return unapplied ? { kind: 'open', note: unappliedNote(unapplied.unapplied!) } : { kind: 'open' };
  }

  #underCorrection(v: StoredWalkthrough): boolean {
    return this.#store.walkthroughCorrectionsOf(v.productId).some((c) => c.version === v.version && !c.doneAt);
  }

  /** The card as it stands, or in the state given, for an edit. */
  #cardPayload(v: StoredWalkthrough, state: CardState = this.#cardState(v)): MessagePayload {
    const { heading, body, buttons } = walkthroughCard(this.#shown(v), state);
    return this.#needsYou.card(heading, body, { buttons });
  }
}

/** The Edit pop-up's one field. */
const EDIT_FIELD = 'value';

/** How a Registration starts once nothing holds it: as a Handoff when its terms ban accounts made by a bot. */
const startingState = (w: Walkthrough) => (w.termsBan ? ('handed-off' as const) : ('queued' as const));


/** Discord allows a pop-up field's label at most 45 characters. */
const cutLabel = (label: string) => (label.length > 45 ? `${label.slice(0, 44)}…` : label);

/** A pop-up with one radio group: the choice's options, its value picked as it opens. */
function radioPopup(customId: string, title: string, f: WalkthroughField): Popup {
  const base = popup(customId, title, [], { customId: EDIT_FIELD, label: cutLabel(f.label), maxLength: 1 });
  const options = f.options!.slice(0, CHOICE_OPTIONS.max).map((o) => ({ label: o.slice(0, 100), value: o.slice(0, 100), ...(o === f.value ? { default: true } : {}) }));
  return { ...base, components: [{ type: 18, label: cutLabel(f.label), component: { type: 21, custom_id: EDIT_FIELD, required: true, options } }] };
}

/**
 * Whether a Walkthrough's card and copy fit Discord: as a Correction's version, if it is one, or else as a version
 * the person's Edit of one field makes, and with the longest line a later state adds.
 */
function showable(walkthrough: Walkthrough, correction: string | undefined, needsYouChannelId: string): boolean {
  const cause: VersionCause = correction === undefined ? { kind: 'edited', field: 'x'.repeat(60) } : { kind: 'corrected', text: correction };
  const v: VersionShown = { productId: 0, version: 99, walkthrough, cause };
  try {
    walkthroughCard(v, { kind: 'open', note: unappliedNote('x'.repeat(UNAPPLIED_CHARS)) });
    walkthroughCopy(v, needsYouChannelId, new Date());
    return true;
  } catch {
    return false;
  }
}

/** How much of why a Correction couldn't be applied its card says. */
const UNAPPLIED_CHARS = 150;

const unappliedNote = (why: string) => `Your Correction couldn't be applied: ${cut(why, UNAPPLIED_CHARS)}. Correct again, or approve it as it stands.`;
