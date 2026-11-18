// `npm run ticket -- <number>`: prints a ticket whole (#87): its number, state, title, labels, body and comments, then
// its parent's, then each issue that mentions it with the lines that do. A `Spec:` parent prints its headings in place
// of its body (#95). With `--heading <words>`, once or more, it prints only the parts of the issue's body and comments
// whose heading names those words, such as #40's §8, which #48 was decided in (the #48 retro). Either way it prints
// only text that the repo's owner and collaborators wrote in the repo, since the tracker is public (#112): anything
// else stands as one line naming its author, date and page, and the output ends by counting it. It asks GitHub through
// `gh api`, whose JSON is the same with or without a terminal, and prints nothing until every answer is in, so a
// failure prints only why. The outside review reads the tracker through it too (#114), with what this exports.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
/** How long each `gh` call has to answer, every page included. */
const TIME_LIMIT_SECONDS = 60;
/** The most a `gh` call may print: a timeline holds a whole issue for each cross-reference. */
const MAX_ANSWER_BYTES = 256 * 1024 * 1024;
const USAGE =
  'give one issue number, as in npm run ticket -- 87, and any parts of it by heading, as in npm run ticket -- 40 --heading "8."';

/** The fields of a REST issue this reads. */
export interface Issue {
  /** Its API URL, which names its repo too. */
  url: string;
  /** Its page on GitHub. */
  html_url: string;
  number: number;
  title: string;
  state: string;
  labels: { name: string }[];
  /** Who opened it, and so wrote its title and body, or `null` when GitHub names no one. */
  user: User | null;
  created_at: string;
  body: string | null;
  comments_url: string;
  repository_url: string;
  /** Set only on a pull request, which GitHub serves as an issue too. */
  pull_request?: unknown;
}

/** The fields of a REST user this reads. */
export interface User {
  login: string;
}

/** The fields of a REST issue comment this reads. */
interface Comment {
  /** Its author, or `null` when GitHub names no one. */
  user: User | null;
  created_at: string;
  /** Its page on GitHub. */
  html_url: string;
  body: string | null;
}

/** The fields of a REST timeline event this reads: a cross-reference's source is the issue that mentions this one. */
interface TimelineEvent {
  event: string;
  source?: { issue?: Issue };
}

/** What `gh api` answers on `args`, parsed, or `undefined` when GitHub answers 404. Throws with gh's error otherwise. */
export async function api(args: string[]): Promise<unknown> {
  const call = `gh api ${args.at(-1)}`;
  let stdout: string;
  try {
    ({ stdout } = await run('gh', ['api', ...args], { timeout: TIME_LIMIT_SECONDS * 1000, maxBuffer: MAX_ANSWER_BYTES }));
  } catch (error) {
    const { stderr, killed, code } = error as { stderr?: string; killed?: boolean; code?: unknown };
    // gh prints GitHub's own message with the status, as in "gh: No parent issue found (HTTP 404)".
    if (stderr?.includes('(HTTP 404)')) return undefined;
    if (code === 'ENOENT') throw new Error("gh isn't on PATH: install GitHub CLI and sign in with gh auth login");
    if (killed) throw new Error(`${call} didn't answer within ${TIME_LIMIT_SECONDS} seconds`);
    throw new Error(`${call} failed: ${stderr?.trim() || (error as Error).message}`);
  }
  return JSON.parse(stdout);
}

/** Every item of a paged list, across all its pages. */
export async function apiList<T>(endpoint: string): Promise<T[]> {
  const pages = (await api(['--paginate', '--slurp', endpoint])) as T[][] | undefined;
  if (!pages) throw new Error(`gh api ${endpoint} found nothing there (HTTP 404)`);
  return pages.flat();
}

/** `text` with GitHub's CRLF line ends made LF. */
function lf(text: string | null): string {
  return (text ?? '').replace(/\r\n/g, '\n');
}

/** Who wrote a body or comment: its author's login, or `ghost` when GitHub names no one. */
const author = (user: User | null) => user?.login ?? 'ghost';

/** `n` of `thing`, as in "1 comment" or "2 comments". */
const count = (n: number, thing: string) => `${n} ${thing}${n === 1 ? '' : 's'}`;

