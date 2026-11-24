// The amended Walkthrough (#115, #10, #12): what a page of an approved Registration newly asks for, put back to the
// person as a new version of the Walkthrough they approved. A page check that failed on a required field with no
// approved value, on terms other than the approved ones or a new box asking for agreement, or on another host, and a
// fill run that found its page off the session's domains, lead here. Plain code takes from the page its host, the
// links of the box it asks to tick, and the fields it requires; a registration-role run proposes a value for each such
// field that is neither the Signup identity, the password nor a box, from the Profile and the Dossier. The card shows
// only what the page asks for, with what the person approved before below it, and Approve, an Edit beside each value,
// and Stop. Its Approval lets filling resume on that page in the same session: its fields join the Walkthrough's keys,
// its terms the approved terms, and the page check of that page and the pages after it takes the host it names. The
// person's Edit of a proposed value is a Correction (#11), sorted as any other.
import { createHash } from 'node:crypto';
import type { Field, Link, Snapshot } from '../browser.ts';
import {
  Accent,
  button,
  ButtonStyle,
  container,
  cut,
  escapeMarkdown,
  fits,
  popup,
  section,
  silentMessage,
  text,
  type Button,
  type MessagePayload,
  type Popup,
  type Section,
  type TextDisplay,
} from '../discord/components.ts';
import type { Dossier } from '../dossier/dossier.ts';
import { fence } from '../fence.ts';
import { needsYouCard } from '../needs-you.ts';
import { shortTime } from '../pacific.ts';
import type { CheckedRule, Store } from '../store.ts';
import { PROFILE_PATH } from '../walkthrough/prompt.ts';
import { choiceOptions, hasPasswordField, VALUE_CHARS, type Walkthrough, type WalkthroughField } from '../walkthrough/walkthrough.ts';

/** What a page newly asks for, as an amended Walkthrough puts it to the person. */
export interface Amendment {
  /** The page that asks for it. */
  page: number;
  /** The host the page is on, when it isn't the one approved for it: the check of this page and those after takes it. */
  host: string | null;
  /** The documents the boxes it asks to tick link, each with its box, which accepts them only while it is ticked. */
  terms: AmendedTerms[];
  /** The fields it requires that nothing approved, each with the value proposed for it. */
  fields: WalkthroughField[];
  /** Whether plain code could read the fields it asks for: not while it is off the session's domains. */
  fieldsRead: boolean;
  rulesApplied: string[];
}

/**
 * A document a box on the page links, and the box among the amendment's fields that accepts it; null for a box the
 * Walkthrough ticks already, whose documents only are new.
 */
export interface AmendedTerms extends Link {
  box: number | null;
}

/**
 * The documents an amendment accepts: those of each box it ticks, and of a box the Walkthrough ticks already. A box the
 * person left unticked accepts none (settled by the person on #115).
 */
export const acceptedTerms = (a: Pick<Amendment, 'terms' | 'fields'>): Link[] =>
  a.terms.flatMap(({ box, text, href }) => (box === null || a.fields[box]?.value === 'ticked' ? [{ text, href }] : []));

/** What made a version: a preparation, or the person's Edit of one value, which is a Correction too. */
export type AmendmentCause = { kind: 'prepared' } | { kind: 'edited'; field: string };

/** One version of an amended Walkthrough, as the store keeps it. */
export interface StoredAmendment {
  productId: number;
  /** Its number, in the same count as the Product's Walkthrough versions. */
  version: number;
  /** The version whose Approval it amends: the one the Registration started from. */
  ofVersion: number;
  amendment: Amendment;
  /** What the person sees and approves, hashed. */
  hash: string;
  cause: AmendmentCause;
  runId: string | null;
  preparedAt: string;
  approvedAt: string | null;
  copyIntended: boolean;
  copyMessageId: string | null;
}

/** Whether a failed rule is one an amended Walkthrough answers: a required field left empty, other terms, another host. */
export const amendable = (r: Pick<CheckedRule, 'rule' | 'validity'>) => r.rule === 'other-terms' || r.rule === 'off-host' || (r.rule === 'invalid' && r.validity === 'valueMissing');

/**
 * The most fields one amended Walkthrough asks about, so that its card, with an Edit beside each, fits Discord: a page
 * that asks for more gets no run. Whether its card fits is judged whole, before it is kept and at each Edit.
 */
