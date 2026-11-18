// A matched mail's text as it waits for its mail run (#57, #61): kept under `raw/gmail/` for 90 days, with each code and
// each link that carries a token replaced by a placeholder, so that no copy of a Secret is kept. Plain code reads from
// it what follows the mail run's kind: the reply address, whether it is a no-reply one, and the mail's own text with
// quoted history stripped. A Rule or an Interest scope change proposed from a Correction of mail is checked against it,
// so that it quotes no mail text and names no sender or address (ADR 0010).
import { rootDomain } from '../root-domain.ts';
import { domainOf, type ReadMail } from './message.ts';
import { withPlaceholders } from './placeholders.ts';

/** A mail's text as kept for its mail run. */
export interface KeptMail {
  messageId: string;
  threadId: string;
  receivedAt: string;
  /** The address in `From`. */
  from: string | null;
  /** `From` as the mail writes it, its name included. Kept since #61. */
  sender: string | null;
  /** The address in `Reply-To`. Kept since #61: a copy without it is read from Gmail again. */
  replyTo: string | null;
  to: string[];
  subject: string;
  text: string;
}

/**
 * A mail's text with each Secret as a placeholder, as it is kept: its subject, its text and the name in its `From`,
 * which a sender may fill with anything. The subject and text are numbered first, as #58 numbers them.
 */
export function keptCopy(mail: ReadMail): KeptMail {
  const { texts } = withPlaceholders([mail.subject, mail.text, mail.sender ?? '']);
  const [subject, text, sender] = texts as [string, string, string];
  return {
    messageId: mail.id,
    threadId: mail.threadId,
    receivedAt: mail.receivedAt,
    from: mail.from ?? null,
    sender: mail.sender === undefined ? null : sender,
    replyTo: mail.replyTo ?? null,
    to: mail.recipients,
    subject,
    text,
  };
}

/**
 * A kept copy, read back: undefined when it can't be read, or was kept before #61 and so lacks the reply address. Every
 * field comes from a file, so each one is checked.
 */
export function readKept(body: string | undefined): KeptMail | undefined {
  if (body === undefined) return undefined;
  let kept: Record<string, unknown>;
  try {
    kept = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const text = (v: unknown) => (typeof v === 'string' ? v : null);
  if (!kept || typeof kept !== 'object' || !('replyTo' in kept) || typeof kept.messageId !== 'string' || typeof kept.subject !== 'string' || typeof kept.text !== 'string') {
    return undefined;
  }
  return {
    messageId: kept.messageId,
    threadId: text(kept.threadId) ?? '',
    receivedAt: text(kept.receivedAt) ?? '',
    from: text(kept.from),
    sender: text(kept.sender),
    replyTo: text(kept.replyTo),
    to: Array.isArray(kept.to) ? kept.to.filter((a): a is string => typeof a === 'string') : [],
    subject: kept.subject,
    text: kept.text,
  };
}

/** The name in a mail's `From`, as in `Codemind <hello@codemindhq.dev>`, when it gives one. */
export function senderName(mail: Pick<KeptMail, 'sender'>): string | undefined {
  return mail.sender?.match(/^\s*"?([^"<]*?)"?\s*</)?.[1]?.trim() || undefined;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Local parts that mean no reply is read (#32). `notifications@`-style addresses are left off, since some accept replies. */
const NO_REPLY = new Set(['noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply']);

/** A mail's addresses: `From`'s, and `Reply-To`'s. */
interface Addresses {
  from: string | null;
  replyTo: string | null;
}

/** Where a reply would go, as plain code works it out: `Reply-To`, otherwise `From` (#32). */
export const replyAddress = (mail: Addresses) => mail.replyTo ?? mail.from ?? undefined;

/** Whether a reply can't go anywhere: no reply address, or one whose local part, less any `+` tag, is a no-reply one. */
export function noReply(mail: Addresses): boolean {
  const address = replyAddress(mail);
  if (!address) return true;
  const local = address.slice(0, address.lastIndexOf('@')).split('+')[0]!.toLowerCase();
  return NO_REPLY.has(local);
}

/** Whether plain code finds a code or a link in a kept mail, as it would were the mail read again (#58). */
export const holdsSecret = (mail: Pick<KeptMail, 'subject' | 'text'>) => /\[(?:code|link) \d+\]/.test(`${mail.subject}\n${mail.text}`);

/**
 * A mail's own text, with the history it quotes stripped: from a line that introduces a quote, such as "On Mon, Jo
 * wrote:", an "Original Message" rule or an Outlook header block, to the end, and every line quoted with `>`.
 */
export function ownText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const end = lines.findIndex((line, i) => {
    const t = line.trim();
    if (/^-{2,}\s*(?:original message|forwarded message)\s*-{2,}$/i.test(t)) return true;
    if (/^_{10,}$/.test(t)) return true;
    // "On <date>, <name> wrote:", which a client may break over two lines.
    if (/^on\s.+\swrote:$/i.test(t)) return true;
    if (/^on\s/i.test(t) && /\swrote:$/i.test(`${t} ${lines[i + 1]?.trim() ?? ''}`) && !/wrote:$/i.test(t)) return true;
    // Outlook's header block: From:, then Sent: or Date: within the next two lines.
    if (/^from:\s/i.test(t) && lines.slice(i + 1, i + 3).some((l) => /^(?:sent|date):\s/i.test(l.trim()))) return true;
    return false;
  });
  return (end < 0 ? lines : lines.slice(0, end))
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A run of this many words that a proposal shares with the mail quotes it. */
const QUOTED_WORDS = 5;

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/**
 * Why a text proposed from a Correction of mail would carry Gmail data, if it would (ADR 0010, #61): it names an email
 * address, the sender's domain or name, or quotes a run of five words or more of the mail.
 */
export function mailDataIn(proposed: string, mail: Addresses & Pick<KeptMail, 'sender' | 'subject' | 'text'>): string | undefined {
  const lower = proposed.toLowerCase();
  if (/[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}/i.test(proposed)) return 'it names an email address';
  for (const address of [mail.from, mail.replyTo]) {
    if (!address) continue;
    const domain = domainOf(address).toLowerCase();
    for (const named of new Set([domain, rootDomain(domain)])) if (named && lower.includes(named)) return `it names the sender's domain, ${named}`;
  }
  const name = senderName(mail);
  if (name && name.length >= 3 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u').test(lower)) {
    return `it names the sender, ${name}`;
  }
  const runs = new Set<string>();
  for (const source of [mail.subject, mail.text]) {
    const w = words(source);
    for (let i = 0; i + QUOTED_WORDS <= w.length; i++) runs.add(w.slice(i, i + QUOTED_WORDS).join(' '));
  }
  const p = words(proposed);
  for (let i = 0; i + QUOTED_WORDS <= p.length; i++) {
    const run = p.slice(i, i + QUOTED_WORDS).join(' ');
    if (runs.has(run)) return `it quotes the mail ("${run}")`;
  }
  return undefined;
}
