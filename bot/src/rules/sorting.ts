// A Correction's sorting run (#49, #14): its input, and what plain code makes of the sort it records. The run gets the
// Interest scope, the item before and after the Correction, and what the person wrote, all fenced, with the Hard
// limits listed in our own words. The sort it records is checked here: an Interest scope change must name lines the
// file has, a new Rule may not share a kept Rule's name, an amendment must name a kept Rule the run loaded, and a
// declined Correction must name one of the Hard limits.
import { fence } from '../fence.ts';
import type { StoredSort } from '../store.ts';
import { sameName, SCOPE_NAMES, type Rule, type RuleScope } from './rules.ts';

/** The Hard limits, which no Correction or Rule can change, as the spec names them. */
export const HARD_LIMITS = [
  'No payment details or card-gated trials',
  "No public posting in the person's name",
  'No deleting or trashing mail',
  'No password reuse',
  "No Secret in a model's input or a Discord message",
  'No cancelling an account or waitlist spot, no unsubscribing, and never suggesting either',
] as const;

/** The kinds of item a Correction is made on. Each one's sorts are kept under its kind and id. */
export type CorrectionKind = 'miner' | 'walkthrough';

/** A Correction's key, as its sort is kept under it: `miner:12` or `walkthrough:3`. */
export const sortKey = (kind: CorrectionKind, id: number) => `${kind}:${id}`;

/** The kind and id a Correction's key names, or undefined if it names none. */
export function correctionOf(key: string): { kind: CorrectionKind; id: number } | undefined {
  const m = key.match(/^(miner|walkthrough):(\d+)$/);
  return m ? { kind: m[1] as CorrectionKind, id: Number(m[2]) } : undefined;
}

/** What a Hard limit that declined a Correction says, on its line and in its history. */
export const declinedText = (limit: string) => `declined: a Hard limit forbids it (${limit})`;

/** What a Correction did once the person decided on its proposal, as a commit's message says it. */
export function decidedText(sort: StoredSort): string {
  if (!sort.keptAt) return 'is fix only';
  const kind = sort.proposal!.kind;
  return kind === 'rule' ? 'taught a Rule' : kind === 'amendment' ? 'amended a Rule' : 'changed the Interest scope';
}

/**
 * What came of a Correction's sort, as the item's history says it once nothing more waits on it, with the Rules its run
 * applied.
 */
export function sortNote(sort: StoredSort | undefined): string | null {
  const note = settledSort(sort);
  const rules = sort?.rulesApplied.length ? ` (Rules applied: ${sort.rulesApplied.join(', ')})` : '';
  return note && `${note}${rules}`;
}

function settledSort(sort: StoredSort | undefined): string | null {
  switch (sort?.outcome) {
    case 'fix-only':
      return 'fix only';
    case 'unsorted':
      return `fix only, as it couldn't be sorted: ${sort.why}`;
    case 'declined':
      return declinedText(sort.hardLimit!);
    case 'proposed': {
      const p = sort.proposal!;
      if (sort.discardedAt) return 'fix only, its proposal discarded';
      if (!sort.keptAt) return null;
      if (p.kind === 'interest-scope') return 'changed the Interest scope';
      return `${p.kind === 'rule' ? 'taught' : 'amended'} the Rule "${p.name}"`;
    }
    default:
      return null;
  }
}

/** The person's Interest scope, in the Personal database (#9). */
export const INTEREST_SCOPE_PATH = 'profile/interest-scope.md';

/** How long a Rule's name and statement may be. */
export const RULE_LIMITS = { name: 60, statement: 600 } as const;

/** What a sort proposes for the person to keep, edit or discard. */
export type Proposal =
  | { kind: 'rule'; name: string; statement: string; scope: RuleScope }
  /** An amendment of a kept Rule: its file, and the statement it had when proposed. */
  | { kind: 'amendment'; name: string; scope: RuleScope; path: string; was: string; statement: string }
  /** The Interest scope as it was when proposed, and as it would be. */
  | { kind: 'interest-scope'; before: string; after: string };

