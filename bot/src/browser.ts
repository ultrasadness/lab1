// The browser service (ADR 0006), reached only through its Unix socket. This slice uses its throwaway `read(url)`,
// which reads one page before any Approval: a Dossier's pages, and the signup page a Walkthrough is prepared from. The bot imports nothing from browser/, so the part of the socket's API
// it reads is written out here (browser/src/api.ts holds the whole of it).
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
  submits: { label: string; disabled: boolean }[];
  links: Link[];
}

export interface Field {
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
    const error = (body as { error?: { kind?: unknown; message?: unknown } } | null)?.error;
    if (status === 400 || status === 502) return { ok: false, error: `${String(error?.kind ?? 'failed')}: ${String(error?.message ?? 'no reason given')}` };
    throw new Error(`The browser service answered ${status}${error?.message ? `: ${String(error.message)}` : ''}`);
  }

  #request(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
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
      const timer = setTimeout(() => req.destroy(new Error(`The browser service took longer than ${READ_TIMEOUT_MS / 1000} s`)), READ_TIMEOUT_MS);
      req.on('close', () => clearTimeout(timer));
      req.on('error', reject);
      req.end(data);
    });
  }
}

const isString = (value: unknown): value is string => typeof value === 'string';
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function linkOf(value: unknown): Link | undefined {
  const l = value as Partial<Link> | null;
  return l && isString(l.text) && isString(l.href) ? { text: l.text, href: l.href } : undefined;
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

/** The page read in an answer, or undefined when it isn't one. Parts the bot can't read are left out. */
function pageReadOf(body: unknown): PageRead | undefined {
  const b = body as Record<string, unknown> | null;
  const s = b?.snapshot as Record<string, unknown> | undefined;
  if (!b || !s || !isString(b.finalUrl) || !isString(b.finalHost) || !isString(s.url)) return undefined;
  return {
    snapshot: {
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
              return sub && isString(sub.label) ? [{ label: sub.label, disabled: sub.disabled === true }] : [];
            }),
            links: linksOf(f.links),
          },
        ];
      }),
      links: linksOf(s.links),
    },
    finalUrl: b.finalUrl,
    finalHost: b.finalHost,
    status: typeof b.status === 'number' ? b.status : null,
    paymentFields: b.paymentFields === true,
    botCheck: isString(b.botCheck) ? (BOT_CHECKS.find((check) => check === b.botCheck) ?? 'unknown') : null,
  };
}
