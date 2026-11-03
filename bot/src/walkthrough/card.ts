// A Walkthrough on Discord (#12): its card in #needs-you and its copy in the Product's post. From the top, the card
// leads with what one tap does, then the signup host, every field with its value one per line, each choice, the walls
// the read predicted, and the Rules applied with when the page was read. An Edit sits beside each field the person may
// change, and Approve, Correct and Dismiss below. A card that Discord's 40 components can't hold with an Edit beside
// every field gives the later ones none, and says Correct changes them. Once handled, the card shrinks to one line.
import {
  Accent,
  actionRow,
  button,
  ButtonStyle,
  container,
  cut,
  escapeMarkdown,
  fits,
  section,
  silentMessage,
  text,
  type Button,
  type MessagePayload,
  type Section,
  type TextDisplay,
} from '../discord/components.ts';
import { needsYouCard } from '../needs-you.ts';
import { pacificTime, shortTime } from '../pacific.ts';
import { PROFILE_PATH } from './prompt.ts';
import { hasPasswordField, offDomain, type Walkthrough, type WalkthroughField } from './walkthrough.ts';

/** What made a version: a preparation, the person's Edit of one field, their Correction, or Prepare again after a lapse. */
export type VersionCause =
  | { kind: 'prepared' }
  | { kind: 'edited'; field: string }
  | { kind: 'corrected'; text: string }
  | { kind: 'prepared-again' };

/**
 * Where the card stands: open; its buttons off while an Approve is done, waits for Bitwarden, or the Walkthrough is
 * prepared again; lapsed, with only Prepare again on; or open again after a Correction that couldn't be applied, saying
 * why.
 */
export type CardState =
  | { kind: 'open'; note?: string }
  | { kind: 'approving' }
  | { kind: 'waiting-for-bitwarden'; approvedAt: Date }
  | { kind: 'correcting' }
  | { kind: 'lapsed' }
  | { kind: 'preparing-again' };

export interface VersionShown {
  productId: number;
  version: number;
  walkthrough: Walkthrough;
  cause: VersionCause;
}

/** What a button on a Walkthrough's card does, and the pop-up it opens, which has its id. */
export type CardAction = 'approve' | 'correct' | 'dismiss' | 'again' | 'edit';

export const walkthroughId = (action: Exclude<CardAction, 'edit'>, v: Pick<VersionShown, 'productId' | 'version'>) =>
  `${action}:walkthrough:${v.productId}:${v.version}`;
/** Edit beside the field at this place among the Walkthrough's fields. */
export const editId = (v: Pick<VersionShown, 'productId' | 'version'>, field: number) => `edit:walkthrough:${v.productId}:${v.version}:${field}`;

/** The action, version and field a button's or pop-up's id names, or undefined if it isn't a Walkthrough's. */
export function walkthroughAction(customId: string): { action: CardAction; productId: number; version: number; field: number | null } | undefined {
  const m = customId.match(/^(approve|correct|dismiss|again|edit):walkthrough:(\d+):(\d+)(?::(\d+))?$/);
  if (!m || (m[1] === 'edit') !== (m[4] !== undefined)) return undefined;
  return { action: m[1] as CardAction, productId: Number(m[2]), version: Number(m[3]), field: m[4] === undefined ? null : Number(m[4]) };
}

/** A choice's Edit is a radio group, which Discord gives 2 to 10 options. */
export const CHOICE_OPTIONS = { min: 2, max: 10 } as const;

/** Whether a field gets no Edit because it is the Signup identity or the password, which the person never sets. */
const fixed = (f: WalkthroughField) => f.key === 'email' || f.key === 'password';

/** Whether the person may change a field with Edit: any but the fixed ones, and a choice Discord can offer as one. */
export const editable = (f: WalkthroughField) =>
  !fixed(f) && (f.key !== 'choice' || (f.options!.length >= CHOICE_OPTIONS.min && f.options!.length <= CHOICE_OPTIONS.max));

const QUOTE_CHARS = 300;

