// Verifying a Registration (#58, ADR 0005, ADR 0007). Once its final press leaves a Registration *awaiting
// verification*, it takes as its verification mail the first mail matched to its Product, received from that press's
// *intended* mark on, in which plain code finds a code or a link; a mail with neither, such as a welcome, is left as
// ordinary mail (settled by the person on #58). Plain code reads each such mail again from Gmail, its codes and links
// held in memory alone, and uses it only when all of these hold: Gmail's own DMARC check passed for the Product's root
// domain or one of its subdomains, Gmail received it within 1 minute of that mark, it holds exactly one code or link,
// and plain code acts within 2 minutes of its receipt, before it is likely to expire, as after an outage it may not.
// Spam doesn't matter (both settled by the person on #58). A code goes by reference into the one code field of the
// page its session shows, read once the page has held still, and that form's button is pressed under the page check;
// if the page still asks for the code once it holds still again, the Product refused it. A link is opened by reference,
// and the browser service closes the session after it. Each step is under an *intended* mark, and one the bot stopped
// during counts as done. Any other mail, and a step the browser service refused before it began, is put to the person:
// a card in `#needs-you` asks them to tap it in Gmail. Either way the mail makes the Registration *registered*, since
// the account exists. With no such mail 24 hours after the final press, judged only once a read of the mailbox shows
// none came, it is *handed off*, and a mail that comes later moves it on the same way (settled by the person on #58).
// All of it runs after each read of the Signup mailbox, as plain code outside the lane, one piece of work at a time for
// each Registration, so no mail waits behind other work or another Registration's.
import { inMinutes, type Clock } from '../clock.ts';
import type { BrowserService, Field, Snapshot } from '../browser.ts';
import { button, ButtonStyle, cut, escapeMarkdown, text } from '../discord/components.ts';
import { refused } from '../discord/rest.ts';
import { errorText, type Log } from '../log.ts';
import { dmarcPassed } from '../mail/message.ts';
import type { AlertTapped, MailContent } from '../mail/signup-mailbox.ts';
import type { NeedsYou } from '../needs-you.ts';
import { shortTime } from '../pacific.ts';
import type { Store, StoredRegistration, VerificationWay } from '../store.ts';
import { hasPasswordField, type Walkthrough } from '../walkthrough/walkthrough.ts';
import { NOT_PRESSED, settledSnapshot } from './registrations.ts';

/** How long after the final press a mail may come for plain code to use it. */
const WINDOW_MS = 60_000;
/** How long after its receipt plain code may still use a mail, since its code or link expires within minutes. */
const FRESH_MS = 2 * 60_000;
/** How long after the final press a Registration with no verification mail is handed off. */
const HAND_OFF_MS = 24 * 60 * 60_000;
/** How long a card or notice Discord refused waits before it is sent again. */
const RETRY_MINUTES = 5;
/** The refusals of `open-link` that mean nothing was opened: each comes before the link is loaded (browser/src/sessions.ts). */
const NOT_OPENED = ['bad-request', 'unknown-session', 'not-driving'];
/** What was uncertain about a step left *intended*, which counts as done after a restart. */
const STOPPED_DURING_STEP = 'the bot stopped after marking the step and before hearing that it was done';

const DONE_PREFIX = 'verification:done:';

/** What Verifications asks of the Registrations: to show where one stands, and to close its session. */
export interface RegistrationsView {
  changed(productId: number): Promise<void>;
  closeSession(productId: number): Promise<void>;
}

/** The one field an emailed code goes in, and the one button of its form, on the page plain code read. */
interface CodeTarget {
  field: string;
  button: string;
  label: string;
  host: string;
}

