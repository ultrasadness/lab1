// A Dossier run's input (#19, #33): the Interest scope, the Launch with its Maker comment, and the pages plain code
// read from the Product's site, each under the key the record cites it by. Outside text reaches the model only
// fenced, and what plain code saw on a page, such as a bot check, is said in our own words beside it.
import type { Form, PageRead } from '../browser.ts';
import { fence } from '../fence.ts';
import { dayLabel, fullTime } from '../pacific.ts';
import type { Launch } from '../store.ts';
import type { SourceKey } from './dossier.ts';

/** How much of a page's text reaches the model. */
const PAGE_TEXT_CHARS = 12_000;

/** One page as plain code read it, and when. */
export interface Read {
  page: PageRead;
  readAt: Date;
}

/** A page the Dossier wanted: read, or why not. */
export type PageInput = Read | { missing: string };

export interface DossierInput {
  interestScope: string;
  launch: Launch;
  date: string;
  landing: Read;
  pricing: PageInput;
  signup: PageInput;
  /** The sources the run may cite. */
  given: SourceKey[];
}

export function dossierPrompt(input: DossierInput): string {
  const { launch } = input;
  return [
    'Interest scope · source interest-scope:',
    fence(input.interestScope),
    '',
    'Write the Dossier of the Product behind this Launch, and record it with record_dossier.',
    `Cite these sources by key: ${input.given.join(', ')}.`,
    '',
    `Launch · source launch · Post id ${launch.postId} · ${dayLabel(input.date)}`,
    'Name:',
    fence(launch.name),
    'Tagline:',
    fence(launch.tagline),
    'Topics:',
    fence(launch.topics.join(', ') || 'none'),
    'Description:',
    fence(launch.description || 'none'),
    '',
    ...makerCommentsBlock(launch.makerComments),
    '',
    ...pageBlock('Landing page', 'landing-page', input.landing),
    '',
    ...pageBlock('Pricing page', 'pricing-page', input.pricing),
    '',
    ...pageBlock('Signup page', 'signup-page', input.signup),
  ].join('\n');
}

/** Every Maker comment, each fenced on its own, under the one source key they share. */
function makerCommentsBlock(comments: Launch['makerComments']): string[] {
  if (comments.length === 0) return ['Maker comment: none'];
  const label = comments.length === 1 ? 'Maker comment' : `${comments.length} Maker comments`;
  return [`${label} · source maker-comment:`, ...comments.map((c) => fence(c.text))];
}

function pageBlock(label: string, key: SourceKey, input: PageInput): string[] {
  if ('missing' in input) return [`${label}: ${input.missing}.`];
  const { page, readAt } = input;
  const text = page.snapshot.text.length > PAGE_TEXT_CHARS ? `${page.snapshot.text.slice(0, PAGE_TEXT_CHARS)}…` : page.snapshot.text;
  const seen = [
    page.botCheck === null ? 'no bot check on load' : page.botCheck === 'unknown' ? 'a bot check on load' : `a ${page.botCheck} bot check on load`,
    page.paymentFields ? 'card fields' : 'no card fields',
  ];
  return [
    `${label} · source ${key} · read ${fullTime(readAt)}`,
    'URL:',
    fence(page.snapshot.url),
    'Title:',
    fence(page.snapshot.title || 'none'),
    `Plain code saw ${seen.join(' and ')}.`,
    'Forms:',
    fence(page.snapshot.forms.map(formText).join('\n') || 'none'),
    'Text:',
    fence(text || 'none'),
  ];
}

/** A form as one line: each field's label, type and whether it is required, then its buttons. */
function formText(form: Form, i: number): string {
  const fields = form.fields.map((f) => {
    const options = f.options?.length ? `: ${f.options.slice(0, 8).map((o) => o.label).join(' / ')}` : '';
    return `${f.label || f.name || 'unlabelled'} (${f.type}${f.required ? ', required' : ''}${options})`;
  });
  const submits = form.submits.map((s) => s.label).join(' / ');
  return `Form ${i + 1}: ${fields.join('; ') || 'no fields'}${submits ? ` · button ${submits}` : ''}`;
}
