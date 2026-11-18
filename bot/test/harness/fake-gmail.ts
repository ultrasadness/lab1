// A fake Gmail: the Signup mailbox as Google's token endpoint and the Gmail API serve it to the bot. Tests deliver mail
// to it and read what the bot asked.
//
// What it is anchored to. The trial on the real Signup mailbox (#17, `docs/tasks/gmail-checks/results.md` on
// `task/gmail-checks`, 2026-10-14) saw:
// - the token endpoint's refresh answer, whose `scope` lists `gmail.compose` then `gmail.readonly`;
// - `history.list` with `historyTypes=messageAdded` and no `labelId` reporting mail Gmail filed straight into Spam, its
//   `messagesAdded[].message.labelIds` holding `SPAM`, and Inbox mail with `INBOX`, as here;
// - one `Authentication-Results` header on a message read with `format=full`, the topmost, added by `mx.google.com`
//   and carrying `dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=<domain>`, beside one `ARC-Authentication-Results`.
//   A header the sender wrote comes below Gmail's, as a message's own headers come after those Gmail adds on receipt;
// - a profile holding the mailbox's `emailAddress` and its current `historyId`, which `history.list` starts after.
// From Google's API documentation, not tried on the real service: `messages.list`'s `q=after:<epoch seconds>` and
// `includeSpamTrash`, an answer with no `messages` field when nothing matches, a `404` from `history.list` whose start
// is too old to serve, the error body every Gmail API error has (`error.code`, `error.errors[].reason`), a rate limit
// answered `429` (or `403` with `rateLimitExceeded`) with an optional `Retry-After` in seconds, an access token refused
// `401` once its `expires_in` is past or it is revoked, and the token endpoint's own `429`. Drafts, whose ids
// the trial saw stay stable across Gmail iOS saves, come with the Reply drafts of #62.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Clock } from '../../src/clock.ts';

/** The scopes ops/token asks for, as Google's refresh answer lists them (#17). */
export const GRANTED_SCOPES = ['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.readonly'];

/** A mail as a test delivers it. Gmail adds what it adds on receipt: its own `Authentication-Results`, labels, ids. */
export interface Mail {
  /** Gmail's message id; one is made when not given. */
  id?: string;
  /** The thread it joins; a thread of its own when not given. */
  threadId?: string;
  /** The `From` header, such as `Codemind <hello@codemindhq.dev>`. */
  from: string;
  /** The `To` header: the Signup mailbox's own address when not given. */
  to?: string;
  cc?: string;
  /** The `Delivered-To` header Gmail adds: the address the mail was delivered to, `to`'s first one when not given. */
  deliveredTo?: string;
  subject?: string;
  /** A `text/plain` body. */
  text?: string;
  /** A `text/html` body, beside the plain one as `multipart/alternative` when both are given. */
  html?: string;
  /** When Gmail received it: the clock's time when not given. */
  receivedAt?: string;
  /** Filed straight into Spam. */
  spam?: boolean;
  /** In the Trash by the time it is read, as when the person deleted it at once. */
  trash?: boolean;
  /** Mail of the mailbox's own: a draft, or mail it sent, which history reports as added too (#17). */
  own?: 'DRAFT' | 'SENT';
  /** The charset its body parts name: UTF-8 unless given. The body is UTF-8 whatever it names. */
  charset?: string;
  /** Its `List-Unsubscribe` header, which bulk mail carries. */
  listUnsubscribe?: string;
  /** Its `Reply-To` header, where a reply goes in place of `From`. */
  replyTo?: string;
  /** Gmail's DMARC verdict in its own `Authentication-Results`, for `From`'s domain: pass unless given. */
  dmarc?: 'pass' | 'fail' | 'none';
  /** `Authentication-Results` headers the sender wrote, which sit below Gmail's. */
  senderAuthResults?: string[];
}

interface Header {
  name: string;
  value: string;
}

interface Part {
  partId: string;
  mimeType: string;
  filename: string;
  headers: Header[];
  body: { size: number; data?: string };
  parts?: Part[];
}

/** A message as `messages.get` with `format=full` returns it. */
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string;
  sizeEstimate: number;
  payload: Part;
}

