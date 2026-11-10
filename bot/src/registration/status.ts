// A Registration's status message in the Product's post (#12): one silent message, edited in place as the Registration
// moves, from queued through each page's filling, checking and pressing to submitted and its outcome. It carries Stop
// until the final press, Correct while there is something to correct, and Start again once it is abandoned.
import { Accent, actionRow, button, ButtonStyle, container, cut, escapeMarkdown, silentMessage, text, type Button, type MessagePayload } from '../discord/components.ts';
import { shortTime } from '../pacific.ts';
import { beforeFinalPress, type StoredRegistration, type WaitsOn } from '../store.ts';
import type { Walkthrough } from '../walkthrough/walkthrough.ts';

// Each button names the Approval it was shown for, by its version, so that a tap or a pop-up from an earlier one is
// refused, as a tap on an older version is (ADR 0007, settled by the person on #56).
export const stopId = (productId: number, version: number) => `stop:registration:${productId}:${version}`;
export const correctId = (productId: number, version: number) => `correct:registration:${productId}:${version}`;
export const startAgainId = (productId: number, version: number) => `again:registration:${productId}:${version}`;

/**
 * What a button on a status message does, and the version of the Approval it was shown for, or undefined if the id
 * isn't one's. A status message sent before buttons named their version has none.
 */
export function registrationAction(customId: string): { action: 'stop' | 'correct' | 'again'; productId: number; version: number | null } | undefined {
  const m = customId.match(/^(stop|correct|again):registration:(\d+)(?::(\d+))?$/);
  return m ? { action: m[1] as 'stop' | 'correct' | 'again', productId: Number(m[2]), version: m[3] === undefined ? null : Number(m[3]) } : undefined;
}

export interface StatusInput {
  registration: StoredRegistration;
  /** The approved Walkthrough. */
  walkthrough: Walkthrough;
  /**
   * For an abandoned one, where a new Walkthrough stands: none asked for, one being prepared, one waiting in
   * #needs-you, or none offered any more and why.
   */
  next: { kind: 'none' } | { kind: 'preparing' } | { kind: 'waiting' } | { kind: 'no-walkthrough'; why: string };
  needsYouChannelId: string;
}

/** A note a model wrote, where no link in it can be tapped. */
const codeBlock = (note: string) => `\`\`\`\n${cut(note.replace(/`/g, "'").replace(/\s+/g, ' ').trim(), 200)}\n\`\`\``;

function waiting(waitsOn: WaitsOn, page: number): { what: string; lines: string[] } {
  const stays = 'Nothing was submitted. It waits here: Stop ends it, and Correct prepares its Walkthrough again.';
  const on = page > 0 ? ` on page ${page}` : '';
  switch (waitsOn.kind) {
    case 'wall':
      return { what: `at a wall${on}: ${waitsOn.wall}`, lines: [stays, ...(waitsOn.note ? [codeBlock(waitsOn.note)] : [])] };
    case 'stuck':
      return { what: `stuck${on}: ${waitsOn.reason}`, lines: [stays, ...(waitsOn.note ? [codeBlock(waitsOn.note)] : [])] };
    case 'check':
      return { what: `page ${page} failed the page check`, lines: [`The filled page doesn't match the Walkthrough: ${cut(waitsOn.failures.map(escapeMarkdown).join('; '), 600)}.`, stays] };
    case 'held':
      return { what: '', lines: [`-# Waiting: ${escapeMarkdown(cut(waitsOn.why, 300))}. It is tried again by itself.`] };
  }
}

export function registrationStatus(input: StatusInput): MessagePayload {
  const { registration: r, walkthrough: w } = input;
  const address = r.plainAddress ? w.identity.plainAddress : w.identity.plusAddress;
  const approved = `Walkthrough v${r.version} approved ${shortTime(new Date(r.approvedAt))}`;
  // A Product whose terms ban accounts made by a bot is the person's to finish from its Approval on.
  if (r.state === 'handed-off') {
    return silentMessage([
      container(Accent.progress, [
        text(`**Registration** · handed off · ${approved}. Its terms ban accounts made by a bot, so you finish it on your own device, as ${w.identity.plusAddress}.`),
      ]),
    ]);
  }
  const submitted = r.submittedAt ? `submitted ${shortTime(new Date(r.submittedAt))}` : '';
  let what: string;
  const lines: string[] = [];
  const buttons: Button[] = [];
  const stop = button(stopId(r.productId, r.version), 'Stop', ButtonStyle.Danger);
  const correct = button(correctId(r.productId, r.version), 'Correct', ButtonStyle.Secondary);
  switch (r.state) {
    case 'held':
      what = 'waiting for Bitwarden';
      break;
    case 'queued':
      what = 'queued';
      break;
    case 'filling':
      what = `filling page ${r.page}`;
      break;
    case 'checking':
      what = `checking page ${r.page}`;
      break;
    case 'pressing':
      what = `pressing **${escapeMarkdown(cut(r.button ?? 'its button', 100))}**`;
      break;
    case 'check-failed':
    case 'at-wall':
      what = r.waitsOn ? waiting(r.waitsOn, r.page).what : 'waiting for you';
      break;
    case 'awaiting-verification':
      what = `${submitted} · awaiting verification`;
      break;
    case 'registered':
    case 'waitlisted':
      what = `${submitted} · **${r.state}**`;
      break;
    case 'abandoned':
      what = `**abandoned** · ${escapeMarkdown(r.endNote ?? 'nothing submitted')}`;
      break;
  }
  if (r.waitsOn && r.state !== 'abandoned') lines.push(...waiting(r.waitsOn, r.page).lines);
  if (r.uncertain) lines.push(`It isn't known whether the last press went through: ${escapeMarkdown(cut(r.uncertain, 300))}. It counts as pressed, and is never pressed again.`);
  // A Stop or a Correction that met a press which turned out to be the final one came too late to stop anything.
  if (r.stopAt && !beforeFinalPress(r) && r.state !== 'abandoned') {
    lines.push(
      r.stopCause === 'correct'
        ? '-# Your Correction came as the final button was being pressed, so the form was submitted and it fixes only the record.'
        : '-# Your Stop came as the final button was being pressed, so the form was submitted, and nothing can be unsent.',
    );
  }
  if (r.state === 'abandoned') {
    if (input.next.kind === 'no-walkthrough') lines.push(`No Walkthrough is offered any more: ${escapeMarkdown(cut(input.next.why, 300))}.`);
    else if (input.next.kind === 'preparing') lines.push('-# A new Walkthrough is being prepared for your Approval.');
    else if (input.next.kind === 'waiting') lines.push(`-# A new Walkthrough waits for your Approval in <#${input.needsYouChannelId}>.`);
    else buttons.push(button(startAgainId(r.productId, r.version), 'Start again', ButtonStyle.Primary));
  } else if (r.stopAt && beforeFinalPress(r)) {
    lines.push('-# Stopping…');
  } else if (beforeFinalPress(r)) {
    buttons.push(stop, correct);
  } else {
    buttons.push(correct);
  }
  return silentMessage([
    container(Accent.progress, [text([`**Registration** · ${what} · ${approved}, as ${address}`, ...lines].join('\n'))]),
    ...(buttons.length > 0 ? [actionRow(buttons)] : []),
  ]);
}

/** The line a held Approval's card shrinks to once the person stops it. */
export const stoppedLine = (w: Walkthrough, version: number, threadId: string) =>
  `Stopped v${version} before it started · **${escapeMarkdown(cut(w.product, 60))}** · <#${threadId}>`;