export class Verifications {
  #store: Store;
  #browser: BrowserService;
  #content: (messageId: string) => Promise<MailContent>;
  #needsYou: NeedsYou;
  #registrations: RegistrationsView;
  #plainWork: (work: () => Promise<void>) => void;
  #taken: () => void;
  #clock: Clock;
  #log: Log;
  /** The Registrations with work under way, and for each, the work asked for meanwhile, which runs next. */
  #busy = new Set<number>();
  #next = new Map<number, () => Promise<void>>();
  /** The mail found to hold no code or link since this bot started, which isn't read again until it restarts. */
  #noSecret = new Set<string>();
  #cancelRetry: (() => void) | undefined;
  #stopped = false;

  constructor(options: {
    store: Store;
    browser: BrowserService;
    /** Reads a mail of the ledger again from Gmail. */
    content(messageId: string): Promise<MailContent>;
    needsYou: NeedsYou;
    registrations: RegistrationsView;
    /** Does plain-code work at once, outside the lane. */
    plainWork(work: () => Promise<void>): void;
    /** Called once a Registration takes its verification mail, so that the mail its mail runs passed over goes on (#61). */
    taken(): void;
    clock: Clock;
    log: Log;
  }) {
    this.#store = options.store;
    this.#browser = options.browser;
    this.#content = options.content;
    this.#needsYou = options.needsYou;
    this.#registrations = options.registrations;
    this.#plainWork = options.plainWork;
    this.#taken = options.taken;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  /** As after a stop: each verification goes on, a step left *intended* counting as done, and each card or notice not sent goes out. */
  start(): void {
    this.#plainWork(async () => {
      for (const v of this.#store.verifications()) this.#inTurn(v.productId, () => this.#goOn(v.productId));
    });
  }

  stop(): void {
    this.#stopped = true;
    this.#cancelRetry?.();
  }

  /** The earliest final press of a Registration awaiting verification that has taken no mail, from which a read searches. */
  lookBackFrom(): Date | undefined {
    const times = this.#store
      .registrationsWaitingForMail()
      .filter((r) => r.state === 'awaiting-verification')
      .map((r) => Date.parse(this.#anchor(r)));
    return times.length > 0 ? new Date(Math.min(...times)) : undefined;
  }

  /**
   * Whether a matched mail may still be taken as its Registration's verification mail: the Registration waits for one,
   * and Gmail received the mail from its final press on. Such a mail holding a code or link is plain code's to take,
   * and no mail run reads it (#61).
   */
  mayTake(productId: number, receivedAt: string): boolean {
    const r = this.#store.registration(productId);
    if (!r || this.#store.verification(productId)) return false;
    if (r.state !== 'awaiting-verification' && !(r.state === 'handed-off' && r.handedOffAt)) return false;
    return receivedAt >= this.#anchor(r);
  }

  /** The Signup mailbox was read: each Registration waiting for its mail takes it, or is handed off after 24 hours. */
  read(): void {
    for (const v of this.#store.verifications()) {
      const r = this.#store.registration(v.productId)!;
      if (r.state === 'awaiting-verification' || r.state === 'handed-off') this.#inTurn(v.productId, () => this.#goOn(v.productId));
    }
    for (const r of this.#store.registrationsWaitingForMail()) this.#inTurn(r.productId, () => this.#await(r.productId));
  }

  /** Done on a card that puts a verification mail to the person: undefined if the tap isn't one. */
  tap(customId: string, messageId: string | undefined): AlertTapped | undefined {
    if (!customId.startsWith(DONE_PREFIX)) return undefined;
    const productId = Number(customId.slice(DONE_PREFIX.length));
    const v = this.#store.verification(productId);
    if (!v || v.way !== 'person') return { refused: 'That card is no longer on record.' };
    // A card whose send was uncertain is known by the tap on it.
    if (!v.cardMessageId && messageId) this.#store.saveVerificationCard(productId, messageId);
    if (!this.#store.endVerificationCard(productId, this.#now())) return { refused: 'Done already.' };
    this.#log('registration.verification-card-done', { productId });
    return { update: this.#needsYou.shrunk(`${this.#heading(productId)} · done`) };
  }

  /**
   * Does a Registration's work outside the lane, after any of its own under way, so that no two pieces touch it at once
   * and none waits on another Registration's. Work asked for while one runs replaces any already waiting.
   */
  #inTurn(productId: number, work: () => Promise<void>): void {
    if (this.#busy.has(productId)) {
      this.#next.set(productId, work);
      return;
    }
    this.#busy.add(productId);
    this.#plainWork(async () => {
      let next: (() => Promise<void>) | undefined = work;
      try {
        while (next && !this.#stopped) {
          this.#next.delete(productId);
          try {
            await next();
          } catch (error) {
            this.#log('registration.verify-failed', { productId, error: errorText(error) });
          }
          next = this.#next.get(productId);
        }
      } finally {
        this.#busy.delete(productId);
        this.#next.delete(productId);
      }
    });
  }

  #now(): string {
    return this.#clock.now().toISOString();
  }

  /** When the final press was intended: the anchor of the 1-minute window and the 24 hours, which a restart doesn't move. */
  #anchor(r: StoredRegistration): string {
    return this.#store.lastPress(r.productId)?.intendedAt ?? r.submittedAt!;
  }

  #walkthrough(r: StoredRegistration): Walkthrough {
    return this.#store.walkthrough(r.productId, r.version)!.walkthrough;
  }

