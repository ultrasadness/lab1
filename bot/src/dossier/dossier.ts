// A Dossier (#33): what the registration-role run records, and what plain code adds to it before rendering. Every
// part of the record names its sources by key; plain code numbers the sources in a fixed order, so ¹ is always the
// Launch, and links each one but the Interest scope.

/** The sources a Dossier may cite, in the fixed order of their numbers. */
export const SOURCE_KEYS = ['launch', 'maker-comment', 'landing-page', 'pricing-page', 'signup-page', 'interest-scope'] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export const SOURCE_NAMES: Record<SourceKey, string> = {
  launch: 'Launch',
  'maker-comment': 'Maker comment',
  'landing-page': 'landing page',
  'pricing-page': 'pricing page',
  'signup-page': 'signup page',
  'interest-scope': 'Interest scope',
};

/** Offers come only from these (#19): never the signup page alone, nor the Interest scope. */
const OFFER_SOURCES: ReadonlySet<SourceKey> = new Set(['launch', 'maker-comment', 'landing-page', 'pricing-page']);

export type ProductState = 'open' | 'waitlisted' | 'no-account';

export interface Part {
  text: string;
  sources: SourceKey[];
}

export interface Offer {
  what: string;
  code: string | null;
  card: 'needed' | 'not needed' | 'not stated';
  deadline: string | null;
  cap: string | null;
  /** Anything else it asks of the person, such as a public post. */
  condition: string | null;
  sources: SourceKey[];
}

export interface DossierRecord {
  state: ProductState;
  register: Part;
  whatItIs: Part;
  forYou: Part;
  offers: Offer[];
  note: Part | null;
  rulesApplied: string[];
}

/** One of the Product's Launches, as its Launches line shows it. */
export interface DossierLaunch {
  postId: string;
  date: string;
  slug: string;
  fit: number;
  rank: number;
  featuredCount: number;
}

/** A Dossier as plain code keeps and renders it: the record, and what the run was given. */
export interface Dossier {
  /** The post's title: the name and tagline of the Product's first Dossier Launch. */
  name: string;
  tagline: string;
  rootDomain: string;
  record: DossierRecord;
  /** Oldest first. */
  launches: DossierLaunch[];
  /** The link of each source the run was given; the Interest scope has none. */
  links: Partial<Record<SourceKey, string>>;
  /** When the Product's pages were read. */
  readAt: string;
}

/** An Offer the Assistant can't take up itself: one that needs a card, or anything beyond a code, deadline or cap. */
export const yoursToActOn = (offer: Offer) => offer.card === 'needed' || offer.condition !== null;

const LIMITS = { register: 300, whatItIs: 600, forYou: 400, note: 400, what: 120, code: 30, deadline: 30, cap: 40, condition: 80, offers: 10 };

type Read = { ok: true; record: DossierRecord } | { ok: false; error: string };

/**
 * Checks a record from a run against the sources the run was given. The extension's schema checked its shape once
 * already; this says what is wrong in a way the model can fix.
 */
export function readDossier(record: unknown, given: ReadonlySet<SourceKey>): Read {
  const r = (record as { kind?: unknown; record?: Record<string, unknown> } | null) ?? {};
  if (r.kind !== 'dossier' || typeof r.record !== 'object' || r.record === null) return { ok: false, error: 'Expected a Dossier record.' };
  const d = r.record;
  const problems: string[] = [];
  const line = (value: unknown, name: string, max: number): string | null => {
    if (typeof value === 'string' && value.trim() && !/[\r\n]/.test(value) && value.length <= max) return value.trim();
    problems.push(`${name} must be one line of at most ${max} characters.`);
    return null;
  };
  const optional = (value: unknown, name: string, max: number) => (value === null ? null : line(value, name, max));
  const sources = (value: unknown, name: string): SourceKey[] => {
    const keys = Array.isArray(value) ? value : [];
    const unknown = keys.filter((k) => !given.has(k as SourceKey));
    if (keys.length === 0) problems.push(`${name} must cite at least one source.`);
    if (unknown.length > 0) problems.push(`${name} cites ${unknown.map(String).join(', ')}, which this run wasn't given.`);
    return SOURCE_KEYS.filter((k) => keys.includes(k));
  };
  const part = (value: unknown, name: string, max: number): Part => {
    const p = (value ?? {}) as Record<string, unknown>;
    return { text: line(p.text, `${name}.text`, max) ?? '', sources: sources(p.sources, `${name}.sources`) };
  };

  const state = d.state;
  if (state !== 'open' && state !== 'waitlisted' && state !== 'no-account') problems.push('state must be open, waitlisted or no-account.');
  const register = part(d.register, 'register', LIMITS.register);
  const whatItIs = part(d.whatItIs, 'whatItIs', LIMITS.whatItIs);
  const forYou = part(d.forYou, 'forYou', LIMITS.forYou);
  if (!forYou.sources.includes('interest-scope')) problems.push('forYou must cite interest-scope.');
  const note = d.note === null ? null : part(d.note, 'note', LIMITS.note);
  const rawOffers = Array.isArray(d.offers) ? d.offers : [];
  if (!Array.isArray(d.offers) || rawOffers.length > LIMITS.offers) problems.push(`offers must be a list of at most ${LIMITS.offers}.`);
  const offers = rawOffers.slice(0, LIMITS.offers).map((value, i): Offer => {
    const o = (value ?? {}) as Record<string, unknown>;
    const name = `offers[${i}]`;
    const card = o.card === 'needed' || o.card === 'not needed' || o.card === 'not stated' ? o.card : 'not stated';
    if (card !== o.card) problems.push(`${name}.card must be needed, not needed or not stated.`);
    const cited = sources(o.sources, `${name}.sources`);
    if (!cited.some((k) => OFFER_SOURCES.has(k))) {
      problems.push(`${name} must come from the Launch description, the Maker comment, the landing page or the pricing page.`);
    }
    return {
      what: line(o.what, `${name}.what`, LIMITS.what) ?? '',
      code: optional(o.code, `${name}.code`, LIMITS.code),
      card,
      deadline: optional(o.deadline, `${name}.deadline`, LIMITS.deadline),
      cap: optional(o.cap, `${name}.cap`, LIMITS.cap),
      condition: optional(o.condition, `${name}.condition`, LIMITS.condition),
      sources: cited,
    };
  });
  if (!Array.isArray(d.rulesApplied) || d.rulesApplied.length > 0) problems.push('rulesApplied must be empty: no Rules exist yet.');
  if (problems.length > 0) return { ok: false, error: problems.join(' ') };
  return { ok: true, record: { state: state as ProductState, register, whatItIs, forYou, offers, note, rulesApplied: [] } };
}