/** `items` as an English list, as in "a, b and c". */
const list = (items: string[]) => [items.slice(0, -1).join(', '), items.at(-1)].filter(Boolean).join(' and ');

/** Who wrote an issue or a comment, when, and its page: the line that stands for it when it is withheld. */
const byline = (text: Issue | Comment) => `${author(text.user)}, ${text.created_at}, ${text.html_url}`;

/** The line a comment prints under, naming who wrote it and when. */
const commentHeader = (comment: Comment) => `--- ${author(comment.user)}, ${comment.created_at}:`;

/** A repo as `owner/name`, from its API URL or an API URL under it. */
const repoOf = (apiUrl: string) => /\/repos\/([^/]+\/[^/]+)/.exec(apiUrl)?.[1] ?? apiUrl;

/** What was withheld from one issue. */
interface Withheld {
  /** All of it, as an issue in another repo. */
  elsewhere: boolean;
  /** Its title, opened by someone else. */
  title: boolean;
  /** Its body, opened by someone else. */
  body: boolean;
  /** The pages of its comments by others, each counted once though an issue can print as parent and mentioner. */
  comments: Set<string>;
}

/**
 * Whose text this prints, and what it withheld (#112). The tracker is public, and a session takes what this prints as
 * the ticket's spec, so a stranger's text could steer it. Only text that the ticket's repo's owner and collaborators
 * wrote in that repo prints: anything else stands as one line that names its author, date and page, and is counted
 * at the end. An issue in another repo is withheld whole, since that repo's writers can edit any comment in it, the
 * owner's too, and it still shows the owner as its author (asked on #112).
 */
export class Trust {
  /** The ticket's repo, as its API URL. */
  readonly home: string;
  /** The ticket's repo, as `owner/name`. */
  readonly #repo: string;
  readonly #logins: Set<string>;
  /** What was withheld from each issue, by the issue's name, in the order the output prints them. */
  readonly #withheld = new Map<string, Withheld>();

  /** Trusts the owner of `home`, the ticket's repo as its API URL, and `collaborators`, the repo's. */
  constructor(home: string, collaborators: User[]) {
    this.home = home;
    this.#repo = repoOf(home);
    const [owner] = this.#repo.split('/');
    this.#logins = new Set([owner!, ...collaborators.map((user) => user.login)]);
  }

  /** Whether the repo's owner or one of its collaborators is `user`. */
  trusts(user: User | null): boolean {
    return user !== null && this.#logins.has(user.login);
  }

  /** Whether `issue` is in another repo than the ticket's. */
  elsewhere(issue: Issue): boolean {
    return issue.repository_url !== this.home;
  }

  /** An issue's number, with its repo before it when it isn't the ticket's. */
  name(issue: Issue): string {
    return `${this.elsewhere(issue) ? repoOf(issue.repository_url) : ''}#${issue.number}`;
  }