const MAX_ASKED = 8;
/**
 * The longest address of a document the card links: Discord counts link addresses in its 4,000 characters, and the
 * person approves only what the card shows, so a longer one can't be put to them.
 */
const LINK_CHARS = 200;

/**
 * The Walkthrough a Registration fills: the approved version, with the fields and terms of each amended Walkthrough
 * approved under it, in order.
 */
export function amendedWalkthrough(w: Walkthrough, amendments: readonly Amendment[]): Walkthrough {
  if (amendments.length === 0) return w;
  const terms = [...w.terms];
  for (const t of amendments.flatMap(acceptedTerms)) if (!terms.some((x) => x.href === t.href)) terms.push(t);
  return { ...w, fields: [...w.fields, ...amendments.flatMap((a) => a.fields)], terms };
}

/** The signup host the page check takes on a page: the latest one an amendment approved at or before it, or the Walkthrough's. */
export function hostOn(w: Walkthrough, amendments: readonly Amendment[], page: number): string {
  return amendments.filter((a) => a.host && a.page <= page).at(-1)?.host ?? w.signupHost;
}

/** Each host the approved amendments name, which the Registration's session holds beside the Walkthrough's domains. */
export const amendedHosts = (amendments: readonly Amendment[]) => [...new Set(amendments.flatMap((a) => (a.host ? [a.host] : [])))];

/** Whether a field is a box, as the page check judges one: a checkbox, or a control whose role is a switch (#55). */
const isBox = (f: Pick<Field, 'type'>) => f.type === 'checkbox' || f.type === 'switch';

/** A field the page asks for, as plain code read it, and what fills it: plain code, or the run's proposal. */
export interface Asked {
  field: WalkthroughField;
  /** The field as the page shows it, for a field whose value the run proposes; none for one plain code fills. */
  shown?: Field;
}

/**
 * What a page asks for, from the rules its check failed and plain code's snapshot of it, or why no amended Walkthrough
 * can answer it. The Signup identity, the password and a box the page asks to tick are plain code's to propose; any
 * other field's value is the run's. A field the Walkthrough gives a value already, which the fill run left empty, is no
 * new ask: when the page asks for nothing else, it is filled again (`fillAgain`). A box whose links can't be shown
 * whole, a password where the Walkthrough has none, or more than a card holds can't be put to the person this way.
 */
export function askedOf(
  rules: readonly CheckedRule[],
  snapshot: Snapshot | null,
  w: Walkthrough,
  page: number,
): { asked: Asked[]; terms: AmendedTerms[]; host: string | null } | { none: string } | { fillAgain: true } {
  const fields = snapshot?.forms.flatMap((f) => f.fields) ?? [];
  const asked: Asked[] = [];
  const terms: AmendedTerms[] = [];
  let host: string | null = null;
  for (const rule of rules) {
    if (rule.rule === 'off-host') {
      host = rule.host ?? null;
      if (!host) return { none: "the page is on another host, which the browser service didn't name" };
      continue;
    }
    if (!amendable(rule)) continue;
    // The check named the field by its ref in the fill run's latest snapshot, which plain code's own snapshot numbers
    // the same way while the page holds still: the ref and the label together first, then either.
    const found =
      fields.find((f) => f.ref === rule.ref && f.label === rule.field) ?? fields.find((f) => f.label === rule.field) ?? fields.find((f) => rule.ref !== null && f.ref === rule.ref);
    if (!found) return { none: `plain code couldn't read the field “${cut(rule.field ?? 'unnamed', 80)}” again` };
    const label = (found.label.replace(/\s+/g, ' ').trim() || found.name?.trim() || 'unnamed field').slice(0, 200);
    const box = isBox(found);
    const options = box ? undefined : choiceOptions(found);
    // A field the Walkthrough approves a value it takes already, by its label, is filled again rather than asked about:
    // the Signup identity or the password, a box approved ticked, an option the field offers, or any other value. A
    // required box the person left unticked is asked about again (settled by the person on #115).
    const takes = (f: WalkthroughField) =>
      f.key === 'email' || f.key === 'password' || (box ? f.value === 'ticked' : options ? f.value !== null && options.includes(f.value) : f.value !== null);
    if (rule.rule === 'invalid' && w.fields.some((f) => f.label === label && takes(f))) continue;
    // Only a box accepts the documents its label links (ADR 0005); a link beside another field is no terms.
    if (box) {
      // A box a key filled holds its approved value already: only its terms are new.
      const filled = rule.rule === 'other-terms' && Boolean(found.filled);
      const box = filled ? null : asked.length;
      for (const l of found.links) {
        if (!/^https?:\/\//.test(l.href) || l.href.includes('[random]') || l.href.length > LINK_CHARS) {
          return { none: `the box “${cut(label, 80)}” links a document whose address can't be shown whole` };
        }
        if (!terms.some((t) => t.href === l.href && t.box === box)) terms.push({ text: l.text.replace(/\s+/g, ' ').trim().slice(0, 200) || 'the terms', href: l.href, box });
      }
      if (!filled) asked.push({ field: { field: null, label, key: 'choice', value: 'ticked', options: ['ticked', 'left unticked'], required: found.required } });
      continue;
    }
    if (/\bemail\b/i.test(`${found.type} ${found.autocomplete ?? ''}`)) {
      asked.push({ field: { field: null, label, key: 'email', value: null, required: true } });
    } else if (found.type === 'password') {
      // The same password, filled by reference; a Walkthrough with none has no vault item to fill it from (ADR 0004).
      if (!hasPasswordField(w)) return { none: `page ${page} asks for a password, and the approved Walkthrough has none` };
      asked.push({ field: { field: null, label, key: 'password', value: null, required: true } });
    } else {
      asked.push({ field: { field: null, label, key: options ? 'choice' : 'text', value: null, ...(options ? { options } : {}), required: true }, shown: found });
    }
  }
  if (asked.length > MAX_ASKED) return { none: `page ${page} asks for ${asked.length} fields, more than one card can put to you` };
  if (asked.length === 0 && terms.length === 0 && !host) return { fillAgain: true };
  return { asked, terms, host };
}

