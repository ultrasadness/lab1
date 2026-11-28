// What a fill run is given (#56, ADR 0006): the approved Walkthrough as keys, and each snapshot of the page as text. A
// key names one approved value, which the bot supplies when the run fills by it, so the model never types text of its
// own. The password's key has no value here at all: it is filled by reference.
import type { SessionSnapshot } from '../browser.ts';
import { fence } from '../fence.ts';
import type { Refill } from '../store.ts';
import { isBox, type Walkthrough, type WalkthroughKey } from '../walkthrough/walkthrough.ts';

/** One thing a fill run may put into a field: an approved value by `fill`, a choice by `choose`, or the password. */
export interface FillKey {
  key: string;
  /** The Walkthrough key of the field it is for. */
  of: WalkthroughKey;
  /** The field's label on the page the Walkthrough was prepared from. */
  label: string;
  action: 'fill' | 'choose' | 'fill_secret';
  /** The approved value, an option's label, `ticked` or `left unticked`; null for the password. */
  value: string | null;
}

/**
 * The keys of an approved Walkthrough: one for each field it gives a value. A key that several fields would share, and
 * every choice and other value, carries its field's number, so each key names one value.
 */
export function fillKeys(w: Walkthrough, plainAddress: boolean): FillKey[] {
  const keys: FillKey[] = [];
  const taken = new Set<string>();
  for (const [i, f] of w.fields.entries()) {
    const n = f.field ?? i + 1;
    const unique = (base: string, numbered = false) => {
      const key = numbered || taken.has(base) ? `${base}-${n}` : base;
      taken.add(key);
      return key;
    };
    if (f.key === 'password') keys.push({ key: unique('password'), of: f.key, label: f.label, action: 'fill_secret', value: null });
    else if (f.key === 'email') keys.push({ key: unique('email'), of: f.key, label: f.label, action: 'fill', value: plainAddress ? w.identity.plainAddress : w.identity.plusAddress });
    else if (f.value === null) continue;
    else if (f.key === 'choice') keys.push({ key: unique('choice', true), of: f.key, label: f.label, action: 'choose', value: f.value });
    else keys.push({ key: unique(f.key, f.key === 'text'), of: f.key, label: f.label, action: 'fill', value: f.value });
  }
  return keys;
}

export interface FillInput {
  walkthrough: Walkthrough;
  page: number;
  plainAddress: boolean;
  /** What the form refused, which this run must fill again before it names a button. */
  refill: Refill[];
}

/** The fill run's one message: the page it fills, and the approved Walkthrough by key. */
export function fillPrompt(input: FillInput): string {
  const { walkthrough: w } = input;
  const keys = fillKeys(w, input.plainAddress);
  const empty = w.fields.filter((f) => f.value === null && f.key !== 'email' && f.key !== 'password').map((f) => f.label);
  const line = (k: FillKey) =>
    k.action === 'fill_secret'
      ? `${k.key} · fill_secret, as password · the new password, which you never see · field: ${k.label}`
      : `${k.key} · ${k.action} · ${k.value} · field: ${k.label}`;
  return [
    `Fill page ${input.page} of the signup form of this Product, as its approved Walkthrough says, then call finish.`,
    'Product:',
    fence(w.product),
    `Signup host: ${w.signupHost}`,
    '',
    'The approved Walkthrough: each key, the action that takes it, what it puts in, and the label of the field it is for.',
    fence(keys.map(line).join('\n') || 'no keys'),
    ...(empty.length > 0 ? ['Fields it leaves empty:', fence(empty.join('\n'))] : []),
    ...(w.button ? ['The button it named on the first page:', fence(w.button)] : []),
    ...(input.page > 1 ? ['This is a later page, which the Walkthrough never saw: fill only the fields its keys fit, and leave the rest empty.'] : []),
    ...(input.refill.includes('password') ? ['The form refused the password before. A new one is ready: fill the password field again with fill_secret before you name a button.'] : []),
    ...(input.refill.includes('email') ? ['The form refused the + in the address before. The email key now fills the plain address: fill the email field again with it before you name a button.'] : []),
  ].join('\n');
}

const PAGE_TEXT_CHARS = 6000;
const LABEL_CHARS = 200;

/** A session's snapshot as a fill run reads it: each field, button and link by its ref, and never a value. */
export function snapshotText(shot: SessionSnapshot): string {
  const { snapshot: s } = shot;
  const one = (value: string, max = LABEL_CHARS) => value.replace(/\s+/g, ' ').trim().slice(0, max);
  const links = (list: { ref?: string; text: string }[]) => list.filter((l) => l.ref).map((l) => `${l.ref} "${one(l.text, 80)}"`);
  const forms = s.forms.flatMap((form, i) => [
    `Form ${i + 1}${form.formElement ? '' : ' · fields in no form'}`,
    ...form.fields.map((f) => {
      const options = isBox(f) ? '' : f.options?.length ? ` · options ${f.options.slice(0, 12).map((o) => one(o.label, 80)).join(' / ')}` : '';
      const within = f.links.length > 0 ? ` · links ${links(f.links).join(', ')}` : '';
      return `${f.ref ?? '-'} · ${f.type}${f.required ? ', required' : ''} · ${f.filled ? `filled with ${f.filled}` : 'not filled'}${options} · label: ${one(f.label || f.name || 'unlabelled')}${within}`;
    }),
    ...form.submits.map((b) => `${b.ref ?? '-'} · button${b.disabled ? ', disabled' : ''} · label: ${one(b.label)}`),
    ...(form.links.length > 0 ? [`Form ${i + 1} links: ${links(form.links).join(', ')}`] : []),
  ]);
  return [
    `Plain code sees ${shot.botCheck === null ? 'no bot check' : shot.botCheck === 'unknown' ? 'a bot check' : `a ${shot.botCheck} bot check`} and ${shot.paymentFields ? 'card fields' : 'no card fields'} on the page.`,
    'The page, as data:',
    fence(
      [
        `URL: ${s.url}`,
        `Title: ${one(s.title) || 'none'}`,
        ...(forms.length > 0 ? forms : ['No form with a visible field.']),
        ...(s.links.length > 0 ? [`Links: ${links(s.links).slice(0, 40).join(', ')}`] : []),
        'Text:',
        s.text.length > PAGE_TEXT_CHARS ? `${s.text.slice(0, PAGE_TEXT_CHARS)}…` : s.text || 'none',
      ].join('\n'),
    ),
  ].join('\n');
}