  /**
   * A Registration waiting for its mail, once the mailbox has been read: it takes the first that holds a code or link,
   * or with none 24 hours after its final press is handed off, since none came.
   */
  async #await(productId: number): Promise<void> {
    const r = this.#store.registration(productId)!;
    if (this.#store.verification(productId) || (r.state !== 'awaiting-verification' && !(r.state === 'handed-off' && r.handedOffAt))) return;
    const anchor = this.#anchor(r);
    for (const found of this.#store.mailOf(productId, anchor)) {
      if (this.#noSecret.has(found.messageId)) continue;
      const content = await this.#content(found.messageId);
      if (typeof content === 'string' || content.codes.length + content.links.length === 0) {
        // A mail deleted since, sent malformed, or holding no code or link isn't the verification mail.
        this.#noSecret.add(found.messageId);
        this.#log('registration.mail-not-verification', { productId, messageId: found.messageId, why: typeof content === 'string' ? content : 'no code or link' });
        continue;
      }
      const delaySeconds = (Date.parse(found.receivedAt) - Date.parse(anchor)) / 1000;
      const { way, why } = this.#decide(r, content, delaySeconds);
      this.#store.takeVerificationMail({ productId, messageId: found.messageId, receivedAt: found.receivedAt, spam: found.spam, delaySeconds, way, why });
      this.#log('registration.verification-mail', { productId, messageId: found.messageId, receivedAt: found.receivedAt, delaySeconds, spam: found.spam, way, ...(why ? { why } : {}) });
      this.#taken();
      return this.#goOn(productId, content);
    }
    if (r.state === 'awaiting-verification' && this.#clock.now().getTime() - Date.parse(anchor) >= HAND_OFF_MS) await this.#handOff(r);
  }

  /** How plain code uses a mail holding a code or link, or why it is put to the person: every condition it fails, in order. */
  #decide(r: StoredRegistration, content: Exclude<MailContent, string>, delaySeconds: number): { way: VerificationWay; why: string | null } {
    const root = this.#walkthrough(r).rootDomain.toLowerCase();
    const why: string[] = [];
    const passed = dmarcPassed(content.mail);
    if (!passed) why.push(`Gmail's check doesn't show that it came from ${root}`);
    else if (passed !== root && !passed.endsWith(`.${root}`)) why.push(`Gmail's check shows that it came from ${passed}, not ${root}`);
    if (delaySeconds * 1000 > WINDOW_MS) why.push(`it came ${durationText(delaySeconds)} after the form was submitted, more than 1 minute`);
    const secrets = content.codes.length + content.links.length;
    if (secrets > 1) why.push(`it holds ${secrets} codes and links, not exactly one`);
    const stale = this.#stale(content.mail.receivedAt);
    if (stale) why.push(stale);
    if (why.length > 0) return { way: 'person', why: why.join('; ') };
    if (!r.sessionId) return { way: 'person', why: 'its browser session is closed' };
    return { way: content.codes.length === 1 ? 'code' : 'link', why: null };
  }

  /** Why a mail is too old for plain code to use now, if it is: its code or link has likely expired. */
  #stale(receivedAt: string): string | undefined {
    const age = this.#clock.now().getTime() - Date.parse(receivedAt);
    return age > FRESH_MS ? `it was ${durationText(age / 1000)} old when plain code came to use it, more than 2 minutes` : undefined;
  }

