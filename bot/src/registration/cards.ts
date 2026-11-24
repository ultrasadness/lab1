// A Registration's cards in #needs-you (#59, #10, #12). What waits on the person gets a card with its route beside
// Stop: a wall, a fill run that ended stuck, or a page check that failed, which plain code's Submit tap answers when
// only values the person can see failed it. Walls nothing can get past end the Registration *abandoned* at once and get
// no card. A Handoff card gives the person the rest of a Registration to finish on their own device: numbered steps,
// the approved values to copy, and the password through AutoFill, with Done. A page that newly asks for something gets
// an amended Walkthrough instead (#115, `amended.ts`), with Approve and Stop. Take over comes with #60, which puts it
// first where #10's routes do; until then each card offers only what works.
import { button, ButtonStyle, cut, escapeMarkdown, image, MESSAGE_LIMITS, text, type Button, type MediaGallery, type TextDisplay } from '../discord/components.ts';
import type { Upload } from '../discord/rest.ts';
import { shortTime } from '../pacific.ts';
import { beforeFinalPress, handOffCause, type CardAbout, type CheckedRule, type HandOff, type RegistrationCard, type StoredRegistration, type WaitsOn } from '../store.ts';
import { amendable } from './amended.ts';
import { codeBlock } from './status.ts';
import { hasPasswordField, type Walkthrough } from '../walkthrough/walkthrough.ts';

/** The rules of the page check a Submit tap answers: a value or a box the person can see on the screenshot. */
const SUBMIT_TAP_RULES = ['unapproved-value', 'unapproved-box'];

/** What a wall is, as a card says it. */
const WALL_TEXT: Record<string, string> = {
  'bot-check': 'a bot check',
  'too-many-pages': 'a signup form still going after 5 pages',
  phone: 'a phone check',
  blocked: "a site that refuses the Assistant's browser",
  'oauth-only': 'a sign-in only through other accounts',
  card: 'card fields',
  'free-email': 'a form that refuses gmail.com addresses',
  'invite-only': 'an invite code nobody has',
};

/** Why a fill run, or plain code, got stuck, as a card says it. */
const STUCK_TEXT: Record<string, string> = {
  'password-refused': 'the form refused the password',
  'plus-refused': 'the form refused the address',
  'no-button': 'the page shows no button to press',
  // A fill run named it until #115 had the page check find such a field, so a Registration may still wait on one.
  'value-missing': 'a required field has no approved value',
  'page-error': 'the page shows an error',
  other: "something on the page the fill run couldn't name",
  'fill-runs-spent': 'its 3 fill runs of the page ended without naming a button',
  'session-lost': 'its browser session was lost after a button was pressed',
};

const NOT_GOOGLE = 'whose mail would land outside the Signup mailbox';

/** The longest link a Handoff card writes out: a card has 4,000 characters, and fifteen values come before its terms. */
const LINK_CHARS = 300;
/** The most a card's body holds, leaving Discord's 4,000 characters room for its heading, its mention and its button. */
const CARD_TEXT = MESSAGE_LIMITS.text - 200;

/**
 * Why a wall ends the Registration *abandoned* at once, when nothing can get past it (#10): card fields, a form that
 * refuses free addresses, an invite code nobody has, or a sign-in only through providers other than Google.
 */
export function endsAtOnce(waitsOn: WaitsOn): string | null {
  if (waitsOn.kind !== 'wall') return null;
  switch (waitsOn.wall) {
    case 'card':
      return 'at a wall: card fields, which are never filled';
    case 'free-email':
      return 'at a wall: its form refuses gmail.com addresses';
    case 'invite-only':
      return 'at a wall: signing up needs an invite code, and none is known';
    case 'oauth-only': {
      const providers = waitsOn.providers ?? [];
      return providers.some(isGoogle) ? null : `at a wall: it signs in only through ${providers.join(' or ') || 'other accounts'}, ${NOT_GOOGLE}`;
    }
    default:
      return null;
  }
}

/** Whether a sign-in a fill run named is Google's, however the page words it: "Google", "Continue with Google". */
export const isGoogle = (provider: string) => /\bgoogle\b/i.test(provider);

/** The hosts of the sign-in providers plain code knows, by the provider's name. */
const SIGN_IN_HOSTS: [host: string, provider: string][] = [
  ['accounts.google.com', 'Google'],
  ['github.com', 'GitHub'],
  ['appleid.apple.com', 'Apple'],
  ['login.microsoftonline.com', 'Microsoft'],
  ['login.live.com', 'Microsoft'],
];

