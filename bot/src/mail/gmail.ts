// The Gmail API, as the bot reaches the Signup mailbox with its refresh token (#16, #57): Google's token endpoint for an
// access token, the profile, the mailbox's history, a search, and a message read whole. The token holds exactly
// `gmail.readonly` and `gmail.compose`, so nothing here can move, label or delete mail. Every request ends within a
// time limit, and a rate-limit answer comes back as `GmailRateLimited`, for the reader to wait as it asks.
import type { Clock } from '../clock.ts';
import type { SecretGuard } from '../secret-guard.ts';

/** The scopes the token must hold, exactly (#16). */
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.readonly'];

/** How long one request may take. */
const REQUEST_MS = 30_000;
/** An access token is traded again this long before Google says it ends. */
const EARLY_MS = 60_000;

export class GmailError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Gmail answered with a rate limit; `retryAfterMs` is its `Retry-After`, when it gave one. */
export class GmailRateLimited extends GmailError {
  readonly retryAfterMs: number | undefined;
  constructor(status: number, retryAfterMs: number | undefined, message: string) {
    super(status, message);
    this.retryAfterMs = retryAfterMs;
  }
}

/** A `Retry-After` in seconds, as milliseconds, when an answer gave one. */
function retryAfterOf(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/** A message as Gmail's history or a search names it. */
export interface MessageRef {
  id: string;
  threadId: string;
}

/** A part of a message, as `messages.get` with `format=full` returns it. */
export interface MessagePart {
  mimeType?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string };
  parts?: MessagePart[];
}

/** A message read whole. Every field is as Gmail sent it, so the reader checks each one it uses. */
export interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: MessagePart;
}

/** What `history.list` gave from a start: the messages added since, oldest first, and the mailbox's history id now. */
export interface HistoryPage {
  added: MessageRef[];
  nextPageToken: string | undefined;
  historyId: string;
}

export class Gmail {
  #apiUrl: string;
  #tokenUrl: string;
  #client: { clientId: string; clientSecret: string };
  #refreshToken: string;
  #secrets: SecretGuard;
  #clock: Clock;
  #access: { token: string; until: number } | undefined;

  constructor(options: {
    apiUrl: string;
    tokenUrl: string;
    client: { clientId: string; clientSecret: string };
    refreshToken: string;
    secrets: SecretGuard;
    clock: Clock;
  }) {
    this.#apiUrl = options.apiUrl;
    this.#tokenUrl = options.tokenUrl;
    this.#client = options.client;
    this.#refreshToken = options.refreshToken;
    this.#secrets = options.secrets;
    this.#clock = options.clock;
  }