/** The item a sorted Correction was made on, as its card and a kept Rule's front matter name it. */
export interface SortedItem {
  /** Its name and day as Discord shows them: `Ancher 2.0` and `Mon Oct 12`. */
  name: string;
  day: string;
  /** As a Rule's front matter names the item it was taught on: `Launch 1266729 (Ancher 2.0) of Mon 2026-10-12 PT`. */
  taughtOn: string;
  scope: RuleScope;
  /** What the person wrote. */
  correction: string;
}

/** What a sort comes to: fix only, declined for a Hard limit, or a proposal for the person. */
export type Sort = { outcome: 'fix-only' } | { outcome: 'declined'; hardLimit: string } | { outcome: 'proposed'; proposal: Proposal };

export interface SortInput {
  interestScope: string;
  /** What the person corrected, such as "a Miner judgment". */
  what: string;
  scope: RuleScope;
  /** The item, as prompt lines with every outside value fenced. */
  item: string[];
  before: string;
  after: string;
  correction: string;
}

export function sortingPrompt(input: SortInput): string {
  return [
    'Interest scope:',
    fence(input.interestScope),
    '',
    `The person corrected ${input.what}, and the Assistant has redone it with their Correction. Sort the Correction, and record it with record_sort.`,
    `The Correction's scope is ${input.scope}, ${SCOPE_NAMES[input.scope]}: a Rule it teaches has scope ${input.scope}, or all.`,
    '',
    ...input.item,
    '',
    'Before the Correction:',
    fence(input.before),
    'Their Correction, what they say it got wrong:',
    fence(input.correction),
    'After the Correction:',
    fence(input.after),
    '',
    'The Hard limits, which no Correction or Rule can change:',
    ...HARD_LIMITS.map((limit) => `- ${limit}`),
  ].join('\n');
}

type Read = { ok: true; sort: Sort; rulesApplied: string[] } | { ok: false; error: string };

/**
 * Checks a sort from a run against the Correction's scope, the kept Rules the run loaded and the Interest scope it was
 * given. Parts the sort doesn't use are ignored. The extension's schema checked its shape once already.
 */
export function readSort(record: unknown, context: { scope: RuleScope; rules: readonly Rule[]; interestScope: string }): Read {
  const r = (record as { kind?: unknown; record?: Record<string, unknown> } | null) ?? {};
  if (r.kind !== 'sort' || typeof r.record !== 'object' || r.record === null) return { ok: false, error: 'Expected a sort record.' };
  const read = readOutcome(r.record, context);
  if (!read.ok) return read;
  // The run checked each name against its own Rules already.
  const named = r.record.rulesApplied;
  return { ...read, rulesApplied: Array.isArray(named) ? named.filter((n): n is string => typeof n === 'string') : [] };
}

type Outcome = { ok: true; sort: Sort } | { ok: false; error: string };

function readOutcome(record: Record<string, unknown>, context: { scope: RuleScope; rules: readonly Rule[]; interestScope: string }): Outcome {
  const { sort, changes, rule, hardLimit } = record;
  switch (sort) {
    case 'fix-only':
      return { ok: true, sort: { outcome: 'fix-only' } };
    case 'declined': {
      const limit = HARD_LIMITS.find((l) => same(l, hardLimit));
      if (!limit) return { ok: false, error: `hardLimit must be one of the Hard limits, exactly as the message lists it.` };
      return { ok: true, sort: { outcome: 'declined', hardLimit: limit } };
    }
    case 'interest-scope': {
      if (!Array.isArray(changes) || changes.length === 0) return { ok: false, error: 'An interest-scope sort needs at least one change.' };
      const changed = applyChanges(context.interestScope, changes as Change[]);
      if (!changed.ok) return changed;
      const proposal: Proposal = { kind: 'interest-scope', before: context.interestScope, after: changed.after };
      return { ok: true, sort: { outcome: 'proposed', proposal } };
    }
    case 'rule':
      return readRuleSort(rule, context);
    default:
      return { ok: false, error: 'sort must be fix-only, interest-scope, rule or declined.' };
  }
}

