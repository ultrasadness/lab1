// The browser service (ADR 0006), reached only through its Unix socket. Its throwaway `read(url)` reads one page
// before any Approval: a Dossier's pages, and the signup page a Walkthrough is prepared from. A Registration's session
// (#56) is one in-memory context there, which a fill run drives through the fixed actions and plain code through its
// own: the page check, the fingerprint and the press. The bot imports nothing from browser/, so the part of the
// socket's API it reads is written out here (browser/src/api.ts holds the whole of it).
import http from 'node:http';

/** What a read sees of a page. Every string in it has had random-looking strings replaced by `[random]`. */
export interface Snapshot {
  /** The URL after redirects. */
  url: string;
  title: string;
  text: string;
  forms: Form[];
  links: Link[];
}

export interface Form {
  /** False for the visible fields that belong to no `<form>` element, gathered as one group. */
  formElement: boolean;
  fields: Field[];
  submits: { ref?: string; label: string; disabled: boolean }[];
  links: Link[];
}

export interface Field {
  /** In a session's snapshot, how the session's actions name the field: `f1`, `f2`… */
  ref?: string;
  /** In a session's snapshot, what filled the field: its Walkthrough key, `[password]` or `[code]`. */
  filled?: string;
  type: string;
  name: string | null;
  label: string;
  required: boolean;
  autocomplete: string | null;
  /** A value the page put there itself, and whether a box is ticked. */
  value?: string;
  checked?: boolean;
  options?: { label: string; value: string; selected: boolean }[];
  /** Links in the field's label, such as the terms a checkbox accepts. */
  links: Link[];
}

export interface Link {
  /** In a session's snapshot, what `open` names: `l1`, `l2`… */
  ref?: string;
  text: string;
  href: string;
}

/** The bot checks the browser service names (browser/src/api.ts); one it names that isn't here reads as `unknown`. */
const BOT_CHECKS = ['Cloudflare challenge', 'Turnstile', 'reCAPTCHA', 'hCaptcha', 'DataDome', 'HUMAN', 'Arkose', 'AWS WAF'] as const;
export type BotCheck = (typeof BOT_CHECKS)[number] | 'unknown';

/** One page as a read saw it. Everything but the snapshot is for plain code only. */
export interface PageRead {
  snapshot: Snapshot;
  /** The exact URL after redirects. */
  finalUrl: string;
  finalHost: string;
  status: number | null;
  paymentFields: boolean;
  /** The bot check or interstitial visible on load, or null. */
  botCheck: BotCheck | null;
}

export type ReadOutcome = { ok: true; page: PageRead } | { ok: false; error: string };

/** How long one read may take, the service's own 60-second limit included, before the bot stops waiting. */
const READ_TIMEOUT_MS = 120_000;

/** What a HEAD of a URL answered: its status, and where it points as an absolute URL, or null when it points nowhere. */
export type RedirectOutcome = { ok: true; status: number; location: string | null } | { ok: false; error: string };

/** Who may act in a session (ADR 0006): each action's path names the driver it needs. */
export type Driver = 'none' | 'fill-run' | 'plain-code';

/** A session's page as a model may see it: no field's value, and every Secret filled into the session removed. */
export interface SessionSnapshot {
  snapshot: Snapshot;
  paymentFields: boolean;
  botCheck: BotCheck | null;
}

/** One rule of the page check a field failed (browser/src/api.ts). */
export interface CheckFailure {
  rule: string;
  field: string | null;
  ref: string | null;
  validity?: string;
}

export interface PageCheck {
  pass: boolean;
  failures: CheckFailure[];
}

/** What the page check is given: the button the fill run named, and what the Walkthrough approved. */
export interface CheckRequest {
  button: string;
  signupHost: string;
  terms: string[];
  identity: string[];
}

/** Why a session refused a request, by the kinds browser/src/api.ts lists. A press refused by the check carries it. */
export interface Refusal {
  kind: string;
  message: string;
  check?: PageCheck;
}

