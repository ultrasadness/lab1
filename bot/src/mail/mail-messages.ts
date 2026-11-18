// A sorted or stopped mail's messages on Discord (#61, #32), as plain code draws them from the store: the silent
// message in the Product post of mail that asks for a reply and gets no Reply draft on arrival, the `#needs-you` card
// of mail that needs the person, and the notice of a mail run that stopped, with the only Retry. Text from the mail is
// escaped, so it can't format, link or mention anything, and the mail's own text is what gets cut to fit Discord.
import { actionRow, Accent, button, ButtonStyle, container, cut, escapeMarkdown, fits, section, silentMessage, text, type Button, type MessagePayload, type TextDisplay } from '../discord/components.ts';
import { shortTime } from '../pacific.ts';
import { declinedText } from '../rules/sorting.ts';
import type { LedgerMail, MailItem, MailKind, MailSort, Product } from '../store.ts';
import { ownText, senderName, type KeptMail } from './kept-mail.ts';

/** The custom ids of a mail's buttons, each followed by the mail's Gmail message id. */
export const CORRECT = 'mail:correct:';
export const DRAFT = 'mail:draft:';
export const DONE = 'mail:done:';
export const RETRY = 'mail:retry:';

/** Each kind as a message says it. */
const KIND_TEXT: Record<MailKind, string> = {
  'asks-for-reply': 'it asks for a reply',
  'needs-the-person': 'it needs you',
  'for-the-record': 'for the record',
};

/** What a mail's messages are made from. */
export interface MailView {
  mail: LedgerMail;
  item: MailItem;
  product: Product;
  sort: MailSort | undefined;
  kept: KeptMail | undefined;
  queued: boolean;
  correcting: boolean;
  /** The Hard limit that declined the person's latest Correction, if one did. */
  declined: string | null;
  /** Why the person's latest Correction couldn't be applied, if it couldn't. */
  unapplied: string | null;
  /** The Product's name, ready for a message. */
  name: string;
}

/** A sender as a message names it: its name, then its address as code, as a security alert's card does. */
export function senderText(kept: KeptMail | undefined): string {
  if (!kept?.from) return 'its sender';
  const name = senderName(kept);
  const address = `\`${kept.from.replaceAll('`', '')}\``;
  return name ? `${escapeMarkdown(cut(name, 80))} (${address})` : address;
}

/** Whether a mail's message offers Draft reply: not to a no-reply address, nor once a draft is queued. */
const offersDraft = (view: MailView) => !view.item.noReply && !view.queued;

/** What the latest Correction made of a mail, as a closed message says it. */
function correctedText(view: MailView): string {
  const kind = view.sort?.kind;
  if (kind === 'asks-for-reply') return view.queued ? 'it asks for a reply; a Reply draft is queued' : 'it asks for a reply';
  return kind ? KIND_TEXT[kind] : 'sorted again';
}

