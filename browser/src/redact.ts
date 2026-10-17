// Removes random-looking strings by pattern: the backstop that keeps tokens a page shows out of a model's input.
// It errs towards removing: a long camelCase word may go too, but no API key should stay.

const RANDOM = '[random]';

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Separators such as `_`, `-` and `.` split a token into pieces; each long piece is judged on its own.
const PIECE = /[A-Za-z0-9]{16,}/g;

const classOf = (c: string) => (c >= '0' && c <= '9' ? 'digit' : c === c.toLowerCase() ? 'lower' : 'upper');

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) bits -= (n / s.length) * Math.log2(n / s.length);
  return bits;
}

function looksRandom(piece: string): boolean {
  if (/^[0-9]+$/.test(piece)) return false; // dates, phone and order numbers
  if (/^[0-9a-f]+$/.test(piece) || /^[0-9A-F]+$/.test(piece)) return /[0-9]/.test(piece) && /[a-f]/i.test(piece);
  const classes = new Set(Array.from(piece, classOf));
  if (classes.size < 2) return false; // a word in one case
  let changes = 0;
  for (let i = 1; i < piece.length; i++) if (classOf(piece[i]!) !== classOf(piece[i - 1]!)) changes++;
  // A capitalised word changes class once; a random token changes about every other character.
  return changes >= piece.length / 4 && entropy(piece) >= 3;
}

function redactRandom(text: string): string {
  return text.replace(UUID, RANDOM).replace(PIECE, (piece) => (looksRandom(piece) ? RANDOM : piece));
}

/** Redacts every string inside a JSON-like value. */
export function redactAll<T>(value: T): T {
  if (typeof value === 'string') return redactRandom(value) as T;
  if (Array.isArray(value)) return value.map(redactAll) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactAll(v)])) as T;
  }
  return value;
}
