// A Walkthrough (#53, #10, #12): the registration plan put to the person for Approval, prepared from a read of the
// live signup page made before any Approval. Plain code takes from that read the start URL, the signup host, the
// form's fields, its terms links and the walls visible on load; a registration-role run records which form it fills,
// which value each field gets by its Walkthrough key, the names from the Profile, what happens on submit, and the walls
// only the page's words show. A wall nothing can get past means no Walkthrough at all, and the Dossier says why.
import { createHash } from 'node:crypto';
import type { Field, Form, Link, PageRead } from '../browser.ts';
import type { Offer } from '../dossier/dossier.ts';
import { onRootDomain } from '../root-domain.ts';

/**
 * What fills a field: a name from the Profile, the Signup identity, the new password by reference, an Offer code, a
 * choice among the field's options, or any other approved value.
 */
export type WalkthroughKey = 'first-name' | 'last-name' | 'full-name' | 'email' | 'password' | 'offer-code' | 'choice' | 'text';

export interface WalkthroughField {
  /** Its number among the form's fields, 1 first; null for a standard key carried while no form was seen. */
  field: number | null;
  label: string;
  key: WalkthroughKey;
  /**
   * The approved value, or null to leave the field empty. The email and password keys hold none: plain code fills the
   * Signup identity, and the password by reference.
   */
  value: string | null;
  /** A choice's options, as the person picks among them: a box's are "ticked" and "left unticked". */
  options?: string[];
  /** What the Offer gives whose code fills an offer-code field. */
  offer?: string;
  required: boolean;
}

export type OnSubmit = 'verification-email' | 'waitlist' | 'logged-in';

/** A wall the read showed that the Registration can get past, with the person's help. */
export type PredictedWall = { kind: 'bot-check'; vendor: string } | { kind: 'phone' } | { kind: 'oauth-only'; providers: string[] };

export interface Walkthrough {
  /** The Product's name, as its Dossier has it, and the root domain it is keyed by. */
  product: string;
  rootDomain: string;
  /** Where the Registration starts: the signup page's exact URL after redirects. */
  startUrl: string;
  /** The host the form is on, which may be an auth vendor's rather than the Product's. */
  signupHost: string;
  authVendor: string | null;
  /** When the signup page was read. */
  readAt: string;
  /** Whether the read saw the form the Walkthrough fills; without one it carries only the standard keys. */
  formSeen: boolean;
  /** The form's number in the read, 1 first, when one was seen. */
  form: number | null;
  /** The button plain code presses once the filled form passes the page check. */
  button: string | null;
  fields: WalkthroughField[];
  /** How many of the form's fields come after those the Walkthrough carries, left empty. */
  fieldsLeftOut: number;
  /** The terms the person accepts, as the form links them. */
  terms: Link[];
  walls: PredictedWall[];
  onSubmit: OnSubmit;
  /** Words from the signup page or the Dossier banning accounts made by a bot: the Registration is then a Handoff. */
  termsBan: string | null;
  /** The Signup identity's two addresses (ADR 0003): the Product's plus-address, and the plain one if `+` is refused. */
  identity: { plusAddress: string; plainAddress: string };
  rulesApplied: string[];
}

/** The most fields a Walkthrough carries, so that its card fits Discord; later ones are left empty. */
export const MAX_FIELDS = 15;

/** How long a value the person approves may be. Values are never cut on the card, so this bounds its length. */
export const VALUE_CHARS = 80;

const BOX_OPTIONS = ['ticked', 'left unticked'];

/** The fields of a form a Walkthrough preparation run may fill, by number: the visible ones, at most MAX_FIELDS. */
export const offeredFields = (form: Form) => form.fields.slice(0, MAX_FIELDS);

