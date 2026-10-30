// Removes random-looking strings by pattern: the backstop that keeps tokens a page shows out of a model's input.
// It errs towards removing: a long camelCase word may go too, but no API key should stay. A session also removes each
// Secret filled into it by its exact value, which no pattern needs to recognise.
import type { SecretKind } from './api.ts';

const RANDOM = '[random]';

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// A run of base64's alphabet and its padding. Separators such as `_`, `-` and `.` end a run; `+` and `/` join its parts.
const RUN = /[A-Za-z0-9+/]+={0,2}/g;
const PART = /[A-Za-z0-9]+/g;
// A word, a capitalised word, an acronym or a number: `Sales/Marketing` and `24/7` are text.
const WORD = /^(?:[a-z]+|[A-Z][a-z]*|[A-Z]+|[0-9]+)$/;

const classOf = (c: string) => (c >= '0' && c <= '9' ? 'digit' : c === c.toLowerCase() ? 'lower' : 'upper');

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) bits -= (n / s.length) * Math.log2(n / s.length);
  return bits;
}

function looksRandom(token: string): boolean {
  if (token.length < 12 || /^[0-9]+$/.test(token)) return false; // dates, phone and order numbers
  const classes = new Set(Array.from(token, classOf));
  let changes = 0;
  for (let i = 1; i < token.length; i++) if (classOf(token[i]!) !== classOf(token[i - 1]!)) changes++;
  // A short secret mixes digits and both cases almost every character; a name like iPhone15ProMax changes less.
  if (token.length < 16) return classes.size === 3 && changes > token.length / 2;
  if (/^[0-9a-f]+$/.test(token) || /^[0-9A-F]+$/.test(token)) return /[0-9]/.test(token) && /[a-f]/i.test(token);
  if (classes.size < 2) return false; // a word in one case
  // A capitalised word changes class once; a random token changes about every other character.
  return changes >= token.length / 4 && entropy(token) >= 3;
}

function redactRun(run: string, offset: number, text: string): string {
  // A token such as base64 goes whole, judged by its parts that aren't words. A URL's path, after its host, goes
  // part by part.
  const inUrl = /[.:]/.test(text[offset - 1] ?? '');
  const token = (run.match(PART) ?? []).filter((part) => !WORD.test(part)).join('');
  if (!inUrl && looksRandom(token)) return RANDOM;
  return run.replace(PART, (part) => (looksRandom(part) ? RANDOM : part));
}

function redactRandom(text: string): string {
  return text.replace(UUID, RANDOM).replace(RUN, redactRun);
}

function mapStrings<T>(value: T, f: (s: string) => string): T {
  if (typeof value === 'string') return f(value) as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, f)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, f)])) as T;
  }
  return value;
}

/** Redacts every string inside a JSON-like value. */
export function redactAll<T>(value: T): T {
  return mapStrings(value, redactRandom);
}

export interface Secret {
  value: string;
  kind: SecretKind;
}

/**
 * Replaces each Secret in every string of a JSON-like value with `[password]` or `[code]`, as it stands and as a URL
 * carries it, in a path or in a form's query. It runs before the random-string pattern, which could otherwise break a
 * Secret into parts no longer matching it. A Secret is well-formed text, which the session's requests check.
 */
export function removeSecrets<T>(value: T, secrets: Secret[]): T {
  const forms = secrets
    .flatMap((s) => [s.value, encodeURIComponent(s.value), new URLSearchParams([['', s.value]]).toString().slice(1)].map((form) => ({ form, mark: `[${s.kind}]` })))
    .filter((f) => f.form)
    // A Secret inside a longer one goes after it.
    .sort((a, b) => b.form.length - a.form.length);
  return mapStrings(value, (text) => forms.reduce((t, { form, mark }) => t.split(form).join(mark), text));
}
