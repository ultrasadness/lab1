// `npm run ticket -- <number>`: prints a ticket whole (#87): its number, state, title, labels, body and comments, then
// its parent's, then each issue that mentions it with the lines that do. A `Spec:` parent prints its headings in place
// of its body (#95). With `--heading <words>`, once or more, it prints only the parts of the issue's body and comments
// whose heading names those words, such as #40's §8, which #48 was decided in (the #48 retro). It asks GitHub through
// `gh api`, whose JSON is the same with or without a terminal, and prints nothing until every answer is in, so a
// failure prints only why.
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
interface Issue {
  /** Its API URL, which names its repo too. */
  url: string;
  number: number;
  title: string;
  state: string;
  labels: { name: string }[];
  body: string | null;
  comments_url: string;
  repository_url: string;
  /** Set only on a pull request, which GitHub serves as an issue too. */
  pull_request?: unknown;
}

/** The fields of a REST issue comment this reads. */
interface Comment {
  user: { login: string } | null;
  created_at: string;
  body: string | null;
}

/** The fields of a REST timeline event this reads: a cross-reference's source is the issue that mentions this one. */
interface TimelineEvent {
  event: string;
  source?: { issue?: Issue };
}

/** What `gh api` answers on `args`, parsed, or `undefined` when GitHub answers 404. Throws with gh's error otherwise. */
async function api(args: string[]): Promise<unknown> {
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
async function apiList<T>(endpoint: string): Promise<T[]> {
  const pages = (await api(['--paginate', '--slurp', endpoint])) as T[][] | undefined;
  if (!pages) throw new Error(`gh api ${endpoint} found nothing there (HTTP 404)`);
  return pages.flat();
}

/** `text` with GitHub's CRLF line ends made LF. */
function lf(text: string | null): string {
  return (text ?? '').replace(/\r\n/g, '\n');
}

/** An issue's number, state and title, with its repo before the number when it isn't the ticket's repo, `home`. */
function heading(issue: Issue, home: string): string {
  const repo = issue.repository_url === home ? '' : issue.repository_url.replace(/^.*\/repos\//, '');
  return `${repo}#${issue.number} ${issue.state.toUpperCase()} ${issue.title}`;
}

/** An issue's heading and labels, body and comments, as one block of text. */
function issueText(issue: Issue, comments: Comment[], home: string): string {
  const labels = issue.labels.map((label) => label.name).join(', ');
  let text = `${heading(issue, home)} [${labels}]\n\n${lf(issue.body)}\n`;
  for (const comment of comments) {
    text += `\n--- ${comment.user?.login ?? 'ghost'}, ${comment.created_at}:\n${lf(comment.body)}\n`;
  }
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
function specText(spec: Issue, comments: Comment[], home: string): string {
  const outline = { ...spec, body: markdownHeadings(lf(spec.body)).map((heading) => heading.line).join('\n') };
  const print = `npm run ticket -- ${spec.number}`;
  return `${issueText(outline, comments, home)}\nPrint the spec whole with ${print}, or only the parts you need with ${print} --heading "<words>".\n`;
}

/** The issue `mentioner` as a heading, then each line of its body and `comments` that names `#n`, indented. */
function mention(n: number, mentioner: Issue, comments: Comment[], home: string): string {
  const names = new RegExp(`#${n}\\b`);
  const lines = [mentioner.body, ...comments.map((comment) => comment.body)]
    .flatMap((text) => lf(text).split('\n'))
    .filter((line) => names.test(line));
  return `${heading(mentioner, home)}\n${lines.map((line) => `  ${line}\n`).join('')}`;
}

/** Issue `n`, which GitHub must have and which can't be a pull request. */
async function issueNumbered(n: number): Promise<Issue> {
  const issue = (await api([`repos/{owner}/{repo}/issues/${n}`])) as Issue | undefined;
  if (!issue) throw new Error(`#${n} names no issue in this repo (gh api answered 404)`);
  if (issue.pull_request) throw new Error(`#${n} is a pull request, not an issue: see it with gh pr view ${n}`);
  return issue;
}

/**
 * Only the parts of issue `n` whose heading names any of `words`: from its body, then from each comment, under the
 * line that says whose it is. Fails, listing the issue's headings, on a word that names none of them.
 */
async function parts(n: number, words: string[]): Promise<string> {
  const issue = await issueNumbered(n);
  const comments = await apiList<Comment>(issue.comments_url);
  const texts = [lf(issue.body), ...comments.map((comment) => lf(comment.body))];
  const headings = texts.flatMap(markdownHeadings);
  const unnamed = words.filter((word) => !headings.some((heading) => names(heading, [word])));
  if (unnamed.length > 0) {
    const asked = unnamed.map((word) => `"${word}"`).join(' or ');
    throw new Error(`no heading of #${n} names ${asked}. Its headings:\n${headings.map((heading) => heading.line).join('\n')}`);
  }
  let text = `${heading(issue, issue.repository_url)} [${issue.labels.map((label) => label.name).join(', ')}]\n`;
  for (const [i, body] of texts.entries()) {
    const found = partsOf(body, words);
    if (found.length === 0) continue;
    const comment = comments[i - 1];
    text += `\n${comment ? `--- ${comment.user?.login ?? 'ghost'}, ${comment.created_at}:\n` : ''}${found.join('\n\n')}\n`;
  }
  return `${text}\nPrint it whole with npm run ticket -- ${n}.\n`;
}

/** Ticket `n` whole, then its parent, then each issue that mentions it. */
async function ticket(n: number): Promise<string> {
  const issue = await issueNumbered(n);
  const [comments, parent, timeline] = await Promise.all([
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
  const home = issue.repository_url;
  const [parentComments, mentions] = await Promise.all([
    parent ? apiList<Comment>(parent.comments_url) : [],
    Promise.all(
      [...mentioners.values()]
        .sort((a, b) => a.number - b.number)
        .map(async (mentioner) => mention(n, mentioner, await apiList<Comment>(mentioner.comments_url), home)),
    ),
  ]);
  let parentText = `#${n} has no parent.\n`;
  if (parent && isSpec(parent)) parentText = specText(parent, parentComments, home);
  else if (parent) parentText = issueText(parent, parentComments, home);
  return [
    issueText(issue, comments, home),
    `=== Parent\n\n${parentText}`,
    `=== Mentioned by\n\n${mentions.join('') || `No other issue mentions #${n}.\n`}`,
  ].join('\n');
}

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