  /** What was withheld from `issue` so far, which the caller adds to. */
  #from(issue: Issue): Withheld {
    const name = this.name(issue);
    const withheld = this.#withheld.get(name) ?? { elsewhere: false, title: false, body: false, comments: new Set() };
    this.#withheld.set(name, withheld);
    return withheld;
  }

  /** Counts the body of `issue`, which someone else opened, as withheld. */
  withholdBody(issue: Issue): void {
    this.#from(issue).body = true;
  }

  /** Counts `comment` on `issue`, which someone else wrote, as withheld. */
  withholdComment(issue: Issue, comment: Comment): void {
    this.#from(issue).comments.add(comment.html_url);
  }

  /** Counts all of `issue`, an issue in another repo, as withheld, and gives the line that stands for it. */
  withholdAll(issue: Issue): string {
    this.#from(issue).elsewhere = true;
    return `Withheld, as an issue in another repo: ${byline(issue)}`;
  }

  /** Counts the title and body of `issue`, which someone else opened, as withheld, and gives the line for them. */
  withholdTitleAndBody(issue: Issue): string {
    Object.assign(this.#from(issue), { title: true, body: true });
    return `Title and body withheld: ${byline(issue)}`;
  }

  /** `comment` on `issue`, as a header line and its text, or as one line when it is withheld. */
  comment(issue: Issue, comment: Comment): string {
    if (this.trusts(comment.user)) return `${commentHeader(comment)}\n${lf(comment.body)}\n`;
    this.withholdComment(issue, comment);
    return `${commentHeader(comment)} withheld, ${comment.html_url}\n`;
  }

  /** The lines the output ends with: what was withheld and whose it is to read, or nothing when nothing was. */
  summary(): string {
    if (this.#withheld.size === 0) return '';
    const counts = [...this.#withheld].map(([name, withheld]) => {
      if (withheld.elsewhere) return `all of ${name}, an issue in another repo`;
      const what: string[] = [];
      if (withheld.title) what.push('the title');
      if (withheld.body) what.push('the body');
      if (withheld.comments.size > 0) what.push(count(withheld.comments.size, 'comment'));
      return `${list(what)} by others on ${name}`;
    });
    return [
      '',
      `Withheld: ${counts.join('; ')}.`,
      `Only text written in ${this.#repo} by its owner and collaborators prints here, since anyone can write on a public tracker.`,
      "What was withheld is the person's to read and relay: ask them, rather than reading it on GitHub.",
      '',
    ].join('\n');
  }
}

/** An issue's number and state, as its heading starts. */
const numberAndState = (issue: Issue, trust: Trust) => `${trust.name(issue)} ${issue.state.toUpperCase()}`;

/** An issue's number, state and title. */
const heading = (issue: Issue, trust: Trust) => `${numberAndState(issue, trust)} ${issue.title}`;

/**
 * An issue's heading and labels, body and comments, as one block of text. An issue someone else opened prints its title
 * only when it is the ticket asked for, `asked`. An issue in another repo prints only its number and state, and a
 * line that says so: its comments go unread.
 */
function issueText(issue: Issue, comments: Comment[], trust: Trust, asked = false): string {
  if (trust.elsewhere(issue)) return `${numberAndState(issue, trust)}\n\n${trust.withholdAll(issue)}\n`;
  const labels = ` [${issue.labels.map((label) => label.name).join(', ')}]`;
  let text: string;
  if (trust.trusts(issue.user)) text = `${heading(issue, trust)}${labels}\n\n${lf(issue.body)}\n`;
  else if (asked) {
    trust.withholdBody(issue);
    text = `${heading(issue, trust)}${labels}\n\nBody withheld: ${byline(issue)}\n`;
  } else text = `${numberAndState(issue, trust)}${labels}\n\n${trust.withholdTitleAndBody(issue)}\n`;
  for (const comment of comments) text += `\n${trust.comment(issue, comment)}`;
  return text;
}

/** A Markdown heading: its line, the line's index in its text, and its level, 1 for `#`. */
interface Heading {
  line: string;
  index: number;
  level: number;
}

