// The doc-pair check (#82). A pair is a doc's English side `foo.md`, its Chinese side `foo.zh.md` and their
// record `foo.i18n.yaml`. The record holds a short hash of each heading section's text on each side, code blocks
// left out; the check recomputes them and names each section that changed since the pair was last recorded.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, normalize } from 'node:path';

/** A pair's three sibling files, as paths from the root. */
interface Pair {
  en: string;
  zh: string;
  record: string;
}

/** A pair's two sides in sections, which line up one to one, and each section's heading path in the English side. */
interface Sides {
  pair: Pair;
  en: Block[][];
  zh: Block[][];
  keys: string[];
}

/** A top-level Markdown block. Its text has whitespace runs collapsed, unless it is code. */
type Block = { kind: 'heading'; depth: number; title: string; text: string } | { kind: 'code' | 'text'; text: string };

type Heading = Extract<Block, { kind: 'heading' }>;

/** One record entry: a section's heading path in the English side, and the hash of its text on each side. */
interface Entry {
  key: string;
  en: string;
  zh: string;
}

type Result = { ok: boolean; output: string };

const USAGE = `Usage: npm run check:docs [-- --list | -- --write <pair>...]
  (no flag)  check every pair, failing on any that is out of step
  --list     print each pair's state, and never fail
  --write    re-record each pair named by any of its files, once its two sides say the same thing
`;

/** What `npm run check:docs` does with `args`, for the `pairs` (each named by its English side) under `root`. */
export function checkDocs(args: string[], root: string, pairs: string[]): Result {
  const [flag, ...names] = args;
  const all = pairs.map(pairOf);
  if (flag === undefined) return checkAll(root, all);
  if (flag === '--list' && names.length === 0) return { ok: true, output: list(root, all) };
  if (flag === '--write' && names.length > 0) return write(root, all, names);
  return { ok: false, output: USAGE };
}

function pairOf(en: string): Pair {
  return { en, zh: en.replace(/\.md$/, '.zh.md'), record: en.replace(/\.md$/, '.i18n.yaml') };
}

function checkAll(root: string, pairs: Pair[]): Result {
  const failed = pairs.flatMap((pair) => {
    const problems = check(root, pair);
    if (problems.length === 0) return [];
    return [
      lines([
        `${pair.en} is out of step with ${pair.zh}:`,
        ...indent(problems),
        `Bring the two sides in line, then re-record the pair: npm run check:docs -- --write ${pair.en}`,
      ]),
    ];
  });
  if (failed.length > 0) return { ok: false, output: failed.join('\n') };
  return { ok: true, output: `${pairs.length} doc ${pairs.length === 1 ? 'pair' : 'pairs'} in step.\n` };
}

function list(root: string, pairs: Pair[]): string {
  const width = Math.max(...pairs.map((pair) => pair.en.length)) + 2;
  return lines(
    pairs.map((pair) => {
      const gone = absent(root, [pair.en, pair.zh, pair.record]);
      const state = gone.length > 0 ? `missing ${and(gone)}` : check(root, pair).length > 0 ? 'out of step' : 'in step';
      return pair.en.padEnd(width) + state;
    }),
  );
}

function write(root: string, pairs: Pair[], names: string[]): Result {
  const out: string[] = [];
  let ok = true;
  for (const name of names) {
    const pair = pairs.find((p) => stem(p.en) === stem(normalize(name)));
    const problems = pair ? unrecordable(root, pair) : [];
    if (pair && problems.length === 0) {
      writeFileSync(join(root, pair.record), serialize(entries(sides(root, pair))));
      out.push(`Recorded ${pair.en} and ${pair.zh} in ${pair.record}.`);
      continue;
    }
    ok = false;
    if (!pair) out.push(`${name} is not one of the doc pairs (${pairs.map((p) => p.en).join(', ')})`);
    else out.push(`${pair.en} can't be recorded yet:`, ...indent(problems));
  }
  return { ok, output: lines(out) };
}

/** Why the pair can't be recorded as it stands: a missing side, or two sides that don't mirror each other. */
function unrecordable(root: string, pair: Pair): string[] {
  const gone = absent(root, [pair.en, pair.zh]);
  return gone.length > 0 ? [areMissing(gone)] : unmirrored(sides(root, pair));
}