export interface AmendmentInput {
  profile: string | null;
  dossier: Dossier;
  /** The Walkthrough as approved so far, as its card showed it. */
  approved: string;
  page: number;
  snapshot: Snapshot;
  /** The fields whose values the run proposes, numbered from 1. */
  fields: Field[];
}

const PAGE_TEXT_CHARS = 6000;

/** The run's one message: the Profile, the Dossier, the approved Walkthrough, the page and the fields to propose for. */
export function amendmentPrompt(input: AmendmentInput): string {
  const { dossier, snapshot } = input;
  const { record } = dossier;
  const fieldLine = (f: Field, i: number) => {
    const options = choiceOptions(f);
    return `Field ${i + 1} (${f.type}, required${options ? `; options ${options.slice(0, 12).join(' / ')}` : ''}): ${(f.label || f.name || 'unlabelled').replace(/\s+/g, ' ').trim().slice(0, 200)}`;
  };
  return [
    ...(input.profile === null ? [`Profile: none. There is no ${PROFILE_PATH}, so nothing about the person is known.`] : [`Profile · ${PROFILE_PATH}:`, fence(input.profile)]),
    '',
    `Page ${input.page} of the signup form of this Product requires the fields below, which the approved Walkthrough gives no value. Propose a value for each, and record them with record_amendment.`,
    'Product:',
    fence(dossier.name),
    `Root domain: ${dossier.rootDomain}`,
    'What it is, as the Dossier has it:',
    fence(record.whatItIs.text),
    'How to register:',
    fence(record.register.text),
    '',
    'The Walkthrough the person approved:',
    fence(input.approved),
    '',
    `Page ${input.page}, as plain code read it:`,
    fence([`URL: ${snapshot.url}`, `Title: ${snapshot.title || 'none'}`, 'Text:', snapshot.text.length > PAGE_TEXT_CHARS ? `${snapshot.text.slice(0, PAGE_TEXT_CHARS)}…` : snapshot.text || 'none'].join('\n')),
    'The fields to propose values for, by number:',
    fence(input.fields.map(fieldLine).join('\n')),
  ].join('\n');
}

const EMAIL_ADDRESS = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Checks the run's record against the fields it was asked about, and gives each its proposed value, or says what is
 * wrong in a way the model can fix. A field it leaves out is proposed empty.
 */