  /**
   * Carries a taken mail on: plain code's step, unless it is done or put to the person, then the outcome. A step left
   * *intended* counts as done (ADR 0007). The code or link comes from Gmail again when it isn't held.
   */
  async #goOn(productId: number, held?: Exclude<MailContent, string>): Promise<void> {
    let v = this.#store.verification(productId)!;
    if (v.way !== 'person' && !v.doneAt) {
      if (v.intendedAt) {
        this.#store.saveVerificationDone(productId, this.#now(), STOPPED_DURING_STEP);
        this.#log('registration.verify-done', { productId, step: v.way, uncertain: STOPPED_DURING_STEP });
      } else {
        const content = held ?? (await this.#content(v.messageId));
        if (typeof content === 'string') this.#putToPerson(productId, content === 'gone' ? 'it was deleted from Gmail before plain code used it' : "plain code couldn't read it again");
        else if (v.way === 'code') await this.#useCode(productId, content.codes[0]!, v.receivedAt);
        else await this.#useLink(productId, content.links[0]!, v.receivedAt);
      }
      v = this.#store.verification(productId)!;
    }
    // A code pressed, before the Registration is *registered*: the page it led to is read, also after a restart.
    const r = this.#store.registration(productId)!;
    if (v.way === 'code' && v.doneAt && (r.state === 'awaiting-verification' || r.state === 'handed-off')) await this.#readAfterPress(productId);
    await this.#finish(productId);
  }

  /**
   * Reads the page the press of a code led to, once it holds still: one still asking for a code refused it, and the
   * mail goes to the person. One plain code can't read leaves it unknown whether the Product took the code, as a page
   * a press led to does (settled by the person on #56).
   */
  async #readAfterPress(productId: number): Promise<void> {
    const v = this.#store.verification(productId)!;
    const session = this.#store.registration(productId)!.sessionId;
    const after = session ? await settledSnapshot(this.#browser, session, () => this.#stopped) : null;
    const label = v.button ?? 'its button';
    if (after && asksForCode(after)) return this.#putToPerson(productId, `the page still asked for the code once "${label}" was pressed, so the Product may have refused it`);
    if (!after && !v.uncertain) {
      const uncertain = `the page "${label}" led to couldn't be read, so it isn't known whether the Product took the code`;
      this.#store.saveVerificationDone(productId, v.doneAt!, uncertain);
      this.#log('registration.verify-done', { productId, step: 'code', uncertain });
    }
  }

