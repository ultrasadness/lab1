// The reader of the Signup mailbox (#57): plain code that never waits in the background lane. Before it reads, it
// checks that the Gmail token holds exactly `gmail.readonly` and `gmail.compose` and reads the Signup mailbox, and
// refuses it otherwise, telling the person. Then it reads Gmail's history every `pollSeconds`, from the history id the
// store holds, and records each mail added in the ledger by its Gmail message id before that history id advances, so
// a mail is recorded once across restarts (ADR 0007). Each mail is matched to a Registration by its plus-address tag,
// then by its sender's domain; mail that matches none is recorded as *unmatched*, and nothing more is done with it.
// Mail whose DMARC passes, by Gmail's own check, for a domain on the config's list is put to the person at once: a card
// in `#needs-you` names only its sender, with Done, and lapses after 14 days (#38 §8). Matched bulk mail, with a
// `List-Unsubscribe` header, is capped at 3 a Product in a rolling 7 days by Gmail's receive time; the rest is held,
// its reason set on arrival (#16). Matched mail within the cap waits for the mail run that sorts it, which #61 adds,
// and its text is kept for that run, outside git for 90 days, with each Secret in it replaced by a placeholder. After
// each read it hands over to the verification of Registrations (#58). First it searches for mail since the earliest
// final press of a Registration still waiting for its mail, when that press came before this bot run's first read,
// once and again for one whose press is earlier still, so a mail that came before the reader could read the mailbox
// is in the ledger too. A press since that first read has its mail in the history the reader reads.
import { button, ButtonStyle, text, type MessagePayload } from '../discord/components.ts';
import { refused } from '../discord/rest.ts';
import type { Clock } from '../clock.ts';
import { errorText, type Log } from '../log.ts';
import type { NeedsYou } from '../needs-you.ts';
import type { RawInputs } from '../raw-inputs.ts';
import { rootDomain } from '../root-domain.ts';
import type { MailAlert, Store } from '../store.ts';
import { GMAIL_SCOPES, GmailRateLimited, type MessageRef, type Gmail } from './gmail.ts';
import { dmarcPassed, domainOf, readMail, type ReadMail } from './message.ts';
import { withPlaceholders } from './placeholders.ts';

/** The first wait after a failed read; each failure in a row doubles it, up to `MAX_BACKOFF_MS`. */
const FIRST_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15 * 60_000;
/**
 * How far before the last check a read goes when Gmail no longer serves the history since: Gmail's receive time can
 * come before a mail shows in its history, and the ledger drops what it holds already.
 */
const RESYNC_MARGIN_MS = 60 * 60_000;

/** Mail with these labels isn't read: the Trash, and the mailbox's own drafts and sent mail. Spam is read like the Inbox. */
const UNREAD_LABELS = new Set(['TRASH', 'DRAFT', 'SENT', 'CHAT']);

/** How many bulk mails of one Product go on in `CAP_WINDOW_MS`, counted by Gmail's receive time (#16). */
const CAP = 3;
const CAP_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** How long a security alert's card waits on the person before it lapses. */
const LAPSE_MS = 14 * 24 * 60 * 60_000;

/** How long a card's edit Discord didn't take waits before it is tried again. */
const RETRY_MINUTES = 5;

const DONE_PREFIX = 'mail-alert:done:';

/** What the person may tap, and what the tap does: the card's new look, or why it changes nothing. */
export type AlertTapped = { update: MessagePayload } | { refused: string };

/**
 * A mail of the ledger read again from Gmail, for the verification of a Registration (#58): its fields, and the codes
 * and links found in its subject and text, held in memory alone; or `gone` or `unreadable`.
 */
export type MailContent = { mail: ReadMail; codes: string[]; links: string[] } | 'gone' | 'unreadable';

/** A security alert as its card names it: the sender alone, never what the mail says. */
const alertHeading = (a: Pick<MailAlert, 'name' | 'sender'>) => `Mail from ${a.name} (\`${a.sender.replaceAll('`', '')}\`) in the Signup mailbox`;

const scopeName = (scope: string) => scope.replace('https://www.googleapis.com/auth/', '');

/** A list as a sentence says it: `a`, `a and b`, `a, b and c`. */
const inWords = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