export function readAmendment(record: unknown, fields: readonly Asked[]): { ok: true; fields: WalkthroughField[]; rulesApplied: string[] } | { ok: false; error: string } {
  const r = (record as { kind?: unknown; record?: Record<string, unknown> } | null) ?? {};
  if (r.kind !== 'amendment' || typeof r.record !== 'object' || r.record === null) return { ok: false, error: 'Expected the proposed values.' };
  const asked = fields.filter((a) => a.shown);
  const problems: string[] = [];
  const values = new Map<number, string | null>();
  for (const [i, entry] of (Array.isArray(r.record.fields) ? r.record.fields : []).entries()) {
    const f = (entry ?? {}) as Record<string, unknown>;
    const n = f.field;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > asked.length) {
      problems.push(`fields[${i}].field must be a field's number, 1 to ${asked.length}.`);
      continue;
    }
    if (values.has(n)) {
      problems.push(`Field ${n} is listed twice.`);
      continue;
    }
    const field = asked[n - 1]!.field;
    const value = typeof f.value === 'string' ? f.value.replace(/\s+/g, ' ').trim() : null;
    if (f.fill === 'empty') {
      values.set(n, null);
    } else if (f.fill === 'choice') {
      const picked = field.options && value ? field.options.find((o) => o.toLowerCase() === value.toLowerCase()) : undefined;
      if (!field.options) problems.push(`Field ${n} isn't a list of options, so it can't be a choice.`);
      else if (!picked) problems.push(`Field ${n}: a choice's value must be one of ${field.options.map((o) => `"${o}"`).join(', ')}.`);
      else values.set(n, picked);
    } else if (f.fill === 'value') {
      if (field.options) problems.push(`Field ${n} is a list of options: fill it with choice.`);
      else if (!value || value.length > VALUE_CHARS) problems.push(`Field ${n}: a value must be one line of at most ${VALUE_CHARS} characters.`);
      else if (EMAIL_ADDRESS.test(value)) problems.push(`Field ${n}: an email address goes into a form only as the Signup identity, which plain code fills.`);
      else values.set(n, value);
    } else {
      problems.push(`fields[${i}].fill must be value, choice or empty.`);
    }
  }
  const { rulesApplied } = r.record;
  if (!Array.isArray(rulesApplied) || !rulesApplied.every((x) => typeof x === 'string')) problems.push('rulesApplied must be a list of Rule names.');
  if (problems.length > 0) return { ok: false, error: problems.join(' ') };
  let n = 0;
  return {
    ok: true,
    fields: fields.map((a) => (a.shown ? { ...a.field, value: values.get(++n) ?? null } : a.field)),
    rulesApplied: rulesApplied as string[],
  };
}

// ---------- The card ----------

/** What the card, its copy and a run's text show of one version. */
export interface AmendedShown {
  stored: Pick<StoredAmendment, 'productId' | 'version' | 'amendment' | 'cause'>;
  /** The Walkthrough as approved so far: the approved version with each amendment approved under it. */
  approved: Walkthrough;
  /** The versions approved so far, the Walkthrough's first. */
  approvedVersions: number[];
  /** The host approved for its page so far: the Walkthrough's, or an earlier amendment's. */
  approvedHost: string;
  /** The Signup identity's address the Registration fills: the plain one once the form refused `+`. */
  address: string;
  /** The registration card it is shown on, whose buttons name it; 0 for a copy or a run's text. */
  cardId: number;
  threadId: string;
  closesAt: Date;
}

/** Approve on an amended Walkthrough's card, and Edit beside one of its values, each naming the version shown. */
export const amendedApproveId = (cardId: number, version: number) => `approve:regcard:${cardId}:${version}`;
export const amendedEditId = (cardId: number, version: number, field: number) => `edit:regcard:${cardId}:${version}:${field}`;

/** Whether the person may change a proposed value with Edit: any but the Signup identity and the password, and a choice Discord offers as one. */
export const amendedEditable = (f: WalkthroughField) =>
  f.key !== 'email' && f.key !== 'password' && (f.key !== 'choice' || (f.options!.length >= 2 && f.options!.length <= 10));

const versionsText = (versions: number[]) => {
  const named = versions.map((v) => `v${v}`);
  return named.length === 1 ? named[0]! : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
};

/** A proposed value as the card says it. */
function proposedText(f: WalkthroughField, w: Walkthrough, address: string): string {
  switch (f.key) {
    case 'email':
      return `${address}, the Signup identity`;
    case 'password':
      return `the same new password, from Bitwarden › Registrations › ${escapeMarkdown(cut(w.product, 60))}, by reference`;
    default:
      return f.value === null ? 'no value proposed: Edit to give one' : escapeMarkdown(f.value);
  }
}

