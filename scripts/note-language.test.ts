// The note-language PostToolUse hook (the #48 retro): a note Claude writes the person between tool calls, in English,
// is named back to Claude after a later tool call, so the next note is in Simplified Chinese as CLAUDE.md asks. Each
// test runs the hook on a throwaway transcript and scratchpad, as Claude Code would.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = join(import.meta.dirname, '..', '.claude', 'hooks', 'note-language.ts');

type Entry = Record<string, unknown>;
let uuids = 0;
const entry = (type: string, content: unknown, extra: Entry = {}): Entry => ({ type, uuid: `uuid-${++uuids}`, message: { role: type, content }, ...extra });
const prompt = (text: string): Entry => entry('user', text);
const say = (text: string): Entry => entry('assistant', [{ type: 'text', text }]);
const toolCall = (): Entry => entry('assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]);
const toolResult = (): Entry => entry('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]);
/** Text Claude Code adds as the user's within a turn, such as a skill's body. */
const meta = (text: string): Entry => entry('user', [{ type: 'text', text }], { isMeta: true });

const ENGLISH = 'Red as expected. Now the implementation: modal components, the Correct pop-up, and wiring.';
const ENGLISH_TOO = 'Green. Slice 2: submitting a Correction that leaves the outcome the same, with the day file rewritten.';
// Past the 40 letters a note needs to be judged, as a Chinese note full of glossary terms and a ticket title often is.
const CHINESE = 'Ticket #48：**Correct a Miner judgment**。先读 spec、CONTEXT.md 和相关 ADR，再建 worktree 开始实现 Correction。';

/** A session: its transcript and scratchpad, and a run of the hook after a tool call, returning what it printed. */
function session(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'note-language-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = join(dir, 'session.jsonl');
  return {
    run(entries: Entry[], extra: Entry = {}): string {
      writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join('\n'));
      const input = JSON.stringify({
        session_id: 'session-1',
        hook_event_name: 'PostToolUse',
        transcript_path: transcript,
        scratchpad_dir: dir,
        tool_name: 'Bash',
        ...extra,
      });
      const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 30_000 });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    },
  };
}

/** What the hook adds to Claude's context, or undefined if it adds nothing. */
function context(out: string): string | undefined {
  if (!out) return undefined;
  const parsed = JSON.parse(out) as { hookSpecificOutput?: { hookEventName?: string; additionalContext?: string } };
  assert.equal(parsed.hookSpecificOutput?.hookEventName, 'PostToolUse');
  return parsed.hookSpecificOutput?.additionalContext;
}

test('an English note before a tool call is named back to Claude, quoted, with how to write the next one', (t) => {
  const said = context(session(t).run([prompt('做 #48'), say(CHINESE), toolCall(), toolResult(), say(ENGLISH), toolCall(), toolResult()]));
  assert.equal(
    said,
    `Your note to the person before a tool call was in English: “${ENGLISH}”. Write the notes between tool calls in ` +
      'Simplified Chinese, like your replies, keeping glossary terms (CONTEXT.md) and skill names in English, as the ' +
      'Language section of CLAUDE.md asks.',
  );
});

test('notes in Chinese add nothing, glossary terms, code and a ticket title in bold included', (t) => {
  const note = `${CHINESE}\n\n\`\`\`\n${ENGLISH}\n\`\`\`\n见 https://github.com/ultrasadness/lab1/issues/48 。`;
  assert.equal(session(t).run([prompt('做 #48'), say(note), toolCall(), toolResult()]), '');
});

test('each English note is named once, however many tool calls follow it', (t) => {
  const s = session(t);
  const turn = [prompt('做 #48'), say(ENGLISH), toolCall(), toolResult()];
  assert.ok(context(s.run(turn)));
  assert.equal(s.run([...turn, toolCall(), toolResult()]), '', 'the same note again adds nothing');
  const later = context(s.run([...turn, toolCall(), toolResult(), say(ENGLISH_TOO), toolCall(), toolResult()]));
  assert.match(later ?? '', new RegExp(`^Your note to the person before a tool call was in English: “${ENGLISH_TOO}”`));
});

test('notes the transcript holds only late are named together, the latest quoted', (t) => {
  const said = context(session(t).run([prompt('做 #48'), say(ENGLISH), toolCall(), toolResult(), say(ENGLISH_TOO), toolCall(), toolResult()]));
  assert.match(said ?? '', new RegExp(`^2 of your notes to the person before tool calls were in English, the latest: “${ENGLISH_TOO}”\\. Write`));
});

test('only the turn since the last prompt counts, though a skill’s body or a hook’s feedback comes within it', (t) => {
  const earlier = [prompt('做 #47'), say(ENGLISH), toolCall(), toolResult(), say(ENGLISH)];
  assert.equal(session(t).run([...earlier, prompt('做 #48'), say(CHINESE), toolCall(), toolResult()]), '');
  const within = [prompt('做 #48'), toolCall(), toolResult(), meta('Base directory for this skill: …'), say(ENGLISH), toolCall(), toolResult()];
  assert.ok(context(session(t).run(within)));
});

test('a note too short to tell, or a final reply with no tool call after it, adds nothing', (t) => {
  assert.equal(session(t).run([prompt('做 #48'), say('Green.'), toolCall(), toolResult()]), '');
  assert.equal(session(t).run([prompt('做 #48'), say(CHINESE), toolCall(), toolResult(), say(ENGLISH)]), '');
});

test('a subagent’s tool call, an unreadable transcript or unreadable input adds nothing', (t) => {
  const turn = [prompt('做 #48'), say(ENGLISH), toolCall(), toolResult()];
  assert.equal(session(t).run(turn, { agent_id: 'agent-1' }), '');
  assert.equal(session(t).run(turn, { transcript_path: '/nonexistent/session.jsonl' }), '');
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});