/**
 * The sign-in provider whose page a host is, if plain code knows it: a fill run that finds itself on one meets #10's
 * `oauth-only` wall, so that no provider's session enters the Registration browser (settled by the person on #115).
 */
export function signInProvider(host: string): string | null {
  const h = host.toLowerCase();
  return SIGN_IN_HOSTS.find(([known]) => h === known || h.endsWith(`.${known}`))?.[1] ?? null;
}

/**
 * Whether a failed check goes to an amended Walkthrough (#115): it failed on what the page newly asks for, a required
 * field left empty, other terms or another host, beside any value the person can see, and on nothing that only Hand
 * off answers, such as a field holding a Secret, another of the browser's validity flags, or a refusal of its own.
 * The press can't pass while a required field is empty, so a value the person can see waits for the next check
 * (settled by the person on #59).
 */
export function forAmended(rules: readonly CheckedRule[]): boolean {
  if (!rules.some(amendable)) return false;
  return rules.every((r) => amendable(r) || (SUBMIT_TAP_RULES.includes(r.rule) && !r.secret));
}

/**
 * Whether a failed check goes to a Submit tap: it failed only on values the person can see on a screenshot, which
 * masks each field filled by reference, with no refusal of its own; or its page changed after the person last saw it,
 * so that they see it again before anything is pressed.
 */
export function forSubmitTap(waitsOn: WaitsOn | null): boolean {
  if (waitsOn?.kind !== 'check' || waitsOn.refusal || !waitsOn.rules) return false;
  if (!waitsOn.rules.every((r) => SUBMIT_TAP_RULES.includes(r.rule) && !r.secret)) return false;
  return waitsOn.rules.length > 0 || Boolean(waitsOn.changed);
}

/** What a Registration waiting on the person waits on, as a Handoff says it came from: "a bot check on page 1", "page 2, stuck: …". */
export function waitingFrom(waitsOn: WaitsOn, page: number): string {
  const on = page > 0 ? ` on page ${page}` : '';
  switch (waitsOn.kind) {
    case 'wall':
      return `${WALL_TEXT[waitsOn.wall] ?? waitsOn.wall}${on}`;
    case 'stuck':
      return `${page > 0 ? `page ${page}, ` : ''}stuck: ${STUCK_TEXT[waitsOn.reason] ?? waitsOn.reason}`;
    case 'check':
      return page > 0 ? `page ${page}, which failed the page check` : 'a failed page check';
    case 'held':
      return `a wait${on}`;
  }
}

/** The card a Registration is due, from where it stands, if any: what it waits on, or its Handoff. */
export function dueCard(r: StoredRegistration): CardAbout | null {
  // One being stopped waits on nobody: its Stop ends it.
  if (r.stopAt && beforeFinalPress(r)) return null;
  if ((r.state === 'at-wall' || r.state === 'check-failed') && r.waitsOn && r.waitsOn.kind !== 'held') {
    // An amended Walkthrough's card comes once its version is prepared; one that couldn't be waits at Hand off and Stop.
    const amended = r.waitsOn.kind === 'check' ? r.waitsOn.amended : undefined;
    if (amended === 'due') return null;
    if (amended && 'version' in amended) return { kind: 'amended', page: r.page, waitsOn: r.waitsOn, amendment: amended.version };
    return forSubmitTap(r.waitsOn) ? { kind: 'submit-tap', page: r.page, waitsOn: r.waitsOn, fingerprint: null } : { kind: 'waiting', page: r.page, waitsOn: r.waitsOn };
  }
  const cause = r.state === 'handed-off' ? handOffCause(r) : null;
  return cause ? { kind: 'handoff', cause } : null;
}

/** Whether a card still stands for what the Registration now waits on, or has. */
export function cardFits(card: RegistrationCard, r: StoredRegistration): boolean {
  if (card.version !== r.version) return false;
  switch (card.kind) {
    case 'waiting':
    case 'submit-tap':
    case 'amended': {
      const due = dueCard(r);
      return due?.kind === card.kind && due.page === card.page && JSON.stringify(due.waitsOn) === JSON.stringify(card.waitsOn);
    }
    case 'handoff':
      return r.state === 'handed-off';
    case 'still-showing':
      return r.state === 'awaiting-verification';
  }
}

/** Whether a card of the due kind is one already made for it: a Handoff is made once for each Approval. */
export function cardMadeFor(card: RegistrationCard, due: CardAbout, version: number): boolean {
  if (card.version !== version || card.kind !== due.kind) return false;
  if (due.kind === 'handoff') return true;
  return !card.endedAt && 'page' in due && 'page' in card && card.page === due.page && JSON.stringify(card.waitsOn) === JSON.stringify(due.waitsOn);
}

