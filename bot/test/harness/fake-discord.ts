// A fake Discord: the REST API and the gateway, enforcing the message limits the real one enforces.
// Tests read what the person would see in each forum post, and tap buttons or submit pop-ups as a user.
// A message may come with files, as Discord documents uploads (Reference › Uploading Files): multipart/form-data, the
// message as `payload_json` naming each file in `attachments` by its `id`, the place of its `files[n]` part. A Components
// V2 message shows a file only through a component that names it as `attachment://<filename>`, such as a media gallery
// (Components › Media Gallery). The real Discord did so in the trial on #59 (`scripts/trial-discord-upload.ts`, run by
// the person on 2026-11-24): it took such a message, resolved its gallery's item to the file on its CDN, and took an
// edit to one text display, as a handled card shrinks, which left no gallery and kept the message's flags. It listed
// the file under no `attachments` when read back, which nothing here reads.
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
// A pop-up's limits, as Discord documents them.
const MAX_POPUP_TITLE = 45;
const MAX_POPUP_COMPONENTS = 5;
const MAX_LABEL = 45;
const MAX_TEXT_INPUT = 4000;
/** A radio group: one choice among 2 to 10 options, in a label of a pop-up. */
const RADIO_GROUP = 21;
const MAX_RADIOS = 10;

interface Component {
  type: number;
  content?: string;
  label?: string;
  custom_id?: string;
  style?: number;
  url?: string;
  components?: Component[];
  accessory?: Component;
  /** A label's one field, in a pop-up. */
  component?: Component;
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
  /** The files uploaded with it. */
  files?: Upload[];
}

/** A file uploaded with a message. */
interface Upload {
  name: string;
  bytes: Buffer;
}

interface Thread {
  id: string;
  forumId: string;
  name: string;
  tagIds: string[];
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

export interface SeenButton {
  label: string;
  customId: string;
  disabled: boolean;
  /** Discord's button style: 1 is blue (Primary), 2 grey, 3 green, 4 red. */
  style: number;
}

export interface SeenMessage {
  id: string;
  /** All text in the message, in reading order. */
  text: string;
  /** Text displays outside sections, such as a band's heading. */
  headings: string[];
  lines: SeenLine[];
  /** The buttons in action rows, such as a Dossier's Add Offer and Correct. */
  buttons: SeenButton[];
  /** The accent colour of the message's first container, if it has one. */
  accent: number | undefined;
  silent: boolean;
  mentionsNobody: boolean;
  /** The users the message notifies by mentioning them. */
  mentions: string[];
  componentCount: number;
  textLength: number;
  /** The images its media galleries show, each a file uploaded with it, by name and with its bytes. */
  images: { name: string; bytes: Buffer }[];
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
  /** The names of the forum tags on the post. */
  tags: string[];
  /** Whether the post is closed, as an archived post shows in a forum. */
  closed: boolean;
  messages: SeenMessage[];
}

/** A pop-up the bot opened, as the person sees it. */
export interface SeenPopup {
  customId: string;
  title: string;
  /** Text shown above the fields. */
  texts: string[];
  /**
   * Each field, with what it holds as the pop-up opens, if anything. A radio group has its options, and the one
   * chosen as it opens as its value.
   */
  fields: {
    customId: string;
    label: string;
    required: boolean;
    multiline: boolean;
    maxLength: number | undefined;
    value?: string;
    options?: string[];
  }[];
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
  /** Every REST call the bot made, as its method and path, oldest first. */
  readonly calls: string[] = [];
  /** Every IDENTIFY the bot sent, with its intents. */
  readonly identifies: { intents: number }[] = [];
  /** The body of every request the bot sent, as Discord received it. */
  readonly bodies: string[] = [];
  /** Requests Discord refused, with the reason it gave. */
  readonly refused: { path: string; reason: string }[] = [];
  /** Forums Discord can't read for now, such as their tags: each read answers 503. */
  readonly unreadable = new Set<string>();
  /** Channels whose messages Discord can't edit for now: each edit answers 503. */
  readonly uneditable = new Set<string>();

