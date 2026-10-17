// The browser service's socket API: what the bot sends and gets back. Plain JSON over HTTP on a Unix socket.

export interface Health {
  browser: string;
  autoconsent: string;
}

/** A read of one page in a throwaway context, before any Approval (ADR 0006). */
export interface PageRead {
  /** What a model may see. Random-looking strings are removed from every part of it. */
  snapshot: Snapshot;
  /** The exact URL after redirects, for plain code only: a model gets `snapshot.url`. */
  finalUrl: string;
  /** The host after redirects, which may be an auth vendor's rather than the Product's. */
  finalHost: string;
  /** The final document's HTTP status, or null when the page gave none. */
  status: number | null;
  paymentFields: boolean;
  /** The bot check or interstitial visible on load, or null. */
  botCheck: BotCheck | null;
  /** The cookie banner autoconsent recognised, or null when it recognised none. */
  cookieBanner: CookieBanner | null;
}

export type BotCheck = 'Cloudflare challenge' | 'Turnstile' | 'reCAPTCHA' | 'hCaptcha' | 'DataDome' | 'HUMAN' | 'Arkose' | 'AWS WAF';

export interface Snapshot {
  /** The URL after redirects. */
  url: string;
  title: string;
  text: string;
  /** Only forms with a visible field. A form the page hasn't shown yet (behind "Get started") isn't here. */
  forms: Form[];
  links: Link[];
}

export interface Form {
  /** False for the visible fields that belong to no `<form>` element, gathered as one group. */
  formElement: boolean;
  action: string | null;
  method: string | null;
  fields: Field[];
  /** The form's native submit controls. Fields in no `<form>` have none, so plain code never presses for them. */
  submits: SubmitControl[];
  links: Link[];
}

export interface Field {
  /** An input's type (`email`, `checkbox`…), `select`, `textarea`, or the ARIA role of a custom control. */
  type: string;
  name: string | null;
  label: string;
  required: boolean;
  autocomplete: string | null;
  /** A value the page put there itself. */
  value?: string;
  checked?: boolean;
  options?: Option[];
  /** Links in the field's label, such as the terms a checkbox accepts. */
  links: Link[];
}

export interface Option {
  label: string;
  value: string;
  selected: boolean;
}

export interface SubmitControl {
  label: string;
  disabled: boolean;
}

export interface Link {
  text: string;
  href: string;
}

export interface CookieBanner {
  /** The consent manager behind it, as autoconsent's rule names it. */
  manager: string;
  rejected: boolean;
}

export type ReadFailureKind = 'bad-url' | 'load-failed' | 'download' | 'timeout';

export interface ReadFailure {
  kind: ReadFailureKind;
  message: string;
}

export type ReadOutcome = { ok: true; page: PageRead } | { ok: false; error: ReadFailure };
