// Discord's REST API, with its rate limits obeyed: a route that reports no requests left waits for its reset, and
// a 429 waits as long as Discord asks before trying again.
import type { Log } from '../log.ts';
import type { MessagePayload } from './components.ts';

export class DiscordError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  constructor(status: number, code: number | undefined, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface InteractionResponse {
  type: number;
  data?: Record<string, unknown>;
}

const MAX_RETRIES = 5;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DiscordRest {
  #apiBaseUrl: string;
  #token: string;
  #log: Log;
  /** When each route may be used again, after Discord said it had no requests left. */
  #routeResets = new Map<string, number>();

  constructor(options: { apiBaseUrl: string; token: string; log: Log }) {
    this.#apiBaseUrl = options.apiBaseUrl.replace(/\/$/, '');
    this.#token = options.token;
    this.#log = options.log;
  }

  async gatewayUrl(): Promise<string> {
    const body = (await this.#request('GET', '/gateway/bot')) as { url: string };
    return body.url;
  }

  /** Opens a post in a forum channel; its first message has the post's own id. */
  async createForumPost(forumId: string, title: string, message: MessagePayload): Promise<{ threadId: string }> {
    const body = (await this.#request('POST', `/channels/${forumId}/threads`, { name: title, message })) as { id: string };
    return { threadId: body.id };
  }

  async sendMessage(channelId: string, message: MessagePayload): Promise<{ messageId: string }> {
    const body = (await this.#request('POST', `/channels/${channelId}/messages`, message)) as { id: string };
    return { messageId: body.id };
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