/** A request the bot made of the Gmail API, with when it came on the test's clock. */
export interface GmailRequest {
  method: string;
  /** The path after `/gmail/v1/users/me`, such as `/history` or `/messages/m1`. */
  path: string;
  query: Record<string, string>;
  at: string;
}

const API = '/gmail/v1/users/me';

/** Gmail's error body (Google's documented shape for every API error). */
const errorBody = (code: number, status: string, reason: string, message: string) =>
  JSON.stringify({ error: { code, message, errors: [{ message, domain: code === 429 ? 'usageLimits' : 'global', reason }], status } });

const part = (partId: string, mimeType: string, text: string, charset = 'UTF-8'): Part => {
  const data = Buffer.from(text, 'utf8');
  return {
    partId,
    mimeType,
    filename: '',
    headers: [{ name: 'Content-Type', value: `${mimeType}; charset="${charset}"` }],
    body: { size: data.length, data: data.toString('base64url') },
  };
};

/** The address inside a header value such as `Name <a@b.c>`. */
const addressOf = (value: string) => (value.match(/<([^>]*)>/)?.[1] ?? value).trim();

export class FakeGmail {
  /** Every request the bot made of the Gmail API, oldest first. */
  readonly requests: GmailRequest[] = [];
  /** Every request that would change the mailbox. The scopes refuse each, and the bot should make none. */
  readonly changes: GmailRequest[] = [];
  /** The refresh tokens' trades for an access token, each with the client it came with. */
  readonly refreshes: { clientId: string; at: string }[] = [];
  /** The mailbox the token belongs to, as the profile names it. */
  emailAddress: string;
  /** The scopes the refresh token holds, as its refresh answer lists them. */
  scopes = [...GRANTED_SCOPES];
  /** How many history records or messages one page holds. */
  pageSize = 100;

  #server: http.Server;
  #clock: Clock;
  #client: { id: string; secret: string };
  #refreshToken: string;
  /** Each access token Google gave, with when it ends on the test's clock. */
  #accessTokens = new Map<string, number>();
  #tokenLimits: (number | undefined)[] = [];
  #messages = new Map<string, GmailMessage>();
  #history: { id: number; message: { id: string; threadId: string; labelIds: string[] } }[] = [];
  #historyId = 1892;
  /** History records at or below this id are no longer served: a start before it answers 404. */
  #historyFrom = 0;
  #limited: { status: 429 | 403; retryAfterSeconds?: number }[] = [];
  #held = new Set<string>();
  /** Messages deleted once they have been read so many more times. */
  #removeAfter = new Map<string, number>();
  /** Messages whose next read, once they have been read so many more times, is refused for a rate limit. */
  #limitAfter = new Map<string, { reads: number; retryAfterSeconds: number }>();
  #heldRequests: http.ServerResponse[] = [];
  #next = 1;