export type SessionAnswer<T extends object = object> = ({ ok: true } & T) | { ok: false; error: Refusal };

/** How long a session's request may take: the service ends an action at 60 s itself, and a page's load before that. */
const SESSION_TIMEOUT_MS = 90_000;

export class BrowserService {
  #socketPath: string;

  constructor(options: { socketPath: string }) {
    this.#socketPath = options.socketPath;
  }

  /**
   * Reads one page in a throwaway context. A page that won't load, or an answer the bot can't use, is a failed read;
   * a service that can't be reached at all throws, since every read would fail the same way.
   */
  async read(url: string): Promise<ReadOutcome> {
    const { status, body } = await this.#request('/read', { url });
    if (status === 200) {
      const page = pageReadOf(body);
      return page ? { ok: true, page } : { ok: false, error: "the browser service's answer isn't a page read" };
    }
    return failedAnswer(status, body);
  }

  /**
   * Sends a HEAD of Product Hunt's redirect, and follows nothing: what comes back is where it points, or why it says
   * nothing. A request that fails is a failed answer; a service that can't be reached throws, as a read does.
   */
  async redirect(url: string): Promise<RedirectOutcome> {
    const { status, body } = await this.#request('/redirect', { url });
    if (status === 200) {
      const answer = body as { status?: unknown; location?: unknown } | null;
      if (typeof answer?.status !== 'number' || (answer.location !== null && !isString(answer.location))) {
        return { ok: false, error: "the browser service's answer isn't a redirect" };
      }
      return { ok: true, status: answer.status, location: answer.location };
    }
    return failedAnswer(status, body);
  }

  // A Registration's session. A refusal is an answer; a service that can't be reached, or fails, throws.

  /** Opens the Registration's session at the Walkthrough's start URL. `full` while 5 are open. */
  async openSession(open: { registration: string; url: string; domains: string[] }): Promise<SessionAnswer<{ session: string }>> {
    const answer = await this.#session('/session/open', open);
    if (!answer.ok) return answer;
    const { session } = answer.body as { session?: unknown };
    if (!isString(session)) throw new Error("The browser service's answer names no session");
    return { ok: true, session };
  }

