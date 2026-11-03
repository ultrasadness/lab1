// The doc-pair check (#82). A pair is a doc's English side `foo.md`, its Chinese side `foo.zh.md` and their
// record `foo.i18n.yaml`. The record holds a short hash of each heading section's text on each side, code blocks
// left out; the check recomputes them and names each section that changed since the pair was last recorded. It also
// fails a Chinese side that links to another pair's English side or to an anchor no heading has, or that breaks a line
// between two Chinese characters (#83). Given the docs that stay unpaired, it fails every doc on neither list, so
// whether a new doc gets a Chinese side goes to the person. Given a table of renderings, it fails a section whose
// English side uses a phrase of the table and whose Chinese side lacks the phrase's one rendering (#97). It fails a
// Setext heading or an indented code block on either side (#86).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize } from 'node:path';

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

/**
 * A top-level Markdown block. Its text has whitespace runs collapsed, unless it is code; a paragraph also keeps its
 * lines as written, and a heading its line. Code and a paragraph start at line `line`.
 */
type Block =
  | { kind: 'heading'; depth: number; title: string; text: string; written: string }
  | { kind: 'code'; text: string; line: number }
  | { kind: 'text'; text: string; line: number; lines: string[] };

type Heading = Extract<Block, { kind: 'heading' }>;

/** One record entry: a section's heading path in the English side, and the hash of its text on each side. */
interface Entry {
  key: string;
  en: string;
  zh: string;
}

/** A word or phrase the English sides use in one sense, and the one Chinese rendering it takes in them. */
export interface Rendering {
  en: string;
  zh: string;
  /** Wording that uses the phrase in another sense, which the entry lets through. */
  except?: string[];
}

type Result = { ok: boolean; output: string };

const USAGE = `Usage: npm run check:docs [-- --list | -- --write <pair>...]
  (no flag)  check every pair, failing on any that is out of step
  --list     print each pair's state, and never fail
  --write    re-record each pair named by any of its files, once its two sides say the same thing
`;

/**
 * What `npm run check:docs` does with `args`, for the `pairs` under `root`. Each is named by its English side, or is
 * a directory ending in `/` whose every English doc is a pair. Given the `unpaired` docs, each a file or a directory
 * ending in `/` that covers everything under it, the check also fails every other doc under `root`. The `renderings`
 * are the table each section is held to.
 */
export function checkDocs(args: string[], root: string, pairs: string[], unpaired?: string[], renderings: Rendering[] = []): Result {
  const [flag, ...names] = args;
  const all = pairs.flatMap((entry) => englishDocs(root, entry)).map(pairOf);
  if (flag === undefined) return checkAll(root, all, unpaired, renderings);
  if (flag === '--list' && names.length === 0) return { ok: true, output: list(root, all, renderings) };
  if (flag === '--write' && names.length > 0) return write(root, all, names);
  return { ok: false, output: USAGE };
}

/** `entry` itself, or each English doc right inside it when it is a directory. */
function englishDocs(root: string, entry: string): string[] {
  if (!entry.endsWith('/')) return [entry];
  return readdirSync(join(root, entry), { withFileTypes: true })
    .filter((file) => file.isFile() && file.name.endsWith('.md') && !file.name.endsWith('.zh.md'))
    .map((file) => entry + file.name)
    .sort();
}

function pairOf(en: string): Pair {
  return { en, zh: en.replace(/\.md$/, '.zh.md'), record: en.replace(/\.md$/, '.i18n.yaml') };
}

function checkAll(root: string, pairs: Pair[], unpaired: string[] | undefined, renderings: Rendering[]): Result {
  const strays = (unpaired ? unlisted(root, pairs, unpaired) : []).map(
    (doc) =>
      `${doc} is neither a doc pair nor an unpaired doc. Whether it gets a Chinese side is the person's call: ask them, ` +
      'then add it to PAIRS in scripts/check-docs.ts and write its Chinese side, or add it to UNPAIRED there.',
  );
  const failed = pairs.flatMap((pair) => {
    const problems = check(root, pair, pairs, renderings);
    if (problems.length === 0) return [];
    return [
      lines([
        `${pair.en} is out of step with ${pair.zh}:`,
        ...indent(problems),
        `Bring the two sides in line, then re-record the pair: npm run check:docs -- --write ${pair.en}`,
      ]),
    ];
  });
  if (strays.length > 0) failed.push(lines(strays));
  if (failed.length > 0) return { ok: false, output: failed.join('\n') };
  return { ok: true, output: `${count(pairs.length, 'doc pair')} in step.\n` };
}