/** What a card's line says of a Registration once the card has ended. */
export function endedText(r: StoredRegistration): string {
  switch (r.state) {
    case 'abandoned':
      return `abandoned: ${r.endNote ?? 'nothing submitted'}`;
    case 'handed-off':
      return 'handed off to you';
    case 'registered':
    case 'waitlisted':
      return r.state;
    case 'awaiting-verification':
      return 'submitted, awaiting verification';
    default:
      return 'moved on';
  }
}

// Each button names the card it is on, by its id in the store; an amended Walkthrough's Approve and Edit name the version
// shown too, and Edit the value it changes (`amended.ts`).
export const cardButtonId = (action: 'handoff' | 'stop' | 'done', cardId: number) => `${action}:regcard:${cardId}`;
export const submitId = (cardId: number, fingerprint: string) => `submit:regcard:${cardId}:${fingerprint}`;

export type CardAction =
  | { action: 'handoff' | 'stop' | 'done'; cardId: number }
  | { action: 'submit'; cardId: number; fingerprint: string }
  | { action: 'approve'; cardId: number; version: number }
  | { action: 'edit'; cardId: number; version: number; field: number };

/** What a button on a Registration's card does, and the card, or undefined if the id isn't one's. */
export function cardAction(customId: string): CardAction | undefined {
  const plain = customId.match(/^(handoff|stop|done):regcard:(\d+)$/);
  if (plain) return { action: plain[1] as 'handoff' | 'stop' | 'done', cardId: Number(plain[2]) };
  const submit = customId.match(/^submit:regcard:(\d+):([0-9a-f]{64})$/);
  if (submit) return { action: 'submit', cardId: Number(submit[1]), fingerprint: submit[2]! };
  const approve = customId.match(/^approve:regcard:(\d+):(\d+)$/);
  if (approve) return { action: 'approve', cardId: Number(approve[1]), version: Number(approve[2]) };
  const edit = customId.match(/^edit:regcard:(\d+):(\d+):(\d+)$/);
  if (edit) return { action: 'edit', cardId: Number(edit[1]), version: Number(edit[2]), field: Number(edit[3]) };
  return undefined;
}

/** A value the person approved, in inline code so that it copies as it is. */
/**
 * A value the person approved, to copy as it is: in inline code, or, holding a backtick, which inline code can't, as
 * text with each character that formats escaped.
 */