/** What the person approved so far, one line for each field. */
function approvedText(w: Walkthrough, address: string, labelChars: number): string {
  return w.fields
    .map((f) => {
      const value =
        f.key === 'email'
          ? address
          : f.key === 'password'
            ? 'new random one'
            : f.value === null
              ? f.key === 'choice'
                ? 'left as the page has it'
                : 'left empty'
              : escapeMarkdown(cut(f.value, 60));
      return `${escapeMarkdown(cut(f.label, labelChars))} · ${value}`;
    })
    .join('; ');
}

const linked = (t: Link) => `[${escapeMarkdown(cut(t.text, 60))}](${t.href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;

/** The card's body: what the page asks for, a line each with an Edit beside its value, then what was approved, then the foot. */
function bodyOf(shown: AmendedShown, shape: { compact: boolean; edits: boolean; disabled: boolean; copy: boolean }): (TextDisplay | Section)[] {
  const { stored, approved: w } = shown;
  const a = stored.amendment;
  const labelChars = shape.compact ? 24 : 60;
  const approvedBy = versionsText(shown.approvedVersions);
  const product = escapeMarkdown(cut(w.product, 60));
  const intro = [
    `Page ${a.page} of ${product}'s signup form asks for what ${approvedBy} didn't approve, so the Assistant pressed nothing there. If you approve, it fills what you approve below in the same browser session and goes on from page ${a.page}, pressing a button only if the filled page matches.`,
    ...(a.fieldsRead ? [] : [`Page ${a.page} is off the Walkthrough's domains, so plain code couldn't read what else it asks for: once you approve its host, the fill run fills there what the approved values fit.`]),
  ];
  const body: (TextDisplay | Section)[] = [text(intro.join('\n'))];
  let lines: string[] = [];
  const flush = () => {
    if (lines.length > 0) body.push(text(lines.join('\n')));
    lines = [];
  };
  for (const [i, f] of a.fields.entries()) {
    const line = `+ **${escapeMarkdown(cut(f.label, labelChars))}** · ${proposedText(f, w, shown.address)} (${f.required ? 'required ' : ''}on page ${a.page})`;
    if (shape.edits && amendedEditable(f)) {
      flush();
      body.push(section(line, button(amendedEditId(shown.cardId, stored.version, i), 'Edit', ButtonStyle.Secondary, shape.disabled)));
    } else {
      lines.push(line);
    }
  }
  const accepted = acceptedTerms(a);
  if (accepted.length > 0) lines.push(`+ **Terms** · you accept ${accepted.map(linked).join(' and ')}`);
  if (a.host) lines.push(`+ **Signup host** · ${escapeMarkdown(a.host)}, from page ${a.page} on, in place of ${escapeMarkdown(shown.approvedHost)}`);
  flush();
  body.push(text(`**What ${approvedBy} approved:** ${cut(approvedText(w, shown.address, labelChars), shape.compact ? 400 : 900)}`));
  const proposed = a.fields.some((f) => f.key === 'text' || (f.key === 'choice' && f.value !== 'ticked'));
  const rules = a.rulesApplied.length > 0 ? cut(a.rulesApplied.map(escapeMarkdown).join(', '), 300) : 'none';
  const foot = [
    ...(proposed ? [`-# Values proposed from your Profile and the Dossier · Rules applied: ${rules}`] : []),
    ...(stored.cause.kind === 'edited' ? [`-# v${stored.version}: you edited ${escapeMarkdown(cut(stored.cause.field, 60))}, which counts as a Correction.`] : []),
    ...(shape.copy ? [] : [`-# Left alone, it closes ${shortTime(shown.closesAt)}, 24 hours after its Approval, with nothing submitted. See <#${shown.threadId}>.`]),
  ];
  if (foot.length > 0) body.push(text(foot.join('\n')));
  return body;
}