/** The options a choice field offers the person: a box's, or each option's label. Other fields have none. */
export function choiceOptions(field: Field): string[] | undefined {
  if (field.type === 'checkbox') return BOX_OPTIONS;
  const labels = [...new Set((field.options ?? []).map((o) => o.label.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  return labels.length > 0 ? labels : undefined;
}

/** How much of a form's button label the run is given and the Walkthrough names, as the run's schema allows. */
export const BUTTON_CHARS = 100;

/** A form's buttons, as the run is given them and a Walkthrough names them. */
export const buttonLabels = (form: Form) => form.submits.map((s) => s.label.replace(/\s+/g, ' ').trim().slice(0, BUTTON_CHARS)).filter(Boolean);

/** What a Walkthrough preparation run's record comes to: a Walkthrough, or no Walkthrough and why. */
export type Prepared = { walkthrough: Walkthrough } | { none: string };

type Read = { ok: true; prepared: Prepared } | { ok: false; error: string };

export interface ReadContext {
  product: string;
  rootDomain: string;
  read: PageRead;
  readAt: Date;
  /** The Dossier's Offers, whose no-card codes alone may fill a code field. */
  offers: Offer[];
  identity: Walkthrough['identity'];
}

const UNPASSABLE_PROVIDERS = 'whose mail would land outside the Signup mailbox';

/**
 * Checks a record from a Walkthrough preparation run against the read it was given, and makes the Walkthrough from
 * both, or says why there is none. The extension's schema checked its shape once already; this says what is wrong in a
 * way the model can fix.
 */
export function readWalkthrough(record: unknown, context: ReadContext): Read {
  const r = (record as { kind?: unknown; record?: Record<string, unknown> } | null) ?? {};
  if (r.kind !== 'walkthrough' || typeof r.record !== 'object' || r.record === null) return { ok: false, error: 'Expected a Walkthrough record.' };
  const w = r.record;
  const problems: string[] = [];
  const forms = context.read.snapshot.forms;

  const walls = Array.isArray(w.walls) ? w.walls.filter((k): k is string => typeof k === 'string') : [];
  const providers = Array.isArray(w.providers) ? w.providers.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim()) : [];
  if (walls.includes('free-email')) return { ok: true, prepared: { none: 'its signup form refuses gmail.com addresses' } };
  if (walls.includes('invite-only')) return { ok: true, prepared: { none: 'signing up needs an invite code, and none is known' } };
  const google = providers.some((p) => /^google\b/i.test(p));
  if (walls.includes('oauth-only')) {
    if (providers.length === 0) problems.push('An oauth-only wall needs the providers it offers.');
    else if (!google) return { ok: true, prepared: { none: `it signs in only through ${providers.join(' or ')}, ${UNPASSABLE_PROVIDERS}` } };
  }

  const formNumber = w.form;
  let form: Form | undefined;
  if (formNumber !== null) {
    if (typeof formNumber !== 'number' || !Number.isInteger(formNumber) || formNumber < 1 || formNumber > forms.length) {
      problems.push(forms.length > 0 ? `form must be null or a form's number, 1 to ${forms.length}.` : 'form must be null: the read saw no form.');
    } else {
      form = forms[formNumber - 1];
    }
  }

  const names = (w.names ?? {}) as Record<string, unknown>;
  const name = (value: unknown, what: string): string | null => {
    if (value === null) return null;
    const named = oneLine(value, VALUE_CHARS);
    if (!named) problems.push(`names.${what} must be null or one line of at most ${VALUE_CHARS} characters.`);
    return named;
  };
  const first = name(names.first, 'first');
  const last = name(names.last, 'last');
  const full = first && last ? `${first} ${last}` : (first ?? last);

  let fields: WalkthroughField[];
  let button: string | null = null;
  let fieldsLeftOut = 0;
  if (form) {
    const offered = offeredFields(form);
    fieldsLeftOut = form.fields.length - offered.length;
    const fills = new Map<number, { fill: unknown; value: unknown }>();
    for (const [i, entry] of (Array.isArray(w.fields) ? w.fields : []).entries()) {
      const f = (entry ?? {}) as Record<string, unknown>;
      const n = f.field;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > offered.length) {
        problems.push(`fields[${i}].field must be a field's number in form ${formNumber}, 1 to ${offered.length}.`);
      } else if (fills.has(n)) {
        problems.push(`Field ${n} is listed twice.`);
      } else {
        fills.set(n, { fill: f.fill, value: f.value });
      }
    }
    const codes = context.offers.filter((o) => o.card === 'not needed' && o.code).map((o) => o.code!);
    fields = offered.map((field, i) => {
      const n = i + 1;
      const at = `Field ${n}`;
      const label = fieldLabel(field, n);
      const options = choiceOptions(field);
      const { fill, value } = fills.get(n) ?? { fill: 'empty', value: null };
      // The Signup identity and the password are plain code's to fill (ADR 0003, ADR 0004): no other value goes in.
      const kind = /\bemail\b/i.test(`${field.type} ${field.autocomplete ?? ''}`) ? 'email' : field.type === 'password' ? 'password' : null;
      if (kind && fill !== kind && fill !== 'empty') problems.push(`${at} is ${kind === 'email' ? 'an' : 'a'} ${kind} field: fill it with ${kind}, or leave it empty.`);
      // A box or list the page set itself is shown as set, so the person sees what will be sent.
      const preset = field.type === 'checkbox' ? (field.checked ? 'ticked' : 'left unticked') : (field.options?.find((o) => o.selected)?.label.replace(/\s+/g, ' ').trim() || null);
      const of = (key: WalkthroughKey, v: string | null): WalkthroughField => ({
        field: n,
        label,
        key,
        value: v,
        ...(key === 'choice' ? { options: options! } : {}),
        required: field.required,
      });
      switch (fill) {
        case 'first-name':
          return of('first-name', first);
        case 'last-name':
          return of('last-name', last);
        case 'full-name':
          return of('full-name', full);
        case 'email':
        case 'password':
          return of(fill, null);
        case 'offer-code': {
          if (value === null && codes.length === 0) return of('offer-code', null);
          const offer = typeof value === 'string' ? context.offers.find((o) => o.card === 'not needed' && o.code === value.trim()) : undefined;
          if (offer) return { ...of('offer-code', offer.code), offer: offer.what };
          problems.push(
            codes.length > 0
              ? `${at}: a code field gets the code of an Offer that needs no card: one of ${codes.join(', ')}.`
              : `${at}: no Offer that needs no card has a code, so its value must be null.`,
          );
          return of('offer-code', null);
        }
        case 'choice': {
          if (!options) {
            problems.push(`${at} isn't a box or a list of options, so it can't be a choice.`);
            return of('text', null);
          }
          if (value === null && field.type !== 'checkbox') return of('choice', preset);
          const picked = typeof value === 'string' ? options.find((o) => o.toLowerCase() === value.trim().toLowerCase()) : undefined;
          if (!picked) problems.push(`${at}: a choice's value must be one of ${options.map((o) => `"${o}"`).join(', ')}.`);
          return of('choice', picked ?? (field.type === 'checkbox' ? 'left unticked' : null));
        }
        case 'value': {
          const v = oneLine(value, VALUE_CHARS);
          if (!v) problems.push(`${at}: a value must be one line of at most ${VALUE_CHARS} characters.`);
          else if (EMAIL_ADDRESS.test(v)) problems.push(`${at}: an email address goes into a form only as the Signup identity, with fill email.`);
          else return of('text', v);
          return of('text', null);
        }
        case 'empty':
          return options ? of('choice', field.type === 'checkbox' ? 'left unticked' : preset) : of('text', null);
        default:
          problems.push(`${at}: fill must be first-name, last-name, full-name, email, password, offer-code, choice, value or empty.`);
          return of('text', null);
      }
    });
    const labels = buttonLabels(form);
    if (labels.length > 0) {
      button = labels.find((l) => typeof w.button === 'string' && l.toLowerCase() === w.button.trim().toLowerCase()) ?? null;
      if (!button) problems.push(`button must be one of form ${formNumber}'s buttons: ${labels.map((l) => `"${l}"`).join(', ')}.`);
    }
  } else {
    // With no form seen, the Walkthrough carries the standard keys alone (#10).
    fields = [
      { field: null, label: 'First name', key: 'first-name', value: first, required: true },
      { field: null, label: 'Last name', key: 'last-name', value: last, required: true },
      { field: null, label: 'Email', key: 'email', value: null, required: true },
      { field: null, label: 'Password', key: 'password', value: null, required: true },
    ];
  }

  const onSubmit = w.onSubmit;
  if (onSubmit !== 'verification-email' && onSubmit !== 'waitlist' && onSubmit !== 'logged-in') {
    problems.push('onSubmit must be verification-email, waitlist or logged-in.');
  }
  const termsBan = optionalLine(w.termsBan, 'termsBan', 300, problems);
  const authVendor = optionalLine(w.authVendor, 'authVendor', 40, problems);
  const { rulesApplied } = w;
  if (!Array.isArray(rulesApplied) || !rulesApplied.every((n) => typeof n === 'string')) problems.push('rulesApplied must be a list of Rule names.');
  if (problems.length > 0) return { ok: false, error: problems.join(' ') };

  const { read } = context;
  const predicted: PredictedWall[] = [
    ...(read.botCheck ? [{ kind: 'bot-check' as const, vendor: read.botCheck === 'unknown' ? 'unknown' : read.botCheck }] : []),
    ...(walls.includes('phone') ? [{ kind: 'phone' as const }] : []),
    ...(walls.includes('oauth-only') ? [{ kind: 'oauth-only' as const, providers }] : []),
  ];
  return {
    ok: true,
    prepared: {
      walkthrough: {
        product: context.product,
        rootDomain: context.rootDomain,
        startUrl: read.finalUrl,
        signupHost: read.finalHost,
        authVendor,
        readAt: context.readAt.toISOString(),
        formSeen: Boolean(form),
        form: form ? (formNumber as number) : null,
        button,
        fields,
        fieldsLeftOut,
        terms: termsLinks(form ? [...form.links, ...form.fields.flatMap((f) => f.links)] : read.snapshot.links),
        walls: predicted,
        onSubmit: onSubmit as OnSubmit,
        termsBan,
        identity: context.identity,
        rulesApplied: rulesApplied as string[],
      },
    },
  };
}

/** A field as the card names it: its label, or its name, or its place. */
function fieldLabel(field: Field, n: number): string {
  return (field.label.replace(/\s+/g, ' ').trim() || field.name?.trim() || `Field ${n}`).slice(0, 200);
}

/** A value of one line of at most `max` characters, trimmed, or null when it isn't one. */
function oneLine(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() && value.trim().length <= max && !/[\r\n]/.test(value) ? value.trim() : null;
}

function optionalLine(value: unknown, name: string, max: number, problems: string[]): string | null {
  if (value === null || value === undefined) return null;
  const line = oneLine(value, max);
  if (!line) problems.push(`${name} must be null or one line of at most ${max} characters.`);
  return line;
}

const EMAIL_ADDRESS = /[^\s@]+@[^\s@]+\.[^\s@]+/;

const TERMS = /\b(?:terms|conditions|privacy|policy|eula|tos)\b/i;

/**
 * The terms a form links, by plain code: at most three, each once, whole, since the page check compares the links of
 * the box it ticks with them (ADR 0005). Random-looking strings break a link.
 */
function termsLinks(links: Link[]): Link[] {
  const found: Link[] = [];
  for (const l of links) {
    if (!TERMS.test(l.text) && !TERMS.test(l.href)) continue;
    if (!/^https?:\/\//.test(l.href) || l.href.includes('[random]')) continue;
    if (found.some((f) => f.href === l.href)) continue;
    found.push({ text: l.text.replace(/\s+/g, ' ').trim().slice(0, 200) || 'the terms', href: l.href });
    if (found.length === 3) break;
  }
  return found;
}

/** Whether the signup host is off the Product's own root domain. */
export const offDomain = (w: Pick<Walkthrough, 'signupHost' | 'rootDomain'>) => !onRootDomain(w.signupHost, w.rootDomain);

/** A version's hash: what the person sees and approves, so two versions that show the same thing hash alike. */
export function versionHash(w: Walkthrough): string {
  return createHash('sha256').update(JSON.stringify(w)).digest('hex');
}

/** The Signup identity's plus-address tag for a Product, from its name, as `you+<tag>@gmail.com` carries it. */
export function plusTagOf(name: string, rootDomain: string): string {
  const slug = (value: string) =>
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 24);
  return slug(name) || slug(rootDomain.split('.')[0]!) || 'product';
}

/** The Signup identity's two addresses for a plus-address tag. */
export function identityOf(mailbox: string, tag: string): Walkthrough['identity'] {
  const [local, domain] = mailbox.split('@') as [string, string];
  return { plusAddress: `${local}+${tag}@${domain}`, plainAddress: mailbox };
}