  async closeSession(session: string): Promise<SessionAnswer> {
    return plain(await this.#session('/session/close', { session }));
  }

  async drive(session: string, driver: Driver): Promise<SessionAnswer> {
    return plain(await this.#session('/session/drive', { session, driver }));
  }

  /** The page as it stands, with the refs the session's actions take; a fill run's, or plain code's own. */
  async snapshot(session: string, driver: 'fill-run' | 'plain-code'): Promise<SessionAnswer<SessionSnapshot>> {
    const answer = await this.#session(`/${driver}/snapshot`, { session });
    if (!answer.ok) return answer;
    const b = answer.body as Record<string, unknown> | null;
    const snapshot = snapshotOf(b?.snapshot);
    if (!b || !snapshot) throw new Error("The browser service's answer isn't a snapshot");
    return { ok: true, snapshot, paymentFields: b.paymentFields === true, botCheck: botCheckOf(b.botCheck) };
  }

  /** Fills a text field with the approved value of a Walkthrough key. */
  async fill(session: string, field: string, key: string, value: string): Promise<SessionAnswer> {
    return plain(await this.#session('/fill-run/fill', { session, field, key, value }));
  }

  /** Fills a password field by reference: the value reaches the service, and never a model. */
  async fillSecret(session: string, field: string, value: string): Promise<SessionAnswer> {
    return plain(await this.#session('/fill-run/fill-secret', { session, field, secret: 'password', value }));
  }

  /** Picks an option by its label, or sets a box to `ticked` or `left unticked`. */
  async choose(session: string, field: string, key: string, value: string): Promise<SessionAnswer> {
    return plain(await this.#session('/fill-run/choose', { session, field, key, value }));
  }

  async open(session: string, link: string): Promise<SessionAnswer> {
    return plain(await this.#session('/fill-run/open', { session, link }));
  }

  async check(session: string, request: CheckRequest): Promise<SessionAnswer<PageCheck>> {
    const answer = await this.#session('/plain-code/check', { session, ...request });
    if (!answer.ok) return answer;
    const check = checkOf(answer.body);
    if (!check) throw new Error("The browser service's answer isn't a page check");
    return { ok: true, ...check };
  }

  async fingerprint(session: string): Promise<SessionAnswer<{ fingerprint: string }>> {
    const answer = await this.#session('/plain-code/fingerprint', { session });
    if (!answer.ok) return answer;
    const { fingerprint } = answer.body as { fingerprint?: unknown };
    if (!isString(fingerprint)) throw new Error("The browser service's answer holds no fingerprint");
    return { ok: true, fingerprint };
  }

  /**
   * Presses the button, if the page passes the check. An answer that isn't a refusal is a press, one whose click may
   * not have gone through included (ADR 0007). A request that throws may have pressed too.
   */
  async press(session: string, request: CheckRequest): Promise<SessionAnswer<{ uncertain?: string }>> {
    const answer = await this.#session('/plain-code/press', { session, ...request });
    if (!answer.ok) return answer;
    const { uncertain } = (answer.body ?? {}) as { uncertain?: unknown };
    return { ok: true, ...(isString(uncertain) ? { uncertain } : {}) };
  }

  async #session(path: string, payload: unknown): Promise<{ ok: true; body: unknown } | { ok: false; error: Refusal }> {
    const { status, body } = await this.#request(path, payload, SESSION_TIMEOUT_MS);
    if (status === 200) return { ok: true, body };
    const error = (body as { error?: { kind?: unknown; message?: unknown; check?: unknown } } | null)?.error;
    if ((status >= 500 && status !== 502 && status !== 504) || !isString(error?.kind)) {
      throw new Error(`The browser service answered ${status} to ${path}${isString(error?.message) ? `: ${error.message}` : ''}`);
    }
    const check = checkOf(error.check);
    return { ok: false, error: { kind: error.kind, message: isString(error.message) ? error.message : 'no reason given', ...(check ? { check } : {}) } };
  }

  #request(path: string, payload: unknown, timeoutMs = READ_TIMEOUT_MS): Promise<{ status: number; body: unknown }> {
    const data = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.#socketPath,
          method: 'POST',
          path,
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (text += chunk));
          res.on('error', reject);
          res.on('end', () => {
            let body: unknown = null;
            try {
              body = text ? JSON.parse(text) : null;
            } catch {
              // An answer that isn't JSON reads as no answer, which each status above already handles.
            }
            resolve({ status: res.statusCode ?? 0, body });
          });
        },
      );
      // The whole read is bounded, however slowly the answer trickles in.
      const timer = setTimeout(() => req.destroy(new Error(`The browser service took longer than ${timeoutMs / 1000} s`)), timeoutMs);
      req.on('close', () => clearTimeout(timer));
      req.on('error', reject);
      req.end(data);
    });
  }
}

/** A 400 or 502 is a request that can't be answered; any other answer is the service failing, and throws. */
function failedAnswer(status: number, body: unknown): { ok: false; error: string } {
  const error = (body as { error?: { kind?: unknown; message?: unknown } } | null)?.error;
  if (status === 400 || status === 502) return { ok: false, error: `${String(error?.kind ?? 'failed')}: ${String(error?.message ?? 'no reason given')}` };
  throw new Error(`The browser service answered ${status}${error?.message ? `: ${String(error.message)}` : ''}`);
}

const plain = (answer: { ok: true; body: unknown } | { ok: false; error: Refusal }): SessionAnswer => (answer.ok ? { ok: true } : answer);