  #server: http.Server;
  #wss: WebSocketServer;
  #sockets = new Set<WebSocket>();
  /** Each forum's tags, by id. */
  #forums = new Map<string, Map<string, string>>();
  #threads = new Map<string, Thread>();
  /** Each plain text channel's messages, oldest first. */
  #textChannels = new Map<string, StoredMessage[]>();
  /** The text channels that take cards, such as #needs-you, rather than plain lines. */
  #cardChannels = new Set<string>();
  #seq = 0;
  #nextId = 500000000000000000n;
  #pending = new Map<string, { messageId?: string; resolve: (reply: InteractionReply) => void }>();
  /** The radio groups in each pop-up the bot opened, by the pop-up's custom_id, whose submissions carry them as such. */
  #radios = new Map<string, Set<string>>();
  #lost: { kind: 'post' | 'message'; remaining: number; forumId: string | undefined }[] = [];
  /** The text channels whose next message Discord refuses. */
  #refusingNext = new Set<string>();
  #gatewayCut = false;
  #resumes = 0;
  #gatewayRefusals = 0;

  private constructor(token: string) {
    this.token = token;
    this.#server = http.createServer((req, res) => void this.#handle(req, res));
    this.#wss = new WebSocketServer({ server: this.#server, path: '/gateway' });
    this.#wss.on('connection', (socket) => this.#gateway(socket));
  }

