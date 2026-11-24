// Rules (ADR 0002, #14): each kept Rule is one Markdown file in the Personal database, `rules/<scope>/<slug>.md`, with
// front matter for its scope, the item it was taught on, its case and its creation date, then its name as a heading
// and its statement. Git is the source of truth for Rules, so the person may write or edit one there, and the bot reads
// them back: every run loads the all scope's Rules and those of its own scope, as one commit holds them, and our Pi
// extension puts them into the run's prompt. A Rule is known by its name, which records cite in `rulesApplied`.
import type { RunKind } from '../config.ts';
import type { PersonalDatabase } from '../personal-database.ts';

export const RULE_SCOPES = ['miner', 'dossier', 'registration', 'mail', 'all'] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];

/** Each scope as the person reads it. Its folder is its id. */
export const SCOPE_NAMES: Record<RuleScope, string> = {
  miner: 'Miner',
  dossier: 'Dossier',
  registration: 'Walkthrough/Registration',
  mail: 'mail',
  all: 'all',
};

/**
 * The scope of each run kind's own Rules, beside the all scope's. A Question loads the all scope alone, and a
 * Correction's sorting run loads the scope of the Correction it sorts.
 */
const KIND_SCOPES: Record<RunKind, RuleScope | null> = {
  'miner-judging': 'miner',
  dossier: 'dossier',
  'walkthrough-preparation': 'registration',
  'amended-walkthrough': 'registration',
  fill: 'registration',
  mail: 'mail',
  question: null,
  'correction-sorting': null,
};

/** The scopes a run loads: the all scope, then its own. */
export function loadedScopes(kind: RunKind, scope?: RuleScope): RuleScope[] {
  const own = scope ?? KIND_SCOPES[kind];
  return own && own !== 'all' ? ['all', own] : ['all'];
}

export interface Rule {
  /** What records cite it by: its heading, or its file's slug when it has none. */
  name: string;
  scope: RuleScope;
  /** Its file in the Personal database. */
  path: string;
  /** What it says, below its heading. */
  statement: string;
  /** Its front matter, line by line, as the file holds it. */
  frontMatter: string[];
}

/** The Rules loaded into a run, and the Personal database commit they were read at. */
export interface RuleSet {
  commit: string;
  rules: Rule[];
}

/** `rules/<scope>/<slug>.md`: a Rule's own file, never a fixture beside it. */
const RULE_PATH = /^rules\/([a-z]+)\/([^/]+)\.md$/;

/** Whether a path in the Personal database is a Rule file of one of these scopes. */
export function isRulePath(path: string, scopes: readonly RuleScope[]): boolean {
  const scope = path.match(RULE_PATH)?.[1];
  return scopes.some((s) => s === scope);
}

/**
 * A Rule file as the person or the bot wrote it. The scope comes from its folder, and any front matter is kept as it
 * is, so a file with none, or with lines the bot doesn't know, still loads.
 */
export function readRule(path: string, content: string): Rule {
  const [, scope, slug] = path.match(RULE_PATH)!;
  let body = content.replace(/\r\n?/g, '\n');
  let frontMatter: string[] = [];
  const fenced = body.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (fenced) {
    frontMatter = fenced[1]!.split('\n');
    body = body.slice(fenced[0].length);
  }
  const heading = body.match(/^[ \t]*# +(.+?)[ \t]*#*[ \t]*$/m);
  const name = heading?.[1]?.trim() || slug!;
  const statement = (heading ? body.slice(body.indexOf(heading[0]) + heading[0].length) : body).trim();
  return { name, scope: scope as RuleScope, path, statement, frontMatter };
}

/**
 * The Rules section that closes a run's system prompt. Each Rule is given whole, under its name, so loading it never
 * depends on the model choosing to read it.
 */
export function rulesPrompt(rules: readonly Rule[]): string {
  if (rules.length === 0) return '## Rules\n\nNo Rules are kept for this kind of run, so rulesApplied is always an empty list.';
  return [
    '## Rules',
    '',
    'The person kept these Rules. Apply each one wherever it bears on your work, as it is written. In rulesApplied, list the name of each Rule you applied, exactly as it follows "Rule:", and leave it empty when none applied.',
    ...rules.flatMap((r) => ['', `Rule: ${r.name}`, `Scope: ${SCOPE_NAMES[r.scope]}`, r.statement]),
  ].join('\n');
}

/** About how many tokens a text takes in a prompt: four characters a token, rounded up. */
export const tokensOf = (text: string) => Math.ceil(text.length / 4);

type Checked = { ok: true; record: unknown } | { ok: false; error: string };

/**
 * Checks the Rules a run's record names against the Rules the run loaded, and writes each name as its Rule has it.
 * A record whose `rulesApplied` isn't a list of names is left for its own reader to refuse.
 */
export function checkRulesApplied(record: unknown, rules: readonly Rule[]): Checked {
  const inner = (record as { record?: unknown } | null)?.record;
  if (typeof inner !== 'object' || inner === null) return { ok: true, record };
  const named = (inner as { rulesApplied?: unknown }).rulesApplied;
  if (!Array.isArray(named) || !named.every((n) => typeof n === 'string')) return { ok: true, record };
  const byName = new Map(rules.map((r) => [nameKey(r.name), r.name]));
  const unknown = named.filter((n) => !byName.has(nameKey(n)));
  if (unknown.length > 0) {
    const loaded =
      rules.length > 0 ? `This run's Rules are: ${rules.map((r) => r.name).join('; ')}.` : 'This run has no Rules, so rulesApplied must be empty.';
    return { ok: false, error: `rulesApplied names ${unknown.map((n) => `"${n}"`).join(', ')}, which isn't one of this run's Rules. ${loaded}` };
  }
  const rulesApplied = [...new Set(named.map((n) => byName.get(nameKey(n))!))];
  return { ok: true, record: { ...(record as object), record: { ...inner, rulesApplied } } };
}

const nameKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

/** Whether two Rule names are the same name, whatever their case and spacing. */
export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);