/** Each doc under `root` that is neither a side of one of the `pairs` nor covered by the `unpaired` docs. */
function unlisted(root: string, pairs: Pair[], unpaired: string[]): string[] {
  const listed = new Set([...pairs.flatMap((pair) => [pair.en, pair.zh]), ...unpaired]);
  return docsUnder(root, '', listed).filter((doc) => !listed.has(doc));
}

/** Directories that are never ours to pair, at any depth: git's own and installed dependencies. */
const NOT_OURS = new Set(['.git', 'node_modules']);

/** Each Markdown doc in `dir` and below, as a path from `root`, past `NOT_OURS` and any directory in `listed`. */
function docsUnder(root: string, dir: string, listed: Set<string>): string[] {
  const entries = readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  return entries.flatMap((entry) => {
    const path = dir + entry.name;
    if (entry.isDirectory()) return NOT_OURS.has(entry.name) || listed.has(`${path}/`) ? [] : docsUnder(root, `${path}/`, listed);
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });
}

function list(root: string, pairs: Pair[], renderings: Rendering[]): string {
  const width = Math.max(...pairs.map((pair) => pair.en.length)) + 2;
  return lines(
    pairs.map((pair) => {
      const gone = absent(root, [pair.en, pair.zh, pair.record]);
      const state = gone.length > 0 ? `missing ${and(gone)}` : check(root, pair, pairs, renderings).length > 0 ? 'out of step' : 'in step';
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

/** One line per problem, naming its section or link; none when the pair is in step with the other `pairs`. */
function check(root: string, pair: Pair, pairs: Pair[], renderings: Rendering[]): string[] {
  const gone = absent(root, [pair.en, pair.zh, pair.record]);
  if (gone.includes(pair.en) || gone.includes(pair.zh)) return [areMissing(gone)];
  const doc = sides(root, pair);
  const problems = [...unreadForms(doc), ...unmirrored(doc), ...englishLinks(doc, pairs), ...brokenAnchors(root, doc), ...brokenLines(doc)];
  return misaligned(doc).length > 0 ? problems : [...problems, ...unrendered(doc, renderings), ...unrecorded(root, doc)];
}

/** Each Setext heading and indented code block on either side, which `blocks` reads as text, so the docs keep one way of each. */
function unreadForms({ pair, en, zh }: Sides): string[] {
  return [...formsIn(pair.en, en), ...formsIn(pair.zh, zh)];
}

/** Any run of `=` or of `-`, past its indentation, which a line of text above makes a Setext heading. */
const UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const LIST_MARKER = /^([-*+]|\d{1,9}[.)])([ \t]+|$)/;

/**
 * The Setext headings and indented code blocks in a side's blocks. What a line is turns on the lines above it. An
 * underline goes under a line of text in the same list item. Code is 4 columns past the content of the innermost list
 * item the line reaches, unless it goes on from the line above.
 *
 * This follows GitHub's renderer, where each case in the tests was tried, except where the person chose on #86 to keep
 * it simple, for forms no pair holds. It doesn't look inside a block quote. A table's row, a line of HTML and a link
 * reference definition are lines of text, so an underline under one fails, as do a front matter's closing `---` and an
 * indented line in an HTML block. Some forms pass though GitHub renders a heading or code: an empty list item, a blank
 * line and an indented line; a line that looks like a list item and can't interrupt a paragraph (`2016. then`), over an
 * underline; a fence whose list item ends before it does; an indented line right under a table's row or a line of HTML.
 */
function formsIn(file: string, side: Block[][]): string[] {
  const out: string[] = [];
  const indentedCode = (line: number) => out.push(`${file}:${line}: an indented code block; write it as a fenced block instead`);
  const open: number[] = [];
  let above: 'text' | 'code' | 'quote' | undefined;
  for (const block of side.flat()) {
    if (block.kind !== 'text') {
      const { inside, past } = reach(block.kind === 'code' ? block.text : block.written, open);
      open.length = inside;
      if (block.kind === 'code' && past >= 4) indentedCode(block.line);
      above = undefined;
      continue;
    }
    if (above !== 'code') above = undefined;
    for (const [i, line] of block.lines.entries()) {
      const { indent, inside, past, text } = reach(line, open);
      const starts = past < 4 && (THEMATIC_BREAK.test(text) || LIST_MARKER.test(text) || text.startsWith('>'));
      const goesOn = above === 'code' ? past >= 4 : above !== undefined;
      if (above === 'text' && inside === open.length && past < 4 && UNDERLINE.test(text)) {
        const thematicBreak = text.startsWith('-') ? ', or put a blank line above it if it is a thematic break' : '';
        out.push(`${file}:${block.line + i}: a Setext heading; write it with # instead${thematicBreak}`);
        above = undefined;
      } else if (starts || !goesOn) {
        open.length = inside;
        if (past >= 4) {
          indentedCode(block.line + i);
          above = 'code';
        } else if (THEMATIC_BREAK.test(text)) {
          above = undefined;
        } else {
          const { rest, indented } = openItems(open, indent, text);
          if (indented) indentedCode(block.line + i);
          above = rest === '' ? undefined : indented ? 'code' : rest.startsWith('>') ? 'quote' : 'text';
        }
      }
    }
  }
  return out;
}

/** How far `line` is indented, how many of the `open` list items it reaches, how far past the last of them, and its text. */
function reach(line: string, open: number[]): { indent: number; inside: number; past: number; text: string } {
  const space = /^[ \t]*/.exec(line)![0];
  const indent = widthOf(space);
  const inside = open.filter((column) => column <= indent).length;
  return { indent, inside, past: indent - (open[inside - 1] ?? 0), text: line.slice(space.length) };
}

/**
 * Adds to `open` the content column of each list item `text` starts, at column `indent`, and returns what follows the
 * markers. More than 4 columns after a marker, that is indented code starting the item's content.
 */
function openItems(open: number[], indent: number, text: string): { rest: string; indented: boolean } {
  let [column, rest] = [indent, text];
  for (let marker = LIST_MARKER.exec(rest); marker !== null; marker = LIST_MARKER.exec(rest)) {
    const start = column + marker[1]!.length;
    const gap = widthOf(marker[2]!, start);
    rest = rest.slice(marker[0].length);
    const indented = gap > 4 && rest !== '';
    column = start + (indented || rest === '' ? 1 : gap);
    open.push(column);
    if (indented) return { rest, indented };
  }
  return { rest, indented: false };
}

/** How many columns the whitespace `space` covers from column `from`, a tab going on to the next multiple of 4. */
function widthOf(space: string, from = 0): number {
  return [...space].reduce((width, c) => (c === '\t' ? width + 4 - ((from + width) % 4) : width + 1), 0);
}

/** Where the two sides don't mirror each other's structure. */
function unmirrored(doc: Sides): string[] {
  const headings = misaligned(doc);
  return [...missingLinks(doc), ...(headings.length > 0 ? headings : [...unequalCode(doc), ...unequalParts(doc)])];
}

/** Each side whose H1 isn't followed by its link to the other side. */
function missingLinks({ pair, en, zh }: Sides): string[] {
  const links: [string, Block[][], string][] = [
    [pair.en, en, languageLinks(pair).en],
    [pair.zh, zh, languageLinks(pair).zh],
  ];
  return links.flatMap(([file, side, link]) => {
    const h1 = side.find(([first]) => first?.kind === 'heading' && first.depth === 1);
    return h1?.[1]?.text === link ? [] : [`${file}: the line after its H1 must be "${link}", with a blank line after it`];
  });
}

/** The line right after each side's H1, linking to the other side. */
function languageLinks(pair: Pair): { en: string; zh: string } {
  return { en: `English | [中文](${basename(pair.zh)})`, zh: `[English](${basename(pair.en)}) | 中文` };
}

/** Each link on the Chinese side to the English side of one of the `pairs`, which belongs on its Chinese side. */
function englishLinks(doc: Sides, pairs: Pair[]): string[] {
  const { pair } = doc;
  const english = new Set(pairs.map((p) => p.en));
  return chineseTargets(doc)
    .filter((target) => english.has(linked(pair.zh, target) ?? ''))
    .map((target) => `${pair.zh}: the link to ${target} must point at its Chinese side, ${target.replace(/\.md(?=[#?]|$)/, '.zh.md')}`);
}

/** Each link on the Chinese side whose anchor names no heading in the doc it leads to. */
function brokenAnchors(root: string, doc: Sides): string[] {
  const { pair } = doc;
  return chineseTargets(doc).flatMap((target) => {
    const hash = target.indexOf('#');
    const file = hash === 0 ? pair.zh : linked(pair.zh, target);
    if (hash < 0 || file === undefined || !file.endsWith('.md') || !existsSync(join(root, file))) return [];
    if (anchors(readFileSync(join(root, file), 'utf8')).has(decoded(target.slice(hash + 1)))) return [];
    return [`${pair.zh}: the link to ${target} names no heading in ${file}`];
  });
}

/** The targets of the Chinese side's links, its language link left out. */
function chineseTargets({ pair, zh }: Sides): string[] {
  return zh
    .flat()
    .filter((block) => block.kind !== 'code' && block.text !== languageLinks(pair).zh)
    .flatMap((block) => targets(block.text));
}

/** The targets of a text's inline links and link reference definitions, inline code left out. */
function targets(text: string): string[] {
  return [...withoutInlineCode(text).matchAll(/\]\(\s*<?([^\s)>]+)|(?:^|\s)\[[^\]]+\]:\s*<?([^\s>]+)/g)].map((m) => (m[1] ?? m[2])!);
}

/** The path from the root that a link to `target` in `file` leads to; none for a URL or an anchor alone. */
function linked(file: string, target: string): string | undefined {
  const path = target.split(/[#?]/)[0]!;
  if (path === '' || isUrl(path)) return undefined;
  return normalize(path.startsWith('/') ? path.slice(1) : join(dirname(file), path));
}

function isUrl(target: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(target);
}

/** A character of Chinese text: a Han character, or CJK or full-width punctuation, quotes, dashes and ellipses. */
const CHINESE = /^[\p{Script=Han}\u3000-\u303f\uff00-\uffef\u2014\u2018-\u201d\u2026]$/u;

/**
 * Each line of a Chinese paragraph that breaks between two Chinese characters, where the break renders as a space.
 * A line may end in a full-width colon, as a glossary term's does before its definition, or in a hard line break.
 */
function brokenLines({ pair, zh }: Sides): string[] {
  return zh.flat().flatMap((block) => {
    if (block.kind !== 'text') return [];
    return block.lines.slice(1).flatMap((next, i) => {
      if (/( {2}|\\)$/.test(block.lines[i]!)) return [];
      const [before, after] = [[...block.lines[i]!.trimEnd()].at(-1) ?? '', [...next.trimStart()][0] ?? ''];
      if (before === '：' || !CHINESE.test(before) || !CHINESE.test(after)) return [];
      return [`${pair.zh}:${block.line + i}: a line break between "${before}" and "${after}" renders as a space inside Chinese text; join the two lines`];
    });
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

/** Where a section's list items, inline code or link URLs differ in number between the two sides. */
function unequalParts({ pair, en, zh, keys }: Sides): string[] {
  return en.flatMap((section, i) => {
    const other = zh[i] ?? [];
    const [ours, theirs] = [listItems(section), listItems(other)];
    const items = ours === theirs ? [] : [`${keys[i]}: ${count(ours, 'list item')} in ${pair.en}, but ${theirs} in ${pair.zh}`];
    const [a, b] = [parts(section), parts(other)];
    return [
      ...items,
      ...[...new Set([...a.keys(), ...b.keys()])].flatMap((part) => {
        const [x, y] = [a.get(part) ?? 0, b.get(part) ?? 0];
        return x === y ? [] : [`${keys[i]}: ${part} appears ${count(x, 'time')} in ${pair.en}, but ${count(y, 'time')} in ${pair.zh}`];
      }),
    ];
  });
}

function listItems(section: Block[]): number {
  const lines = section.flatMap((b) => (b.kind === 'text' ? b.lines : []));
  return lines.filter((line) => /^\s*(?:[-*+]|\d+[.)])\s/.test(line)).length;
}

/** How many times each piece of inline code, and each URL a link points at, appears in a section. */
function parts(section: Block[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const block of section.filter((b) => b.kind !== 'code')) {
    const code = (block.text.match(/`[^`]+`/g) ?? []).map((c) => `inline code ${c}`);
    const urls = targets(block.text).filter(isUrl).map((url) => `a link to ${url}`);
    for (const part of [...code, ...urls]) out.set(part, (out.get(part) ?? 0) + 1);
  }
  return out;
}

/** Each section whose English side uses a phrase of the table and whose Chinese side lacks its rendering. */
function unrendered({ pair, en, zh, keys }: Sides, renderings: Rendering[]): string[] {
  return en.flatMap((section, i) => {
    const [ours, theirs] = [wordsOf(section), wordsOf(zh[i] ?? [])];
    return renderings
      .filter((entry) => uses(ours, entry) && !theirs.includes(entry.zh))
      .map((entry) => `${keys[i]}: "${entry.en}" in ${pair.en} must be rendered ${entry.zh} in ${pair.zh}`);
  });
}

/**
 * Whether `text`, past the entry's other senses, holds its phrase as whole words, in any case, hyphenated or not, in
 * the singular or the plural.
 */
function uses(text: string, { en, except = [] }: Rendering): boolean {
  const rest = except.reduce((left, wording) => left.replace(new RegExp(RegExp.escape(wording), 'gi'), ''), text);
  return new RegExp(`\\b${en.split(/[ -]/).map(RegExp.escape).join('[ -]')}s?\\b`, 'i').test(rest);
}

/** What a section says in words: its text, past inline code and the URLs its links point at. */
function wordsOf(section: Block[]): string {
  const text = withoutInlineCode(sectionText(section));
  return targets(text).reduce((rest, target) => rest.replace(target, ''), text);
}

function withoutInlineCode(text: string): string {
  return text.replace(/`[^`]*`/g, '');
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

/** `1 doc pair`, `2 doc pairs`. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
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
  let start = 0;
  let fence: { marker: string; lines: string[]; line: number } | undefined;
  const flush = () => {
    if (paragraph.length > 0) out.push({ kind: 'text', text: collapse(paragraph.join(' ')), line: start, lines: paragraph });
    paragraph = [];
  };
  for (const [i, line] of markdown.split(/\r?\n/).entries()) {
    if (fence) {
      fence.lines.push(line);
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (close !== undefined && close[0] === fence.marker[0] && close.length >= fence.marker.length) {
        out.push({ kind: 'code', text: fence.lines.join('\n'), line: fence.line });
        fence = undefined;
      }
      continue;
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    const heading = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(line);
    if (open) {
      flush();
      fence = { marker: open, lines: [line], line: i + 1 };
    } else if (heading) {
      flush();
      out.push({ kind: 'heading', depth: heading[1]!.length, title: heading[2] ?? '', text: collapse(line), written: line });
    } else if (line.trim() === '') {
      flush();
    } else {
      if (paragraph.length === 0) start = i + 1;
      paragraph.push(line);
    }
  }
  flush();
  if (fence) out.push({ kind: 'code', text: fence.lines.join('\n'), line: fence.line });
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
  return createHash('sha256').update(sectionText(section)).digest('hex').slice(0, 16);
}

/** A section's text, code blocks left out. */
function sectionText(section: Block[]): string {
  return section.filter(hashed).map((b) => b.text).join('\n');
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

/** GitHub's anchor for each heading of `markdown`; a repeated one gets `-1`, `-2`. */
function anchors(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  return new Set(
    blocks(markdown).flatMap((block) => {
      if (block.kind !== 'heading') return [];
      const base = slug(block.title);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return [n === 0 ? base : `${base}-${n}`];
    }),
  );
}

/** A link's anchor as GitHub reads it, percent-escapes decoded. */
function decoded(anchor: string): string {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
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