/** The line under a message saying where it stands, if anything does. */
function statusLine(view: MailView): string | undefined {
  if (view.correcting) return 'Sorting it again after your Correction…';
  const parts: string[] = [];
  if (view.queued) parts.push('Reply draft queued');
  else if (view.item.noReply) parts.push('Its reply address is a no-reply one, so it gets no Reply draft');
  if (view.unapplied) parts.push(`Your Correction couldn't be applied: ${cut(view.unapplied, 150)}. Correct again`);
  if (view.declined) parts.push(`Your Correction is ${declinedText(view.declined)}`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * The silent message in the Product post of mail that asks for a reply and gets no Reply draft on arrival: bulk mail,
 * and mail from a no-reply address. Undefined while the mail is sorted otherwise.
 */
export function postPayload(view: MailView): MessagePayload | undefined {
  const { sort, kept, mail, item } = view;
  if (sort?.kind !== 'asks-for-reply' || !(mail.bulk || item.noReply)) return undefined;
  const id = mail.messageId;
  const status = statusLine(view);
  const buttons = view.correcting ? [] : [...(offersDraft(view) ? [button(`${DRAFT}${id}`, 'Draft reply')] : []), button(`${CORRECT}${id}`, 'Correct')];
  const heading = `**Mail that asks for a reply** · from ${senderText(kept)}${mail.spam ? ' · in Spam' : ''}`;
  const subject = kept ? `**${escapeMarkdown(cut(kept.subject || '(no subject)', 200))}**` : `-# Received ${shortTime(new Date(mail.receivedAt))}`;
  const tail = status ? `-# ${status}` : undefined;
  const build = (body: string) =>
    silentMessage([
      container(Accent.progress, [text(heading), text(`${subject}\n${body}`), ...(tail ? [text(tail)] : [])]),
      ...(buttons.length > 0 ? [actionRow(buttons)] : []),
    ]);
  // The mail's own text is what gets cut to fit Discord's 4,000 characters.
  const own = kept ? escapeBlock(ownText(kept.text)) || '-# (no text)' : '-# Its text can’t be read from Gmail now.';
  let room = own.length;
  let message = build(own);
  while (!fits(message) && room > 0) {
    room = Math.max(0, room - 200);
    message = build(cut(own, room));
  }
  return message;
}

/** The silent message of mail that asked for a reply and was sorted otherwise after a Correction, as one line. */
export function closedPost(view: MailView): MessagePayload {
  const from = view.kept ? ` · “${escapeMarkdown(cut(view.kept.subject || '(no subject)', 150))}”` : '';
  return silentMessage([text(`Mail from ${view.name}${from} · corrected: ${correctedText(view)}`)]);
}

/** The notice of a mail run that stopped, with the only Retry; once the mail is sorted, it says so. */
export function noticePayload(view: Pick<MailView, 'mail' | 'item' | 'kept'>): MessagePayload | undefined {
  const { item, mail } = view;
  if (!item.noticeIntended && !item.stoppedWhy) return undefined;
  const which = `${view.kept ? `From ${senderText(view.kept)} · “${escapeMarkdown(cut(view.kept.subject || '(no subject)', 150))}” · r` : 'R'}eceived ${shortTime(new Date(mail.receivedAt))}`;
  if (!item.stoppedWhy) {
    return silentMessage([container(Accent.progress, [section(`**Mail handled** · ${which}, sorted after Retry.`, button(`${RETRY}${mail.messageId}`, 'Retry', ButtonStyle.Primary, true))])]);
  }
  const then = item.retryTappedAt ? `-# Retried at ${shortTime(new Date(item.retryTappedAt))}` : '-# Retry runs it again under the same limits.';
  return silentMessage([
    container(Accent.progress, [
      section(`**Mail not handled** · ${which}: ${escapeMarkdown(cut(item.stoppedWhy, 300))}.\n${then}`, button(`${RETRY}${mail.messageId}`, 'Retry', ButtonStyle.Primary, Boolean(item.retryTappedAt))),
    ]),
  ]);
}

/** Text from a mail shown as a block: each line escaped, so the mail can't format, link or mention anything. */
function escapeBlock(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/[\\*_~`|[\]<>@#]/g, (c) => `\\${c}`).replace(/^(\s*)([-+>]|\d+\.)/, '$1\\$2'))
    .join('\n')
    .trim();
}

/** The card of mail that needs the person, while it is open: undefined once it is done, lapsed or sorted otherwise. */
export function cardOf(view: MailView): { heading: string; body: TextDisplay[]; buttons: Button[] } | undefined {
  const { sort, item, kept } = view;
  if (sort?.kind !== 'needs-the-person' || item.cardEndedBy) return undefined;
  const id = view.mail.messageId;
  const status = statusLine(view);
  const buttons = view.correcting
    ? []
    : [
        button(`${DONE}${id}`, 'Done', ButtonStyle.Primary),
        button(`${CORRECT}${id}`, 'Correct'),
        ...(offersDraft(view) ? [button(`${DRAFT}${id}`, 'Draft reply')] : []),
      ];
  const from = kept ? `From ${senderText(kept)} · “${escapeMarkdown(cut(kept.subject || '(no subject)', 150))}”` : `Received ${shortTime(new Date(view.mail.receivedAt))}`;
  const meta = `-# ${from}${view.mail.spam ? ' · in Spam' : ''} · <#${view.product.threadId}>`;
  return {
    heading: `Mail from ${view.name} needs you`,
    body: [text(escapeMarkdown(sort.wants ?? sort.gist ?? 'Open it in Gmail.')), text(meta), ...(status ? [text(`-# ${status}`)] : [])],
    buttons,
  };
}

/** A card no longer open, as the one line it shrinks to. */
export function cardLine(view: MailView): string {
  const head = `Mail from ${view.name}`;
  if (view.item.cardEndedBy === 'done') return `${head} · done`;
  if (view.item.cardEndedBy === 'lapse') return `${head} · lapsed after 14 days; it’s still in Gmail`;
  return `${head} · corrected: ${correctedText(view)}`;
}
