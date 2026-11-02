// A fake browser service on a Unix socket, answering `read(url)` as the real one does (browser/src/api.ts). Each
// Launch's website redirect leads to a page set for it, or to a plain landing page of its own on a `.example` site,
// with a pricing link and a signup link to pages of their own. A page set at the redirect's own URL keeps the read
// there, as Product Hunt's Cloudflare challenge did on the VM (#85). A HEAD answers what a test sets, as the real one
// answered 301 with the landing page in #101's trial on 2026-11-02. Unset, it answers 403, which stands for Product Hunt
// closing that route: no trial has seen it, and #102 waits on it. Tests set pages, redirects, HEAD answers and failures per URL, and read which URLs the bot asked for.
import http from 'node:http';
import { rmSync } from 'node:fs';

export interface FakeLink {
  text: string;
  href: string;
}

export interface FakeField {
  type: string;
  name: string | null;
  label: string;
  required: boolean;
  autocomplete: string | null;
  links: FakeLink[];
  value?: string;
  checked?: boolean;
  options?: { label: string; value: string; selected: boolean }[];
}

export interface FakeForm {
  formElement: boolean;
  action: string | null;
  method: string | null;
  fields: FakeField[];
  submits: { label: string; disabled: boolean }[];
  links: FakeLink[];
}

/** A page as a test sets it: where it is, and what a read sees there. */
export interface FakePage {
  url: string;
  title: string;
  text: string;
  links?: FakeLink[];
  forms?: FakeForm[];
  botCheck?: string | null;
  paymentFields?: boolean;
  /** The final document's HTTP status, 200 unless set. */
  status?: number;
}

export type FakeReadFailure = { kind: 'load-failed' | 'timeout' | 'download'; message: string };

/** What a HEAD of a URL answers. */
export interface FakeHead {
  status: number;
  location: string | null;
}

const REDIRECT = /^https:\/\/www\.producthunt\.com\/r\/p\/(\d+)$/;

/** A form with one email field and a submit button, as a plain signup page has. */
export const emailForm = (submit = 'Sign up'): FakeForm => ({
  formElement: true,
  action: null,
  method: 'post',
  fields: [{ type: 'email', name: 'email', label: 'Email', required: true, autocomplete: 'email', links: [] }],
  submits: [{ label: submit, disabled: false }],
  links: [],
});

export class FakeBrowser {
  readonly socketPath: string;
  /** Every URL the bot asked to read, in order. */
  readonly reads: string[] = [];
  /** Every URL the bot asked for a HEAD of, in order. */
  readonly heads: string[] = [];
  #server: http.Server;
  #pages = new Map<string, FakePage>();
  #redirects = new Map<string, string>();
  #failures = new Map<string, FakeReadFailure>();
  #headAnswers = new Map<string, FakeHead | FakeReadFailure>();
  /** While true, the service answers nothing, as when its container is down. */
  down = false;

  private constructor(socketPath: string) {
    this.socketPath = socketPath;
    this.#server = http.createServer((req, res) => void this.#handle(req, res));
  }

  static async start(socketPath: string): Promise<FakeBrowser> {
    const browser = new FakeBrowser(socketPath);
    rmSync(socketPath, { force: true });
    await new Promise<void>((resolve) => browser.#server.listen(socketPath, resolve));
    return browser;
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  /** Serves a page at its URL, in place of any redirect set from there. */
  page(page: FakePage): void {
    this.#redirects.delete(page.url);
    this.#pages.set(page.url, page);
  }

  /** A read of `from` ends at `to`, as after a redirect. */
  redirect(from: string, to: string): void {
    this.#redirects.set(from, to);
  }

  /** A read of this URL fails, or reads again once `failure` is undefined. */
  fail(url: string, failure: FakeReadFailure | undefined): void {
    if (failure) this.#failures.set(url, failure);
    else this.#failures.delete(url);
  }

  /** A HEAD of this URL answers so, or fails. */
  head(url: string, answer: FakeHead | FakeReadFailure): void {
    this.#headAnswers.set(url, answer);
  }

  /** Where a read of `url` ends, after redirects. */
  #resolve(url: string): string {
    const to = this.#redirects.get(url);
    if (to) return this.#resolve(to);
    if (this.#pages.has(url)) return url;
    const launch = url.match(REDIRECT);
    return launch ? `https://p${launch[1]}.example/` : url;
  }

  /** The page at a URL: one a test set, or the plain landing, pricing or signup page of a `.example` site. */
  #pageAt(url: string): FakePage | undefined {
    const set = this.#pages.get(url);
    if (set) return set;
    const site = url.match(/^https:\/\/(?:app\.)?(p\d+\.example)\/(pricing|signup)?$/);
    if (!site) return undefined;
    const [, host, path] = site;
    if (path === 'pricing') return { url, title: 'Pricing', text: 'Free: $0 a month. Pro: $10 a month.' };
    if (path === 'signup') return { url, title: 'Sign up', text: 'Create your account', forms: [emailForm()] };
    return {
      url,
      title: `The Product at ${host}`,
      text: 'The Product does one thing well.',
      links: [
        { text: 'Pricing', href: `https://${host}/pricing` },
        { text: 'Sign up', href: `https://app.${host}/signup` },
      ],
    };
  }

  async #handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (this.down) return void res.socket?.destroy();
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && req.url === '/redirect') {
      const url = (JSON.parse(raw) as { url?: unknown }).url;
      if (typeof url !== 'string') return send(400, { error: { kind: 'bad-url', message: 'redirect takes an http or https URL' } });
      this.heads.push(url);
      const answer = this.#headAnswers.get(url) ?? { status: 403, location: null };
      return 'kind' in answer ? send(502, { error: answer }) : send(200, answer);
    }
    if (req.method !== 'POST' || req.url !== '/read') return send(404, { error: { kind: 'not-found', message: `${req.method} ${req.url}` } });
    const url = (JSON.parse(raw) as { url?: unknown }).url;
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      return send(400, { error: { kind: 'bad-url', message: 'read takes an http or https URL with no username or password' } });
    }
    this.reads.push(url);
    const failure = this.#failures.get(url);
    if (failure) return send(502, { error: failure });
    const finalUrl = this.#resolve(url);
    const failed = this.#failures.get(finalUrl);
    if (failed) return send(502, { error: failed });
    const page = this.#pageAt(finalUrl);
    if (!page) return send(502, { error: { kind: 'load-failed', message: `net::ERR_NAME_NOT_RESOLVED at ${finalUrl}` } });
    send(200, {
      snapshot: { url: page.url, title: page.title, text: page.text, forms: page.forms ?? [], links: page.links ?? [] },
      finalUrl: page.url,
      finalHost: new URL(page.url).hostname,
      status: page.status ?? 200,
      paymentFields: page.paymentFields ?? false,
      botCheck: page.botCheck ?? null,
      cookieBanner: null,
    });
  }
}