export class SignupMailbox {
  #gmail: Gmail | undefined;
  #signupMailbox: string;
  #pollMs: number;
  #alertDomains: Record<string, string>;
  #store: Store;
  #rawInputs: RawInputs;
  #needsYou: NeedsYou;
  #plainWork: (work: () => Promise<void>) => void;
  #lookBackFrom: () => Date | undefined;
  #onRead: () => void;
  #clock: Clock;
  #log: Log;
  /** Whether the token passed its check since the bot started. */
  #checked = false;
  /** When this bot run first read the mailbox, and the earliest time it searched for mail from since, if it has. */
  #firstReadAt: number | undefined;
  #lookedBackFrom: number | undefined;
  /** Why the token was refused, if it was: nothing is read until the bot starts again with another. */
  #refused: string | undefined;
  #backoffMs = 0;
  /** Until when Gmail asked the bot to wait, by a rate-limit reply to any request of its: none goes before then. */
  #limitedUntil = 0;
  #cancelNext = () => {};
  #cancelLapse = () => {};
  #stopped = false;

  constructor(options: {
    /** None when `gmail-client-secret` holds no client id and secret. */
    gmail: Gmail | undefined;
    /** The Signup mailbox's own address, which the token must read (ADR 0003). */
    signupMailbox: string;
    pollSeconds: number;
    /** The domains whose mail with DMARC pass raises a card, each with the name the card calls it. */
    alertDomains: Record<string, string>;
    store: Store;
    /** Where the text of mail waiting for its mail run is kept, for 90 days (ADR 0010). */
    rawInputs: RawInputs;
    needsYou: NeedsYou;
    /** Does plain-code work at once, outside the lane. */
    plainWork(work: () => Promise<void>): void;
    /** Whence a read searches for mail: the earliest final press still waiting for its mail, if any (#58). */
    lookBackFrom(): Date | undefined;
    /** Called after each read, once the ledger holds every mail Gmail received until then (#58). */
    onRead(): void;
    clock: Clock;
    log: Log;
  }) {
    this.#gmail = options.gmail;
    this.#signupMailbox = options.signupMailbox;
    this.#pollMs = options.pollSeconds * 1000;
    this.#alertDomains = options.alertDomains;
    this.#store = options.store;
    this.#rawInputs = options.rawInputs;
    this.#needsYou = options.needsYou;
    this.#plainWork = options.plainWork;
    this.#lookBackFrom = options.lookBackFrom;
    this.#onRead = options.onRead;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  /**
   * Reads the mailbox now, and every `pollSeconds` from then on. As after a stop, sends each card that wasn't sent,
   * shrinks each that lapsed, and arms the lapse of those still waiting.
   */
  start(): void {
    this.#plainWork(() => this.#poll());
    this.#plainWork(async () => {
      for (const alert of this.#store.unsentMailAlerts()) await this.#sendAlert(alert.messageId);
      await this.#lapse();
    });
  }

  stop(): void {
    this.#stopped = true;
    this.#cancelNext();
    this.#cancelLapse();
  }