  /** Puts a mail plain code meant to use to the person after all, saying why. */
  #putToPerson(productId: number, why: string): void {
    this.#store.saveVerificationPutToPerson(productId, why);
    this.#log('registration.verification-put-to-person', { productId, why });
  }

  /**
   * Fills the code by reference into the one code field of the page as it holds still, and presses that form's button
   * under the page check. A page that still asks for the code once it holds still again refused it.
   */
  async #useCode(productId: number, code: string, receivedAt: string): Promise<void> {
    const r = this.#store.registration(productId)!;
    const session = r.sessionId;
    if (!session) return this.#putToPerson(productId, 'its browser session is closed');
    const w = this.#walkthrough(r);
    const domains = [w.rootDomain, w.signupHost];
    let target: CodeTarget;
    let fingerprint: string;
    try {
      const driven = await this.#browser.drive(session, 'plain-code');
      if (!driven.ok) return this.#putToPerson(productId, refusedText(driven.error.kind));
      const page = await settledSnapshot(this.#browser, session, () => this.#stopped);
      if (!page) return this.#putToPerson(productId, "its page couldn't be read");
      const found = codeTarget(page, domains);
      if (typeof found === 'string') return this.#putToPerson(productId, found);
      target = found;
      // No code reaches the page once the mail is too old, as the browser's answers may have taken a while.
      const stale = this.#stale(receivedAt);
      if (stale) return this.#putToPerson(productId, stale);
      const filled = await this.#browser.fillCode(session, target.field, code);
      if (!filled.ok) return this.#putToPerson(productId, `the code didn't fill (${filled.error.kind})`);
      const fingerprinted = await this.#browser.fingerprint(session);
      if (!fingerprinted.ok) return this.#putToPerson(productId, `its page couldn't be read (${fingerprinted.error.kind})`);
      fingerprint = fingerprinted.fingerprint;
    } catch (error) {
      return this.#putToPerson(productId, `the browser service can't be reached (${cut(errorText(error), 200)})`);
    }
    if (!this.#intend(productId, 'code', session, receivedAt, { button: target.label, fingerprint })) return;
    let uncertain: string | null = null;
    try {
      const answer = await this.#browser.press(session, { button: target.button, signupHost: target.host, terms: [], identity: [] });
      if (!answer.ok && NOT_PRESSED.includes(answer.error.kind)) return this.#refusedBeforeStep(productId, 'code', answer.error.kind, `its button was refused (${answer.error.kind})`);
      if (!answer.ok) uncertain = `the browser service answered ${answer.error.kind}`;
      else if (answer.uncertain) uncertain = answer.uncertain;
    } catch (error) {
      uncertain = `the browser service gave no answer (${cut(errorText(error), 200)})`;
    }
    this.#done(productId, 'code', uncertain);
  }

  /** Opens the link by reference; the browser service closes the session after it. */
  async #useLink(productId: number, link: string, receivedAt: string): Promise<void> {
    const session = this.#store.registration(productId)!.sessionId;
    if (!session) return this.#putToPerson(productId, 'its browser session is closed');
    try {
      const driven = await this.#browser.drive(session, 'plain-code');
      if (!driven.ok) return this.#putToPerson(productId, refusedText(driven.error.kind));
    } catch (error) {
      return this.#putToPerson(productId, `the browser service can't be reached (${cut(errorText(error), 200)})`);
    }
    if (!this.#intend(productId, 'link', session, receivedAt, null)) return;
    let uncertain: string | null = null;
    try {
      const answer = await this.#browser.openLink(session, link);
      if (!answer.ok && NOT_OPENED.includes(answer.error.kind)) return this.#refusedBeforeStep(productId, 'link', answer.error.kind, `the link wasn't opened (${answer.error.kind})`);
      if (!answer.ok) uncertain = `the link didn't load (${answer.error.kind}), though the Product may have had the request`;
    } catch (error) {
      uncertain = `the browser service gave no answer (${cut(errorText(error), 200)})`;
    }
    this.#done(productId, 'link', uncertain);
  }

  /**
   * Writes the *intended* mark right before the step, unless the mail has grown too old meanwhile, which puts it to
   * the person instead. Returns whether the step may go.
   */
  #intend(productId: number, step: 'code' | 'link', session: string, receivedAt: string, press: { button: string; fingerprint: string } | null): boolean {
    const stale = this.#stale(receivedAt);
    if (stale) {
      this.#putToPerson(productId, stale);
      return false;
    }
    this.#store.intendVerification(productId, this.#now(), press);
    this.#log('registration.verify-intended', { productId, step, session, ...(press ? { fingerprint: press.fingerprint.slice(0, 16) } : {}) });
    return true;
  }

  /** A step the browser service refused before it began: its mark is taken back, and the mail is put to the person. */
  #refusedBeforeStep(productId: number, step: 'code' | 'link', kind: string, why: string): void {
    this.#store.dropVerificationIntended(productId);
    this.#log('registration.verify-refused', { productId, step, kind });
    this.#putToPerson(productId, why);
  }

  #done(productId: number, step: 'code' | 'link', uncertain: string | null): void {
    this.#store.saveVerificationDone(productId, this.#now(), uncertain);
    this.#log('registration.verify-done', { productId, step, ...(uncertain ? { uncertain } : {}) });
  }

  /**
   * The mail's outcome: the Registration *registered*, its session closed and where it stands shown, then the card
   * that puts the mail to the person, or the notice of an uncertain step. Each goes once.
   */
  async #finish(productId: number): Promise<void> {
    const v = this.#store.verification(productId)!;
    const r = this.#store.registration(productId)!;
    if (r.state === 'awaiting-verification' || r.state === 'handed-off') {
      this.#store.saveRegistration(productId, { state: 'registered', endedAt: this.#now(), endNote: null, waitsOn: null });
      this.#log('registration.verified', { productId, way: v.way, ...(v.uncertain ? { uncertain: v.uncertain } : {}) });
    }
    await this.#registrations.closeSession(productId);
    await this.#registrations.changed(productId);
    if (v.way === 'person') await this.#sendCard(productId);
    else if (v.uncertain) await this.#tellUncertain(productId);
  }

  /** Hands off a Registration with no verification mail 24 hours after its final press: the account may exist. */
  async #handOff(r: StoredRegistration): Promise<void> {
    const at = this.#now();
    this.#store.saveRegistration(r.productId, { state: 'handed-off', endedAt: at, endNote: 'submitted; no verification mail yet', handedOffAt: at, waitsOn: null });
    this.#log('registration.handed-off', { productId: r.productId, why: 'no verification mail within 24 hours of the final press' });
    await this.#registrations.closeSession(r.productId);
    await this.#registrations.changed(r.productId);
  }

  #heading(productId: number): string {
    const r = this.#store.registration(productId)!;
    return `Verify ${escapeMarkdown(cut(this.#walkthrough(r).product, 60))} in Gmail`;
  }

  /** Sends the card that puts a verification mail to the person, unless it was sent or may have been (ADR 0007). */
  async #sendCard(productId: number): Promise<void> {
    const v = this.#store.verification(productId)!;
    if (v.cardIntended || v.cardDoneAt) return;
    const r = this.#store.registration(productId)!;
    const w = this.#walkthrough(r);
    const product = escapeMarkdown(cut(w.product, 60));
    const threadId = this.#store.product(productId)!.threadId;
    const address = r.plainAddress ? w.identity.plainAddress : w.identity.plusAddress;
    const again = hasPasswordField(w)
      ? `log in to ${product} as ${address}, with the password AutoFill gives you, and have it send a new one`
      : `have ${product} send a new one to ${address}`;
    const body =
      `${product}'s verification mail came ${shortTime(new Date(v.receivedAt))}${v.spam ? ", and it's in Spam" : ''}. ` +
      `The Assistant didn't use it: ${escapeMarkdown(cut(v.why ?? '', 400))}. ` +
      `Open it in Gmail and tap its link or enter its code. If that has expired, ${again}. ` +
      `The Registration counts as registered.${threadId ? ` See <#${threadId}>.` : ''}`;
    this.#store.saveVerificationCardIntended(productId, true);
    try {
      const { messageId } = await this.#needsYou.post(this.#heading(productId), [text(body)], { buttons: [button(`${DONE_PREFIX}${productId}`, 'Done', ButtonStyle.Secondary)] });
      this.#store.saveVerificationCard(productId, messageId);
    } catch (error) {
      this.#log('registration.verification-card-failed', { productId, error: errorText(error) });
      if (refused(error)) {
        this.#store.saveVerificationCardIntended(productId, false);
        this.#tryAgainLater();
      }
    }
  }

  /** Tells the person, once, what was uncertain about plain code's step, which counts as done. */
  async #tellUncertain(productId: number): Promise<void> {
    const v = this.#store.verification(productId)!;
    if (!v.uncertain || v.uncertainTold) return;
    const r = this.#store.registration(productId)!;
    const w = this.#walkthrough(r);
    const product = escapeMarkdown(cut(w.product, 60));
    const threadId = this.#store.product(productId)!.threadId;
    const step = v.way === 'code' ? `filling the emailed code and pressing **${escapeMarkdown(cut(v.button ?? 'its button', 100))}**` : 'opening the verification link';
    this.#store.saveVerificationUncertainTold(productId, true);
    try {
      await this.#needsYou.post(`An uncertain verification · ${product}`, [
        text(
          `The Assistant was ${step}, and doesn't know whether it went through: ${escapeMarkdown(cut(v.uncertain, 300))}. ` +
            `It counts as done, so it is never done again, and the Registration counts as registered. If ${product} says your address isn't verified, open its mail in Gmail.${threadId ? ` See <#${threadId}>.` : ''}`,
        ),
      ]);
    } catch (error) {
      this.#log('registration.verification-uncertain-untold', { productId, error: errorText(error) });
      if (refused(error)) {
        this.#store.saveVerificationUncertainTold(productId, false);
        this.#tryAgainLater();
      }
    }
  }

  /** In a few minutes, sends again each card and notice Discord refused. */
  #tryAgainLater(): void {
    if (this.#stopped || this.#cancelRetry) return;
    this.#cancelRetry = inMinutes(this.#clock, RETRY_MINUTES, () => {
      this.#cancelRetry = undefined;
      this.start();
    });
  }
}