  static async start(options: {
    token: string;
    /** Each forum, with the names of the tags the person set up in it. */
    forums: Record<string, string[]>;
    textChannels?: string[];
    cardChannels?: string[];
  }): Promise<FakeDiscord> {
    const discord = new FakeDiscord(options.token);
    for (const [forum, tags] of Object.entries(options.forums)) {
      discord.#forums.set(forum, new Map(tags.map((name) => [discord.#id(), name])));
    }
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
      .map((t) => ({
        id: t.id,
        title: t.name,
        tags: t.tagIds.map((id) => this.#forums.get(forumId)!.get(id)!),
        closed: Boolean(t.archivedAt),
        messages: t.messages.map(seen),
      }));
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
   * Discord takes the `nth` forum post or message created from now on, in one forum or text channel if one is named,
   * but its reply never reaches the bot, as when the bot stops in the middle of the request.
   */
  loseReply(kind: 'post' | 'message', nth = 1, forumId?: string): void {
    this.#lost.push({ kind, remaining: nth, forumId });
  }

  /**
   * Discord refuses the next message sent to this text channel outright, with the 400 this fake answers any message it
   * refuses, so it surely doesn't take it. #29 saw real Discord refuse a message over its limits, though not which 4xx;
   * the bot takes any 4xx alike (`refused` in `bot/src/discord/rest.ts`).
   */
  refuseNextMessage(channelId: string): void {
    this.#refusingNext.add(channelId);
  }

  /** Archives a post, as a forum does once it has been inactive for its auto-archive time. */
  archive(threadId: string, at: string): void {
    this.#threads.get(threadId)!.archivedAt = at;
  }

  #replyLost(kind: 'post' | 'message', forumId: string): boolean {
    let lost = false;
    for (const l of this.#lost.filter((x) => x.kind === kind && (x.forumId ?? forumId) === forumId)) {
      l.remaining -= 1;
      if (l.remaining === 0) lost = true;
    }
    this.#lost = this.#lost.filter((l) => l.remaining > 0);
    return lost;
  }

  /** How many times the bot resumed its session on the gateway. */
  get resumes(): number {
    return this.#resumes;
  }

  /** How many times the gateway refused the bot while it was cut. */
  get gatewayRefusals(): number {
    return this.#gatewayRefusals;
  }

  /**
   * The gateway asks the bot to reconnect, then stops reading from it until `releaseGateway`, as a connection gone
   * half-open does: the bot's close goes unanswered, so the connection doesn't close.
   */
  hangGateway(): void {
    for (const socket of this.#sockets) {
      socket.send(JSON.stringify({ op: 7, d: null }));
      socket.pause();
    }
  }

  releaseGateway(): void {
    for (const socket of this.#sockets) socket.resume();
  }

  /** The gateway drops the bot, and refuses each connection until `restoreGateway`, as in an outage of Discord's. */
  cutGateway(): void {
    this.#gatewayCut = true;
    for (const socket of this.#sockets) socket.terminate();
  }

  restoreGateway(): void {
    this.#gatewayCut = false;
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

  /**
   * A user submits a pop-up; resolves with the bot's reply. A pop-up opened from a button carries the message the
   * button is on, which the reply may rewrite.
   */
  submitPopup(options: {
    userId: string;
    customId: string;
    channelId: string;
    fields: Record<string, string>;
    messageId?: string;
  }): Promise<InteractionReply> {
    return this.#interact(options.userId, options.channelId, {
      type: 5,
      data: {
        custom_id: options.customId,
        components: Object.entries(options.fields).map(([custom_id, value]) => ({
          type: 18,
          component: { type: this.#radios.get(options.customId)?.has(custom_id) ? RADIO_GROUP : 4, custom_id, value },
        })),
      },
      ...(options.messageId ? { message: { id: options.messageId, channel_id: options.channelId } } : {}),
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
    if (this.#gatewayCut) {
      this.#gatewayRefusals += 1;
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 41_250 } }));
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as { op: number; d: Record<string, unknown> };
      if (frame.op === 1) socket.send(JSON.stringify({ op: 11 }));
      if (frame.op === 6) {
        if (frame.d.token !== this.token) return socket.close(4004, 'Authentication failed.');
        this.#resumes += 1;
        this.#sockets.add(socket);
        this.#seq += 1;
        socket.send(JSON.stringify({ op: 0, t: 'RESUMED', s: this.#seq, d: null }));
      }
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
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let raw = Buffer.concat(chunks).toString('utf8');
    const path = (req.url ?? '').replace(/^\/api\/v10/, '');
    this.calls.push(`${req.method} ${path}`);
    const reply = (status: number, body?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const refuse = (reason: string) => {
      this.refused.push({ path, reason });
      reply(400, { code: 50035, message: 'Invalid Form Body', errors: { reason } });
    };
    // An upload: the message is its payload_json, and each file a files[n] part.
    let files: Upload[] | undefined;
    const type = req.headers['content-type'] ?? '';
    if (type.startsWith('multipart/form-data')) {
      const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': type } }).formData();
      const payload = form.get('payload_json');
      if (typeof payload !== 'string') return refuse('a multipart message needs payload_json');
      raw = payload;
      files = [];
      for (const [name, value] of form.entries()) {
        const n = name.match(/^files\[(\d+)\]$/);
        if (!n || typeof value === 'string') continue;
        files[Number(n[1])] = { name: value.name, bytes: Buffer.from(await value.arrayBuffer()) };
      }
      const problem = checkUploads(JSON.parse(raw) as MessagePayload & { attachments?: unknown }, files);
      if (problem) return refuse(problem);
    }
    if (raw) this.bodies.push(raw);

    let match: RegExpMatchArray | null;
    if ((match = path.match(/^\/interactions\/(\d+)\/([^/]+)\/callback$/)) && req.method === 'POST') {
      const pending = this.#pending.get(`${match[1]}/${match[2]}`);
      if (!pending) return reply(404, { code: 10062, message: 'Unknown interaction' });
      this.#pending.delete(`${match[1]}/${match[2]}`);
      const answer = JSON.parse(raw) as InteractionReply;
      if (answer.type === 9) {
        const problem = checkPopup(answer.data ?? {});
        if (problem) return refuse(problem);
        const radios = (answer.data?.components ?? []).filter((c) => c.component?.type === RADIO_GROUP).map((c) => c.component!.custom_id!);
        this.#radios.set(answer.data!.custom_id!, new Set(radios));
      }
      // An ephemeral message of components is held to a message's limits too.
      if (answer.type === 4 && (answer.data?.flags ?? 0) & IS_COMPONENTS_V2) {
        const problem = checkMessage(answer.data as MessagePayload);
        if (problem) return refuse(problem);
      }
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
      const body = JSON.parse(raw) as { name?: string; message?: MessagePayload; applied_tags?: string[] };
      if (!body.name || body.name.length > 100) return refuse('name must be 1 to 100 characters');
      const problem = body.message ? checkMessage(body.message) : 'message is required';
      if (problem) return refuse(problem);
      const tagIds = body.applied_tags ?? [];
      if (tagIds.some((tag) => !this.#forums.get(forumId)!.has(tag))) return refuse('applied_tags names a tag the forum lacks');
      if (tagIds.length > 5) return refuse('a post takes at most 5 tags');
      const id = this.#id();
      // A forum post's first message has the post's own id.
      this.#threads.set(id, { id, forumId, name: body.name, tagIds, messages: [{ id, channelId: id, payload: body.message! }] });
      if (this.#replyLost('post', forumId)) return void res.socket?.destroy();
      return reply(201, { id, type: 11, parent_id: forumId, name: body.name, message: { id, channel_id: id } });
    }

    if (path === '/users/@me' && req.method === 'GET') return reply(200, { id: this.botUserId, username: 'Assistant', bot: true });

    if ((match = path.match(/^\/channels\/(\d+)$/)) && req.method === 'GET') {
      if (this.unreadable.has(match[1]!)) return reply(503, { code: 0, message: 'Service Unavailable' });
      const tags = this.#forums.get(match[1]!);
      if (tags) {
        const available_tags = [...tags].map(([id, name]) => ({ id, name, moderated: false, emoji_id: null, emoji_name: null }));
        return reply(200, { id: match[1], type: 15, guild_id: this.guildId, available_tags });
      }
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
      if (this.uneditable.has(match[1]!)) return reply(503, { code: 0, message: 'Service Unavailable' });
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
      const body = JSON.parse(raw) as { name?: string; archived?: boolean; applied_tags?: string[] };
      if (body.name !== undefined && (!body.name || body.name.length > 100)) return refuse('name must be 1 to 100 characters');
      if (body.applied_tags?.some((tag) => !this.#forums.get(thread.forumId)?.has(tag))) return refuse('applied_tags names a tag the forum lacks');
      if ((body.applied_tags?.length ?? 0) > 5) return refuse('a post takes at most 5 tags');
      // Only unarchiving touches an archived thread; anything else must unarchive it in the same request.
      if (thread.archivedAt && body.archived !== false) return reply(400, { code: 50083, message: 'Thread is archived' });
      if (body.name !== undefined) thread.name = body.name;
      if (body.applied_tags !== undefined) thread.tagIds = body.applied_tags;
      if (body.archived === false) delete thread.archivedAt;
      if (body.archived === true) thread.archivedAt = new Date().toISOString();
      return reply(200, this.#threadObject(thread));
    }

    if ((match = path.match(/^\/channels\/(\d+)\/messages$/)) && req.method === 'POST' && this.#textChannels.has(match[1]!)) {
      const body = JSON.parse(raw) as MessagePayload;
      const problem = this.#cardChannels.has(match[1]!) ? checkMessage(body) : checkPlainMessage(body);
      if (problem) return refuse(problem);
      if (this.#refusingNext.delete(match[1]!)) return refuse('the test has Discord refuse this message');
      const id = this.#id();
      this.#textChannels.get(match[1]!)!.push({ id, channelId: match[1]!, payload: body, ...(files ? { files } : {}) });
      if (this.#replyLost('message', match[1]!)) return void res.socket?.destroy();
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
      thread.messages.push({ id, channelId: thread.id, payload: body, ...(files ? { files } : {}) });
      if (this.#replyLost('message', thread.forumId)) return void res.socket?.destroy();
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
    if (c.type === 1 && (!c.components?.length || c.components.length > 5 || c.components.some((b) => b.type !== 2))) {
      problem = 'an action row needs 1 to 5 buttons';
    }
  });
  if (count > MAX_COMPONENTS) return `${count} components, over ${MAX_COMPONENTS}`;
  if (text > MAX_TEXT) return `COMPONENT_DISPLAYABLE_TEXT_SIZE_EXCEEDED: ${text} characters, over ${MAX_TEXT}`;
  return problem;
}

/**
 * Returns why real Discord would refuse these uploads: each file named in `attachments` by its place, and each
 * `attachment://` a component shows naming one of them.
 */
function checkUploads(message: MessagePayload & { attachments?: unknown }, files: Upload[]): string | undefined {
  const attachments = Array.isArray(message.attachments) ? (message.attachments as { id?: unknown; filename?: unknown }[]) : [];
  if (files.length === 0 || files.some((f) => !f)) return 'files must be files[0] to files[n]';
  for (const [i, f] of files.entries()) {
    if (!attachments.some((a) => Number(a.id) === i && a.filename === f.name)) return `attachments doesn't name files[${i}] by its id and filename`;
  }
  let problem: string | undefined;
  walk(message.components ?? [], (c) => {
    for (const item of c.type === 12 ? ((c.items ?? []) as { media?: { url?: string } }[]) : []) {
      const url = item.media?.url ?? '';
      if (url.startsWith('attachment://') && !files.some((f) => f.name === url.slice('attachment://'.length))) problem = `${url} names no file uploaded with the message`;
    }
  });
  return problem;
}

/** Returns why real Discord would refuse this pop-up: a title, and text displays or labels each holding one field. */
function checkPopup(popup: { custom_id?: string; title?: string; components?: Component[] }): string | undefined {
  if (!popup.custom_id || popup.custom_id.length > 100) return 'a pop-up needs a custom_id of 1 to 100 characters';
  if (!popup.title || popup.title.length > MAX_POPUP_TITLE) return `a pop-up title must be 1 to ${MAX_POPUP_TITLE} characters`;
  const components = popup.components ?? [];
  if (components.length === 0 || components.length > MAX_POPUP_COMPONENTS) return `a pop-up holds 1 to ${MAX_POPUP_COMPONENTS} components`;
  for (const c of components) {
    if (c.type === 10) continue;
    if (c.type !== 18) return 'a pop-up holds only text displays and labels';
    if (!c.label || c.label.length > MAX_LABEL) return `a label must be 1 to ${MAX_LABEL} characters`;
    const field = c.component;
    if ((field?.type !== 4 && field?.type !== RADIO_GROUP) || !field.custom_id) return 'a label holds one text input or radio group with a custom_id';
    if (field.type === RADIO_GROUP) {
      const options = (field.options ?? []) as { label?: string; value?: string; default?: boolean }[];
      if (options.length < 2 || options.length > MAX_RADIOS) return `a radio group holds 2 to ${MAX_RADIOS} options`;
      if (options.some((o) => !o.label || o.label.length > 100 || !o.value || o.value.length > 100)) return 'a radio option needs a label and value of 1 to 100 characters';
      if (options.filter((o) => o.default).length > 1) return 'a radio group has at most one default option';
      continue;
    }
    if (Number(field.max_length ?? MAX_TEXT_INPUT) > MAX_TEXT_INPUT) return `a text input takes at most ${MAX_TEXT_INPUT} characters`;
    if (typeof field.value === 'string' && field.value.length > Number(field.max_length ?? MAX_TEXT_INPUT)) return 'a text input’s value is over its max_length';
  }
  if (!components.some((c) => c.type === 18)) return 'a pop-up needs a field';
  return undefined;
}

/** The pop-up a reply opens, as the person sees it, or undefined if the reply opens none. */
export function popupOf(reply: InteractionReply): SeenPopup | undefined {
  if (reply.type !== 9 || !reply.data) return undefined;
  const components = reply.data.components ?? [];
  return {
    customId: reply.data.custom_id ?? '',
    title: reply.data.title ?? '',
    texts: components.filter((c) => c.type === 10).map((c) => c.content ?? ''),
    fields: components
      .filter((c) => c.type === 18)
      .map((c) => {
        const options = c.component?.type === RADIO_GROUP ? ((c.component.options ?? []) as { label: string; value: string; default?: boolean }[]) : undefined;
        const chosen = options?.find((o) => o.default)?.value;
        return {
          customId: c.component?.custom_id ?? '',
          label: c.label ?? '',
          required: c.component?.required !== false,
          multiline: c.component?.style === 2,
          maxLength: typeof c.component?.max_length === 'number' ? c.component.max_length : undefined,
          ...(typeof c.component?.value === 'string' ? { value: c.component.value } : {}),
          ...(options ? { options: options.map((o) => o.value), ...(chosen ? { value: chosen } : {}) } : {}),
        };
      }),
  };
}

/** The ephemeral message of components a reply shows only the person, as they see it, or undefined if it shows none. */
export function ephemeralOf(reply: InteractionReply): SeenMessage | undefined {
  if (reply.type !== 4 || !reply.data || !((reply.data.flags ?? 0) & EPHEMERAL) || !reply.data.components) return undefined;
  return seen({ id: '', channelId: '', payload: reply.data as MessagePayload });
}

/** The message a reply rewrites the tapped message into, as the person sees it, or undefined if it rewrites none. */
export function updateOf(reply: InteractionReply): SeenMessage | undefined {
  if (reply.type !== 7 || !reply.data) return undefined;
  return seen({ id: '', channelId: '', payload: reply.data as MessagePayload });
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
  const buttons: SeenButton[] = [];
  const images: Upload[] = [];
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
      if (c.type === 2) buttons.push({ label: c.label ?? '', customId: c.custom_id ?? '', disabled: c.disabled === true, style: Number(c.style) });
      if (c.type === 12) {
        for (const item of (c.items ?? []) as { media?: { url?: string } }[]) {
          const file = message.files?.find((f) => `attachment://${f.name}` === item.media?.url);
          if (file) images.push(file);
        }
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
    buttons,
    accent: payload.components?.find((c) => c.type === 17)?.accent_color as number | undefined,
    silent: Boolean((payload.flags ?? 0) & SUPPRESS_NOTIFICATIONS),
    mentionsNobody: mentionsNobody(payload),
    // Discord notifies a user mentioned in the text only if the message allows it.
    mentions: (payload.allowed_mentions?.users ?? []).filter((id) => texts.some((t) => t.includes(`<@${id}>`))),
    componentCount: count,
    textLength: length,
    images,
  };
}
