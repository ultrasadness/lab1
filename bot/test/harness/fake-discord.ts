// A fake Discord: the REST API and the gateway, enforcing the message limits the real one enforces.
// Tests read what the person would see in each forum post, and tap buttons or submit pop-ups as a user.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export const IS_COMPONENTS_V2 = 1 << 15;
export const SUPPRESS_NOTIFICATIONS = 1 << 12;
export const EPHEMERAL = 1 << 6;
/** GUILD_MEMBERS, GUILD_PRESENCES and MESSAGE_CONTENT. */
export const PRIVILEGED_INTENTS = (1 << 1) | (1 << 8) | (1 << 15);

// Real Discord refuses a Components V2 message over these (verified in #29), and plain content over 2,000 characters.
const MAX_TEXT = 4000;
const MAX_COMPONENTS = 40;
const MAX_CONTENT = 2000;

interface Component {
  type: number;
  content?: string;
  label?: string;
  custom_id?: string;
  style?: number;
  url?: string;
  components?: Component[];
  accessory?: Component;
  [key: string]: unknown;
}

export interface MessagePayload {
  content?: string;
  flags?: number;
  components?: Component[];
  allowed_mentions?: { parse?: string[]; users?: string[] };
}

interface StoredMessage {
  id: string;
  channelId: string;
  payload: MessagePayload;
}

interface Thread {
  id: string;
  forumId: string;
  name: string;
  messages: StoredMessage[];
  /** When the thread was archived, while it is. */
  archivedAt?: string;
}

/** One line of a band message as the person sees it: its text and the button beside it. */
export interface SeenLine {
  text: string;
  /** A link button has a URL in place of an id. */
  button?: { label: string; customId: string; disabled: boolean; url?: string };
}

export interface SeenMessage {
  id: string;
  /** All text in the message, in reading order. */
  text: string;
  /** Text displays outside sections, such as a band's heading. */
  headings: string[];
  lines: SeenLine[];
  silent: boolean;
  mentionsNobody: boolean;
  /** The users the message notifies by mentioning them. */
  mentions: string[];
  componentCount: number;
  textLength: number;
}

/** A plain message in a text channel, such as a #status line. */
export interface SeenTextMessage {
  id: string;
  content: string;
  silent: boolean;
  mentionsNobody: boolean;
}

export interface SeenPost {
  id: string;
  title: string;
  messages: SeenMessage[];
}

export interface InteractionReply {
  type: number;
  data?: { content?: string; flags?: number; custom_id?: string; title?: string; components?: Component[] };
}

export class FakeDiscord {
  readonly token: string;
  readonly applicationId = '300000000000000001';
  readonly botUserId = '300000000000000002';
  readonly guildId = '400000000000000001';
  /** Every IDENTIFY the bot sent, with its intents. */
  readonly identifies: { intents: number }[] = [];
  /** Requests Discord refused, with the reason it gave. */
  readonly refused: { path: string; reason: string }[] = [];

  #server: http.Server;
  #wss: WebSocketServer;
  #sockets = new Set<WebSocket>();
  #forums = new Set<string>();
  #threads = new Map<string, Thread>();
  /** Each plain text channel's messages, oldest first. */
  #textChannels = new Map<string, StoredMessage[]>();
  /** The text channels that take cards, such as #needs-you, rather than plain lines. */
  #cardChannels = new Set<string>();
  #seq = 0;
  #nextId = 500000000000000000n;
  #pending = new Map<string, { messageId?: string; resolve: (reply: InteractionReply) => void }>();
  #lost: { kind: 'post' | 'message'; remaining: number }[] = [];

  private constructor(token: string) {
    this.token = token;
    this.#server = http.createServer((req, res) => void this.#handle(req, res));
    this.#wss = new WebSocketServer({ server: this.#server, path: '/gateway' });
    this.#wss.on('connection', (socket) => this.#gateway(socket));
  }

