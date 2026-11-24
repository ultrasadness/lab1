// The browser tests' client for the socket. The bot imports nothing from browser/, so its own side is bot/src/browser.ts.
import http from 'node:http';
import type {
  CheckRequest,
  Driver,
  Health,
  PageCheck,
  PageRead,
  Press,
  ReadFailure,
  ReadOutcome,
  RedirectAnswer,
  RedirectOutcome,
  Refusal,
  Screenshot,
  SecretKind,
  SessionDomain,
  SessionOpen,
  SessionOutcome,
  SessionSnapshot,
} from './api.ts';

export class BrowserClient {
  readonly socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async health(): Promise<Health> {
    const { status, body } = await this.request('GET', '/health');
    if (status !== 200) throw new Error(`browser service health: HTTP ${status}`);
    return body as Health;
  }

  /** Reads a page in a throwaway context. A page that won't load is a failure, not an exception. */
  async read(url: string): Promise<ReadOutcome> {
    const { status, body } = await this.request('POST', '/read', { url });
    if (status === 200) return { ok: true, page: body as PageRead };
    const error = (body as { error?: ReadFailure } | null)?.error;
    // 400 and 502 are a page that can't be read; any other answer is the service failing.
    if ((status !== 400 && status !== 502) || !error) throw new Error(`browser service read: HTTP ${status}${error ? `: ${error.message}` : ''}`);
    return { ok: false, error };
  }

  /** Sends a HEAD of a URL and follows nothing. A request that fails is a failure, not an exception. */
  async redirect(url: string): Promise<RedirectOutcome> {
    const { status, body } = await this.request('POST', '/redirect', { url });
    if (status === 200) return { ok: true, redirect: body as RedirectAnswer };
    const error = (body as { error?: ReadFailure } | null)?.error;
    if ((status !== 400 && status !== 502) || !error) throw new Error(`browser service redirect: HTTP ${status}${error ? `: ${error.message}` : ''}`);
    return { ok: false, error };
  }

  // A Registration's session. A refusal is an answer; any other failure is the service failing.

  openSession(open: SessionOpen): Promise<SessionOutcome<{ session: string }>> {
    return this.session('/session/open', open);
  }

  closeSession(session: string): Promise<SessionOutcome> {
    return this.session('/session/close', { session });
  }

  drive(session: string, driver: Driver): Promise<SessionOutcome> {
    return this.session('/session/drive', { session, driver });
  }

  /** Adds a domain to the session's, on which its actions may then act. */
  addDomain(session: string, domain: string): Promise<SessionOutcome> {
    return this.session('/session/domains', { session, domain } satisfies SessionDomain);
  }

  // The fixed actions a fill run may use, through the bot.

  snapshot(session: string): Promise<SessionOutcome<SessionSnapshot>> {
    return this.session('/fill-run/snapshot', { session });
  }

  /** Fills a field with the approved value the bot supplies for the Walkthrough key. */
  fill(session: string, field: string, key: string, value: string): Promise<SessionOutcome> {
    return this.session('/fill-run/fill', { session, field, key, value });
  }

  fillSecret(session: string, field: string, secret: SecretKind, value: string): Promise<SessionOutcome> {
    return this.session('/fill-run/fill-secret', { session, field, secret, value });
  }

  /** Picks an option by its label, or sets a box to `ticked` or `left unticked`. */
  choose(session: string, field: string, key: string, value: string): Promise<SessionOutcome> {
    return this.session('/fill-run/choose', { session, field, key, value });
  }

  /** Loads a link's URL. */
  open(session: string, link: string): Promise<SessionOutcome> {
    return this.session('/fill-run/open', { session, link });
  }

  // Plain code's.

  /** The same snapshot as a fill run's, for plain code's own use; it too replaces the session's refs. */
  plainSnapshot(session: string): Promise<SessionOutcome<SessionSnapshot>> {
    return this.session('/plain-code/snapshot', { session });
  }

  check(session: string, request: CheckRequest): Promise<SessionOutcome<PageCheck>> {
    return this.session('/plain-code/check', { session, ...request });
  }

  fingerprint(session: string): Promise<SessionOutcome<{ fingerprint: string; shape: string }>> {
    return this.session('/plain-code/fingerprint', { session });
  }

  screenshot(session: string, marks: { outline?: string; mark?: string[] } = {}): Promise<SessionOutcome<Screenshot>> {
    return this.session('/plain-code/screenshot', { session, ...marks });
  }

  press(session: string, request: CheckRequest): Promise<SessionOutcome<Press>> {
    return this.session('/plain-code/press', { session, ...request });
  }

  /** Fills an emailed code by reference. */
  fillCode(session: string, field: string, value: string): Promise<SessionOutcome> {
    return this.session('/plain-code/fill-code', { session, field, value });
  }

  /** Opens a verification link by reference; the session closes once it has loaded. */
  openLink(session: string, url: string): Promise<SessionOutcome> {
    return this.session('/plain-code/open-link', { session, url });
  }

  private async session<T extends object>(path: string, payload: object): Promise<SessionOutcome<T>> {
    const { status, body } = await this.request('POST', path, payload);
    if (status === 200) return { ok: true, ...(body as T) };
    const error = (body as { error?: Refusal } | null)?.error;
    if (status >= 500 && status !== 502 && status !== 504) throw new Error(`browser service ${path}: HTTP ${status}${error ? `: ${error.message}` : ''}`);
    if (!error) throw new Error(`browser service ${path}: HTTP ${status} with no reason`);
    return { ok: false, error };
  }

  private request(method: string, path: string, payload?: unknown): Promise<{ status: number; body: unknown }> {
    const data = payload === undefined ? undefined : JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socketPath,
          method,
          path,
          headers: data === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
          timeout: 120_000,
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (text += chunk));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`browser service ${path}: timed out`)));
      req.on('error', reject);
      req.end(data);
    });
  }
}
