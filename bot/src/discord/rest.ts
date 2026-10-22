// Discord's REST API, with its rate limits obeyed: a route that reports no requests left waits for its reset, and
// a 429 waits as long as Discord asks before trying again.
import type { Log } from '../log.ts';
import type { MessagePayload, PlainMessage } from './components.ts';

export class DiscordError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  constructor(status: number, code: number | undefined, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Whether Discord refused a request outright, so it surely didn't take it. Anything else, such as a timeout or a
 * server error, leaves it uncertain.
 */
export const refused = (error: unknown) => error instanceof DiscordError && error.status < 500;

export interface InteractionResponse {
  type: number;
  data?: Record<string, unknown>;
}

/** A thread as Discord lists it; a forum post is one. */
interface ThreadObject {
  id: string;
  parent_id: string;
  owner_id: string;
  name: string;
  thread_metadata: { archive_timestamp: string };
}

const MAX_RETRIES = 5;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DiscordRest {
  #apiBaseUrl: string;
  #token: string;
  #log: Log;
  /** When each route may be used again, after Discord said it had no requests left. */
  #routeResets = new Map<string, number>();
  #userId: string | undefined;

  constructor(options: { apiBaseUrl: string; token: string; log: Log }) {
    this.#apiBaseUrl = options.apiBaseUrl.replace(/\/$/, '');
    this.#token = options.token;
    this.#log = options.log;
  }

  async gatewayUrl(): Promise<string> {
    const body = (await this.#request('GET', '/gateway/bot')) as { url: string };
    return body.url;
  }

  /** Opens a post in a forum channel, with the forum tags given by id; its first message has the post's own id. */
  async createForumPost(forumId: string, title: string, message: MessagePayload, tagIds: string[] = []): Promise<{ threadId: string }> {
    const post = { name: title, message, ...(tagIds.length > 0 ? { applied_tags: tagIds } : {}) };
    const body = (await this.#request('POST', `/channels/${forumId}/threads`, post)) as { id: string };
    return { threadId: body.id };
  }

  /** The tags a forum offers, as the person set them up. */
  async forumTags(forumId: string): Promise<{ id: string; name: string }[]> {
    const forum = (await this.#request('GET', `/channels/${forumId}`)) as { available_tags?: { id: string; name: string }[] };
    return (forum.available_tags ?? []).map(({ id, name }) => ({ id, name }));
  }

  async sendMessage(channelId: string, message: MessagePayload | PlainMessage): Promise<{ messageId: string }> {
    const body = (await this.#request('POST', `/channels/${channelId}/messages`, message)) as { id: string };
    return { messageId: body.id };
  }

  /** Rewrites one of the bot's messages. An archived thread must be unarchived first. */
  async editMessage(channelId: string, messageId: string, message: MessagePayload): Promise<void> {
    await this.#request('PATCH', `/channels/${channelId}/messages/${messageId}`, message);
  }

  /** Renames a thread, such as a forum post, sets a forum post's tags by id, or archives or unarchives it. */
  async editThread(threadId: string, change: { name?: string; archived?: boolean; applied_tags?: string[] }): Promise<void> {
    await this.#request('PATCH', `/channels/${threadId}`, change);
  }

  /**
   * The post the bot started in a forum under this title, open or archived, if there is one. A forum archives a
   * post that goes quiet, after an hour by default; only posts archived since `since` are looked through.
   */
  async findForumPost(forumId: string, title: string, since: Date): Promise<string | undefined> {
    const me = await this.#botUserId();
    const ours = (t: ThreadObject) => t.parent_id === forumId && t.owner_id === me && t.name === title;
    const forum = (await this.#request('GET', `/channels/${forumId}`)) as { guild_id: string };
    const active = (await this.#request('GET', `/guilds/${forum.guild_id}/threads/active`)) as { threads: ThreadObject[] };
    const open = active.threads.find(ours);
    if (open) return open.id;
    // Archived posts come most recently archived first, a page at a time.
    let before = '';
    for (;;) {
      const page = (await this.#request(
        'GET',
        `/channels/${forumId}/threads/archived/public?limit=50${before && `&before=${encodeURIComponent(before)}`}`,
      )) as { threads: ThreadObject[]; has_more: boolean };
      const found = page.threads.find(ours);
      if (found) return found.id;
      const last = page.threads.at(-1)?.thread_metadata.archive_timestamp;
      if (!page.has_more || !last || Date.parse(last) < since.getTime()) return undefined;
      before = last;
    }
  }

  /** The ids of the bot's own latest messages in a channel, oldest first. */
  async ownMessages(channelId: string): Promise<string[]> {
    const me = await this.#botUserId();
    const messages = (await this.#request('GET', `/channels/${channelId}/messages?limit=100`)) as { id: string; author: { id: string } }[];
    return messages
      .filter((m) => m.author.id === me)
      .map((m) => m.id)
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  }

  async #botUserId(): Promise<string> {
    this.#userId ??= ((await this.#request('GET', '/users/@me')) as { id: string }).id;
    return this.#userId;
  }

  /** Answers an interaction. The interaction's own token authorises this call, not the bot's. */
  async respond(interactionId: string, interactionToken: string, response: InteractionResponse): Promise<void> {
    await this.#request('POST', `/interactions/${interactionId}/${interactionToken}/callback`, response, false);
  }

  async #request(method: string, path: string, body?: unknown, authorise = true): Promise<unknown> {
    // Rate limits apply per route and major parameter (the channel or interaction).
    const route = `${method} ${path.split('/').slice(0, 3).join('/')}`;
    for (let attempt = 0; ; attempt++) {
      const wait = (this.#routeResets.get(route) ?? 0) - Date.now();
      if (wait > 0) await sleep(wait);
      const response = await fetch(`${this.#apiBaseUrl}${path}`, {
        method,
        headers: {
          ...(authorise ? { authorization: `Bot ${this.#token}` } : {}),
          'content-type': 'application/json',
          'user-agent': 'DiscordBot (https://github.com/ultrasadness/lab1, 1)',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.get('x-ratelimit-remaining') === '0') {
        const resetAfter = Number(response.headers.get('x-ratelimit-reset-after') ?? 0);
        this.#routeResets.set(route, Date.now() + resetAfter * 1000);
      }
      const text = await response.text();
      const json = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const seconds = Number(json?.retry_after ?? response.headers.get('retry-after') ?? 1);
        this.#log('discord.rate-limited', { route, waitSeconds: seconds, global: Boolean(json?.global) });
        await sleep(seconds * 1000 + 50);
        continue;
      }
      if (!response.ok) {
        const code = typeof json?.code === 'number' ? json.code : undefined;
        throw new DiscordError(response.status, code, `Discord refused ${route}: ${response.status} ${JSON.stringify(json ?? {})}`);
      }
      return json;
    }
  }
}