  static async start(options: { token: string; forums: string[]; textChannels?: string[]; cardChannels?: string[] }): Promise<FakeDiscord> {
    const discord = new FakeDiscord(options.token);
    for (const forum of options.forums) discord.#forums.add(forum);
    for (const channel of options.textChannels ?? []) discord.#textChannels.set(channel, []);
    for (const channel of options.cardChannels ?? []) {
      discord.#textChannels.set(channel, []);
      discord.#cardChannels.add(channel);
    }
    await new Promise<void>((resolve) => discord.#server.listen(0, '127.0.0.1', resolve));
    return discord;
  }

  get #origin(): string {
    return `127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  get apiBaseUrl(): string {
    return `http://${this.#origin}/api/v10`;
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.terminate();
    await new Promise<void>((resolve) => this.#wss.close(() => resolve()));
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  /** The posts in a forum, oldest first, as the person sees them. */
  forumPosts(forumId: string): SeenPost[] {
    return [...this.#threads.values()]
      .filter((t) => t.forumId === forumId)
      .map((t) => ({ id: t.id, title: t.name, messages: t.messages.map(seen) }));
  }

  /** The messages in a plain text channel, oldest first. */
  textMessages(channelId: string): SeenTextMessage[] {
    return (this.#textChannels.get(channelId) ?? []).map(({ id, payload }) => ({
      id,
      content: payload.content ?? '',
      silent: Boolean((payload.flags ?? 0) & SUPPRESS_NOTIFICATIONS),
      mentionsNobody: mentionsNobody(payload),
    }));
  }

  /** The cards in a text channel that takes them, oldest first, as the person sees them. */
  cards(channelId: string): SeenMessage[] {
    return (this.#textChannels.get(channelId) ?? []).map(seen);
  }

  /**
   * Discord takes the `nth` forum post or message created from now on, but its reply never reaches the bot, as when
   * the bot stops in the middle of the request.
   */
  loseReply(kind: 'post' | 'message', nth = 1): void {
    this.#lost.push({ kind, remaining: nth });
  }

  /** Archives a post, as a forum does once it has been inactive for its auto-archive time. */
  archive(threadId: string, at: string): void {
    this.#threads.get(threadId)!.archivedAt = at;
  }

  #replyLost(kind: 'post' | 'message'): boolean {
    let lost = false;
    for (const l of this.#lost.filter((x) => x.kind === kind)) {
      l.remaining -= 1;
      if (l.remaining === 0) lost = true;
    }
    this.#lost = this.#lost.filter((l) => l.remaining > 0);
    return lost;
  }

  /** Resolves once the bot has identified on the gateway. */
  async connected(timeoutMs = 10_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (this.identifies.length === 0) {
      if (Date.now() > until) throw new Error('The bot never connected to the gateway');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /** A user taps a button; resolves with the bot's reply to the interaction. */
  tap(options: { userId: string; customId: string; channelId: string; messageId: string }): Promise<InteractionReply> {
    return this.#interact(options.userId, options.channelId, {
      type: 3,
      data: { custom_id: options.customId, component_type: 2 },
      message: { id: options.messageId, channel_id: options.channelId },
    });
  }

  /** A user submits a pop-up; resolves with the bot's reply. */
  submitPopup(options: {
    userId: string;
    customId: string;
    channelId: string;
    fields: Record<string, string>;
  }): Promise<InteractionReply> {
    return this.#interact(options.userId, options.channelId, {
      type: 5,
      data: {
        custom_id: options.customId,
        components: Object.entries(options.fields).map(([custom_id, value]) => ({
          type: 18,
          component: { type: 4, custom_id, value },
        })),
      },
    });
  }

  #interact(userId: string, channelId: string, rest: Record<string, unknown>): Promise<InteractionReply> {
    const id = this.#id();
    const token = `interaction-token-${id}`;
    const interaction = {
      id,
      application_id: this.applicationId,
      token,
      version: 1,
      guild_id: this.guildId,
      channel_id: channelId,
      member: { user: { id: userId, username: `user-${userId.slice(-4)}` } },
      ...rest,
    };
    return new Promise<InteractionReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The bot never answered the interaction')), 10_000);
      const message = rest.message as { id: string } | undefined;
      this.#pending.set(`${id}/${token}`, {
        messageId: message?.id,
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
      });
      this.#dispatch('INTERACTION_CREATE', interaction);
    });
  }

  #id(): string {
    this.#nextId += 1n;
    return String(this.#nextId);
  }

  #message(messageId: string): StoredMessage | undefined {
    for (const messages of [...[...this.#threads.values()].map((t) => t.messages), ...this.#textChannels.values()]) {
      const found = messages.find((m) => m.id === messageId);
      if (found) return found;
    }
    return undefined;
  }

  #threadObject(t: Thread) {
    return {
      id: t.id,
      type: 11,
      parent_id: t.forumId,
      owner_id: this.botUserId,
      name: t.name,
      thread_metadata: { archived: Boolean(t.archivedAt), archive_timestamp: t.archivedAt ?? new Date(0).toISOString(), locked: false },
    };
  }

  #dispatch(event: string, data: unknown): void {
    this.#seq += 1;
    for (const socket of this.#sockets) socket.send(JSON.stringify({ op: 0, t: event, s: this.#seq, d: data }));
  }

  #gateway(socket: WebSocket): void {
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 41_250 } }));
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as { op: number; d: Record<string, unknown> };
      if (frame.op === 1) socket.send(JSON.stringify({ op: 11 }));
      if (frame.op === 2) {
        if (frame.d.token !== this.token) return socket.close(4004, 'Authentication failed.');
        this.identifies.push({ intents: Number(frame.d.intents) });
        this.#sockets.add(socket);
        this.#seq += 1;
        socket.send(
          JSON.stringify({
            op: 0,
            t: 'READY',
            s: this.#seq,
            d: {
              v: 10,
              user: { id: this.botUserId, username: 'Assistant', bot: true },
              guilds: [{ id: this.guildId, unavailable: true }],
              session_id: 'fake-session',
              resume_gateway_url: `ws://${this.#origin}/gateway`,
              application: { id: this.applicationId, flags: 0 },
            },
          }),
        );
      }
    });
    socket.on('close', () => this.#sockets.delete(socket));
  }

  async #handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const path = (req.url ?? '').replace(/^\/api\/v10/, '');
    const reply = (status: number, body?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const refuse = (reason: string) => {
      this.refused.push({ path, reason });
      reply(400, { code: 50035, message: 'Invalid Form Body', errors: { reason } });
    };

    let match: RegExpMatchArray | null;
    if ((match = path.match(/^\/interactions\/(\d+)\/([^/]+)\/callback$/)) && req.method === 'POST') {
      const pending = this.#pending.get(`${match[1]}/${match[2]}`);
      if (!pending) return reply(404, { code: 10062, message: 'Unknown interaction' });
      this.#pending.delete(`${match[1]}/${match[2]}`);
      const answer = JSON.parse(raw) as InteractionReply;
      // UPDATE_MESSAGE rewrites the message whose component was tapped.
      if (answer.type === 7) {
        const stored = pending.messageId ? this.#message(pending.messageId) : undefined;
        if (!stored) return reply(400, { code: 50035, message: 'Invalid Form Body', errors: { reason: 'no message to update' } });
        const problem = checkEdit(stored.payload, answer.data as MessagePayload);
        if (problem) return refuse(problem);
        stored.payload = edited(stored.payload, answer.data as MessagePayload);
      }
      pending.resolve(answer);
      return reply(204);
    }

    if (req.headers.authorization !== `Bot ${this.token}`) return reply(401, { code: 0, message: '401: Unauthorized' });

    if (path === '/gateway/bot' && req.method === 'GET') {
      return reply(200, {
        url: `ws://${this.#origin}/gateway`,
        shards: 1,
        session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 },
      });
    }

    if ((match = path.match(/^\/channels\/(\d+)\/threads$/)) && req.method === 'POST') {
      const forumId = match[1]!;
      if (!this.#forums.has(forumId)) return reply(404, { code: 10003, message: 'Unknown Channel' });
      const body = JSON.parse(raw) as { name?: string; message?: MessagePayload };
      if (!body.name || body.name.length > 100) return refuse('name must be 1 to 100 characters');
      const problem = body.message ? checkMessage(body.message) : 'message is required';
      if (problem) return refuse(problem);
      const id = this.#id();
      // A forum post's first message has the post's own id.
      this.#threads.set(id, { id, forumId, name: body.name, messages: [{ id, channelId: id, payload: body.message! }] });
      if (this.#replyLost('post')) return void res.socket?.destroy();
      return reply(201, { id, type: 11, parent_id: forumId, name: body.name, message: { id, channel_id: id } });
    }

    if (path === '/users/@me' && req.method === 'GET') return reply(200, { id: this.botUserId, username: 'Assistant', bot: true });

    if ((match = path.match(/^\/channels\/(\d+)$/)) && req.method === 'GET') {
      if (this.#forums.has(match[1]!)) return reply(200, { id: match[1], type: 15, guild_id: this.guildId });
      if (this.#textChannels.has(match[1]!)) return reply(200, { id: match[1], type: 0, guild_id: this.guildId });
      const thread = this.#threads.get(match[1]!);
      if (!thread) return reply(404, { code: 10003, message: 'Unknown Channel' });
      return reply(200, { id: thread.id, type: 11, parent_id: thread.forumId, guild_id: this.guildId, name: thread.name });
    }

    if ((match = path.match(/^\/guilds\/(\d+)\/threads\/active$/)) && req.method === 'GET') {
      if (match[1] !== this.guildId) return reply(404, { code: 10004, message: 'Unknown Guild' });
      const threads = [...this.#threads.values()].filter((t) => !t.archivedAt).map((t) => this.#threadObject(t));
      return reply(200, { threads, members: [] });
    }

    // Archived public threads of one channel, most recently archived first, paged by `before`.
    if ((match = path.match(/^\/channels\/(\d+)\/threads\/archived\/public(\?.*)?$/)) && req.method === 'GET') {
      if (!this.#forums.has(match[1]!)) return reply(404, { code: 10003, message: 'Unknown Channel' });
      const query = new URLSearchParams(match[2]?.slice(1));
      const before = query.get('before');
      const limit = Number(query.get('limit') ?? 50);
      const archived = [...this.#threads.values()]
        .filter((t) => t.forumId === match![1] && t.archivedAt && (!before || Date.parse(t.archivedAt) < Date.parse(before)))
        .sort((a, b) => Date.parse(b.archivedAt!) - Date.parse(a.archivedAt!));
      return reply(200, {
        threads: archived.slice(0, limit).map((t) => this.#threadObject(t)),
        members: [],
        has_more: archived.length > limit,
      });
    }

    if ((match = path.match(/^\/channels\/(\d+)\/messages(\?.*)?$/)) && req.method === 'GET') {
      const thread = this.#threads.get(match[1]!);
      if (!thread) return reply(404, { code: 10003, message: 'Unknown Channel' });
      const newestFirst = [...thread.messages].reverse().slice(0, 100);
      return reply(200, newestFirst.map((m) => ({ id: m.id, channel_id: m.channelId, author: { id: this.botUserId, bot: true } })));
    }

    if ((match = path.match(/^\/channels\/(\d+)\/messages\/(\d+)$/)) && req.method === 'PATCH') {
      const thread = this.#threads.get(match[1]!);
      const messages = thread?.messages ?? (this.#cardChannels.has(match[1]!) ? this.#textChannels.get(match[1]!) : undefined);
      const stored = messages?.find((m) => m.id === match![2]);
      if (!stored) return reply(404, { code: 10008, message: 'Unknown Message' });
      if (thread?.archivedAt) return reply(400, { code: 50083, message: 'Thread is archived' });
      const body = JSON.parse(raw) as MessagePayload;
      const problem = checkEdit(stored.payload, body);
      if (problem) return refuse(problem);
      stored.payload = edited(stored.payload, body);
      return reply(200, { id: stored.id, channel_id: match[1] });
    }

    // Renames a post, or archives or unarchives it.
    if ((match = path.match(/^\/channels\/(\d+)$/)) && req.method === 'PATCH') {
      const thread = this.#threads.get(match[1]!);
      if (!thread) return reply(404, { code: 10003, message: 'Unknown Channel' });
      const body = JSON.parse(raw) as { name?: string; archived?: boolean };
      if (body.name !== undefined && (!body.name || body.name.length > 100)) return refuse('name must be 1 to 100 characters');
      // Only unarchiving touches an archived thread; anything else must unarchive it in the same request.
      if (thread.archivedAt && body.archived !== false) return reply(400, { code: 50083, message: 'Thread is archived' });
      if (body.name !== undefined) thread.name = body.name;
      if (body.archived === false) delete thread.archivedAt;
      if (body.archived === true) thread.archivedAt = new Date().toISOString();
      return reply(200, this.#threadObject(thread));
    }

    if ((match = path.match(/^\/channels\/(\d+)\/messages$/)) && req.method === 'POST' && this.#textChannels.has(match[1]!)) {
      const body = JSON.parse(raw) as MessagePayload;
      const problem = this.#cardChannels.has(match[1]!) ? checkMessage(body) : checkPlainMessage(body);
      if (problem) return refuse(problem);
      const id = this.#id();
      this.#textChannels.get(match[1]!)!.push({ id, channelId: match[1]!, payload: body });
      return reply(200, { id, channel_id: match[1] });
    }

    if ((match = path.match(/^\/channels\/(\d+)\/messages$/)) && req.method === 'POST') {
      const thread = this.#threads.get(match[1]!);
      if (!thread) return reply(404, { code: 10003, message: 'Unknown Channel' });
      const body = JSON.parse(raw) as MessagePayload;
      const problem = checkMessage(body);
      if (problem) return refuse(problem);
      const id = this.#id();
      // A message in an archived thread that isn't locked opens it again.
      delete thread.archivedAt;
      thread.messages.push({ id, channelId: thread.id, payload: body });
      if (this.#replyLost('message')) return void res.socket?.destroy();
      return reply(200, { id, channel_id: thread.id });
    }

    reply(404, { code: 0, message: '404: Not Found' });
  }
}

function walk(components: Component[], visit: (c: Component) => void): void {
  for (const c of components) {
    visit(c);
    if (c.components) walk(c.components, visit);
    if (c.accessory) walk([c.accessory], visit);
  }
}

/** Returns why real Discord would refuse this message, or undefined if it would accept it. */
function checkMessage(message: MessagePayload): string | undefined {
  const flags = message.flags ?? 0;
  if (!(flags & IS_COMPONENTS_V2)) return 'expected a Components V2 message';
  if (message.content) return 'content is not allowed with IS_COMPONENTS_V2';
  const components = message.components ?? [];
  if (components.length === 0) return 'components are required';
  let count = 0;
  let text = 0;
  let problem: string | undefined;
  walk(components, (c) => {
    count += 1;
    if (c.type === 10) text += (c.content ?? '').length;
    if (c.type === 9 && (!c.components?.length || c.components.length > 3 || !c.accessory)) {
      problem = 'a section needs 1 to 3 text displays and an accessory';
    }
    if (c.type === 2 && c.style !== 5 && (!c.custom_id || c.custom_id.length > 100)) problem = 'a button needs a custom_id of 1 to 100 characters';
    if (c.type === 2 && (c.label ?? '').length > 80) problem = 'a button label is over 80 characters';
  });
  if (count > MAX_COMPONENTS) return `${count} components, over ${MAX_COMPONENTS}`;
  if (text > MAX_TEXT) return `COMPONENT_DISPLAYABLE_TEXT_SIZE_EXCEEDED: ${text} characters, over ${MAX_TEXT}`;
  return problem;
}

/** Returns why real Discord would refuse this plain text message. */
function checkPlainMessage(message: MessagePayload): string | undefined {
  if ((message.flags ?? 0) & IS_COMPONENTS_V2) return 'this channel takes plain lines only';
  if (message.components?.length) return 'this channel takes plain lines only';
  const length = (message.content ?? '').length;
  if (length === 0 || length > MAX_CONTENT) return `content must be 1 to ${MAX_CONTENT} characters, not ${length}`;
  return undefined;
}

const mentionsNobody = (payload: MessagePayload) =>
  Array.isArray(payload.allowed_mentions?.parse) && payload.allowed_mentions.parse.length === 0 && !payload.allowed_mentions.users?.length;

/**
 * Returns why real Discord would refuse this edit. An edit keeps the message's flags; of the flags this bot uses only
 * IS_COMPONENTS_V2 may be sent, and it can't be taken off.
 */
function checkEdit(before: MessagePayload, edit: MessagePayload): string | undefined {
  if ((edit.flags ?? 0) & ~IS_COMPONENTS_V2) return 'an edit may set only IS_COMPONENTS_V2 of these flags';
  return checkMessage(edited(before, edit));
}

const edited = (before: MessagePayload, edit: MessagePayload): MessagePayload => ({ ...before, ...edit, flags: before.flags });

function seen(message: StoredMessage): SeenMessage {
  const payload = message.payload;
  const texts: string[] = [];
  const headings: string[] = [];
  const lines: SeenLine[] = [];
  let count = 0;
  let length = 0;
  const visit = (cs: Component[], inSection: boolean) => {
    for (const c of cs) {
      count += 1;
      if (c.type === 10) {
        texts.push(c.content ?? '');
        length += (c.content ?? '').length;
        if (!inSection) headings.push(c.content ?? '');
      }
      if (c.type === 9) {
        const text = (c.components ?? []).map((t) => t.content ?? '').join('\n');
        const a = c.accessory;
        lines.push({
          text,
          ...(a?.type === 2
            ? { button: { label: a.label ?? '', customId: a.custom_id ?? '', disabled: a.disabled === true, ...(a.url ? { url: a.url } : {}) } }
            : {}),
        });
        visit(c.components ?? [], true);
        if (a) count += 1;
        continue;
      }
      if (c.components) visit(c.components, inSection);
    }
  };
  visit(payload.components ?? [], false);
  return {
    id: message.id,
    text: texts.join('\n'),
    headings,
    lines,
    silent: Boolean((payload.flags ?? 0) & SUPPRESS_NOTIFICATIONS),
    mentionsNobody: mentionsNobody(payload),
    // Discord notifies a user mentioned in the text only if the message allows it.
    mentions: (payload.allowed_mentions?.users ?? []).filter((id) => texts.some((t) => t.includes(`<@${id}>`))),
    componentCount: count,
    textLength: length,
  };
}