/** The card's parts, for NeedsYou to build it with the person's mention. */
export function walkthroughCard(v: VersionShown, state: CardState): { heading: string; body: (TextDisplay | Section)[]; buttons: Button[] } {
  const heading = `Walkthrough v${v.version} · ${productName(v.walkthrough)}`;
  const on = state.kind === 'open';
  const buttons = [
    button(walkthroughId('approve', v), 'Approve', ButtonStyle.Success, !on),
    button(walkthroughId('correct', v), 'Correct', ButtonStyle.Secondary, !on),
    button(walkthroughId('dismiss', v), 'Dismiss', ButtonStyle.Secondary, !on),
    ...(state.kind === 'lapsed' ? [button(walkthroughId('again', v), 'Prepare again', ButtonStyle.Primary)] : []),
  ];
  const note = stateNote(state);
  // A Discord user id has at most 20 digits.
  const fitsCard = (body: (TextDisplay | Section)[]) => fits(needsYouCard('0'.repeat(20), heading, body, { buttons }));
  for (const compact of [false, true]) {
    const editableCount = v.walkthrough.fields.filter(editable).length;
    for (let edits = editableCount; edits >= 0; edits--) {
      const body = bodyOf(v, { compact, edits, disabled: !on, note, copy: false });
      if (fitsCard(body)) return { heading, body, buttons };
    }
  }
  throw new Error(`The Walkthrough of ${v.walkthrough.rootDomain} doesn't fit Discord even with its labels cut`);
}

/** The copy of a version in the Product's post: the card's text without its mention or any button, silent. */
export function walkthroughCopy(v: VersionShown, needsYouChannelId: string, preparedAt: Date): MessagePayload {
  const head = `**Walkthrough v${v.version}** · put to you in <#${needsYouChannelId}> ${shortTime(preparedAt)}`;
  for (const compact of [false, true]) {
    const body = bodyOf(v, { compact, edits: 0, disabled: true, note: undefined, copy: true });
    const message = silentMessage([container(Accent.progress, [text(head), ...body])]);
    if (fits(message)) return message;
  }
  throw new Error(`The copy of the Walkthrough of ${v.walkthrough.rootDomain} doesn't fit Discord`);
}

/** A version as its card shows it, for a run's prompt: the card's text without the mention or any button. */
export function cardText(v: VersionShown): string {
  return bodyOf(v, { compact: false, edits: 0, disabled: true, note: undefined, copy: true })
    .map((c) => (c.type === 10 ? c.content : c.components.map((t) => t.content).join('\n')))
    .join('\n');
}

function stateNote(state: CardState): string | undefined {
  switch (state.kind) {
    case 'approving':
      return 'Approving…';
    case 'waiting-for-bitwarden':
      return `Approved ${pacificTime(state.approvedAt)}. Waiting for Bitwarden: the Registration starts once its new password is saved.`;
    case 'correcting':
      return 'Preparing it again after your Correction…';
    case 'preparing-again':
      return 'Preparing it again from a fresh read of the signup page…';
    case 'lapsed':
      return 'Lapsed: unanswered for 14 days.';
    case 'open':
      return state.note;
  }
}

const productName = (w: Walkthrough) => escapeMarkdown(cut(w.product, 60));

/**
 * The card's body: what one tap does, the host, the fields with an Edit beside the first `edits` editable ones, the
 * choices, the walls, then the foot.
 */
