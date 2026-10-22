// A Stop hook (.claude/settings.json): the reply that ends a turn is in Simplified Chinese, as the Language section of
// CLAUDE.md asks. Late in a long session, among English tool output, a reply slipped into English (the #47 retro).
// The hook reads the turn's last reply from the session's transcript and leaves out code blocks, inline code, URLs and
// bold spans, which hold titles, such as a ticket's English title in a Chinese reply (the #48 retro). It blocks a reply
// that keeps 40 Latin letters or more, of which Han characters make up under 15% of letters and characters together;
// Claude then writes the reply again.
// Tried on every final reply in this repo's sessions since that rule landed on 2026-10-19: each English one reads 0%,
// and each Chinese one, glossary terms and all, 28% or more. Leaving bold spans out turned none of the 22 English
// replies by 2026-10-22 Chinese. note-language.ts judges notes by the same rule.
// The hook says nothing when it can't read the transcript, and blocks once per stop, so a second English try ends.
import { readFileSync } from 'node:fs';

const MIN_LATIN = 40;
const MIN_HAN_SHARE = 0.15;

export const REASON =
  'This reply is in English. Write it again in Simplified Chinese, keeping glossary terms (CONTEXT.md) and skill names in English, as the Language section of CLAUDE.md asks.';

interface Entry {
  type?: string;
  isSidechain?: boolean;
  message?: { content?: unknown };
}

type Block = { type?: string; text?: string };

/** The text of the turn's last reply: the assistant's text after its last tool call. */
export function lastReply(transcript: string): string {
  let reply: string[] = [];
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
      // A tool's result or the person's next message starts what follows afresh.
      reply = [];
      continue;
    }
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') reply.push(block.text);
      if (block.type === 'tool_use') reply = [];
    }
  }
  return reply.join('\n');
}

/** Whether a reply is in another language than Chinese, by how much of it is Han once code, links and bold are out. */
export function notChinese(reply: string): boolean {
  const prose = reply
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\*\*[^*\n]+\*\*/g, '');
  const han = prose.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latin = prose.match(/[A-Za-z]/g)?.length ?? 0;
  return latin >= MIN_LATIN && han / (han + latin) < MIN_HAN_SHARE;
}

function main(): void {
  let input: { transcript_path?: unknown; stop_hook_active?: unknown; last_assistant_message?: unknown };
  try {
    input = JSON.parse(readFileSync(0, 'utf8')) as typeof input;
  } catch {
    return;
  }
  if (input.stop_hook_active === true) return;
  let reply = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '';
  if (!reply && typeof input.transcript_path === 'string') {
    try {
      reply = lastReply(readFileSync(input.transcript_path, 'utf8'));
    } catch {
      return;
    }
  }
  if (notChinese(reply)) process.stdout.write(`${JSON.stringify({ decision: 'block', reason: REASON })}\n`);
}

if (import.meta.main) main();
