// The reply-language Stop hook (the #47 retro): a turn's last reply in English is sent back to be written again in
// Simplified Chinese, as CLAUDE.md asks. Each test runs the hook on a throwaway transcript, as Claude Code would.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = join(import.meta.dirname, '..', '.claude', 'hooks', 'reply-language.ts');

type Entry = Record<string, unknown>;
const prompt = (text: string): Entry => ({ type: 'user', message: { role: 'user', content: text } });
const say = (text: string): Entry => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolCall = (): Entry => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } });
const toolResult = (): Entry => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });

const ENGLISH = 'The branch is pushed and both CI runs passed, so main can be fast-forwarded now.';
// Past the 40 letters the hook needs to judge a reply, as a Chinese reply full of glossary terms often is.
const CHINESE = 'Bot 和 Browser 两个 CI run 都通过了。main checkout 在 main 上、工作区干净，可以 fast-forward 并关闭这个 ticket，再在 #66 留 Left by 评论。';

/** Runs the hook on a transcript of these entries, with these fields beside its path; returns what it printed. */
function stop(t: TestContext, entries: Entry[], extra: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'reply-language-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = join(dir, 'session.jsonl');
  writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join('\n'));
  const input = JSON.stringify({ hook_event_name: 'Stop', transcript_path: transcript, stop_hook_active: false, ...extra });
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

const blocked = (out: string) => {
  const decision = JSON.parse(out) as { decision?: string; reason?: string };
  return decision.decision === 'block' && /Simplified Chinese/.test(decision.reason ?? '');
};

test('a last reply in English is sent back to be written in Chinese', (t) => {
  assert.ok(blocked(stop(t, [prompt('落地吧'), say(ENGLISH)])));
});

test('a last reply in Chinese passes, glossary terms, code and links in English and all', (t) => {
  const reply = `${CHINESE}\n\n\`\`\`\n! git -C /home/ubuntu/lab1 merge --ff-only 47-dossiers && git push origin main\n\`\`\`\n见 https://github.com/ultrasadness/lab1/issues/47 。`;
  assert.equal(stop(t, [prompt('Land it.'), say(reply)]), '');
});

test('a Chinese reply that names an English title in bold passes (the #48 retro)', (t) => {
  const reply = 'Ticket #48：**Correct a Miner judgment** 已合入，**Write a Dossier for each Launch at or above the line** 也是。';
  assert.equal(stop(t, [prompt('落地吧'), say(reply)]), '');
});

test('only the text after the turn’s last tool call counts as its reply', (t) => {
  assert.equal(stop(t, [prompt('落地吧'), say(ENGLISH), toolCall(), toolResult(), say(CHINESE)]), '');
  assert.ok(blocked(stop(t, [prompt('落地吧'), say(CHINESE), toolCall(), toolResult(), say(ENGLISH)])));
});

test('a reply made of code, or too short to tell, passes', (t) => {
  assert.equal(stop(t, [prompt('命令是什么？'), say(`\`\`\`\n${ENGLISH}\n${ENGLISH}\n\`\`\``)]), '');
  assert.equal(stop(t, [prompt('好了吗？'), say('OK, done.')]), '');
});

test('the reply Claude Code hands the hook is the one judged, when it hands one', (t) => {
  assert.ok(blocked(stop(t, [prompt('落地吧'), say(CHINESE)], { last_assistant_message: ENGLISH })));
});

test('a reply already sent back once ends the turn, and a transcript the hook can’t read blocks nothing', (t) => {
  assert.equal(stop(t, [prompt('落地吧'), say(ENGLISH)], { stop_hook_active: true }), '');
  assert.equal(stop(t, [], { transcript_path: '/nonexistent/session.jsonl' }), '');
});