/** Why the browser service refused to let plain code drive the session: a session it no longer has is closed. */
const refusedText = (kind: string) => (kind === 'unknown-session' ? 'its browser session is closed' : `the browser service refused it (${kind})`);

/** A duration as the card says it: seconds under 5 minutes, then minutes under an hour, then hours. */
function durationText(seconds: number): string {
  if (seconds < 300) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  const hours = Math.round(seconds / 3600);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/** Field types an emailed code may go in: the text-like ones `fill-code` takes (browser/src/sessions.ts) that a code fits. */
const CODE_TYPES = ['text', 'tel', 'number', 'password'];
/** What names a field for a code, beside `autocomplete="one-time-code"`. */
const CODE_FIELD = /code|otp|one[- ]?time|verif|pin|token/i;

const namedForCode = (f: Field) => f.autocomplete === 'one-time-code' || CODE_FIELD.test(`${f.label} ${f.name ?? ''}`);

/** Whether a page asks for a code: any field of it is named for one, whatever else the page shows. */
const asksForCode = (snapshot: Snapshot) => snapshot.forms.some((f) => f.fields.some(namedForCode));

/**
 * The one field an emailed code goes in, and the one button of its form, on the page as plain code reads it: the
 * only form whose only field is named for a code, with one submit control, on the Walkthrough's domains. Otherwise
 * why there is none, such as a code split across one box a digit.
 */
export function codeTarget(snapshot: Snapshot, domains: string[]): CodeTarget | string {
  let host: string;
  try {
    host = new URL(snapshot.url).hostname.toLowerCase();
  } catch {
    return "its page's address can't be read";
  }
  const on = domains.map((d) => d.toLowerCase());
  if (!on.some((d) => host === d || host.endsWith(`.${d}`))) return `its page is on ${host}, off the Walkthrough's domains`;
  const forms = snapshot.forms.filter((f) => {
    const [only] = f.fields;
    return f.fields.length === 1 && only && namedForCode(only) && CODE_TYPES.includes(only.type) && f.submits.length === 1;
  });
  const [form] = forms;
  const field = form?.fields[0]?.ref;
  const submit = form?.submits[0];
  if (forms.length !== 1 || !field || !submit?.ref) return 'its page shows no one field for the code with one button';
  return { field, button: submit.ref, label: submit.label, host };
}