  /** Done on a security alert's card: undefined if the tap isn't one. */
  tap(customId: string, messageId: string | undefined): AlertTapped | undefined {
    if (!customId.startsWith(DONE_PREFIX)) return undefined;
    const alert = this.#store.mailAlert(customId.slice(DONE_PREFIX.length));
    if (!alert) return { refused: 'That card is no longer on record.' };
    // A card whose send was uncertain is known by the tap on it.
    if (!alert.cardMessageId && messageId) this.#store.saveMailAlertCard(alert.messageId, messageId);
    if (!this.#store.endMailAlert(alert.messageId, 'done', this.#clock.now().toISOString())) {
      return { refused: alert.endedBy === 'lapse' ? 'It lapsed already; the mail is still in Gmail.' : 'Done already.' };
    }
    this.#log('mail.alert-done', { messageId: alert.messageId });
    return { update: this.#needsYou.shrunk(`${alertHeading(alert)} · done`) };
  }

  async #poll(): Promise<void> {
    this.#cancelNext();
    if (this.#stopped || this.#refused) return;
    let waitMs = this.#pollMs;
    try {
      const limited = this.#limitedUntil - this.#clock.now().getTime();
      if (limited > 0) {
        waitMs = limited;
        return;
      }
      if (!this.#gmail) return await this.#refuse('gmail-client-secret', 'it holds no client id and secret');
      if (!this.#checked) {
        const why = await this.#check(this.#gmail);
        if (why) return await this.#refuse('gmail-refresh-token', why);
        this.#checked = true;
      }
      const readAt = this.#clock.now().getTime();
      await this.#read(this.#gmail);
      this.#firstReadAt ??= readAt;
      // In the poll itself, so that it never records a mail beside the read. A Registration that starts waiting later,
      // as once the lane settles a press a restart cut off, gets a search of its own if its press came earlier.
      const since = this.#lookBackFrom();
      if (since && since.getTime() < this.#firstReadAt && !(this.#lookedBackFrom !== undefined && this.#lookedBackFrom <= since.getTime())) {
        const found = await this.#find(this.#gmail, since);
        this.#log('mail.looked-back', { since: since.toISOString(), found: found.length });
        await this.#recordEach(this.#gmail, found);
        this.#lookedBackFrom = since.getTime();
      }
      this.#backoffMs = 0;
      this.#onRead();
    } catch (error) {
      this.#backoffMs = this.#backoffMs === 0 ? FIRST_BACKOFF_MS : Math.min(this.#backoffMs * 2, MAX_BACKOFF_MS);
      waitMs = Math.max(this.#backoffMs, error instanceof GmailRateLimited ? (error.retryAfterMs ?? 0) : 0);
      if (error instanceof GmailRateLimited) this.#limitedUntil = Math.max(this.#limitedUntil, this.#clock.now().getTime() + waitMs);
      this.#log('gmail.read-failed', { error: errorText(error), retryInSeconds: waitMs / 1000 });
    } finally {
      if (!this.#stopped && !this.#refused) {
        this.#cancelNext = this.#clock.at(new Date(this.#clock.now().getTime() + waitMs), () => this.#plainWork(() => this.#poll()));
      }
    }
  }

  /** Why the token can't be used, if it can't: its scopes aren't exactly the two, or it reads another mailbox. */
  async #check(gmail: Gmail): Promise<string | undefined> {
    const scopes = (await gmail.scopes()).map(scopeName).sort();
    if (scopes.join(' ') !== GMAIL_SCOPES.map(scopeName).sort().join(' ')) {
      return `it holds ${inWords(scopes) || 'no scope'}, not exactly gmail.readonly and gmail.compose`;
    }
    const { emailAddress } = await gmail.profile();
    if (emailAddress.toLowerCase() !== this.#signupMailbox.toLowerCase()) return `it reads ${emailAddress}, not the Signup mailbox, ${this.#signupMailbox}`;
    return undefined;
  }

  /** Reads nothing more until the bot starts again, and tells the person which token to replace. */
  async #refuse(token: string, why: string): Promise<void> {
    this.#refused = why;
    this.#log('gmail.token-refused', { token, why });
    const body = `${why[0]!.toUpperCase()}${why.slice(1)}, so the bot reads no mail. Replace it on the VM: \`sudo ops/token ${token}\`.`;
    try {
      await this.#needsYou.post('Replace the Gmail token', [text(body)]);
    } catch (error) {
      this.#log('gmail.token-card-failed', { error: errorText(error) });
    }
  }

  /**
   * Records each mail added since the stored history id, then stores the history id it read up to. A store with none,
   * new or lost, starts from the mailbox's history id now, and older mail counts as seen (ADR 0007).
   */
  async #read(gmail: Gmail): Promise<void> {
    const checkedAt = this.#clock.now().toISOString();
    const mailbox = this.#store.mailbox();
    if (!mailbox) {
      const { historyId } = await gmail.profile();
      this.#store.saveMailbox(historyId, checkedAt);
      this.#log('mail.history-started', { historyId });
      return;
    }
    const added: MessageRef[] = [];
    let historyId = mailbox.historyId;
    let pageToken: string | undefined;
    do {
      const page = await gmail.history(mailbox.historyId, pageToken);
      if (page === 'expired') return await this.#readSince(gmail, new Date(Date.parse(mailbox.checkedAt) - RESYNC_MARGIN_MS), checkedAt);
      added.push(...page.added);
      historyId = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken);
    await this.#recordEach(gmail, added);
    this.#store.saveMailbox(historyId, checkedAt);
  }

  /**
   * Records each mail Gmail received since a time, Spam and Trash searched too, and stores the history id the mailbox
   * had before the search, so that what comes after is read from its history. The bound of a read when Gmail no
   * longer serves the history since the last check (ADR 0007).
   */
  async #readSince(gmail: Gmail, since: Date, checkedAt: string): Promise<void> {
    const { historyId } = await gmail.profile();
    const found = await this.#find(gmail, since);
    this.#log('mail.history-expired', { since: since.toISOString(), found: found.length });
    await this.#recordEach(gmail, found);
    this.#store.saveMailbox(historyId, checkedAt);
  }

