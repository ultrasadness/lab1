// A fake browser service on a Unix socket, answering `read(url)` as the real one does (browser/src/api.ts). Each
// Launch's website redirect leads to a page set for it, or to a plain landing page of its own on a `.example` site,
// with a pricing link and a signup link to pages of their own. A page set at the redirect's own URL keeps the read
// there, as Product Hunt's Cloudflare challenge did on the VM (#85). A HEAD answers what a test sets, as the real one
// answered 301 with the landing page in #101's trial on 2026-11-02. Unset, it answers 403, which stands for Product Hunt
// closing that route: no trial has seen it, and #102 waits on it. Tests set pages, redirects, HEAD answers and failures per URL, and read which URLs the bot asked for.
//
// A Registration's session (#56) answers as `browser/src/sessions.ts` and `browser/src/page-check.ts` do, which the
// browser-seam tests of #55 saw against real Chromium (`browser/test/`): the limit of 5 (`full`, 429) and one session a
// Registration (`already-open`); a driver for each action's path (`not-driving`); refs from the latest snapshot, gone
// (`stale`) after a navigation; a snapshot that shows what filled a field and never its value, with each Secret filled
// into the session removed from its text; the page check's rules on the form the named button submits; a press that
// is refused with the failed check, or for a button that is disabled or not its form's only one; `fill-code`, which
// fills an emailed code by reference into a text-like field, a textarea or a password field alone and shows it as
// `[code]`; and `open-link`,
// which loads a verification link and closes the session, whether the link loads or not. A page here is one a
// test sets: `next` says where a press leads, and `errors` what the page says of the values it holds, as a form's own
// script would. Not modelled: the check's wait for the page to hold still, cookie banners, `open`'s domain refusal of a
// link's target, screenshots, card fields, the 60-second action limit and the 24-hour close. `holdPresses` takes a press
// and never answers, `uncertainPress` answers one as a click that failed after it began, `pause` keeps one path's
// requests until the test lets them go, `failCloses` fails a close as a service that errs, `timeOut(path)` answers the
// next request to a path as the real one does past its 60-second action limit, closing the session, and `loseSessions`
// drops every session as the service's restart does. No real service was seen doing the first four, and each is there for
// what the bot must do with any answer, or none (ADR 0007).
import { createHash, randomUUID } from 'node:crypto';
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
  /** In a session: the URL a press of a button leads to, given the form's values by field name; null or unset stays. */
  next?: string | ((press: { button: string; values: Record<string, string> }) => string | null);
  /** In a session: what the page says of the values its fields hold, by field name, beside its text, as a form's own script would. */
  errors?: (values: Record<string, string>) => string | null;
}

/** A press the Product's page received: the button, and what its form held, by field name. */
export interface SeenPress {
  registration: string;
  /** The session it came in, and the page's fingerprint as it was pressed, which `fingerprint` answers alike. */
  session: string;
  fingerprint: string;
  url: string;
  button: string;
  values: Record<string, string>;
}

/** A session a bot opened. */
export interface SeenSession {
  id: string;
  registration: string;
  startUrl: string;
  domains: string[];
  open: boolean;
}

interface Fill {
  /** What a snapshot shows: the key, `[password]` or `[code]`. */
  mark: string;
  value: string;
}

interface Session extends SeenSession {
  url: string;
  driver: string;
  /** What the session filled, by `form:field` on the page as it stands. */
  fills: Map<string, Fill>;
  fields: Map<string, { form: number; field: number }>;
  submits: Map<string, { form: number; submit: number }>;
  links: Map<string, string>;
  secrets: string[];
}

const MAX_SESSIONS = 5;