const copyable = (value: string) => (value.includes('`') ? value.replace(/[\\*_~`|[\]<>]/g, (c) => `\\${c}`) : `\`${value}\``);

export interface CardInput {
  registration: StoredRegistration;
  walkthrough: Walkthrough;
  /** The Product's post. */
  threadId: string;
  /** When the Registration closes if nothing final is pressed, 24 hours after its Approval. */
  closesAt: Date;
}

/** A waiting card's heading, body and buttons: what stopped the Registration, and Hand off beside Stop. */
export function waitingCard(card: RegistrationCard & { kind: 'waiting' }, input: CardInput): { heading: string; body: TextDisplay[]; buttons: Button[] } {
  const { walkthrough: w } = input;
  const product = escapeMarkdown(cut(w.product, 60));
  const { waitsOn, page } = card;
  const on = page > 0 ? ` on page ${page}` : '';
  const lines: string[] = [];
  let heading: string;
  if (waitsOn.kind === 'wall') {
    heading = `At a wall · ${product}`;
    lines.push(`The Assistant stopped at ${WALL_TEXT[waitsOn.wall] ?? escapeMarkdown(waitsOn.wall)}${on} of its signup form, and nothing was submitted.`);
  } else if (waitsOn.kind === 'stuck') {
    heading = `Stuck · ${product}`;
    lines.push(`The Assistant got stuck${on} of its signup form: ${STUCK_TEXT[waitsOn.reason] ?? escapeMarkdown(waitsOn.reason)}. Nothing was submitted.`);
  } else if (waitsOn.kind === 'check' && waitsOn.refusal) {
    // The browser service refused the press itself, as for a disabled button: the page may match the Walkthrough.
    heading = `Stuck · ${product}`;
    const label = escapeMarkdown(cut(waitsOn.button?.label ?? 'its button', 100));
    lines.push(`The Assistant couldn't press **${label}** on page ${page}: ${cut(waitsOn.failures.map(escapeMarkdown).join('; '), 600)}. Nothing was submitted.`);
  } else {
    heading = `A page check failed · ${product}`;
    const failures = waitsOn.kind === 'check' ? waitsOn.failures.map(escapeMarkdown).join('; ') : '';
    lines.push(`Page ${page} doesn't match the Walkthrough, so the Assistant didn't press its button: ${cut(failures, 600)}. Nothing was submitted.`);
    const amended = waitsOn.kind === 'check' ? waitsOn.amended : undefined;
    if (amended && typeof amended === 'object' && 'none' in amended) lines.push(`It couldn't be put to you as an amended Walkthrough: ${escapeMarkdown(cut(amended.none, 300))}.`);
  }
  if (waitsOn.kind !== 'check' && waitsOn.kind !== 'held' && waitsOn.note) lines.push(codeBlock(waitsOn.note));
  const google = waitsOn.kind === 'wall' && waitsOn.wall === 'oauth-only';
  lines.push(
    google
      ? `**Hand off** gives you the steps to sign up on your own device with Google, choosing the Signup mailbox's own Google account, ${w.identity.plainAddress}. **Stop** ends it.`
      : '**Hand off** gives you the steps to finish it on your own device, with the values you approved and the password from AutoFill. **Stop** ends it.',
  );
  lines.push(`-# Left alone, it closes ${shortTime(input.closesAt)}, 24 hours after its Approval, with nothing submitted. See <#${input.threadId}>.`);
  return {
    heading,
    body: [text(lines.join('\n'))],
    buttons: [button(cardButtonId('handoff', card.id), 'Hand off', ButtonStyle.Primary), button(cardButtonId('stop', card.id), 'Stop', ButtonStyle.Danger)],
  };
}

/** A Handoff card's heading, body and Done: why it is the person's, numbered steps, the values to copy, and the password through AutoFill. */
export function handoffCard(card: RegistrationCard & { kind: 'handoff' }, input: CardInput): { heading: string; body: TextDisplay[]; buttons: Button[] } {
  const { registration: r, walkthrough: w } = input;
  const product = escapeMarkdown(cut(w.product, 60));
  const address = r.plainAddress ? w.identity.plainAddress : w.identity.plusAddress;
  const handOff: HandOff | null = r.handOff;
  const submitted = card.cause === 'no-mail' || Boolean(handOff?.submitted);
  const google = handOff?.wall === 'oauth-only';
  const vault = hasPasswordField(w) && r.vaultItemId ? `Bitwarden › Registrations › ${product} (item ${r.vaultItemId})` : null;
  const why =
    card.cause === 'terms-ban'
      ? `Its terms ban accounts made by a bot, so you sign up on your own device.`
      : card.cause === 'no-mail'
        ? `The form was submitted as ${address}${r.submittedAt ? ` ${shortTime(new Date(r.submittedAt))}` : ''}, and no verification mail came within 24 hours. The account may exist.`
        : submitted
          ? `You handed it off after ${escapeMarkdown(handOff!.from)}. The form was submitted, and may have been rejected.`
          : `You handed it off at ${escapeMarkdown(handOff!.from)}. Nothing was submitted.`;

  /**
   * The card's text: in full, or, when that is too long for Discord, compact, with each label cut shorter and each
   * link named alone. Values are never cut, since the person copies them.
   */
  const textOf = (compact: boolean) => {
    const values = w.fields.flatMap((f) => {
      const label = escapeMarkdown(cut(f.label, compact ? 30 : 60));
      if (f.key === 'email') return [`- ${label}: ${copyable(address)}`];
      if (f.key === 'password') return vault ? [`- ${label}: let AutoFill fill it from ${vault}`] : [];
      if (f.value === null) return [];
      return [`- ${label}: ${copyable(f.value)}`];
    });
    // A link too long for the card is named alone, as the Walkthrough's card names it.
    const linked = (href: string) => !compact && href.length <= LINK_CHARS;
    const terms = w.terms.length > 0 ? ` Accept ${w.terms.map((t) => `${escapeMarkdown(cut(t.text, 60))}${linked(t.href) ? ` (${t.href})` : ''}`).join(' and ')}.` : '';
    const open = linked(w.startUrl) ? `Open ${w.startUrl}` : `Open the signup page on ${w.signupHost}`;
    const press = w.button ? ` Press **${escapeMarkdown(w.button)}**.` : '';
    const steps: string[] = [];
    if (submitted) {
      steps.push(`${open} and log in as ${copyable(address)}${vault ? `, with the password AutoFill gives you from ${vault}` : ''}.`);
      steps.push(`If it says your address isn't verified, have it send the verification mail again, and open it in the Signup mailbox's Gmail.`);
      steps.push(`If no account was made, sign up there with the values you approved:\n${values.join('\n')}`);
    } else if (google) {
      steps.push(`${open}.`);
      steps.push(`Choose to sign in with Google, and pick the Signup mailbox's own Google account, ${copyable(w.identity.plainAddress)}.`);
    } else {
      steps.push(`${open}.`);
      steps.push(`Fill in the values you approved, and leave every other field empty:\n${values.join('\n')}`);
      steps.push(`${terms}${press}`.trim() || 'Submit the form.');
      steps.push(`If ${product} sends a verification mail, open it in the Signup mailbox's Gmail and tap its link or enter its code.`);
    }
    steps.push('Tap **Done** here once the account exists.');
    return [why, ...steps.map((s, i) => `${i + 1}. ${s}`), `-# See <#${input.threadId}>.`].join('\n');
  };
  const full = textOf(false);
  return {
    heading: `Hand off · ${product}`,
    body: [text(full.length <= CARD_TEXT ? full : textOf(true))],
    buttons: [button(cardButtonId('done', card.id), 'Done', ButtonStyle.Success)],
  };
}

/**
 * A Submit tap's heading, body and buttons: what failed the check, the screenshot of the page, and Submit bound to that
 * page's fingerprint, beside Hand off and Stop.
 */
export function submitTapCard(
  card: RegistrationCard & { kind: 'submit-tap'; fingerprint: string },
  input: CardInput,
  png: Buffer,
): { heading: string; body: (TextDisplay | MediaGallery)[]; buttons: Button[]; files: Upload[] } {
  const { walkthrough: w } = input;
  const product = escapeMarkdown(cut(w.product, 60));
  const check = card.waitsOn.kind === 'check' ? card.waitsOn : null;
  const label = escapeMarkdown(cut(check?.button?.label ?? 'its button', 100));
  const failures = (check?.failures ?? []).map(escapeMarkdown).join('; ');
  const name = `page-${card.id}.png`;
  const lines = [
    check?.rules?.length
      ? `Page ${card.page} holds what the Walkthrough didn't approve: ${cut(failures, 600)}. Nothing was submitted yet.`
      : `Page ${card.page} now matches the Walkthrough. Nothing was submitted yet.`,
    ...(check?.changed ? ['It changed after you last saw it, so the Assistant pressed nothing, and shows it to you again.'] : []),
    `The screenshot shows the page as it stands: **${label}** outlined in red, each such field marked in orange, and each field filled by reference masked.`,
    `**Submit** has the Assistant press **${label}** on exactly this page; if it has changed since, you get a new screenshot instead. **Hand off** gives you the steps to finish it yourself, and **Stop** ends it.`,
    `-# Left alone, it closes ${shortTime(input.closesAt)}, 24 hours after its Approval, with nothing submitted. See <#${input.threadId}>.`,
  ];
  return {
    heading: `Submit? · ${product}`,
    body: [text(lines.join('\n')), image(name, `Page ${card.page} of the signup form, as it stands`)],
    buttons: [
      button(submitId(card.id, card.fingerprint), 'Submit', ButtonStyle.Success),
      button(cardButtonId('handoff', card.id), 'Hand off', ButtonStyle.Primary),
      button(cardButtonId('stop', card.id), 'Stop', ButtonStyle.Danger),
    ],
    files: [{ name, data: png, contentType: 'image/png' }],
  };
}

/**
 * The notice of a form still showing 10 seconds after its final press (#10): it may have been rejected, nothing changes
 * by itself, and Hand off gives the person the steps.
 */
export function stillShowingCard(card: RegistrationCard & { kind: 'still-showing' }, input: CardInput): { heading: string; body: TextDisplay[]; buttons: Button[] } {
  const product = escapeMarkdown(cut(input.walkthrough.product, 60));
  const lines = [
    `The form is still showing after **${escapeMarkdown(cut(card.button, 100))}** was pressed; it may have been rejected.`,
    "Nothing changes by itself: the Registration waits for its verification mail, and is handed off to you if none comes within 24 hours of the press. **Hand off** gives you the steps to check it on your own device now.",
    `-# See <#${input.threadId}>.`,
  ];
  return { heading: `Still showing? · ${product}`, body: [text(lines.join('\n'))], buttons: [button(cardButtonId('handoff', card.id), 'Hand off', ButtonStyle.Primary)] };
}

/** The line a handled card shrinks to. */
export const shrunkLine = (product: string, what: string, threadId: string) => `✓ ${escapeMarkdown(cut(product, 60))} · ${what} · <#${threadId}>`;