/** One line per problem, naming its section; none when the pair is in step. */
function check(root: string, pair: Pair): string[] {
  const gone = absent(root, [pair.en, pair.zh, pair.record]);
  if (gone.includes(pair.en) || gone.includes(pair.zh)) return [areMissing(gone)];
  const doc = sides(root, pair);
  const problems = unmirrored(doc);
  return misaligned(doc).length > 0 ? problems : [...problems, ...unrecorded(root, doc)];
}

/** Where the two sides don't mirror each other's structure. */
function unmirrored(doc: Sides): string[] {
  const headings = misaligned(doc);
  return [...missingLinks(doc), ...(headings.length > 0 ? headings : unequalCode(doc))];
}

/** Each side whose H1 isn't followed by its link to the other side. */
function missingLinks({ pair, en, zh }: Sides): string[] {
  const links: [string, Block[][], string][] = [
    [pair.en, en, `English | [中文](${basename(pair.zh)})`],
    [pair.zh, zh, `[English](${basename(pair.en)}) | 中文`],
  ];
  return links.flatMap(([file, side, link]) => {
    const h1 = side.find(([first]) => first?.kind === 'heading' && first.depth === 1);
    return h1?.[1]?.text === link ? [] : [`${file}: the line after its H1 must be "${link}", with a blank line after it`];
  });
}

/** The first place the two sides' headings stop matching in depth and order. Past it, no section lines up. */
function misaligned({ pair, en, zh, keys }: Sides): string[] {
  const [ours, theirs] = [headings(en), headings(zh)];
  for (let i = 0; i < Math.max(ours.length, theirs.length); i++) {
    const [e, z, key] = [ours[i], theirs[i], keys[i + 1]];
    if (!z) return [`${key}: ${pair.zh} has no heading to match it`];
    if (!e) return [`${pair.zh} has a heading ${pair.en} doesn't, after ${keys[i]}: "${z.text}"`];
    if (e.depth !== z.depth) return [`${key}: a level ${e.depth} heading in ${pair.en}, but level ${z.depth} in ${pair.zh} ("${z.text}")`];
  }
  return [];
}

/** Where the two sides' code blocks differ, section by section. */
function unequalCode(doc: Sides): string[] {
  const code = (section: Block[]) => section.filter((b) => b.kind === 'code').map((b) => b.text);
  return doc.en.flatMap((section, i) => {
    const [en, zh] = [code(section), code(doc.zh[i] ?? [])];
    const n = Array.from({ length: Math.max(en.length, zh.length) }, (_, j) => j).find((j) => en[j] !== zh[j]);
    return n === undefined ? [] : [`${doc.keys[i]}: code block ${n + 1} differs between the two sides`];
  });
}

/** Each section whose text on either side changed since the pair was recorded. */
function unrecorded(root: string, doc: Sides): string[] {
  const { pair } = doc;
  if (!existsSync(join(root, pair.record))) return [areMissing([pair.record])];
  const record = parse(readFileSync(join(root, pair.record), 'utf8'));
  if (!Array.isArray(record)) return [`${pair.record} can't be read at line ${record.line}: "${record.text}"`];
  const recorded = new Map(record.map((e) => [e.key, e]));
  const current = entries(doc);
  const keys = new Set(current.map((e) => e.key));
  return [
    ...current.flatMap((e) => {
      const was = recorded.get(e.key);
      if (!was) return [`${e.key}: new since the pair was recorded`];
      const changed = [e.en !== was.en && pair.en, e.zh !== was.zh && pair.zh].filter((side) => side !== false);
      return changed.length === 0 ? [] : [`${e.key}: changed in ${and(changed)} since the pair was recorded`];
    }),
    ...record.filter((e) => !keys.has(e.key)).map((e) => `${e.key}: in ${pair.record}, but no longer a section of ${pair.en}`),
  ];
}

function absent(root: string, files: string[]): string[] {
  return files.filter((file) => !existsSync(join(root, file)));
}

function areMissing(files: string[]): string {
  return `${and(files)} ${files.length === 1 ? 'is' : 'are'} missing`;
}