  private constructor(options: { clock: Clock; client: { id: string; secret: string }; refreshToken: string; emailAddress: string }) {
    this.#clock = options.clock;
    this.#client = options.client;
    this.#refreshToken = options.refreshToken;
    this.emailAddress = options.emailAddress;
    this.#server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => this.#handle(req, Buffer.concat(chunks).toString('utf8'), res));
    });
  }

  static async start(options: { clock: Clock; client: { id: string; secret: string }; refreshToken: string; emailAddress: string }): Promise<FakeGmail> {
    const gmail = new FakeGmail(options);
    await new Promise<void>((resolve) => gmail.#server.listen(0, '127.0.0.1', resolve));
    return gmail;
  }

  get #base(): string {
    return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  /** The Gmail API's base for the mailbox, as `https://gmail.googleapis.com/gmail/v1/users/me` is the real one. */
  get apiUrl(): string {
    return `${this.#base}${API}`;
  }

  /** Google's token endpoint, as `https://oauth2.googleapis.com/token` is the real one. */
  get tokenUrl(): string {
    return `${this.#base}/token`;
  }

  /** Delivers a mail, as Gmail does on receipt: it gets its labels, an id, and a history record. Returns its id. */
  deliver(mail: Mail): string {
    const id = mail.id ?? `m${String(this.#next++).padStart(4, '0')}`;
    const threadId = mail.threadId ?? id;
    const labelIds = mail.own ? [mail.own] : mail.trash ? ['TRASH'] : mail.spam ? ['UNREAD', 'CATEGORY_PERSONAL', 'SPAM'] : ['UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL', 'INBOX'];
    const received = mail.receivedAt ? Date.parse(mail.receivedAt) : this.#clock.now().getTime();
    const to = mail.to ?? this.emailAddress;
    const fromDomain = addressOf(mail.from).split('@')[1] ?? '';
    const dmarc = mail.dmarc ?? 'pass';
    const headers: Header[] = [
      { name: 'Delivered-To', value: mail.deliveredTo ?? addressOf(to.split(',')[0]!) },
      { name: 'Received', value: `by 2002:a05:6a10:1::1 with SMTP id x; ${new Date(received).toUTCString()}` },
      { name: 'ARC-Authentication-Results', value: `i=1; mx.google.com; dmarc=${dmarc} header.from=${fromDomain}` },
      { name: 'Return-Path', value: `<bounce@${fromDomain}>` },
      {
        name: 'Authentication-Results',
        value: `mx.google.com; dkim=pass header.i=@${fromDomain}; spf=pass smtp.mailfrom=${fromDomain}; dmarc=${dmarc} (p=NONE sp=NONE dis=NONE) header.from=${fromDomain}`,
      },
      ...(mail.senderAuthResults ?? []).map((value) => ({ name: 'Authentication-Results', value })),
      { name: 'From', value: mail.from },
      { name: 'To', value: to },
      ...(mail.cc ? [{ name: 'Cc', value: mail.cc }] : []),
      { name: 'Subject', value: mail.subject ?? '' },
      { name: 'Date', value: new Date(received).toUTCString() },
      { name: 'Message-ID', value: `<${id}@${fromDomain}>` },
      ...(mail.listUnsubscribe ? [{ name: 'List-Unsubscribe', value: mail.listUnsubscribe }] : []),
      ...(mail.replyTo ? [{ name: 'Reply-To', value: mail.replyTo }] : []),
      { name: 'MIME-Version', value: '1.0' },
    ];
    const plain = mail.text !== undefined ? part('0', 'text/plain', mail.text, mail.charset) : undefined;
    const html = mail.html !== undefined ? part(plain ? '1' : '0', 'text/html', mail.html, mail.charset) : undefined;
    let payload: Part;
    if (plain && html) {
      payload = { partId: '', mimeType: 'multipart/alternative', filename: '', headers: [...headers, { name: 'Content-Type', value: 'multipart/alternative; boundary="b"' }], body: { size: 0 }, parts: [plain, html] };
    } else {
      const only = plain ?? html ?? part('', 'text/plain', '');
      payload = { ...only, partId: '', headers: [...headers, ...only.headers] };
    }
    this.#historyId += 1;
    this.#messages.set(id, {
      id,
      threadId,
      labelIds,
      snippet: (mail.text ?? '').slice(0, 100),
      historyId: String(this.#historyId),
      internalDate: String(received),
      sizeEstimate: 1000,
      payload,
    });
    this.#history.push({ id: this.#historyId, message: { id, threadId, labelIds } });
    return id;
  }

  /** The message is deleted, as the person may in Gmail before the bot reads it: its history record stays. */
  remove(id: string): void {
    this.#messages.delete(id);
  }

  /**
   * The message is deleted once it has been read this many more times, as when the person deletes it in Gmail between
   * the bot's reads. A deleted message's `messages.get` answers 404, as `remove` has it.
   */
  removeAfterReads(id: string, reads: number): void {
    this.#removeAfter.set(id, reads);
  }

  /**
   * Once the message has been read this many more times, its next read is refused for a rate limit, `429` with this
   * `Retry-After`, as `limitNext` refuses any request.
   */
  limitAfterReads(id: string, reads: number, retryAfterSeconds: number): void {
    this.#limitAfter.set(id, { reads, retryAfterSeconds });
  }

  /** Changes the message as Gmail would serve it, to stand for one sent malformed. */
  corrupt(id: string, change: (message: Record<string, unknown>) => void): void {
    change(this.#messages.get(id) as unknown as Record<string, unknown>);
  }

  /** Every access token Google gave stops working, as when it is revoked. */
  revokeAccessTokens(): void {
    this.#accessTokens.clear();
  }

  /** The next trades of the refresh token are refused for a rate limit, in order, each with its `Retry-After` if given. */
  limitTokenRefresh(...retryAfterSeconds: (number | undefined)[]): void {
    this.#tokenLimits.push(...retryAfterSeconds);
  }

  /** Gmail no longer serves history this old: a start before now answers 404, as after a week unread. */
  forgetHistory(): void {
    this.#historyFrom = this.#historyId;
  }

  /** The next requests of the Gmail API are refused for a rate limit, in order, each with its `Retry-After` if given. */
  limitNext(...limits: { status?: 429 | 403; retryAfterSeconds?: number }[]): void {
    this.#limited.push(...limits.map((l) => ({ status: l.status ?? 429, retryAfterSeconds: l.retryAfterSeconds })));
  }

  /** Each request for this message is taken and never answered, from now until the fake closes. */
  holdMessage(id: string): void {
    this.#held.add(id);
  }

  /** Requests for messages are answered again; one held stays held. */
  releaseHolds(): void {
    this.#held.clear();
  }

  /** How many requests are held unanswered. */
  get held(): number {
    return this.#heldRequests.length;
  }

  /** The requests the bot made for this message's content. */
  readsOf(id: string): GmailRequest[] {
    return this.requests.filter((r) => r.path === `/messages/${id}`);
  }

  #handle(req: http.IncomingMessage, body: string, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', this.#base);
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=UTF-8', ...headers }).end(typeof value === 'string' ? value : JSON.stringify(value));
    };
    if (url.pathname === '/token') return this.#token(req.method ?? '', body, json);
    if (!url.pathname.startsWith(API)) return json(404, errorBody(404, 'NOT_FOUND', 'notFound', 'Not Found'));
    const request: GmailRequest = {
      method: req.method ?? '',
      path: url.pathname.slice(API.length),
      query: Object.fromEntries(url.searchParams),
      at: this.#clock.now().toISOString(),
    };
    this.requests.push(request);
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!((this.#accessTokens.get(bearer) ?? 0) > this.#clock.now().getTime())) return json(401, errorBody(401, 'UNAUTHENTICATED', 'authError', 'Request had invalid authentication credentials.'));
    const limit = this.#limited.shift();
    if (limit) {
      const reason = limit.status === 429 ? 'rateLimitExceeded' : 'userRateLimitExceeded';
      return json(limit.status, errorBody(limit.status, limit.status === 429 ? 'RESOURCE_EXHAUSTED' : 'PERMISSION_DENIED', reason, 'Rate Limit Exceeded'), limit.retryAfterSeconds === undefined ? {} : { 'retry-after': String(limit.retryAfterSeconds) });
    }
    if (request.method !== 'GET') {
      // gmail.readonly and gmail.compose let no message be modified, moved, trashed or deleted.
      this.changes.push(request);
      return json(403, errorBody(403, 'PERMISSION_DENIED', 'insufficientPermissions', 'Request had insufficient authentication scopes.'));
    }
    if (request.path === '/profile') {
      return json(200, { emailAddress: this.emailAddress, messagesTotal: this.#messages.size, threadsTotal: this.#messages.size, historyId: String(this.#historyId) });
    }
    if (request.path === '/history') return this.#historyList(url.searchParams, json);
    if (request.path === '/messages') return this.#list(url.searchParams, json);
    const one = request.path.match(/^\/messages\/([^/]+)$/);
    if (one) {
      if (this.#held.has(one[1]!)) {
        this.#heldRequests.push(res);
        return;
      }
      const message = this.#messages.get(one[1]!);
      if (!message) return json(404, errorBody(404, 'NOT_FOUND', 'notFound', 'Requested entity was not found.'));
      const limitAfter = this.#limitAfter.get(message.id);
      if (limitAfter && limitAfter.reads === 0) {
        this.#limitAfter.delete(message.id);
        return json(429, errorBody(429, 'RESOURCE_EXHAUSTED', 'rateLimitExceeded', 'Rate Limit Exceeded'), { 'retry-after': String(limitAfter.retryAfterSeconds) });
      }
      if (limitAfter) limitAfter.reads -= 1;
      if ((url.searchParams.get('format') ?? 'full') !== 'full') return json(400, errorBody(400, 'INVALID_ARGUMENT', 'invalidArgument', 'This fake serves format=full only'));
      const left = this.#removeAfter.get(message.id);
      if (left !== undefined && left <= 1) {
        this.#removeAfter.delete(message.id);
        this.#messages.delete(message.id);
      } else if (left !== undefined) {
        this.#removeAfter.set(message.id, left - 1);
      }
      return json(200, message);
    }
    return json(404, errorBody(404, 'NOT_FOUND', 'notFound', 'Not Found'));
  }

  #token(method: string, body: string, json: (status: number, value: unknown, headers?: Record<string, string>) => void): void {
    const form = new URLSearchParams(body);
    if (method !== 'POST' || form.get('grant_type') !== 'refresh_token') return json(400, { error: 'unsupported_grant_type', error_description: 'Invalid grant_type' });
    if (form.get('client_id') !== this.#client.id || form.get('client_secret') !== this.#client.secret) {
      return json(401, { error: 'invalid_client', error_description: 'Unauthorized' });
    }
    if (form.get('refresh_token') !== this.#refreshToken) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    if (this.#tokenLimits.length > 0) {
      const retryAfter = this.#tokenLimits.shift();
      return json(429, { error: 'rate_limit_exceeded', error_description: 'Rate limit exceeded' }, retryAfter === undefined ? {} : { 'retry-after': String(retryAfter) });
    }
    this.refreshes.push({ clientId: form.get('client_id')!, at: this.#clock.now().toISOString() });
    const token = `ya29.fake-access-${this.refreshes.length}`;
    // Google's answer says it lasts 3599 seconds, and a request after that is refused 401.
    this.#accessTokens.set(token, this.#clock.now().getTime() + 3599_000);
    json(200, { access_token: token, expires_in: 3599, scope: this.scopes.join(' '), token_type: 'Bearer' });
  }

  #historyList(params: URLSearchParams, json: (status: number, value: unknown) => void): void {
    const start = Number(params.get('startHistoryId'));
    if (!Number.isInteger(start) || start <= 0) return json(400, errorBody(400, 'INVALID_ARGUMENT', 'invalidArgument', 'Invalid startHistoryId'));
    if (start < this.#historyFrom) return json(404, errorBody(404, 'NOT_FOUND', 'notFound', 'Requested entity was not found.'));
    const types = params.getAll('historyTypes');
    const after = this.#history.filter((h) => h.id > start && (types.length === 0 || types.includes('messageAdded')));
    const offset = Number(params.get('pageToken') ?? 0);
    const page = after.slice(offset, offset + this.pageSize);
    const next = offset + this.pageSize < after.length ? String(offset + this.pageSize) : undefined;
    json(200, {
      ...(page.length > 0
        ? { history: page.map((h) => ({ id: String(h.id), messages: [{ id: h.message.id, threadId: h.message.threadId }], messagesAdded: [{ message: h.message }] })) }
        : {}),
      ...(next ? { nextPageToken: next } : {}),
      historyId: String(this.#historyId),
    });
  }

  #list(params: URLSearchParams, json: (status: number, value: unknown) => void): void {
    const q = params.get('q') ?? '';
    const after = q.match(/^after:(\d+)$/);
    if (q && !after) return json(400, errorBody(400, 'INVALID_ARGUMENT', 'invalidArgument', `This fake answers q=after:<epoch seconds> only, not ${q}`));
    const spamTrash = params.get('includeSpamTrash') === 'true';
    // Newest first, as Gmail lists them.
    const found = [...this.#messages.values()]
      .filter((m) => !after || Number(m.internalDate) > Number(after[1]) * 1000)
      .filter((m) => spamTrash || !m.labelIds.some((l) => l === 'SPAM' || l === 'TRASH'))
      .sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
    const offset = Number(params.get('pageToken') ?? 0);
    const page = found.slice(offset, offset + this.pageSize);
    const next = offset + this.pageSize < found.length ? String(offset + this.pageSize) : undefined;
    json(200, {
      ...(page.length > 0 ? { messages: page.map((m) => ({ id: m.id, threadId: m.threadId })) } : {}),
      ...(next ? { nextPageToken: next } : {}),
      resultSizeEstimate: found.length,
    });
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }
}