function readRuleSort(value: unknown, context: { scope: RuleScope; rules: readonly Rule[] }): Outcome {
  const rule = (value ?? {}) as Record<string, unknown>;
  if (typeof value !== 'object' || value === null) return { ok: false, error: 'A rule sort needs its rule.' };
  const checked = checkRuleText(rule.name, rule.statement);
  if (!checked.ok) return checked;
  const { name, statement } = checked;
  const kept = context.rules.find((r) => same(r.name, name));
  if (rule.amends === true) {
    if (!kept) {
      const names = context.rules.map((r) => `"${r.name}"`).join(', ');
      const amend = names ? `Amend one of ${names}, or` : 'There is none to amend, so';
      return { ok: false, error: `No kept Rule is named "${name}". ${amend} set amends to false for a new Rule.` };
    }
    if (kept.statement === statement) {
      return { ok: false, error: `That is "${kept.name}" as it is kept. Amend its statement, or sort the Correction otherwise.` };
    }
    const proposal: Proposal = { kind: 'amendment', name: kept.name, scope: kept.scope, path: kept.path, was: kept.statement, statement };
    return { ok: true, sort: { outcome: 'proposed', proposal } };
  }
  if (kept) return { ok: false, error: `A Rule named "${kept.name}" is kept already. Amend it, with amends true, or name the new Rule differently.` };
  const scope = rule.scope === 'all' ? 'all' : rule.scope === context.scope ? context.scope : undefined;
  if (!scope) return { ok: false, error: `scope must be ${context.scope} or all.` };
  return { ok: true, sort: { outcome: 'proposed', proposal: { kind: 'rule', name, statement, scope } } };
}

/** A Rule's name and statement, as the run or the person wrote them, or why they can't be kept. */
export function checkRuleText(name: unknown, statement: unknown): { ok: true; name: string; statement: string } | { ok: false; error: string } {
  const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  const s = typeof statement === 'string' ? statement.trim() : '';
  if (!n || n.length > RULE_LIMITS.name || !/[\p{L}\p{N}]/u.test(n)) {
    return { ok: false, error: `A Rule's name is one line of at most ${RULE_LIMITS.name} characters, with letters or digits.` };
  }
  if (!s || s.length > RULE_LIMITS.statement) return { ok: false, error: `A Rule's statement is at most ${RULE_LIMITS.statement} characters.` };
  return { ok: true, name: n, statement: s };
}

interface Change {
  section: unknown;
  remove: unknown;
  add: unknown;
}

/** The Interest scope with the changes made, or why one can't be: each names a section and a line it has. */
function applyChanges(file: string, changes: Change[]): { ok: true; after: string } | { ok: false; error: string } {
  const lines = file.replace(/\r\n?/g, '\n').split('\n');
  for (const [i, change] of changes.entries()) {
    const at = `changes[${i}]`;
    const heading = lines.findIndex((l) => /^#{1,6}\s/.test(l) && same(l.replace(/^#{1,6}\s+/, ''), change.section));
    if (heading < 0) {
      const sections = lines.filter((l) => /^#{1,6}\s/.test(l)).map((l) => `"${l.replace(/^#{1,6}\s+/, '').trim()}"`);
      return { ok: false, error: `${at}: the Interest scope has no section "${String(change.section)}". Its sections are ${sections.join(', ')}.` };
    }
    let end = lines.findIndex((l, j) => j > heading && /^#{1,6}\s/.test(l));
    if (end < 0) end = lines.length;
    const bullets = [...lines.keys()].filter((j) => j > heading && j < end && /^\s*[-*]\s+/.test(lines[j]!));
    const add = typeof change.add === 'string' && change.add.trim() ? `- ${change.add.replace(/\s+/g, ' ').trim()}` : undefined;
    if (typeof change.remove === 'string' && change.remove.trim()) {
      const found = bullets.find((j) => same(lines[j]!.replace(/^\s*[-*]\s+/, ''), change.remove));
      if (found === undefined) return { ok: false, error: `${at}: "${change.remove}" isn't a line of the section, as the Interest scope has it.` };
      if (add) lines[found] = add;
      else lines.splice(found, 1);
    } else if (add) {
      lines.splice((bullets.at(-1) ?? heading) + 1, 0, add);
    } else {
      return { ok: false, error: `${at} must add, remove or reword a line.` };
    }
  }
  const after = lines.join('\n');
  if (after === file) return { ok: false, error: 'The changes leave the Interest scope as it is.' };
  return { ok: true, after };
}

/** Whether a name or line from the run says the same as ours, whatever its case and spacing. */
const same = (a: string, b: unknown) => typeof b === 'string' && sameName(a, b);
