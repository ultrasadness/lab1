// A PostToolUse hook (.claude/settings.json): the notes Claude writes the person between tool calls are in Simplified
// Chinese, like the reply that ends a turn (reply-language.ts), as the Language section of CLAUDE.md asks. In #48's
// session most notes were English, and the Stop hook reads only the last reply.
// A tool hook can't see the note just before its own call: Claude Code writes the transcript a message or more behind,
// and the MessageDisplay hook, which does see the text, only changes what the screen shows (both tried in the #48
// retro). So after each tool call this reads the notes of the turn the transcript holds by then, judges each by
// reply-language.ts's rule, and names back to Claude, through the context it adds, the English notes it hasn't named
// before. They are recorded by id in the session's scratchpad.
// Tried on every note in this repo's sessions from 2026-10-19 to 2026-10-22: it names 218 of 780, each one English.
// It says nothing on a subagent's tool call, or when it can't read its input or the transcript.
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notChinese } from './reply-language.ts';

/** The most of the transcript's end the hook reads: a turn's notes are near the end, and a transcript runs to 20 MB. */
const TAIL_BYTES = 4 * 1024 * 1024;
/** How much of a note is quoted back. */
const QUOTE_CHARS = 160;
/** How many named notes the scratchpad remembers. */
const KEPT_IDS = 500;

const HOW = 'Write the notes between tool calls in Simplified Chinese, like your replies, keeping glossary terms (CONTEXT.md) and skill names in English, as the Language section of CLAUDE.md asks.';

interface Entry {
  type?: string;
  uuid?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { content?: unknown };
}

type Block = { type?: string; text?: string };

/** A note: text Claude wrote that a tool call followed in its turn, with an id to remember it by. */
export interface Note {
  id: string;
  text: string;
}

/**
 * The notes of the transcript's last turn. A turn begins at a user entry that holds no tool result and that Claude Code
 * didn't add itself, as it adds a skill's body: the person's prompt, a task's notification or a `!` command.
 */
export function turnNotes(transcript: string): Note[] {
  let notes: Note[] = [];
  let pending: Note[] = [];
  for (const line of transcript.split('\n')) {
    let entry: Entry;
    try {
      entry = JSON.parse(line) as Entry;
    } catch {
      continue;
    }
    if (entry.isSidechain || (entry.type !== 'user' && entry.type !== 'assistant')) continue;
    const content = entry.message?.content;
    const blocks: Block[] = Array.isArray(content) ? (content as Block[]) : [];
    if (entry.type === 'user') {
      if (entry.isMeta !== true && !blocks.some((block) => block.type === 'tool_result')) [notes, pending] = [[], []];
      continue;
    }
    for (const [i, block] of blocks.entries()) {
      if (block.type === 'text' && typeof block.text === 'string') pending.push({ id: `${entry.uuid ?? block.text}#${i}`, text: block.text });
      if (block.type === 'tool_use') [notes, pending] = [[...notes, ...pending], []];
    }
  }
  return notes;
}

/** The transcript's last `bytes`, from the first whole line in them. */
function tail(path: string, bytes: number): string {
  const size = statSync(path).size;
  const start = Math.max(0, size - bytes);
  const buffer = Buffer.alloc(size - start);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, buffer.length, start);
  } finally {
    closeSync(fd);
  }
  const text = buffer.toString('utf8');
  return start === 0 ? text : text.slice(text.indexOf('\n') + 1);
}

/** What the hook tells Claude about these English notes, quoting the latest. */
export function reminder(english: Note[]): string {
  const latest = english.at(-1)!.text.replace(/\s+/g, ' ').trim();
  const quote = latest.length > QUOTE_CHARS ? `${latest.slice(0, QUOTE_CHARS - 1)}…` : latest;
  const what =
    english.length === 1
      ? `Your note to the person before a tool call was in English: “${quote}”.`
      : `${english.length} of your notes to the person before tool calls were in English, the latest: “${quote}”.`;
  return `${what} ${HOW}`;
}

function main(): void {
  let input: { session_id?: unknown; transcript_path?: unknown; scratchpad_dir?: unknown; agent_id?: unknown };
  try {
    input = JSON.parse(readFileSync(0, 'utf8')) as typeof input;
  } catch {
    return;
  }
  // A subagent's notes go to Claude, not to the person.
  if (input.agent_id !== undefined || typeof input.transcript_path !== 'string') return;
  let notes: Note[];
  try {
    notes = turnNotes(tail(input.transcript_path, TAIL_BYTES));
  } catch {
    return;
  }
  const dir = typeof input.scratchpad_dir === 'string' ? input.scratchpad_dir : tmpdir();
  const state = join(dir, `note-language-${String(input.session_id ?? 'session')}.json`);
  let named: string[] = [];
  try {
    named = JSON.parse(readFileSync(state, 'utf8')) as string[];
  } catch {}
  const english = notes.filter((note) => !named.includes(note.id) && notChinese(note.text));
  if (english.length === 0) return;
  try {
    writeFileSync(state, JSON.stringify([...named, ...english.map((note) => note.id)].slice(-KEPT_IDS)));
  } catch {}
  const output = { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: reminder(english) } };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) main();
