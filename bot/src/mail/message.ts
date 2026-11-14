// A mail as plain code reads it from Gmail's `format=full`: its labels, Gmail's receive time, the addresses it came from
// and went to, whether it is bulk, the domain Gmail's own DMARC check passed, and its text. Every field comes from
// outside, so each one has an answer for any value: a header missing or malformed reads as absent, never as a throw.
import { htmlToText } from '../html-text.ts';
import type { GmailMessage, MessagePart } from './gmail.ts';

export interface ReadMail {
  id: string;
  threadId: string;
  labels: string[];
  /** When Gmail received it. */
  receivedAt: string;
  /** Its headers, topmost first, as the message holds them. */
  headers: { name: string; value: string }[];
  /** The address in `From`, in lower case. */
  from: string | undefined;
  /** The addresses it was delivered and sent to: `Delivered-To`, `To` and `Cc`, in lower case. */
  recipients: string[];
  /** Whether it carries `List-Unsubscribe`, which makes it bulk mail (#16). */
  bulk: boolean;
  subject: string;
  /** Its plain-text parts, or its HTML ones as text when it has none. */
  text: string;
}

/** The latest time a Date can hold, in milliseconds. */
const LATEST_TIME = 8.64e15;

/** A part's headers that have a name and a value, as text: any other entry, or a field that isn't a list, reads as none. */
const headersOf = (part: MessagePart | undefined): { name: string; value: string }[] =>
  (Array.isArray(part?.headers) ? part.headers : []).flatMap((h) => (typeof h?.name === 'string' && typeof h.value === 'string' ? [{ name: h.name, value: h.value }] : []));

/** The values of a part's headers of one name, in any case, topmost first. */
const valuesOf = (headers: { name: string; value: string }[], name: string) => headers.filter((h) => h.name.toLowerCase() === name.toLowerCase()).map((h) => h.value);

/** The message's own fields, or undefined when Gmail sent one without its id, thread or a receive time a date can hold. */
export function readMail(m: GmailMessage): ReadMail | undefined {
  const received = Number(m.internalDate);
  if (typeof m.id !== 'string' || typeof m.threadId !== 'string' || !(received > 0 && received <= LATEST_TIME)) return undefined;
  const payload = m.payload && typeof m.payload === 'object' ? m.payload : undefined;
  const headers = headersOf(payload);
  const all = (name: string) => valuesOf(headers, name);
  return {
    id: m.id,
    threadId: m.threadId,
    labels: Array.isArray(m.labelIds) ? m.labelIds.filter((l): l is string => typeof l === 'string') : [],
    receivedAt: new Date(received).toISOString(),
    headers,
    from: addressesIn(all('From')[0] ?? '')[0],
    recipients: ['Delivered-To', 'To', 'Cc'].flatMap((name) => all(name).flatMap(addressesIn)),
    bulk: all('List-Unsubscribe').length > 0,
    subject: all('Subject')[0] ?? '',
    text: bodyText(payload),
  };
}

/** The addresses in a header such as `"Doe, Jo" <jo@x.dev>, team@y.dev`, in lower case. */
export function addressesIn(value: string): string[] {
  const unquoted = value.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return unquoted
    .split(',')
    .map((piece) => (piece.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? piece.match(/[^\s<>"]+@[^\s<>"]+/)?.[0])?.toLowerCase())
    .filter((address): address is string => Boolean(address));
}

/** The domain of an address. */
export const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1);

/**
 * The domain Gmail's own DMARC check passed for, if it passed: read from the topmost `Authentication-Results` whose
 * authserv-id is `mx.google.com`, since a header lower down could come from the sender (#17).
 */
export function dmarcPassed(mail: ReadMail): string | undefined {
  const gmails = mail.headers.find((h) => h.name.toLowerCase() === 'authentication-results' && h.value.trim().toLowerCase().startsWith('mx.google.com;'));
  if (!gmails) return undefined;
  const verdict = gmails.value.match(/(?:^|;)\s*dmarc=(\w+)[^;]*?header\.from=([a-z0-9.-]+)/i);
  return verdict && verdict[1]!.toLowerCase() === 'pass' ? verdict[2]!.toLowerCase() : undefined;
}

/** Its plain-text parts joined, or its HTML parts as text when it has no plain one. Attachments are left out. */
function bodyText(payload: MessagePart | undefined): string {
  const plain: string[] = [];
  const html: string[] = [];
  const visit = (part: MessagePart | undefined) => {
    if (!part || typeof part !== 'object') return;
    const type = typeof part.mimeType === 'string' ? part.mimeType.toLowerCase() : '';
    const attached = valuesOf(headersOf(part), 'Content-Disposition').some((value) => /^\s*attachment/i.test(value));
    if (!attached && typeof part.body?.data === 'string') {
      if (type === 'text/plain') plain.push(decoded(part));
      else if (type === 'text/html') html.push(decoded(part));
    }
    for (const child of Array.isArray(part.parts) ? part.parts : []) visit(child);
  };
  visit(payload);
  return plain.length > 0 ? plain.join('\n') : html.map(mailHtmlToText).join('\n');
}

/** A part's body, in the charset its `Content-Type` names, or UTF-8 when that names none this Node knows. */
function decoded(part: MessagePart): string {
  const bytes = Buffer.from(part.body?.data ?? '', 'base64url');
  const type = valuesOf(headersOf(part), 'Content-Type')[0] ?? '';
  const charset = type.match(/charset="?([^";\s]+)"?/i)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** A mail's HTML as text, with each link's address beside its words, so the links stay in the text. */
function mailHtmlToText(html: string): string {
  return htmlToText(
    html
      .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (_whole, dq?: string, sq?: string, bare?: string, words = '') => {
        const href = (dq ?? sq ?? bare ?? '').trim();
        return href ? `${words} ( ${href} )` : words;
      }),
  );
}