/** The card's heading, body and buttons: Approve and Stop, with an Edit beside each value the person may change. */
export function amendedCard(shown: AmendedShown, disabled = false): { heading: string; body: (TextDisplay | Section)[]; buttons: Button[] } {
  const heading = `Amended Walkthrough v${shown.stored.version} · ${escapeMarkdown(cut(shown.approved.product, 60))}`;
  const buttons = [
    button(amendedApproveId(shown.cardId, shown.stored.version), 'Approve', ButtonStyle.Success, disabled),
    button(`stop:regcard:${shown.cardId}`, 'Stop', ButtonStyle.Danger, disabled),
  ];
  for (const compact of [false, true]) {
    const body = bodyOf(shown, { compact, edits: true, disabled, copy: false });
    if (fits(needsYouCard('0'.repeat(20), heading, body, { buttons }))) return { heading, body, buttons };
  }
  throw new Error(`The amended Walkthrough of ${shown.approved.rootDomain} doesn't fit Discord even with its labels cut`);
}

/** The copy of a version in the Product's post: the card's text without its mention or any button, silent. */
export function amendedCopy(shown: AmendedShown, needsYouChannelId: string, preparedAt: Date): MessagePayload {
  const head = `**Amended Walkthrough v${shown.stored.version}** · put to you in <#${needsYouChannelId}> ${shortTime(preparedAt)}`;
  for (const compact of [false, true]) {
    const message = silentMessage([container(Accent.progress, [text(head), ...bodyOf(shown, { compact, edits: false, disabled: true, copy: true })])]);
    if (fits(message)) return message;
  }
  throw new Error(`The copy of the amended Walkthrough of ${shown.approved.rootDomain} doesn't fit Discord`);
}

/** A version as its card shows it, for a sorting run's prompt. */
export function amendedText(shown: AmendedShown): string {
  return [`Amended Walkthrough v${shown.stored.version}`, ...bodyOf(shown, { compact: false, edits: false, disabled: true, copy: true }).map((c) => (c.type === 10 ? c.content : c.components.map((t) => t.content).join('\n')))].join('\n');
}

/** Whether a version's card fits Discord, as `amendedCard` builds it. */
export function amendedFits(shown: AmendedShown): boolean {
  try {
    amendedCard(shown);
    return true;
  } catch {
    return false;
  }
}

/** The Edit pop-up of one proposed value: one field holding it, or a radio group for a choice. */
export function amendedEditPopup(customId: string, f: WalkthroughField): Popup {
  const label = f.label.length > 45 ? `${f.label.slice(0, 44)}…` : f.label;
  const title = `Edit · ${f.label}`;
  if (f.key !== 'choice') return popup(customId, title, [], { customId: AMENDED_EDIT_FIELD, label, maxLength: VALUE_CHARS, oneLine: true, required: false, value: f.value ?? '' });
  const options = f.options!.slice(0, 10).map((o) => ({ label: o.slice(0, 100), value: o.slice(0, 100), ...(o === f.value ? { default: true } : {}) }));
  return { ...popup(customId, title, []), components: [{ type: 18, label, component: { type: 21, custom_id: AMENDED_EDIT_FIELD, required: true, options } }] };
}

/** The Edit pop-up's one field. */
export const AMENDED_EDIT_FIELD = 'value';

/**
 * A version's hash: what the person sees and approves, with the versions approved before it, the Walkthrough's first, so
 * that a version asking again for what an earlier one approved is an Approval of its own (ADR 0007).
 */
export const amendmentHash = (approvedVersions: number[], amendment: Amendment) => createHash('sha256').update(JSON.stringify({ approvedVersions, amendment })).digest('hex');

/**
 * A version as its card, its copy and a sorting run's text show it: beside what the person approved before it under
 * the same Approval, the Walkthrough's version and each amended Walkthrough approved earlier.
 */
export function shownOf(store: Store, stored: StoredAmendment, cardId: number, closesAt: Date): AmendedShown {
  const w = store.walkthrough(stored.productId, stored.ofVersion)!.walkthrough;
  const before = store.amendmentsOf(stored.productId).filter((a) => a.ofVersion === stored.ofVersion && a.approvedAt && a.version < stored.version);
  const amendments = before.map((a) => a.amendment);
  const r = store.registration(stored.productId);
  return {
    stored,
    approved: amendedWalkthrough(w, amendments),
    approvedVersions: [stored.ofVersion, ...before.map((a) => a.version)],
    approvedHost: hostOn(w, amendments, stored.amendment.page),
    address: r?.version === stored.ofVersion && r.plainAddress ? w.identity.plainAddress : w.identity.plusAddress,
    cardId,
    threadId: store.product(stored.productId)!.threadId!,
    closesAt,
  };
}