/** The Rules of these scopes as the Personal database's checkout last committed them, in scope order, then by file. */
export async function loadRules(personalDatabase: Pick<PersonalDatabase, 'filesAt'>, scopes: readonly RuleScope[]): Promise<RuleSet> {
  const { commit, files } = await personalDatabase.filesAt('rules', (path) => isRulePath(path, scopes));
  const rules = files.map((f) => readRule(f.path, f.content));
  const order = (r: Rule) => scopes.indexOf(r.scope);
  return { commit, rules: rules.sort((a, b) => order(a) - order(b) || a.path.localeCompare(b.path)) };
}

/** A Rule's file name from its name: `Waitlist isn't open signup` is `waitlist-isnt-open-signup`. */
export function ruleSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 60).replace(/-+$/, '') || 'rule';
}

/** A new Rule's file, as Keep commits it. Its case is unproven until it has one (#50). */
export function ruleFile(rule: { name: string; statement: string; scope: RuleScope; taughtOn: string; created: string }): string {
  const frontMatter = [`scope: ${rule.scope}`, 'taught-on:', `  - ${rule.taughtOn}`, 'case: unproven', `created: ${rule.created}`];
  return fileOf(frontMatter, rule.name, rule.statement);
}

/**
 * A kept Rule's file with its statement amended: its front matter stays as it was, with the item this amendment was
 * taught on added to the items it was taught on, and when it was amended.
 */
export function amendedRuleFile(rule: Rule, amendment: { statement: string; taughtOn: string; amended: string }): string {
  const lines = [...rule.frontMatter];
  const at = lines.findIndex((l) => /^taught-on:/.test(l));
  if (at < 0) {
    lines.push('taught-on:', `  - ${amendment.taughtOn}`);
  } else {
    const one = lines[at]!.replace(/^taught-on:\s*/, '').trim();
    let end = at + 1;
    while (end < lines.length && /^\s+-\s/.test(lines[end]!)) end++;
    lines.splice(at, end - at, 'taught-on:', ...(one ? [`  - ${one}`] : lines.slice(at + 1, end)), `  - ${amendment.taughtOn}`);
  }
  const amended = lines.findIndex((l) => /^amended:/.test(l));
  if (amended >= 0) lines[amended] = `amended: ${amendment.amended}`;
  else lines.push(`amended: ${amendment.amended}`);
  return fileOf(lines, rule.name, amendment.statement);
}

const fileOf = (frontMatter: string[], name: string, statement: string) =>
  ['---', ...frontMatter, '---', '', `# ${name}`, '', statement, ''].join('\n');

/**
 * The run scope whose Rules would take the most of the Rule budget with this Rule in place of any at its path, and how
 * many tokens they would take. An all-scope Rule loads with every scope, so each one is measured.
 */
export function heaviestLoad(rules: readonly Rule[], changed: Rule): { scope: RuleScope; tokens: number } {
  const after = [...rules.filter((r) => r.path !== changed.path), changed];
  const scopes = changed.scope === 'all' ? RULE_SCOPES.filter((s) => s !== 'all') : [changed.scope];
  return scopes
    .map((scope) => ({ scope, tokens: tokensOf(rulesPrompt(after.filter((r) => r.scope === 'all' || r.scope === scope))) }))
    .reduce((a, b) => (b.tokens > a.tokens ? b : a));
}
