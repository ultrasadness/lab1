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
  /** How a session's actions name the field: `f1`, `f2`…, from the session's latest snapshot. Absent in a read. */
  ref?: string;
  /** An input's type (`email`, `checkbox`…), `select`, `textarea`, or the ARIA role of a custom control. */
  type: string;
  name: string | null;
  label: string;
  required: boolean;
  autocomplete: string | null;
  /** A value the page put there itself. A session's snapshot shows no value, and no box's or option's state. */
  value?: string;
  checked?: boolean;
  /** In a session's snapshot, what filled the field: its Walkthrough key, `[password]` or `[code]`. */
  filled?: string;
  options?: Option[];
  /** Links in the field's label, such as the terms a checkbox accepts. */
  links: Link[];
}

export interface Option {
  label: string;
  value: string;
  /** Absent in a session's snapshot. */
  selected?: boolean;
}

export interface SubmitControl {
  /** `b1`, `b2`…, in a session's snapshot: what a fill run's finish and plain code's press name. */
  ref?: string;
  label: string;
  disabled: boolean;
}

export interface Link {
  /** `l1`, `l2`…, in a session's snapshot: what `open` names. */
  ref?: string;
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

/** What a HEAD of a URL answered, with nothing followed. */
export interface RedirectAnswer {
  status: number;
  /** Where a 3xx answer points, as an absolute URL, or null for any other answer or one with no usable address. */
  location: string | null;
}

export type RedirectOutcome = { ok: true; redirect: RedirectAnswer } | { ok: false; error: ReadFailure };

// A Registration's session (ADR 0006): one in-memory context per Registration, at most 5 at once. The path of each
// action names the driver it needs: /fill-run/… for the fixed actions a fill run may use, /plain-code/… for plain code's.

/** Who may act in a session: nobody, a fill run, plain code, or the person in a Takeover. */
export type Driver = 'none' | 'fill-run' | 'plain-code' | 'person';

export type SecretKind = 'password' | 'code';

export interface SessionOpen {
  /** The Registration the session is for: one session per Registration. */
  registration: string;
  /** The Walkthrough's start URL, which the session loads. */
  url: string;
  /** The Walkthrough's domains, such as the Product's root domain and the signup host: every action needs the top-level page on one. */
  domains: string[];
}

export interface SessionSnapshot {
  /** What a model may see: no field's value, every Secret filled into the session removed, and random-looking strings. */
  snapshot: Snapshot;
  paymentFields: boolean;
  botCheck: BotCheck | null;
  cookieBanner: CookieBanner | null;
}

/** What the page check is given: what the Walkthrough approved, beside the values the session filled. */
export interface CheckRequest {
  /** The submit control the fill run named, by its ref. */
  button: string;
  signupHost: string;
  /** The terms the Walkthrough links, by URL. */
  terms: string[];
  /** The Signup identity's two addresses: a field filled with one may hold either. */
  identity: string[];
  /**
   * With a Submit tap (#59), the fingerprint of the page whose screenshot the person approved. The check then lets
   * through the values the person saw (`unapproved-value`, `unapproved-box`), but not one in a field filled by
   * reference, which the screenshot masks, and refuses `changed` unless the page still has that fingerprint.
   */
  approvedPage?: string;
}

/**
 * Why the page check failed, for each field it failed on:
 * - `off-host`: the top-level page isn't on the approved signup host;
 * - `unapproved-value`: a field holds a value nobody approved, such as one the page preset or a script changed;
 * - `unapproved-box`: a box is ticked without approval, and isn't a required terms box;
 * - `other-terms`: a ticked box links documents other than the approved terms;
 * - `invalid`: the browser's validity check fails on the field, as for a required field left empty.
 */
export type CheckRule = 'off-host' | 'unapproved-value' | 'unapproved-box' | 'other-terms' | 'invalid';

export interface CheckFailure {
  rule: CheckRule;
  /** The field's label, and its ref when the latest snapshot listed it; both null for `off-host`. */
  field: string | null;
  ref: string | null;
  /** For `invalid`, the failing validity flag, such as `valueMissing` or `patternMismatch`. */
  validity?: string;
  /**
   * Whether the field was filled by reference, as a password: a screenshot masks it, so a Submit tap never lets its
   * value through (#59).
   */
  secret?: true;
}

export interface PageCheck {
  pass: boolean;
  failures: CheckFailure[];
}

export interface Press {
  pressedAt: string;
  /** Why the press may not have gone through, when the click failed after it began. It counts as done all the same (ADR 0007). */
  uncertain?: string;
}

export interface Screenshot {
  /** A PNG of the whole page, base64. Every field filled by reference is masked. */
  png: string;
}

/**
 * Why a session refused a request:
 * - `bad-request`: a request the API doesn't take;
 * - `unknown-session`: no such session, or it closed;
 * - `full`: 5 sessions are open; `already-open`: the Registration has one;
 * - `not-driving`: the action needs another driver;
 * - `off-domain`: the top-level page, or a link's target, isn't on the Walkthrough's domains;
 * - `stale`: the ref isn't in the latest snapshot, or its element has gone;
 * - `not-allowed`: the action doesn't take that element, such as `fill` on a password field;
 * - `payment-field`: a card field, refused whatever is asked;
 * - `check-failed`: press, when the page check fails (its result is in `check`);
 * - `changed`: check or press with `approvedPage`, when the page no longer has the fingerprint the person approved;
 * - `not-pressable`: press, when the element isn't one plain code may press;
 * - `blocked`: something, such as a cookie banner, covers the element;
 * - `load-failed`, `download`: a page that won't load, and a session whose start page won't load never opens;
 * - `timeout`: a page that took too long to load, or an action that took too long, which closes its session.
 */
export type RefusalKind =
  | 'bad-request'
  | 'unknown-session'
  | 'full'
  | 'already-open'
  | 'not-driving'
  | 'off-domain'
  | 'stale'
  | 'not-allowed'
  | 'payment-field'
  | 'check-failed'
  | 'changed'
  | 'not-pressable'
  | 'blocked'
  | 'load-failed'
  | 'download'
  | 'timeout';

export interface Refusal {
  kind: RefusalKind;
  message: string;
  check?: PageCheck;
}

export type SessionOutcome<T extends object = object> = ({ ok: true } & T) | { ok: false; error: Refusal };