  /** Trades the refresh token for an access token, and returns the scopes Google says it holds. */
  async scopes(): Promise<string[]> {
    return (await this.#refresh()).scopes;
  }

  /** The mailbox the token reads, and its history id now. */
  async profile(): Promise<{ emailAddress: string; historyId: string }> {
    const body = (await this.#get('/profile')) as { emailAddress?: unknown; historyId?: unknown };
    if (typeof body.emailAddress !== 'string' || typeof body.historyId !== 'string') throw new GmailError(200, "Gmail's profile named no mailbox or history id");
    return { emailAddress: body.emailAddress, historyId: body.historyId };
  }

  /**
   * The messages added after `startHistoryId`, a page at a time, in the history's own order, which mail added later
   * can't move. `expired` when Gmail no longer serves history that old.
   */
  async history(startHistoryId: string, pageToken?: string): Promise<HistoryPage | 'expired'> {
    const query = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', maxResults: '500' });
    if (pageToken) query.set('pageToken', pageToken);
    let body: { history?: unknown; nextPageToken?: unknown; historyId?: unknown };
    try {
      body = (await this.#get(`/history?${query}`)) as typeof body;
    } catch (error) {
      if (error instanceof GmailError && error.status === 404) return 'expired';
      throw error;
    }
    if (typeof body.historyId !== 'string') throw new GmailError(200, 'Gmail’s history gave no history id');
    const added: MessageRef[] = [];
    for (const record of Array.isArray(body.history) ? body.history : []) {
      for (const entry of Array.isArray(record?.messagesAdded) ? record.messagesAdded : []) {
        const { id, threadId } = entry?.message ?? {};
        if (typeof id === 'string' && typeof threadId === 'string') added.push({ id, threadId });
      }
    }
    return { added, nextPageToken: typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined, historyId: body.historyId };
  }

  /** One page of the messages a search finds, Spam and Trash included, newest first, as Gmail lists them. */
  async list(q: string, pageToken?: string): Promise<{ found: MessageRef[]; nextPageToken: string | undefined }> {
    const query = new URLSearchParams({ q, includeSpamTrash: 'true', maxResults: '500' });
    if (pageToken) query.set('pageToken', pageToken);
    const body = (await this.#get(`/messages?${query}`)) as { messages?: unknown; nextPageToken?: unknown };
    const found: MessageRef[] = [];
    // An answer with nothing found has no `messages` field at all.
    for (const m of Array.isArray(body.messages) ? body.messages : []) {
      if (typeof m?.id === 'string' && typeof m?.threadId === 'string') found.push({ id: m.id, threadId: m.threadId });
    }
    return { found, nextPageToken: typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined };
  }

  /** A message read whole, or `gone` when it was deleted since its history was read. */
  async message(id: string): Promise<GmailMessage | 'gone'> {
    try {
      return (await this.#get(`/messages/${encodeURIComponent(id)}?format=full`)) as GmailMessage;
    } catch (error) {
      if (error instanceof GmailError && error.status === 404) return 'gone';
      throw error;
    }
  }

  async #get(path: string): Promise<unknown> {
    const { token } = this.#access && this.#access.until > this.#clock.now().getTime() ? this.#access : await this.#refresh();
    const response = await fetch(`${this.#apiUrl}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(REQUEST_MS) });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    if (response.ok && body && typeof body === 'object') return body;
    const error = (body as { error?: { message?: unknown; errors?: { reason?: unknown }[] } } | undefined)?.error;
    const said = typeof error?.message === 'string' ? error.message : text.slice(0, 200);
    const reasons = Array.isArray(error?.errors) ? error.errors.map((e) => e?.reason) : [];
    if (response.status === 429 || (response.status === 403 && reasons.some((r) => r === 'rateLimitExceeded' || r === 'userRateLimitExceeded'))) {
      throw new GmailRateLimited(response.status, retryAfterOf(response), `Gmail limited the rate: ${response.status} ${said}`);
    }
    if (response.status === 401) this.#access = undefined;
    throw new GmailError(response.status, `Gmail answered ${response.status}: ${said}`);
  }

  async #refresh(): Promise<{ token: string; until: number; scopes: string[] }> {
    const response = await fetch(this.#tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.#refreshToken, client_id: this.#client.clientId, client_secret: this.#client.clientSecret }),
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    const body = (await response.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; scope?: unknown; error?: unknown };
    if (response.status === 429) throw new GmailRateLimited(429, retryAfterOf(response), 'Google limited the rate of token refreshes');
    if (!response.ok || typeof body.access_token !== 'string') {
      throw new GmailError(response.status, `Google gave no access token: ${typeof body.error === 'string' ? body.error : `it answered ${response.status}`}`);
    }
    // An access token lets whoever holds it read the mailbox, so the last door holds it from now on (ADR 0009).
    this.#secrets.hold(body.access_token, { name: 'a Gmail access token', replace: 'It lasts an hour. Replace the refresh token behind it on the VM: `sudo ops/token gmail-refresh-token`.' });
    const seconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    this.#access = { token: body.access_token, until: this.#clock.now().getTime() + seconds * 1000 - EARLY_MS };
    const scopes = typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [];
    return { ...this.#access, scopes };
  }
}