function bodyOf(
  v: VersionShown,
  shape: { compact: boolean; edits: number; disabled: boolean; note: string | undefined; copy: boolean },
): (TextDisplay | Section)[] {
  const w = v.walkthrough;
  const labelChars = shape.compact ? 24 : 60;
  const body: (TextDisplay | Section)[] = [text([consequences(w), whatHappens(w), hostLine(w)].join('\n'))];
  let lines: string[] = [];
  let edits = shape.edits;
  let noEdit = false;
  const ordered = [...w.fields.filter((f) => f.key !== 'choice'), ...w.fields.filter((f) => f.key === 'choice')];
  for (const field of ordered) {
    const line = `**${escapeMarkdown(cut(field.label, labelChars))}** · ${valueText(field, w)}`;
    if (!editable(field)) {
      if (!fixed(field)) noEdit = true;
      lines.push(line);
      continue;
    }
    if (edits === 0) {
      noEdit = true;
      lines.push(line);
      continue;
    }
    edits -= 1;
    if (lines.length > 0) body.push(text(lines.join('\n')));
    lines = [];
    body.push(section(line, button(editId(v, w.fields.indexOf(field)), 'Edit', ButtonStyle.Secondary, shape.disabled)));
  }
  if (lines.length > 0) body.push(text(lines.join('\n')));
  body.push(text([...(w.formSeen ? [] : ['Form not seen: carries only the standard keys.']), wallsLine(w)].join('\n')));
  const rules = w.rulesApplied.length > 0 ? cut(w.rulesApplied.map(escapeMarkdown).join(', '), shape.compact ? 200 : 600) : 'none';
  const foot = [
    `-# Rules applied: ${rules} · signup page read ${shortTime(new Date(w.readAt))}`,
    ...causeLine(v),
    ...(w.fieldsLeftOut > 0 ? [`-# The form has ${w.fieldsLeftOut} more fields after these, left empty.`] : []),
    // The copy has no Edit at all, so it never says so.
    ...(noEdit && !shape.copy ? ['-# Correct to change a field with no Edit beside it.'] : []),
    ...(shape.note ? [`-# ${shape.note}`] : []),
  ];
  body.push(text(foot.join('\n')));
  return body;
}

function causeLine(v: VersionShown): string[] {
  const { cause, version } = v;
  switch (cause.kind) {
    case 'prepared':
      return [];
    case 'edited':
      return [`-# v${version}: you edited ${escapeMarkdown(cut(cause.field, 60))}.`];
    case 'corrected':
      return [`-# v${version}: prepared again after your Correction: “${cut(escapeMarkdown(cause.text), QUOTE_CHARS)}”`];
    case 'prepared-again':
      return [`-# v${version}: prepared again from a fresh read, after v${version - 1} lapsed.`];
  }
}

/** What one tap does, consequences first (#12). */
function consequences(w: Walkthrough): string {
  const product = `**${productName(w)}**`;
  const where = `on **${escapeMarkdown(w.signupHost)}** as **${w.identity.plusAddress}**`;
  const terms = `You accept ${termsText(w)}.`;
  if (w.termsBan) {
    // A Walkthrough with no password field gets no vault item (ADR 0004).
    const password = hasPasswordField(w) ? ` saves a new random password to Bitwarden › Registrations › ${product}, and` : '';
    return (
      `If you approve, the Assistant${password} hands the Registration to you: you create the account at ${product} ${where} ` +
      `yourself, with the values below. ${terms}`
    );
  }
  const press = w.button ? `presses **${escapeMarkdown(w.button)}**` : "presses the form's button";
  return `If you approve, the Assistant creates an account at ${product} ${where}, and ${press} itself if the filled form matches this Walkthrough. ${terms}`;
}

function whatHappens(w: Walkthrough): string {
  if (w.termsBan) return `**What happens:** a Handoff, since its terms ban accounts made by a bot: “${escapeMarkdown(w.termsBan)}”`;
  const after = { 'verification-email': 'a verification email.', waitlist: 'it joins a waitlist.', 'logged-in': 'it logs straight in.' }[w.onSubmit];
  return `**What happens on submit:** ${after}`;
}

/** The host, with its auth vendor when the page is one's, or saying it is off the Product's own domain. */
function hostLine(w: Walkthrough): string {
  const vendor = w.authVendor
    ? ` (${escapeMarkdown(w.authVendor)}, ${productName(w)}'s sign-in provider)`
    : offDomain(w)
      ? ` (not ${productName(w)}'s own domain)`
      : '';
  return `**Signup host:** ${escapeMarkdown(w.signupHost)}${vendor}`;
}

/** Discord counts link URLs in its 4,000 characters, so terms at a longer URL are named with no link. */
const TERMS_URL_MAX = 200;

