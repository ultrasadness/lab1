// A trial of a Submit tap's upload on the real Discord (#59), as `bot/test/harness/fake-discord.ts` models it from
// Discord's documentation: one silent Components V2 message, through the bot's own `DiscordRest.sendMessage`, with a
// 1×1 PNG uploaded beside it and shown by a media gallery that names it as `attachment://trial.png`. It reads the
// message back, edits it to one line as a handled card shrinks (`NeedsYou.shrunk`, through `DiscordRest.editMessage`),
// reads it back again, prints what Discord kept of it each time, and deletes it.
//
//   node scripts/trial-discord-upload.ts --channel <channel id> [--token-file <path>]
//
// The token file defaults to `~/.config/lab1/discord-bot-token`. The script prints only named fields of Discord's
// answers, never the token or a URL's query.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { container, Flags, image, text, type MessagePayload } from '../bot/src/discord/components.ts';
import { DiscordRest } from '../bot/src/discord/rest.ts';
import { SecretGuard } from '../bot/src/secret-guard.ts';

const API = 'https://discord.com/api/v10';
/** A 1×1 PNG, as the fake browser's screenshots are. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
/** How long Discord has to answer one request. */
const ANSWER_MS = 30_000;

const { values } = parseArgs({ options: { channel: { type: 'string' }, 'token-file': { type: 'string' } } });
if (!values.channel || !/^\d{17,20}$/.test(values.channel)) {
  console.error('usage: node scripts/trial-discord-upload.ts --channel <channel id> [--token-file <path>]');
  process.exit(2);
}
const channel = values.channel;
const token = readFileSync(values['token-file'] ?? join(homedir(), '.config/lab1/discord-bot-token'), 'utf8').trim();
const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry));
const secrets = new SecretGuard({ log: (event, fields) => log({ event, ...fields }), post: async () => {}, plainWork: () => {} });
const discord = new DiscordRest({ apiBaseUrl: API, token, log: (event, fields) => log({ event, ...fields }), secrets });

const card: MessagePayload = {
  flags: Flags.IS_COMPONENTS_V2 | Flags.SUPPRESS_NOTIFICATIONS,
  components: [container(0x4f545c, [text('**Trial** · a Submit tap’s screenshot upload (#59). This message deletes itself.'), image('trial.png', 'A 1×1 test image')])],
  allowed_mentions: { parse: [] },
};

/** A request of the script's own, for what `DiscordRest` doesn't ask: reading the message back, and deleting it. */
async function request(method: string, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${API}${path}`, { method, headers: { authorization: `Bot ${token}` }, signal: AbortSignal.timeout(ANSWER_MS) });
  const raw = await response.text();
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = { unparsed: raw.slice(0, 200) };
  }
  return { status: response.status, body };
}

/** A URL as the script prints it: its host and path, never its query, which Discord signs. */
const shown = (url: unknown) => {
  try {
    const u = new URL(String(url));
    return u.protocol === 'attachment:' ? String(url) : `${u.host}${u.pathname}`;
  } catch {
    return String(url);
  }
};

/** Reads the message back, and prints its flags, its components' types, its attachments and its gallery's items. */
async function readBack(event: string, messageId: string): Promise<void> {
  const read = await request('GET', `/channels/${channel}/messages/${messageId}`);
  const m = (read.body ?? {}) as { flags?: number; attachments?: { filename?: string; size?: number; content_type?: string; url?: string }[]; components?: unknown[] };
  const types: number[] = [];
  const galleries: unknown[] = [];
  const walk = (cs: unknown[]) => {
    for (const c of cs as { type?: number; components?: unknown[]; items?: { media?: { url?: string } }[] }[]) {
      types.push(Number(c.type));
      if (c.type === 12) galleries.push(...(c.items ?? []).map((i) => shown(i.media?.url)));
      if (c.components) walk(c.components);
    }
  };
  walk(m.components ?? []);
  log({
    event,
    status: read.status,
    flags: m.flags,
    componentTypes: types,
    attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, size: a.size, contentType: a.content_type, url: shown(a.url) })),
    galleryItems: galleries,
  });
}

try {
  const { messageId } = await discord.sendMessage(channel, card, [{ name: 'trial.png', data: PNG, contentType: 'image/png' }]);
  log({ event: 'trial.sent', messageId });
  await readBack('trial.read-back', messageId);
  // As a handled card shrinks to one line (`NeedsYou.shrunk`): its components alone, and its flags as an edit takes them.
  await discord.editMessage(channel, messageId, { flags: Flags.IS_COMPONENTS_V2, components: [text('✓ Trial · shrunk to one line')], allowed_mentions: { parse: [] } });
  log({ event: 'trial.edited' });
  await readBack('trial.read-back-edited', messageId);
  const deleted = await request('DELETE', `/channels/${channel}/messages/${messageId}`);
  log({ event: 'trial.deleted', status: deleted.status });
} catch (error) {
  log({ event: 'trial.failed', error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