  /** The mail Gmail received since a time, Spam and Trash searched too, in the order it came. */
  async #find(gmail: Gmail, since: Date): Promise<MessageRef[]> {
    const found: MessageRef[] = [];
    let pageToken: string | undefined;
    do {
      const page = await gmail.list(`after:${Math.floor(since.getTime() / 1000)}`, pageToken);
      found.push(...page.found);
      pageToken = page.nextPageToken;
    } while (pageToken);
    // Gmail lists the newest first; the ledger records them in the order they came.
    return found.reverse();
  }

  /**
   * A mail the ledger holds, read again from Gmail for what plain code needs to verify a Registration (#58): its
   * fields, and the codes and links found in its subject and text, held in memory alone. `gone` when it was deleted
   * since, and `unreadable` when Gmail sends it malformed. Throws until the token has passed its check, and once it
   * is refused, so that a token for another mailbox never answers for this one. While Gmail asks the bot to wait, it
   * throws without asking, and a rate-limit reply to it holds the reads of the mailbox too (ADR 0011).
   */
  async content(messageId: string): Promise<MailContent> {
    if (!this.#gmail || !this.#checked || this.#refused) throw new Error('no checked Gmail token reads the Signup mailbox yet');
    const limited = this.#limitedUntil - this.#clock.now().getTime();
    if (limited > 0) throw new GmailRateLimited(429, limited, `Gmail asked the bot to wait ${Math.ceil(limited / 1000)} s more`);
    let message: Awaited<ReturnType<Gmail['message']>>;
    try {
      message = await this.#gmail.message(messageId);
    } catch (error) {
      if (error instanceof GmailRateLimited) this.#limitedUntil = Math.max(this.#limitedUntil, this.#clock.now().getTime() + (error.retryAfterMs ?? FIRST_BACKOFF_MS));
      throw error;
    }
    if (message === 'gone') return 'gone';
    let mail: ReadMail | undefined;
    try {
      mail = readMail(message);
    } catch {
      return 'unreadable';
    }
    if (!mail) return 'unreadable';
    const { codes, links } = withPlaceholders([mail.subject, mail.text]);
    return { mail, codes, links };
  }

  /** Reads and records each mail the ledger doesn't hold yet, in the order given. */
  async #recordEach(gmail: Gmail, found: MessageRef[]): Promise<void> {
    const seen = new Set<string>();
    for (const { id } of found) {
      if (seen.has(id) || this.#store.mailRecorded(id)) continue;
      seen.add(id);
      const message = await gmail.message(id);
      if (message === 'gone') {
        this.#log('mail.gone', { messageId: id });
        continue;
      }
      // A message Gmail sent malformed costs that message alone, never the batch behind it.
      let mail: ReadMail | undefined;
      try {
        mail = readMail(message);
      } catch (error) {
        this.#log('mail.unreadable', { messageId: id, error: errorText(error) });
        continue;
      }
      if (!mail) {
        this.#log('mail.unreadable', { messageId: id });
        continue;
      }
      if (mail.labels.some((label) => UNREAD_LABELS.has(label))) continue;
      await this.#record(mail);
    }
  }

  /**
   * Records a mail with its disposition on arrival, then acts on it: a security alert's card goes out, and matched
   * mail within the cap waits for its mail run with its text kept.
   */
  async #record(mail: ReadMail): Promise<void> {
    const spam = mail.labels.includes('SPAM');
    const alert = this.#alertOf(mail);
    // Mail from a listed domain without Gmail's own DMARC pass may be spoofed, so it is just unmatched (#38 §8).
    const match = alert || this.#fromAlertDomain(mail) ? undefined : this.#match(mail);
    // Never capped or counted: mail with no List-Unsubscribe, and verification mail, which is mail to a Registration
    // waiting for it. Mail in a thread with a Reply draft joins them with #62, which makes Reply drafts.
    const counts = Boolean(match && mail.bulk && this.#store.registration(match.productId)!.state !== 'awaiting-verification');
    const overCap = counts && this.#overCap(match!.productId, mail.receivedAt);
    const disposition = alert
      ? ({ disposition: 'put-to-person', reason: 'alert' } as const)
      : !match
        ? ({ disposition: 'unmatched', reason: null } as const)
        : overCap
          ? ({ disposition: 'held', reason: 'over-the-cap' } as const)
          : null;
    // Kept before it is recorded, so that mail the ledger says waits for its run has its text kept.
    if (!disposition) this.#keep(mail);
    this.#store.recordMail({
      messageId: mail.id,
      threadId: mail.threadId,
      receivedAt: mail.receivedAt,
      recordedAt: this.#clock.now().toISOString(),
      spam,
      bulk: mail.bulk,
      productId: match?.productId ?? null,
      matchedBy: match?.by ?? null,
      counted: counts && !overCap,
      disposition,
      alert: alert ?? null,
    });
    this.#log('mail.recorded', {
      messageId: mail.id,
      receivedAt: mail.receivedAt,
      spam,
      bulk: mail.bulk,
      product: match ? this.#store.product(match.productId)!.rootDomain : null,
      matchedBy: match?.by ?? null,
      // Mail with no disposition yet waits for the mail run that sorts it.
      disposition: disposition?.disposition ?? 'queued',
      ...(disposition?.reason ? { reason: disposition.reason } : {}),
    });
    if (alert) {
      // Sent beside the read, so a Discord that never answers can't stop the mailbox being read.
      this.#plainWork(() => this.#sendAlert(mail.id));
      this.#armLapse();
    }
  }

  /**
   * Whether a bulk mail received at `receivedAt` would put a 4th counted mail of its Product into some 7 days. Mail is
   * read in the order Gmail's history gives, which its receive times may not follow, so the window may lie on either
   * side of it.
   */
  #overCap(productId: number, receivedAt: string): boolean {
    const at = Date.parse(receivedAt);
    const times = [at, ...this.#store.countedMailTimes(productId, new Date(at - CAP_WINDOW_MS).toISOString(), new Date(at + CAP_WINDOW_MS).toISOString()).map(Date.parse)].sort((a, b) => a - b);
    return times.some((time, i) => i + CAP < times.length && times[i + CAP]! - time < CAP_WINDOW_MS);
  }

  /** Whether a mail's sender is on a domain of the config's list, or one of its subdomains. */
  #fromAlertDomain(mail: ReadMail): boolean {
    const domain = mail.from && domainOf(mail.from);
    return Boolean(domain && this.#listedDomain(domain));
  }

  /** The domain of the config's list that a domain is, or is under. */
  #listedDomain(domain: string): string | undefined {
    return Object.keys(this.#alertDomains).find((listed) => domain === listed || domain.endsWith(`.${listed}`));
  }

  /**
   * The card a mail raises, when its DMARC passes, by Gmail's own check, for a domain on the config's list or one of
   * its subdomains: what the card calls that domain, and the sender's address.
   */
  #alertOf(mail: ReadMail): { name: string; sender: string } | undefined {
    const passed = dmarcPassed(mail);
    const listed = passed && this.#listedDomain(passed);
    return listed ? { name: this.#alertDomains[listed]!, sender: mail.from ?? passed } : undefined;
  }

  /**
   * Keeps a mail's text for the mail run that sorts it, with each code and Secret link replaced by a placeholder, so
   * that no copy of a Secret is kept (#58 holds them in memory alone). It expires with the raw inputs, after 90 days.
   */
  #keep(mail: ReadMail): void {
    const { texts } = withPlaceholders([mail.subject, mail.text]);
    const [subject, body] = texts as [string, string];
    const copy = { messageId: mail.id, threadId: mail.threadId, receivedAt: mail.receivedAt, from: mail.from ?? null, to: mail.recipients, subject, text: body };
    this.#rawInputs.keep('gmail', mail.id, `${JSON.stringify(copy, null, 2)}\n`);
  }

  /**
   * The Registration a mail is matched to: by the tag of the plus-address it went to, or else by its sender's root
   * domain, the Product's key. Sender addresses the person matched come with #64.
   */
  #match(mail: ReadMail): { productId: number; by: 'tag' | 'domain' } | undefined {
    const [local, domain] = this.#signupMailbox.toLowerCase().split('@') as [string, string];
    for (const address of mail.recipients) {
      const plus = address.match(/^([^+@]+)\+([^@]+)@(.+)$/);
      if (!plus || plus[1] !== local || plus[3] !== domain) continue;
      const productId = this.#store.productOfTag(plus[2]!);
      if (productId !== undefined && this.#store.registration(productId)) return { productId, by: 'tag' };
    }
    if (!mail.from) return undefined;
    const product = this.#store.productByDomain(rootDomain(domainOf(mail.from)));
    return product && this.#store.registration(product.id) ? { productId: product.id, by: 'domain' } : undefined;
  }

  /** Sends a security alert's card, unless it was sent or may have been (ADR 0007). One Discord refused is sent at the next start. */
  async #sendAlert(messageId: string): Promise<void> {
    const alert = this.#store.mailAlert(messageId)!;
    if (alert.cardIntended || alert.endedAt) return;
    this.#store.saveMailAlertCardIntended(alert.messageId, true);
    try {
      const body = `The Assistant doesn’t read it: open it in Gmail${alert.spam ? ', where it’s in Spam' : ''}.`;
      const { messageId } = await this.#needsYou.post(alertHeading(alert), [text(body)], { buttons: [button(`${DONE_PREFIX}${alert.messageId}`, 'Done', ButtonStyle.Secondary)] });
      this.#store.saveMailAlertCard(alert.messageId, messageId);
    } catch (error) {
      if (refused(error)) this.#store.saveMailAlertCardIntended(alert.messageId, false);
      this.#log('mail.alert-card-failed', { messageId: alert.messageId, error: errorText(error) });
    }
  }

  /** Lapses each card waiting 14 days, shrinking it to one line, then arms the next lapse. */
  async #lapse(): Promise<void> {
    const now = this.#clock.now();
    for (const alert of this.#store.openMailAlerts()) {
      if (Date.parse(alert.recordedAt) + LAPSE_MS > now.getTime()) continue;
      if (this.#store.endMailAlert(alert.messageId, 'lapse', now.toISOString())) this.#log('mail.alert-lapsed', { messageId: alert.messageId });
    }
    // Shrunk only once Discord took the edit, since an edit can safely go twice.
    for (const alert of this.#store.unshrunkMailAlerts()) {
      try {
        await this.#needsYou.shrink(alert.cardMessageId!, `${alertHeading(alert)} · lapsed after 14 days; it’s still in Gmail`);
        this.#store.saveMailAlertShrunk(alert.messageId, now.toISOString());
      } catch (error) {
        this.#log('mail.alert-shrink-failed', { messageId: alert.messageId, error: errorText(error) });
      }
    }
    this.#armLapse();
  }

  /**
   * Arms the lapse of the card waiting longest, if one waits, or sooner, `RETRY_MINUTES` on, if a card that lapsed
   * isn't shrunk yet because Discord didn't take the edit.
   */
  #armLapse(): void {
    this.#cancelLapse();
    if (this.#stopped) return;
    const due = this.#store.openMailAlerts().map((a) => Date.parse(a.recordedAt) + LAPSE_MS);
    if (this.#store.unshrunkMailAlerts().length > 0) due.push(this.#clock.now().getTime() + RETRY_MINUTES * 60_000);
    if (due.length === 0) return;
    this.#cancelLapse = this.#clock.at(new Date(Math.min(...due)), () => this.#plainWork(() => this.#lapse()));
  }
}
