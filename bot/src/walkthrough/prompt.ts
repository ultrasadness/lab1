// A Walkthrough preparation run's input (#53, #10): the person's Profile, the Product's Dossier and the signup page
// plain code read, with each form's fields by number, so the record names a field by its place. Outside text reaches
// the model only fenced, and what plain code saw on the page, such as a bot check, is said in our own words beside it.
// A Correction's run gets the Walkthrough it corrects, as the person saw it, and what they wrote.
import type { Form, PageRead } from '../browser.ts';
import type { Dossier } from '../dossier/dossier.ts';
import { fence } from '../fence.ts';
import { fullTime } from '../pacific.ts';
import { buttonLabels, offeredFields } from './walkthrough.ts';

/** The person's Profile in the Personal database. */
export const PROFILE_PATH = 'profile/profile.md';

/** How much of the signup page's text reaches the model, and of each field's label. */
const PAGE_TEXT_CHARS = 12_000;
const LABEL_CHARS = 200;

export interface WalkthroughInput {
  /** The Profile as the Personal database holds it, or null when it holds none. */
  profile: string | null;
  dossier: Dossier;
  read: PageRead;
  readAt: Date;
  /** For a Correction's run: the Walkthrough corrected, as its card showed it, and what the person wrote. */
  correction?: { version: number; shown: string; text: string };
}

export function walkthroughPrompt(input: WalkthroughInput): string {
  const { dossier, read, correction } = input;
  const { record } = dossier;
  return [
    ...(input.profile === null
      ? [`Profile: none. There is no ${PROFILE_PATH}, so no names are known.`]
      : [`Profile · ${PROFILE_PATH}:`, fence(input.profile)]),
    '',
    'Prepare the Walkthrough for registering at this Product, and record it with record_walkthrough.',
    'Product:',
    fence(dossier.name),
    `Root domain: ${dossier.rootDomain}`,
    '',
    `Its Dossier says it is ${record.state === 'waitlisted' ? 'waitlisted' : 'open'}. What it is, as the Dossier has it:`,
    fence(record.whatItIs.text),
    'How to register:',
    fence(record.register.text),
    'Its Offers:',
    fence(record.offers.map((o) => `${o.what} · ${o.code ? `code ${o.code}` : 'no code'} · ${CARD[o.card]}`).join('\n') || 'none'),
    ...(record.note ? ['Its note:', fence(record.note.text)] : []),
    '',
    `Signup page · read ${fullTime(input.readAt)}`,
    'URL:',
    fence(read.snapshot.url),
    'Title:',
    fence(read.snapshot.title || 'none'),
    `Plain code saw ${read.botCheck === null ? 'no bot check' : read.botCheck === 'unknown' ? 'a bot check' : `a ${read.botCheck} bot check`} on load and ${read.paymentFields ? 'card fields' : 'no card fields'}.`,
    ...(read.snapshot.forms.length > 0 ? ['Forms, each with its fields by number:', fence(read.snapshot.forms.map(formText).join('\n'))] : ['Forms: none seen.']),
    'Text:',
    fence(read.snapshot.text.length > PAGE_TEXT_CHARS ? `${read.snapshot.text.slice(0, PAGE_TEXT_CHARS)}…` : read.snapshot.text || 'none'),
    ...(correction
      ? [
          '',
          `The person corrected Walkthrough v${correction.version}, as it was put to them:`,
          fence(correction.shown),
          'Their Correction, what they say it got wrong:',
          fence(correction.text),
          'Prepare the Walkthrough again with their Correction.',
        ]
      : []),
  ].join('\n');
}

const CARD = { needed: 'card needed', 'not needed': 'no card', 'not stated': 'card not stated' } as const;

/** A form's buttons, then each field it offers on a line of its own: its type, whether required, its options, and its label. */
function formText(form: Form, i: number): string {
  const n = i + 1;
  const buttons = buttonLabels(form);
  const offered = offeredFields(form);
  const left = form.fields.length - offered.length;
  return [
    `Form ${n} · ${buttons.length === 0 ? 'no button' : `${buttons.length === 1 ? 'button' : 'buttons'} ${buttons.join(' / ')}`}${form.formElement ? '' : ' · fields in no form'}`,
    ...offered.map((f, j) => {
      const options = f.options?.length ? `; options ${f.options.slice(0, 12).map((o) => o.label).join(' / ')}` : '';
      const links = f.links.length ? ` · links ${f.links.map((l) => l.text).join(' / ')}` : '';
      const label = (f.label || f.name || 'unlabelled').slice(0, LABEL_CHARS);
      return `Form ${n} field ${j + 1} (${f.type}${f.required ? ', required' : ''}${options}): ${label}${links}`;
    }),
    ...(left > 0 ? [`Form ${n}: ${left} more fields after these, left empty.`] : []),
    ...(form.links.length ? [`Form ${n} links: ${form.links.map((l) => l.text).join(' / ')}`] : []),
  ].join('\n');
}