function termsText(w: Walkthrough): string {
  if (w.terms.length === 0) return 'the terms its form shows, which the read found no link to';
  const links = w.terms.map((l) => {
    const name = escapeMarkdown(cut(l.text, 60));
    if (l.href.length > TERMS_URL_MAX) return `${name} (its link too long to show)`;
    return `[${name}](${l.href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
  });
  return links.length === 1 ? links[0]! : `${links.slice(0, -1).join(', ')} and ${links.at(-1)}`;
}

function valueText(f: WalkthroughField, w: Walkthrough): string {
  switch (f.key) {
    case 'email':
      return `${w.identity.plusAddress}, or ${w.identity.plainAddress} if the form refuses +`;
    case 'password':
      return `new random one, saved to Bitwarden › Registrations › ${productName(w)}`;
    case 'first-name':
    case 'last-name':
    case 'full-name':
      return f.value === null ? `left empty, as your Profile gives no name (\`${PROFILE_PATH}\`)` : escapeMarkdown(f.value);
    case 'offer-code':
      if (f.value === null) return 'left empty';
      return f.offer ? `${escapeMarkdown(f.value)}, from the Offer “${escapeMarkdown(cut(f.offer, 60))}”` : escapeMarkdown(f.value);
    case 'choice':
      return f.value === null ? 'left as the page has it' : escapeMarkdown(f.value);
    case 'text':
      return f.value === null ? 'left empty' : escapeMarkdown(f.value);
  }
}

function wallsLine(w: Walkthrough): string {
  const walls = w.walls.map((wall) => {
    switch (wall.kind) {
      case 'bot-check':
        return `expect a bot check${wall.vendor === 'unknown' ? '' : ` (${escapeMarkdown(wall.vendor)})`}; you'll be asked to Take over`;
      case 'phone':
        return "expect a phone check; you'll be asked to Hand off";
      case 'oauth-only':
        return `sign-in only through ${wall.providers.map((p) => escapeMarkdown(cut(p, 30))).join(' or ')}; you'll be asked to Hand off, signing in with the Signup mailbox's own Google account`;
    }
  });
  return `**Walls:** ${walls.length > 0 ? walls.join('; ') : 'none seen on load'}.`;
}

/** The line a card shrinks to once approved: `✅ Approved v1 14:03 · Codemind · #post`. */
export const approvedLine = (w: Walkthrough, version: number, at: Date, threadId: string) =>
  `✅ Approved v${version} ${pacificTime(at)} · **${productName(w)}** · <#${threadId}>`;

export const dismissedLine = (w: Walkthrough, version: number, threadId: string) => `Dismissed v${version} · **${productName(w)}** · <#${threadId}>`;

export const replacedLine = (w: Walkthrough, version: number, threadId: string) => `Replaced by v${version} · **${productName(w)}** · <#${threadId}>`;

export const preparedAgainLine = (w: Walkthrough, lapsed: number, version: number, threadId: string) =>
  `Lapsed v${lapsed} · prepared again as v${version} · **${productName(w)}** · <#${threadId}>`;

export const withdrawnLine = (w: Walkthrough, version: number, why: string, threadId: string) =>
  `No Walkthrough after your Correction of v${version}: ${escapeMarkdown(why)} · **${productName(w)}** · <#${threadId}>`;

/** The Registration's status message in the Product's post: silent, with Stop until the final press. */
export function statusMessage(input: { productId: number; walkthrough: Walkthrough; version: number; approvedAt: Date; state: 'queued' | 'handed-off' }): MessagePayload {
  const { walkthrough: w } = input;
  const approved = `Walkthrough v${input.version} approved ${shortTime(input.approvedAt)}`;
  if (input.state === 'handed-off') {
    return silentMessage([
      container(Accent.progress, [
        text(`**Registration** · handed off · ${approved}. Its terms ban accounts made by a bot, so you finish it on your own device, as ${w.identity.plusAddress}.`),
      ]),
    ]);
  }
  return silentMessage([
    container(Accent.progress, [text(`**Registration** · queued · ${approved}, as ${w.identity.plusAddress}`)]),
    actionRow([button(stopId(input.productId), 'Stop', ButtonStyle.Danger)]),
  ]);
}

/** Stop is wired in #56. */
export const stopId = (productId: number) => `stop:registration:${productId}`;