/** The fields `fill-code` takes, as `describe` in browser/src/sessions.ts kinds them: text-like inputs, a textarea, a password. */
const CODE_FIELD_TYPES = ['text', 'email', 'tel', 'url', 'search', 'number', 'date', 'datetime-local', 'month', 'week', 'time', 'textarea', 'password'];

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
  /** Every session a bot opened, oldest first. */
  readonly sessions: Session[] = [];
  /** Every press a page received, oldest first: one the service never answered is here too. */
  readonly presses: SeenPress[] = [];
  /** Every verification link a session opened, as the Product received it, oldest first: one never answered is here too. */
  readonly linksOpened: { registration: string; url: string }[] = [];
  /** Every request on a session, with its body, oldest first. */
  readonly sessionRequests: { path: string; body: Record<string, unknown> }[] = [];
  /** While true, a press reaches its page, and the service never answers it. */
  holdPresses = false;
  /** What the next press answers as uncertain: its click failed after it began. */
  uncertainPress: string | null = null;
  /** While true, a close fails as a service that errs, and the session stays open. */
  failCloses = false;
  /** The paths whose next request times out. */
  #timeOuts = new Set<string>();
  /** The paths whose requests wait until the test lets them go, each with what lets them go. */
  #paused = new Map<string, { gate: Promise<void>; release(): void }>();

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
    if (req.method === 'POST' && req.url && /^\/(session|fill-run|plain-code)\//.test(req.url)) {
      const body = (JSON.parse(raw || '{}') ?? {}) as Record<string, unknown>;
      this.sessionRequests.push({ path: req.url, body });
      await this.#paused.get(req.url)?.gate;
      const answer = this.#session(req.url, body);
      if (answer === 'held') return;
      return answer.error ? send(STATUS[answer.error.kind] ?? 409, answer) : send(200, answer);
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

  /** The sessions now open. */
  get openSessions(): SeenSession[] {
    return this.sessions.filter((s) => s.open);
  }

  /**
   * Keeps every request to this path, such as `/plain-code/fingerprint`, from being answered until the function it
   * returns is called; each is then answered as the session stands at that moment.
   */
  pause(path: string): () => void {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    this.#paused.set(path, { gate, release });
    return () => {
      this.#paused.delete(path);
      release();
    };
  }

  /** The next request to this path takes longer than the action limit: the session closes, and it answers `timeout`. */
  timeOut(path: string): void {
    this.#timeOuts.add(path);
  }

  /** How many requests to this path the service has taken. */
  requestsTo(path: string): number {
    return this.sessionRequests.filter((r) => r.path === path).length;
  }

  /** Opens `n` sessions of other Registrations, as when the service is that busy. Returns what closes them again. */
  occupy(n: number): () => void {
    const taken = Array.from({ length: n }, (_, i): Session => ({ id: randomUUID(), registration: `other-${i}`, startUrl: 'https://other.example/', domains: ['other.example'], open: true, url: 'https://other.example/', driver: 'none', fills: new Map(), fields: new Map(), submits: new Map(), links: new Map(), secrets: [] }));
    this.sessions.push(...taken);
    return () => taken.forEach((s) => (s.open = false));
  }

  /** Closes every session, as the browser service's restart does. */
  loseSessions(): void {
    for (const s of this.sessions) s.open = false;
  }

  /** What a form of the session's page holds, by field name: what the session filled, or what the page preset. */
  #values(s: Session, page: FakePage, form: number): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [i, field] of (page.forms?.[form]?.fields ?? []).entries()) {
      const fill = s.fills.get(`${form}:${i}`);
      const preset = field.type === 'checkbox' ? (field.checked ? 'ticked' : 'left unticked') : (field.value ?? field.options?.find((o) => o.selected)?.label ?? '');
      values[field.name ?? field.label] = fill?.value ?? preset;
    }
    return values;
  }

  #check(s: Session, page: FakePage, form: number, request: Record<string, unknown>) {
    const failures: { rule: string; field: string | null; ref: string | null; validity?: string }[] = [];
    const refOf = (i: number) => [...s.fields].find(([, at]) => at.form === form && at.field === i)?.[0] ?? null;
    if (new URL(page.url).hostname !== request.signupHost) failures.push({ rule: 'off-host', field: null, ref: null });
    const terms = Array.isArray(request.terms) ? request.terms : [];
    for (const [i, field] of (page.forms?.[form]?.fields ?? []).entries()) {
      const fill = s.fills.get(`${form}:${i}`);
      const fail = (rule: string, validity?: string) => failures.push({ rule, field: field.label, ref: refOf(i), ...(validity ? { validity } : {}) });
      if (field.type === 'checkbox') {
        const checked = fill ? fill.value === 'ticked' : Boolean(field.checked);
        const linked = field.links.length > 0;
        if (checked && linked && !field.links.every((l) => terms.includes(l.href))) fail('other-terms');
        else if (checked && fill?.value !== 'ticked' && !(field.required && linked)) fail('unapproved-box');
        if (field.required && !checked) fail('invalid', 'valueMissing');
        continue;
      }
      const preset = field.value ?? field.options?.find((o) => o.selected)?.value ?? '';
      if (!fill && preset !== '') fail('unapproved-value');
      if (field.required && !fill && preset === '') fail('invalid', 'valueMissing');
    }
    return { pass: failures.length === 0, failures };
  }

  #session(path: string, body: Record<string, unknown>): Answer | Refused | 'held' {
    const refuse = (kind: string, message: string, check?: unknown): Refused => ({ error: { kind, message, ...(check ? { check } : {}) } });
    if (path === '/session/open') {
      const { registration, url, domains } = body as { registration: string; url: string; domains: string[] };
      if (typeof registration !== 'string' || typeof url !== 'string' || !Array.isArray(domains)) return refuse('bad-request', 'open takes a registration, a url and domains');
      const on = (host: string) => domains.some((d) => host === d || host.endsWith(`.${d}`));
      if (!on(new URL(url).hostname)) return refuse('bad-request', `the start URL isn't on ${domains.join(' or ')}`);
      if (this.sessions.some((x) => x.open && x.registration === registration)) return refuse('already-open', 'the Registration has a session open');
      if (this.openSessions.length >= MAX_SESSIONS) return refuse('full', `${MAX_SESSIONS} sessions are open`);
      const finalUrl = this.#resolve(url);
      const failure = this.#failures.get(url) ?? this.#failures.get(finalUrl);
      if (failure) return refuse(failure.kind, failure.message);
      if (!this.#pageAt(finalUrl)) return refuse('load-failed', `net::ERR_NAME_NOT_RESOLVED at ${finalUrl}`);
      const session: Session = { id: randomUUID(), registration, startUrl: url, domains, open: true, url: finalUrl, driver: 'none', fills: new Map(), fields: new Map(), submits: new Map(), links: new Map(), secrets: [] };
      this.sessions.push(session);
      return { session: session.id };
    }
    const s = this.sessions.find((x) => x.open && x.id === body.session);
    if (!s) return refuse('unknown-session', 'no such session: it closed, or never opened');
    if (path === '/session/close') {
      if (this.failCloses) return { error: { kind: 'internal', message: 'the browser service failed' } };
      s.open = false;
      return {};
    }
    if (path === '/session/drive') {
      if (!['none', 'fill-run', 'plain-code', 'person'].includes(String(body.driver))) return refuse('bad-request', 'driver must be one of none, fill-run, plain-code, person');
      s.driver = String(body.driver);
      return {};
    }
    // As `inTurn` in browser/src/sessions.ts: an action past the limit closes its session.
    if (this.#timeOuts.delete(path)) {
      s.open = false;
      return refuse('timeout', 'the action took longer than 60 s, and the session closed');
    }
    const [, driver, action] = path.split('/') as [string, string, string];
    if (s.driver !== driver) return refuse('not-driving', `${path} needs ${driver} driving, and ${s.driver === 'none' ? 'nobody' : s.driver} is`);
    const page = this.#pageAt(s.url)!;
    const onDomain = s.domains.some((d) => new URL(s.url).hostname === d || new URL(s.url).hostname.endsWith(`.${d}`));
    const field = () => {
      const at = s.fields.get(String(body.field));
      return at ? { at, field: page.forms![at.form]!.fields[at.field]! } : undefined;
    };
    switch (action) {
      case 'snapshot': {
        if (!onDomain) return refuse('off-domain', `the page is on ${new URL(s.url).hostname}, not on ${s.domains.join(' or ')}`);
        s.fields.clear();
        s.submits.clear();
        s.links.clear();
        let [f, b, l] = [0, 0, 0];
        const link = (x: FakeLink) => {
          const ref = `l${++l}`;
          s.links.set(ref, x.href);
          return { ref, text: x.text, href: x.href };
        };
        const links = (page.links ?? []).map(link);
        const forms = (page.forms ?? []).map((form, fi) => ({
          formElement: form.formElement,
          action: form.action,
          method: form.method,
          fields: form.fields.map((x, i) => {
            const ref = `f${++f}`;
            s.fields.set(ref, { form: fi, field: i });
            const filled = s.fills.get(`${fi}:${i}`)?.mark;
            return {
              ref,
              type: x.type,
              name: x.name,
              label: x.label,
              required: x.required,
              autocomplete: x.autocomplete,
              ...(filled ? { filled } : {}),
              ...(x.options ? { options: x.options.map(({ label, value }) => ({ label, value })) } : {}),
              links: x.links.map(link),
            };
          }),
          submits: form.submits.map((x, i) => {
            const ref = `b${++b}`;
            s.submits.set(ref, { form: fi, submit: i });
            return { ref, label: x.label, disabled: x.disabled };
          }),
          links: form.links.map(link),
        }));
        const said = (page.forms ?? []).map((_, fi) => page.errors?.(this.#values(s, page, fi))).filter(Boolean);
        let text = [page.text, ...said].join(' · ');
        for (const secret of s.secrets) text = text.replaceAll(secret, '[password]');
        return { snapshot: { url: page.url, title: page.title, text, forms, links }, paymentFields: page.paymentFields ?? false, botCheck: page.botCheck ?? null, cookieBanner: null };
      }
      case 'fill':
      case 'fill-secret':
      case 'choose': {
        const found = field();
        if (!found) return refuse('stale', `${String(body.field)} is no field of the latest snapshot`);
        const { type, options } = found.field;
        const value = String(body.value);
        const choice = type === 'checkbox' || type === 'select' || type === 'radio';
        if (action === 'fill' && type === 'password') return refuse('not-allowed', 'a password field takes only fillSecret');
        if (action === 'fill' && choice) return refuse('not-allowed', `${String(body.field)} is a choice: use choose`);
        if (action === 'fill-secret' && (body.secret !== 'password' || type !== 'password')) return refuse('not-allowed', 'a password goes only into a password field');
        if (action === 'choose') {
          if (!choice) return refuse('not-allowed', 'choose clicks only an element whose role is combobox, option, checkbox, radio or switch');
          if (type === 'checkbox' ? !['ticked', 'left unticked'].includes(value) : !options?.some((o) => o.label === value)) {
            return refuse(type === 'checkbox' ? 'bad-request' : 'not-allowed', `${String(body.field)} has no option labelled ${JSON.stringify(value)}`);
          }
        }
        if (action === 'fill-secret' && !s.secrets.includes(value)) s.secrets.push(value);
        s.fills.set(`${found.at.form}:${found.at.field}`, { mark: action === 'fill-secret' ? '[password]' : String(body.key), value });
        return {};
      }
      case 'open': {
        const href = s.links.get(String(body.link));
        if (!href) return refuse('stale', `${String(body.link)} is no link of the latest snapshot`);
        if (!this.#pageAt(this.#resolve(href))) return refuse('load-failed', `net::ERR_NAME_NOT_RESOLVED at ${href}`);
        this.#navigate(s, this.#resolve(href));
        return {};
      }
      case 'fill-code': {
        if (!onDomain) return refuse('off-domain', `the page is on ${new URL(s.url).hostname}, not on ${s.domains.join(' or ')}`);
        const found = field();
        if (!found) return refuse('stale', `${String(body.field)} is no field of the latest snapshot`);
        if (!CODE_FIELD_TYPES.includes(found.field.type)) return refuse('not-allowed', 'a code goes only into a text or password field');
        const value = String(body.value);
        if (!s.secrets.includes(value)) s.secrets.push(value);
        s.fills.set(`${found.at.form}:${found.at.field}`, { mark: '[code]', value });
        return {};
      }
      case 'open-link': {
        let target: URL;
        try {
          target = new URL(String(body.url));
        } catch {
          return refuse('bad-request', 'url must be an http or https URL with no username or password');
        }
        if (!/^https?:$/.test(target.protocol) || target.username || target.password) return refuse('bad-request', 'url must be an http or https URL with no username or password');
        // The session closes right after the link is opened, whether it loads or not (browser/src/sessions.ts).
        this.linksOpened.push({ registration: s.registration, url: target.href });
        s.open = false;
        if (!this.#pageAt(this.#resolve(target.href))) return refuse('load-failed', "the verification link didn't load (load-failed)");
        return {};
      }
      case 'fingerprint':
        return { fingerprint: this.#fingerprintOf(s, page) };
      case 'check':
      case 'press': {
        const at = s.submits.get(String(body.button));
        if (!at) return refuse('stale', `${String(body.button)} isn't on the page of the latest snapshot`);
        const check = this.#check(s, page, at.form, body);
        if (action === 'check') return check;
        if (!onDomain) return refuse('off-domain', `the page is on ${new URL(s.url).hostname}`);
        if (!check.pass) return refuse('check-failed', `the page check failed: ${check.failures.map((x) => x.rule).join('; ')}`, check);
        const form = page.forms![at.form]!;
        const button = form.submits[at.submit]!;
        if (button.disabled) return refuse('not-pressable', `${String(body.button)} is disabled`);
        if (form.submits.length !== 1) return refuse('not-pressable', `${String(body.button)} isn't the only submit control of its form`);
        const values = this.#values(s, page, at.form);
        this.presses.push({ registration: s.registration, session: s.id, fingerprint: this.#fingerprintOf(s, page), url: page.url, button: button.label, values });
        const next = typeof page.next === 'function' ? page.next({ button: button.label, values }) : page.next;
        if (next) this.#navigate(s, next);
        if (this.holdPresses) return 'held';
        const uncertain = this.uncertainPress;
        this.uncertainPress = null;
        return { pressedAt: new Date().toISOString(), ...(uncertain ? { uncertain } : {}) };
      }
      default:
        return refuse('bad-request', `no action ${path}`);
    }
  }

  /** The page's URL, its forms and what the session filled, hashed, as the real one hashes the URL, the forms and their values. */
  #fingerprintOf(s: Session, page: FakePage): string {
    return createHash('sha256').update(JSON.stringify([page.url, page.forms, [...s.fills]])).digest('hex');
  }

  /** A navigation: the page's fills and the snapshot's refs go with the page they were on. */
  #navigate(s: Session, url: string): void {
    s.url = url;
    s.fills.clear();
    s.fields.clear();
    s.submits.clear();
    s.links.clear();
  }
}

type Answer = { error?: undefined; [key: string]: unknown };
type Refused = { error: { kind: string; message: string; check?: unknown } };

/** The HTTP status of each refusal that isn't 409 (`browser/src/server.ts`). */
const STATUS: Record<string, number> = { 'bad-request': 400, 'unknown-session': 404, full: 429, 'load-failed': 502, download: 502, timeout: 504, internal: 500 };
