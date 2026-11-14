// Secrets in mail, as plain code finds them (#57): a verification code, or a link that verifies, signs in or resets,
// each replaced by a placeholder such as `[code 1]` or `[link 2]` before anything keeps, shows or sends the mail's text.
// The values stay in memory only, for a fill by reference (#58). Plain code can't tell a sign-in link from any other
// link that carries a token, so it errs toward a placeholder: one too many costs a model a link it never needed, and
// one too few would hand it a Secret.

/** A mail's texts with each Secret replaced, and the Secrets by placeholder, numbered across the texts. */
export interface Placeheld {
  texts: string[];
  /** Each code, the first `[code 1]`. */
  codes: string[];
  /** Each link that is a Secret, the first `[link 1]`. */
  links: string[];
}

/** A link in text: up to a space, a quote or a bracket, less the punctuation that ends a sentence. */
const LINK = /\bhttps?:\/\/[^\s<>"'`()[\]{}]+/gi;

/** A query or fragment key that names a Secret. */
const SECRET_KEY = /token|code|key|sig|auth|otp|verif|confirm|magic|reset|secret|session|ticket|nonce|oob|login|invite|activat|pass|hash|jwt|upn/i;

/**
 * A code standing alone: 4 to 8 digits, two groups of 3 such as `482 913`, or 6 to 10 capitals and digits with at least
 * one of each. Not part of a word, an amount, a time, a date or a longer number.
 */
const CODE = /(?<![\p{L}\p{N}_$€£¥#@+&=/?])(?<!\p{N}[.,:/-])(?:\d{3}[ -]\d{3}|\d{4,8}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,10})(?![\p{L}\p{N}_%])(?![.,:/-]\p{N})/gu;

/** Words that say a line holds a code, so a number that reads like a year there is one, and so is a looser form. */
const CODE_WORD = /\b(?:code|verif\w*|otp|one[- ]time|passcode|pin)\b/i;

/** A path segment that says what follows it signs in, verifies or resets, such as `/verify/k7Qm2x`. */
const SECRET_PATH = /^(?:verif\w*|confirm\w*|magic\w*|reset\w*|log-?in|sign-?in|auth\w*|activat\w*|invit\w*|token\w*|otp|pass\w*|v)$/i;

/** What may wrap a word in a sentence, and isn't part of it. */
const WRAPPING = /^[\s.,:;!?()[\]{}"'“”‘’«»*_<>]+|[\s.,:;!?()[\]{}"'“”‘’«»*_<>]+$/g;

/**
 * A word on a line that speaks of a code, read as one in a looser form than `CODE` takes anywhere: 4 to 12 letters and
 * digits, with dashes between groups, holding a digit, or 6 capitals or more, such as `4KD-9XQ`, `abc123` or `QWERTY`.
 */
function looseCode(word: string): boolean {
  const compact = word.replaceAll('-', '');
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(word) || compact.length < 4 || compact.length > 12 || CODE_WORD.test(word)) return false;
  return /\d/.test(compact) || (compact.length >= 6 && compact === compact.toUpperCase());
}

/** Hyphenated words or numbers, such as a blog post's slug or a date: no token. */
const slug = (value: string) => value.includes('-') && value.split('-').every((part) => /^[a-z]+$/i.test(part) || /^\d+$/.test(part));

/** A value that reads like a token: a run of 6 digits or more, a mix of 6 letters and digits or more that isn't a slug, or a long run of letters. */
function tokenLike(value: string): boolean {
  if (/^\d{6,}$/.test(value)) return true;
  if (value.length < 6 || slug(value)) return false;
  return /\d/.test(value) && /[a-z]/i.test(value) ? true : value.length >= 32 && /^[\w.~=+/-]+$/.test(value);
}

const decodedOr = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Whether a link carries a Secret: a key that names one, or a value that reads like a token, anywhere in it. */
export function secretLink(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    // A link that can't be read is taken for one.
    return true;
  }
  const params = [...url.searchParams, ...new URLSearchParams(url.hash.slice(1))];
  if (params.some(([key, value]) => (SECRET_KEY.test(key) && value.length >= 4) || tokenLike(value))) return true;
  const segments = url.pathname.split('/').map(decodedOr);
  // A segment after one that says it signs in, verifies or resets is taken for a token, however short.
  if (segments.some((segment, i) => SECRET_PATH.test(segment) && segments.slice(i + 1).some((after) => after.length >= 4))) return true;
  return [...segments, url.hash.slice(1)].some(tokenLike);
}

/** Replaces each Secret in the texts with its placeholder, the same value with the same one throughout. */
export function withPlaceholders(texts: string[]): Placeheld {
  const codes: string[] = [];
  const links: string[] = [];
  const placeholder = (kind: 'code' | 'link', found: string[], value: string) => {
    if (!found.includes(value)) found.push(value);
    return `[${kind} ${found.indexOf(value) + 1}]`;
  };
  const replaced = texts.map((text) =>
    text
      .replace(LINK, (whole) => {
        const link = whole.replace(/[.,;:!?]+$/, '');
        return secretLink(link) ? placeholder('link', links, link) + whole.slice(link.length) : whole;
      })
      .split('\n')
      .map((line, i, lines) => {
        // A line speaks of a code when it names one, or holds one word alone right after a line that names one, as a
        // code set apart under its label does: "Your verification code:", then the code.
        const before = lines.slice(0, i).findLast((l) => l.trim() !== '') ?? '';
        const aboutCode = CODE_WORD.test(line) || (/^\s*\S+\s*$/.test(line) && CODE_WORD.test(before));
        const strict = line.replace(CODE, (code) => {
          // A number that reads like a year is one, unless its line speaks of a code or holds nothing else.
          const year = /^(19|20)\d\d$/.test(code) && !aboutCode && line.trim() !== code;
          return year ? code : placeholder('code', codes, code);
        });
        return aboutCode ? looseCodes(strict, (code) => placeholder('code', codes, code)) : strict;
      })
      .join('\n'),
  );
  return { texts: replaced, codes, links };
}

/**
 * The looser codes on a line that speaks of one: each word `looseCode` takes, and digits in short groups such as
 * `48 29 13`, 4 to 10 of them in all.
 */
function looseCodes(line: string, placeholder: (code: string) => string): string {
  const words = [...line.matchAll(/\S+/g)].map((m) => {
    const word = m[0].replace(WRAPPING, '');
    return { word, at: m.index + m[0].indexOf(word) };
  });
  const found: { at: number; code: string }[] = [];
  for (let i = 0; i < words.length; i++) {
    let j = i;
    while (j + 1 < words.length && /^\d{1,4}$/.test(words[j]!.word) && /^\d{1,4}$/.test(words[j + 1]!.word) && words[j + 1]!.at === words[j]!.at + words[j]!.word.length + 1) j++;
    const grouped = line.slice(words[i]!.at, words[j]!.at + words[j]!.word.length);
    if (j > i && /^[\d ]+$/.test(grouped) && grouped.replaceAll(' ', '').length >= 4 && grouped.replaceAll(' ', '').length <= 10) {
      found.push({ at: words[i]!.at, code: grouped });
      i = j;
    } else if (looseCode(words[i]!.word)) {
      found.push({ at: words[i]!.at, code: words[i]!.word });
    }
  }
  // Numbered in the order they stand, then put in from the end, so each place found still holds.
  const numbered = found.map(({ at, code }) => ({ at, code, with: placeholder(code) }));
  let out = line;
  for (const { at, code, with: replacement } of numbered.reverse()) out = `${out.slice(0, at)}${replacement}${out.slice(at + code.length)}`;
  return out;
}