const isString = (value: unknown): value is string => typeof value === 'string';
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function linkOf(value: unknown): Link | undefined {
  const l = value as Partial<Link> | null;
  return l && isString(l.text) && isString(l.href) ? { ...(isString(l.ref) ? { ref: l.ref } : {}), text: l.text, href: l.href } : undefined;
}

const linksOf = (value: unknown): Link[] => array(value).flatMap((l) => linkOf(l) ?? []);

function fieldOf(value: unknown): Field | undefined {
  const f = value as Record<string, unknown> | null;
  if (!f || !isString(f.type) || !isString(f.label)) return undefined;
  const options = array(f.options).flatMap((o) => {
    const opt = o as Record<string, unknown> | null;
    return opt && isString(opt.label) && isString(opt.value) ? [{ label: opt.label, value: opt.value, selected: opt.selected === true }] : [];
  });
  return {
    ...(isString(f.ref) ? { ref: f.ref } : {}),
    ...(isString(f.filled) ? { filled: f.filled } : {}),
    type: f.type,
    name: isString(f.name) ? f.name : null,
    label: f.label,
    required: f.required === true,
    autocomplete: isString(f.autocomplete) ? f.autocomplete : null,
    ...(isString(f.value) ? { value: f.value } : {}),
    ...(typeof f.checked === 'boolean' ? { checked: f.checked } : {}),
    ...(options.length ? { options } : {}),
    links: linksOf(f.links),
  };
}

/** The snapshot in an answer, or undefined when it isn't one. Parts the bot can't read are left out. */
function snapshotOf(value: unknown): Snapshot | undefined {
  const s = value as Record<string, unknown> | null | undefined;
  if (!s || !isString(s.url)) return undefined;
  return {
    url: s.url,
    title: isString(s.title) ? s.title : '',
    text: isString(s.text) ? s.text : '',
    forms: array(s.forms).flatMap((value) => {
      const f = value as Record<string, unknown> | null;
      if (!f) return [];
      return [
        {
          formElement: f.formElement !== false,
          fields: array(f.fields).flatMap((x) => fieldOf(x) ?? []),
          submits: array(f.submits).flatMap((x) => {
            const sub = x as Record<string, unknown> | null;
            return sub && isString(sub.label) ? [{ ...(isString(sub.ref) ? { ref: sub.ref } : {}), label: sub.label, disabled: sub.disabled === true }] : [];
          }),
          links: linksOf(f.links),
        },
      ];
    }),
    links: linksOf(s.links),
  };
}

const botCheckOf = (value: unknown): BotCheck | null => (isString(value) ? (BOT_CHECKS.find((check) => check === value) ?? 'unknown') : null);

/** The page check in an answer, or undefined when it isn't one. */
function checkOf(value: unknown): PageCheck | undefined {
  const c = value as { pass?: unknown; failures?: unknown } | null | undefined;
  if (!c || typeof c.pass !== 'boolean') return undefined;
  const failures = array(c.failures).flatMap((x) => {
    const f = x as Record<string, unknown> | null;
    if (!f || !isString(f.rule)) return [];
    return [{ rule: f.rule, field: isString(f.field) ? f.field : null, ref: isString(f.ref) ? f.ref : null, ...(isString(f.validity) ? { validity: f.validity } : {}) }];
  });
  return { pass: c.pass, failures };
}

/** The page read in an answer, or undefined when it isn't one. Parts the bot can't read are left out. */
function pageReadOf(body: unknown): PageRead | undefined {
  const b = body as Record<string, unknown> | null;
  const snapshot = snapshotOf(b?.snapshot);
  if (!b || !snapshot || !isString(b.finalUrl) || !isString(b.finalHost)) return undefined;
  return {
    snapshot,
    finalUrl: b.finalUrl,
    finalHost: b.finalHost,
    status: typeof b.status === 'number' ? b.status : null,
    paymentFields: b.paymentFields === true,
    botCheck: botCheckOf(b.botCheck),
  };
}