/** `a`, `a and b`, `a, b and c`. */
function and(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function indent(problems: string[]): string[] {
  return problems.map((p) => `  ${p}`);
}

function lines(items: string[]): string {
  return items.map((line) => `${line}\n`).join('');
}

function stem(file: string): string {
  return file.replace(/(\.zh\.md|\.i18n\.yaml|\.md)$/, '');
}

function sides(root: string, pair: Pair): Sides {
  const en = sections(readFileSync(join(root, pair.en), 'utf8'));
  const zh = sections(readFileSync(join(root, pair.zh), 'utf8'));
  return { pair, en, zh, keys: headingPaths(headings(en)) };
}

/** Each section's heading, past the text before the first one. */
function headings(sections: Block[][]): Heading[] {
  return sections.slice(1).map((s) => s[0] as Heading);
}

function entries({ en, zh, keys }: Sides): Entry[] {
  return en.flatMap((section, i) => {
    const other = zh[i] ?? [];
    if (!section.some(hashed) && !other.some(hashed)) return [];
    return [{ key: keys[i]!, en: hash(section), zh: hash(other) }];
  });
}

/** The doc's blocks before its first heading, then one list per heading, starting with the heading itself. */
function sections(markdown: string): Block[][] {
  const out: Block[][] = [[]];
  for (const block of blocks(markdown)) {
    if (block.kind === 'heading') out.push([]);
    out.at(-1)!.push(block);
  }
  return out;
}

function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  let paragraph: string[] = [];
  let fence: { marker: string; lines: string[] } | undefined;
  const flush = () => {
    if (paragraph.length > 0) out.push({ kind: 'text', text: collapse(paragraph.join(' ')) });
    paragraph = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (fence) {
      fence.lines.push(line);
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (close !== undefined && close[0] === fence.marker[0] && close.length >= fence.marker.length) {
        out.push({ kind: 'code', text: fence.lines.join('\n') });
        fence = undefined;
      }
      continue;
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    const heading = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(line);
    if (open) {
      flush();
      fence = { marker: open, lines: [line] };
    } else if (heading) {
      flush();
      out.push({ kind: 'heading', depth: heading[1]!.length, title: heading[2] ?? '', text: collapse(line) });
    } else if (line.trim() === '') {
      flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  if (fence) out.push({ kind: 'code', text: fence.lines.join('\n') });
  return out;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Whether a block counts toward its section's hash: every block but code. */
function hashed(block: Block): boolean {
  return block.kind !== 'code';
}

function hash(section: Block[]): string {
  const text = section.filter(hashed).map((b) => b.text).join('\n');
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** `/` for the text before the first heading, then each heading's path of slugs; a repeated path gets `~2`, `~3`. */
function headingPaths(headings: Heading[]): string[] {
  const open: { depth: number; slug: string }[] = [];
  const seen = new Map([['/', 1]]);
  const out = ['/'];
  for (const { depth, title } of headings) {
    while (open.length > 0 && open.at(-1)!.depth >= depth) open.pop();
    open.push({ depth, slug: slug(title) });
    const path = '/' + open.map((h) => h.slug).join('/');
    const n = (seen.get(path) ?? 0) + 1;
    seen.set(path, n);
    out.push(n === 1 ? path : `${path}~${n}`);
  }
  return out;
}

/** GitHub's anchor for a heading: lowercased, punctuation dropped, spaces as hyphens. */
function slug(title: string): string {
  return title
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

function serialize(entries: Entry[]): string {
  return entries.map((e) => `${e.key}:\n  en: ${e.en}\n  zh: ${e.zh}\n`).join('');
}

/** The record's entries, or its first line that doesn't fit the form `serialize` writes. */
function parse(record: string): Entry[] | { line: number; text: string } {
  const rows = record.split('\n');
  if (rows.at(-1) === '') rows.pop();
  const out: Entry[] = [];
  for (let i = 0; i < rows.length; i += 3) {
    const key = /^(\S.*):$/.exec(rows[i]!)?.[1];
    const en = /^ {2}en: ([0-9a-f]{16})$/.exec(rows[i + 1] ?? '')?.[1];
    const zh = /^ {2}zh: ([0-9a-f]{16})$/.exec(rows[i + 2] ?? '')?.[1];
    if (key === undefined || en === undefined || zh === undefined) {
      const bad = key === undefined ? i : en === undefined ? i + 1 : i + 2;
      return { line: bad + 1, text: rows[bad] ?? '' };
    }
    out.push({ key, en, zh });
  }
  return out;
}