/** The Markdown headings of `text`, in order, leaving out the lines GitHub shows inside a fenced code block. */
function markdownHeadings(text: string): Heading[] {
  const found: Heading[] = [];
  let fence: string | undefined;
  for (const [index, line] of text.split('\n').entries()) {
    // A backtick fence's info string holds no backtick. A fence closes on a bare marker of its own character, at least
    // as long as the one that opened it.
    const opening = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/.exec(line)?.[1];
    const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
    const marks = /^ {0,3}(#{1,6})(\s|$)/.exec(line)?.[1];
    if (!fence && opening) fence = opening;
    else if (fence && closing && closing[0] === fence[0] && closing.length >= fence.length) fence = undefined;
    else if (!fence && marks) found.push({ line, index, level: marks.length });
  }
  return found;
}

/** Whether a heading names any of `words`, ignoring case. */
const names = (heading: Heading, words: string[]) =>
  words.some((word) => heading.line.replace(/^ *#+\s*/, '').toLowerCase().includes(word.toLowerCase()));

/** The parts of `text` whose heading names any of `words`, each from its heading to the next of its level or above. */
function partsOf(text: string, words: string[]): string[] {
  const lines = text.split('\n');
  const headings = markdownHeadings(text);
  const parts: string[] = [];
  let taken = 0;
  for (const [i, heading] of headings.entries()) {
    // A heading inside a part already taken is printed with it.
    if (heading.index < taken || !names(heading, words)) continue;
    taken = headings.slice(i + 1).find((next) => next.level <= heading.level)?.index ?? lines.length;
    parts.push(lines.slice(heading.index, taken).join('\n').trimEnd());
  }
  return parts;
}

/** Whether `issue` is a spec, which its tickets have as their parent: its title starts with `Spec:`. */
const isSpec = (issue: Issue) => issue.title.startsWith('Spec:');

/**
 * A spec parent: its heading and labels, the headings of its body, its comments, and how to print it whole or in part.
 * A spec is the plan its tickets were cut from, and each ticket reaches into it only for the parts it names.
 */
function specText(spec: Issue, comments: Comment[], trust: Trust): string {
  const outline = { ...spec, body: markdownHeadings(lf(spec.body)).map((heading) => heading.line).join('\n') };
  const print = `npm run ticket -- ${spec.number}`;
  return `${issueText(outline, comments, trust)}\nPrint the spec whole with ${print}, or only the parts you need with ${print} --heading "<words>".\n`;
}

/**
 * The issue `mentioner` as a heading, then each line of its body and `comments` that names `#n`, indented. A body or
 * comment someone else wrote stands as one line instead, as does the issue's title when they opened it, and a comment
 * of theirs that doesn't name `#n` is left out, as anyone's is. An issue in another repo prints only its number and
 * state, and a line that says so: its comments go unread.
 */
function mention(n: number, mentioner: Issue, comments: Comment[], trust: Trust): string {
  const namesN = new RegExp(`#${n}\\b`);
  const linesNamingN = (text: string | null) => lf(text).split('\n').filter((line) => namesN.test(line));
  const indented = (text: string | null) => linesNamingN(text).map((line) => `  ${line}\n`).join('');
  if (trust.elsewhere(mentioner)) return `${numberAndState(mentioner, trust)}\n  ${trust.withholdAll(mentioner)}\n`;
  let text = trust.trusts(mentioner.user)
    ? `${heading(mentioner, trust)}\n${indented(mentioner.body)}`
    : `${numberAndState(mentioner, trust)}\n  ${trust.withholdTitleAndBody(mentioner)}\n`;
  for (const comment of comments) {
    if (trust.trusts(comment.user)) text += indented(comment.body);
    else if (linesNamingN(comment.body).length > 0) {
      trust.withholdComment(mentioner, comment);
      text += `  Comment withheld: ${byline(comment)}\n`;
    }
  }
  return text;
}

/** The repo's collaborators, asked of GitHub once a run, however many issues the run prints. */
let collaborators: Promise<User[]> | undefined;

/** Whose text this prints, for a ticket in the repo whose API URL is `home`. */
export async function trustIn(home: string): Promise<Trust> {
  collaborators ??= apiList<User>('repos/{owner}/{repo}/collaborators');
  return new Trust(home, await collaborators);
}

/** Issue `n`, which GitHub must have and which can't be a pull request. */
export async function issueNumbered(n: number): Promise<Issue> {
  const issue = (await api([`repos/{owner}/{repo}/issues/${n}`])) as Issue | undefined;
  if (!issue) throw new Error(`#${n} names no issue in this repo (gh api answered 404)`);
  if (issue.pull_request) throw new Error(`#${n} is a pull request, not an issue: see it with gh pr view ${n}`);
  return issue;
}

/**
 * Only the parts of issue `n` whose heading names any of `words`: from its body, then from each comment, under the
 * line that says whose it is. It searches only trusted text, and ends with what it withheld unsearched. Fails, listing
 * the headings of that text, on a word that names none of them.
 */
async function parts(n: number, words: string[]): Promise<string> {
  const issue = await issueNumbered(n);
  const [trust, comments] = await Promise.all([trustIn(issue.repository_url), apiList<Comment>(issue.comments_url)]);
  // Each trusted text, with the comment that holds it, or none for the body.
  const texts: { text: string; comment?: Comment }[] = [];
  if (trust.trusts(issue.user)) texts.push({ text: lf(issue.body) });
  else trust.withholdBody(issue);
  for (const comment of comments) {
    if (trust.trusts(comment.user)) texts.push({ text: lf(comment.body), comment });
    else trust.withholdComment(issue, comment);
  }
  const withheld = trust.summary();
  const headings = texts.flatMap(({ text }) => markdownHeadings(text));
  const unnamed = words.filter((word) => !headings.some((heading) => names(heading, [word])));
  if (unnamed.length > 0) {
    const asked = unnamed.map((word) => `"${word}"`).join(' or ');
    const known = headings.map((heading) => heading.line).join('\n');
    throw new Error(`no heading of #${n} names ${asked}. Its headings:\n${known}${withheld && `\n${withheld.trimEnd()}`}`);
  }
  let text = `${heading(issue, trust)} [${issue.labels.map((label) => label.name).join(', ')}]\n`;
  for (const { text: body, comment } of texts) {
    const found = partsOf(body, words);
    if (found.length === 0) continue;
    text += `\n${comment ? `${commentHeader(comment)}\n` : ''}${found.join('\n\n')}\n`;
  }
  return `${text}\nPrint it whole with npm run ticket -- ${n}.\n${withheld}`;
}

/** Ticket `n` whole, then its parent, then each issue that mentions it: what `npm run ticket -- <n>` prints. */
export async function ticket(n: number): Promise<string> {
  const issue = await issueNumbered(n);
  const [trust, comments, parent, timeline] = await Promise.all([
    trustIn(issue.repository_url),
    apiList<Comment>(issue.comments_url),
    api([`repos/{owner}/{repo}/issues/${n}/parent`]) as Promise<Issue | undefined>,
    apiList<TimelineEvent>(`repos/{owner}/{repo}/issues/${n}/timeline`),
  ]);
  // An issue that names this one more than once cross-references it once for each. One in another repo can have the
  // number of one in this repo, so each is kept by its URL.
  const mentioners = new Map<string, Issue>();
  for (const event of timeline) {
    const source = event.event === 'cross-referenced' ? event.source?.issue : undefined;
    if (source) mentioners.set(source.url, source);
  }
  const sorted = [...mentioners.values()].sort((a, b) => a.number - b.number);
  const commentsOn = (other: Issue) => (trust.elsewhere(other) ? [] : apiList<Comment>(other.comments_url));
  const [parentComments, mentionerComments] = await Promise.all([
    parent ? commentsOn(parent) : [],
    Promise.all(sorted.map(commentsOn)),
  ]);
  // Each part is built in the order it prints, so the count of what was withheld lists it in that order too.
  const text = issueText(issue, comments, trust, true);
  // A spec is told by its title, which counts only when its author is trusted.
  const spec = parent && isSpec(parent) && trust.trusts(parent.user) && !trust.elsewhere(parent);
  let parentText = `#${n} has no parent.\n`;
  if (parent && spec) parentText = specText(parent, parentComments, trust);
  else if (parent) parentText = issueText(parent, parentComments, trust);
  const mentions = sorted.map((mentioner, i) => mention(n, mentioner, mentionerComments[i]!, trust));
  return [
    text,
    `=== Parent\n\n${parentText}`,
    `=== Mentioned by\n\n${mentions.join('') || `No other issue mentions #${n}.\n`}`,
  ].join('\n') + trust.summary();
}

if (import.meta.main) {
  try {
    const [number, ...rest] = process.argv.slice(2);
    const n = /^#?([1-9]\d*)$/.exec(number ?? '')?.[1];
    // Each heading asked for comes as `--heading <words>`.
    const words: string[] = [];
    for (let i = 0; i < rest.length; i += 2) {
      const word = rest[i + 1]?.trim();
      if (rest[i] !== '--heading' || !word) throw new Error(USAGE);
      words.push(word);
    }
    if (!n) throw new Error(USAGE);
    process.stdout.write(words.length > 0 ? await parts(Number(n), words) : await ticket(Number(n)));
  } catch (error) {
    process.stderr.write(`ticket: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
