// A Registration's sessions (ADR 0006): one isolated in-memory context per Registration, at most 5 open at once, each
// with one driver at a time. The path of each action names the driver it needs: the fixed actions a fill run may use,
// through the bot, are under /fill-run/, and plain code's under /plain-code/. No action takes a URL, a key press or a
// script from a model, and every field's value reaches a model only as the key or reference that filled it.
import { createHash, randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, ElementHandle, Page } from 'playwright-core';
import type { CheckRequest, Driver, Link, PageCheck, RefusalKind, SecretKind, SessionOutcome, Snapshot } from './api.ts';
import { rejectCookies } from './cookie-banners.ts';
import { judge } from './page-check.ts';
import { CONTEXT_OPTIONS, loadPage, targetOf } from './reader.ts';
import { redactAll, removeSecrets, type Secret } from './redact.ts';
import { takeSnapshot, type PageView } from './snapshot.ts';
import { botCheckOn, hasPaymentFields } from './walls.ts';

const MAX_SESSIONS = 5;
// A session nothing has asked of in this long closes: the bot's own 24-hour rules close it first, so this catches one
// the bot lost. Any request counts (#55).
const IDLE_LIMIT_MS = Number(process.env.SESSION_IDLE_LIMIT_MS ?? 24 * 60 * 60 * 1000);
// An action that takes longer has a page that hangs, and closes its session.
const ACTION_LIMIT_MS = Number(process.env.SESSION_ACTION_LIMIT_MS ?? 60_000);
// How long an element may take to be ready for a fill, a choice or a press.
const ELEMENT_WAIT_MS = 5_000;
// The page check judges a page that has held still this long, read every SETTLE_READ_MS, or the one it shows at
// SETTLE_LIMIT_MS. A page's script may still be reacting to the last fill, as a debounced field does, and a busy
// page runs its timers late: on CI, a script's change 0 ms after a choice showed only a second later (#55).
const SETTLE_MS = 1_500;
const SETTLE_READ_MS = 500;
const SETTLE_LIMIT_MS = 5_000;

const DRIVERS: Driver[] = ['none', 'fill-run', 'plain-code', 'person'];
const BOX_VALUES = ['ticked', 'left unticked'];
const CHOOSABLE = 'combobox, option, checkbox, radio or switch';

class Refused extends Error {
  readonly kind: RefusalKind;
  readonly check?: PageCheck;

  constructor(kind: RefusalKind, message: string, check?: PageCheck) {
    super(message);
    this.kind = kind;
    this.check = check;
  }
}

type Handle = ElementHandle<Element>;

interface Fill {
  elements: Handle[];
  /** What a snapshot shows: the Walkthrough key, `[password]` or `[code]`. */
  mark: string;
  /** What went in: the approved value, an option's label, `ticked` or `left unticked`, or the Secret. */
  value: string;
  /** The kind of Secret filled by reference, or null for a Walkthrough key's value. */
  secret: SecretKind | null;
}

type Ref = { kind: 'field'; elements: Handle[]; options: string[] } | { kind: 'submit'; element: Handle } | { kind: 'link'; href: string };

interface Session {
  id: string;
  registration: string;
  context: BrowserContext;
  page: Page;
  domains: string[];
  driver: Driver;
  /** Every Secret filled into the session, removed from each snapshot by exact value. */
  secrets: Secret[];
  /** The fills on the page as it stands; a fill whose element has gone is dropped. */
  fills: Fill[];
  /** The latest snapshot's refs. */
  refs: Map<string, Ref>;
  idle?: ReturnType<typeof setTimeout>;
  /** The action running, which the next waits for. */
  turn: Promise<unknown>;
}

type Body = Record<string, unknown>;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
const onDomains = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));
const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0]!;

// A request's parameters. A string must be well-formed Unicode, which a Secret's URL form needs (redact.ts).
const wellFormed = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && v.isWellFormed();

function stringParam(body: Body, name: string, max = 2_000): string {
  const value = body[name];
  if (!wellFormed(value, max) || !value) throw new Refused('bad-request', `${name} must be a string of 1 to ${max} characters`);
  return value;
}

function stringListParam(body: Body, name: string, max = 20): string[] {
  const value = body[name];
  if (!Array.isArray(value) || value.length > max || !value.every((v) => wellFormed(v, 2_000))) {
    throw new Refused('bad-request', `${name} must be a list of at most ${max} strings`);
  }
  return value as string[];
}

function checkRequestOf(body: Body): CheckRequest {
  return {
    button: stringParam(body, 'button', 20),
    signupHost: stringParam(body, 'signupHost', 253),
    terms: stringListParam(body, 'terms'),
    identity: stringListParam(body, 'identity', 2),
  };
}

// What a Playwright error says when the element or the document it ran in has gone.
const GONE = /not attached|Execution context was destroyed|Cannot find context|disposed|Target closed/i;

/** What an element is to an action, read in the page when the action runs, so it uses nothing outside its body. */
function describe(el: Element) {
  const TEXT_TYPES = ['text', 'email', 'tel', 'url', 'search', 'number', 'date', 'datetime-local', 'month', 'week', 'time'];
  const role = el.getAttribute('role');
  const payment = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/).some((token) => token.startsWith('cc-'));
  const native = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
  let kind: 'text' | 'password' | 'select' | 'box' | 'radio' | 'custom-box' | 'combobox' | 'other' = 'other';
  if (el instanceof HTMLInputElement) {
    if (el.type === 'password') kind = 'password';
    else if (el.type === 'checkbox') kind = 'box';
    else if (el.type === 'radio') kind = 'radio';
    else if (TEXT_TYPES.includes(el.type)) kind = 'text';
  } else if (el instanceof HTMLSelectElement) {
    if (!el.multiple && el.size <= 1) kind = 'select';
  } else if (el instanceof HTMLTextAreaElement) {
    kind = 'text';
  } else if (role === 'checkbox' || role === 'switch' || role === 'radio') {
    kind = 'custom-box';
  } else if (role === 'combobox') {
    kind = 'combobox';
  } else if (role === 'textbox' || el.matches('[contenteditable=""], [contenteditable=true]')) {
    kind = 'text';
  }
  return { kind, role, native, payment, checked: el.getAttribute('aria-checked') === 'true' };
}

/** The refusal a failed Playwright action on an element comes to. */
function refusalOf(e: unknown, what: string): Refused {
  const message = e instanceof Error ? e.message : String(e);
  if (GONE.test(message)) return new Refused('stale', `${what}: the element has gone; take a snapshot again`);
  if (/intercepts pointer events/.test(message)) return new Refused('blocked', `${what}: something covers it, such as a cookie banner`);
  return new Refused('not-allowed', `${what}: ${firstLine(e)}`);
}

export function createSessions(browser: Browser) {
  const sessions = new Map<string, Session>();
  // Registrations whose session is still loading its start page, which count towards the limit.
  const opening = new Set<string>();

  async function close(s: Session) {
    if (!sessions.delete(s.id)) return;
    clearTimeout(s.idle);
    await s.context.close().catch(() => {});
  }

  const armIdle = (s: Session) => {
    clearTimeout(s.idle);
    s.idle = setTimeout(() => void close(s), IDLE_LIMIT_MS);
  };

  async function open(body: Body) {
    const registration = stringParam(body, 'registration', 200);
    const target = targetOf(body.url);
    if (!target) throw new Refused('bad-request', 'url must be an http or https URL with no username or password');
    const domains = stringListParam(body, 'domains', 10).map((d) => d.toLowerCase());
    if (domains.length === 0 || !domains.every((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(d))) throw new Refused('bad-request', 'domains must name at least one domain');
    if (!onDomains(target.hostname, domains)) throw new Refused('bad-request', `the start URL isn't on ${domains.join(' or ')}`);
    if (opening.has(registration) || [...sessions.values()].some((s) => s.registration === registration)) {
      throw new Refused('already-open', 'the Registration has a session open');
    }
    if (sessions.size + opening.size >= MAX_SESSIONS) throw new Refused('full', `${MAX_SESSIONS} sessions are open`);

    opening.add(registration);
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext(CONTEXT_OPTIONS);
      const page = await context.newPage();
      await navigate(page, target);
      const s: Session = { id: randomUUID(), registration, context, page, domains, driver: 'none', secrets: [], fills: [], refs: new Map(), turn: Promise.resolve() };
      sessions.set(s.id, s);
      armIdle(s);
      return { session: s.id };
    } catch (e) {
      await context?.close().catch(() => {});
      throw e;
    } finally {
      opening.delete(registration);
    }
  }

  /** Runs one action at a time in a session, bounded, with the idle clock stopped while it runs. */
  function inTurn<T>(s: Session, action: () => Promise<T>): Promise<T> {
    const run = s.turn.then(async () => {
      if (!sessions.has(s.id)) throw new Refused('unknown-session', 'the session closed');
      clearTimeout(s.idle);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Refused('timeout', `the action took longer than ${ACTION_LIMIT_MS / 1000} s, and the session closed`);
      const tooLong = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(limit), ACTION_LIMIT_MS);
      });
      try {
        return await Promise.race([action(), tooLong]);
      } catch (e) {
        if (e === limit) await close(s);
        throw e;
      } finally {
        clearTimeout(timer);
        if (sessions.has(s.id)) armIdle(s);
      }
    });
    s.turn = run.catch(() => {});
    return run;
  }

  function onDomain(s: Session, url = s.page.url()) {
    const host = hostOf(url);
    if (!onDomains(host, s.domains)) throw new Refused('off-domain', `the page is on ${host || url}, not on ${s.domains.join(' or ')}`);
  }

  const connected = (el: Handle) => el.evaluate((e) => e.isConnected).catch(() => false);

  /** Drops each fill and field ref whose element is no longer on the page, as after a navigation. */
  async function prune(s: Session) {
    const fills = await Promise.all(s.fills.map(async (f) => ((await connected(f.elements[0]!)) ? f : null)));
    s.fills = fills.filter((f): f is Fill => f !== null);
    for (const [name, ref] of [...s.refs]) {
      if (ref.kind === 'field' && !(await connected(ref.elements[0]!))) s.refs.delete(name);
    }
  }

  async function recordFill(s: Session, elements: Handle[], mark: string, value: string, secret: SecretKind | null = null) {
    // A field filled again keeps only its latest fill.
    const firsts = s.fills.map((f) => f.elements[0]!);
    const i = firsts.length > 0 ? await s.page.evaluate(([list, el]) => list.indexOf(el), [firsts, elements[0]!] as const) : -1;
    if (i >= 0) s.fills.splice(i, 1);
    s.fills.push({ elements, mark, value, secret });
  }

  const fieldRefs = (s: Session) => [...s.refs].flatMap(([name, ref]) => (ref.kind === 'field' ? [{ name, elements: ref.elements }] : []));

  /**
   * What the page shows, through the session's eyes, once fills and refs whose element has gone are dropped; with
   * `refs`, the elements the new refs point at too.
   */
  async function viewOf(s: Session, button: Handle | null, refs = false) {
    await prune(s);
    if (button && !(await connected(button))) throw new Refused('stale', 'the button has gone; take a snapshot again');
    try {
      const view = await s.page.evaluateHandle(takeSnapshot, {
        fills: s.fills.map((f) => ({ elements: f.elements, mark: f.mark })),
        refs: fieldRefs(s).map((r) => r.elements),
        button,
      });
      try {
        const data: Omit<PageView, 'elements'> = await view.evaluate((v) => ({ snapshot: v.snapshot, refs: v.refs, states: v.states, button: v.button }));
        const elements: Handle[] = [];
        if (refs) {
          for (const [i, handle] of await (await view.getProperty('elements')).getProperties()) {
            if (/^\d+$/.test(i)) elements[Number(i)] = handle.asElement() as Handle;
          }
        }
        return { ...data, elements };
      } finally {
        await view.dispose().catch(() => {});
      }
    } catch (e) {
      // A navigation while the page was read, such as a late script redirect.
      if (GONE.test(String(e))) throw new Refused('stale', 'the page changed while it was read; take a snapshot again');
      throw e;
    }
  }

  function newRefs(s: Session, view: Awaited<ReturnType<typeof viewOf>>) {
    const kept = new Set(s.fills.flatMap((f) => f.elements));
    for (const ref of s.refs.values()) {
      for (const el of ref.kind === 'field' ? ref.elements : ref.kind === 'submit' ? [ref.element] : []) if (!kept.has(el)) void el.dispose().catch(() => {});
    }
    const fields = new Map(view.snapshot.forms.flatMap((f) => f.fields).map((f) => [f.ref, f]));
    const refs = new Map<string, Ref>();
    for (const { ref, kind, elements: indexes } of view.refs) {
      const elements = indexes.map((i) => view.elements[i]!);
      refs.set(ref, kind === 'submit' ? { kind, element: elements[0]! } : { kind, elements, options: (fields.get(ref)?.options ?? []).map((o) => o.label) });
    }
    const links: Link[] = [...view.snapshot.links, ...view.snapshot.forms.flatMap((f) => [...f.links, ...f.fields.flatMap((field) => field.links)])];
    for (const link of links) if (link.ref) refs.set(link.ref, { kind: 'link', href: link.href });
    s.refs = refs;
  }

  async function field(s: Session, body: Body, name = 'field') {
    const ref = s.refs.get(stringParam(body, name, 20));
    if (ref?.kind !== 'field') throw new Refused('stale', `${body[name]} is no field of the latest snapshot`);
    const described = await ref.elements[0]!.evaluate(describe).catch(() => null);
    if (!described) throw new Refused('stale', `${body[name]} has gone; take a snapshot again`);
    if (described.payment) throw new Refused('payment-field', `${body[name]} is a card field, and no card is ever entered`);
    return { ref, described };
  }

  async function element(s: Session, name: string) {
    const ref = s.refs.get(name);
    const el = ref?.kind === 'submit' ? ref.element : ref?.kind === 'field' ? ref.elements[0] : undefined;
    if (!el || !(await connected(el))) throw new Refused('stale', `${name} isn't on the page of the latest snapshot`);
    return { el, all: ref?.kind === 'field' ? ref.elements : [el] };
  }

  async function act(what: string, action: () => Promise<unknown>) {
    try {
      await action();
    } catch (e) {
      throw refusalOf(e, what);
    }
  }

  async function fillSecretInto(s: Session, body: Body, kind: SecretKind) {
    onDomain(s);
    const { ref, described } = await field(s, body);
    const fits = kind === 'password' ? described.kind === 'password' : described.native && (described.kind === 'text' || described.kind === 'password');
    if (!fits) throw new Refused('not-allowed', kind === 'password' ? 'a password goes only into a password field' : 'a code goes only into a text or password field');
    const value = stringParam(body, 'value', 500);
    await act(`filling ${body.field}`, () => ref.elements[0]!.fill(value, { timeout: ELEMENT_WAIT_MS }));
    if (!s.secrets.some((x) => x.value === value)) s.secrets.push({ value, kind });
    await recordFill(s, ref.elements, `[${kind}]`, value, kind);
    return {};
  }

  async function setChecked(el: Handle, want: boolean) {
    // A styled box often hides the native one behind its label.
    if (await el.isVisible()) await el.setChecked(want, { timeout: ELEMENT_WAIT_MS });
    else await el.evaluate((box, want) => box instanceof HTMLInputElement && box.checked !== want && box.click(), want);
  }

  async function checkPage(s: Session, body: Body) {
    const request = checkRequestOf(body);
    const { el } = await element(s, request.button);
    if (s.refs.get(request.button)?.kind !== 'submit') throw new Refused('not-allowed', `${request.button} isn't a submit control`);
    const view = await settledView(s, el);
    const button = view.button!;
    if (!button.submit) throw new Refused('not-allowed', `${request.button} submits no form`);
    const refs = fieldRefs(s).map((r) => r.name);
    const check = judge({ host: hostOf(s.page.url()), fields: view.states[button.form] ?? [], button }, s.fills, refs, request);
    return { check, button, el };
  }

  /** What the page shows once it has held still, as SETTLE_MS says. */
  async function settledView(s: Session, button: Handle) {
    const start = Date.now();
    const shown = (view: Awaited<ReturnType<typeof viewOf>>) => JSON.stringify([s.page.url(), view.states, view.button]);
    let view = await viewOf(s, button);
    let still = Date.now();
    while (Date.now() - still < SETTLE_MS && Date.now() - start < SETTLE_LIMIT_MS) {
      await new Promise((r) => setTimeout(r, SETTLE_READ_MS));
      const next = await viewOf(s, button);
      if (shown(next) !== shown(view)) still = Date.now();
      view = next;
    }
    return view;
  }

  async function navigate(page: Page, target: URL) {
    const loaded = await loadPage(page, target);
    if (!loaded.ok) throw new Refused(loaded.kind, loaded.message);
    loaded.stop();
  }

  /** A snapshot, after cookie banners are rejected, and the refs the session's actions take from it. */
  async function snapshot(s: Session) {
    onDomain(s);
    const cookieBanner = await rejectCookies(s.page);
    const view = await viewOf(s, null, true);
    // The page read, which a consent manager's reload or a script's redirect may have moved off the domains.
    onDomain(s, view.snapshot.url);
    newRefs(s, view);
    const snapshot: Snapshot = redactAll(removeSecrets(view.snapshot, s.secrets));
    return { snapshot, paymentFields: await hasPaymentFields(s.page), botCheck: await botCheckOn(s.page, null), cookieBanner };
  }

  const actions: Record<string, { driver: Driver | null; run(s: Session, body: Body): Promise<object> }> = {
    '/session/close': {
      driver: null,
      async run(s) {
        await close(s);
        return {};
      },
    },
    '/session/drive': {
      driver: null,
      async run(s, body) {
        const driver = DRIVERS.find((d) => d === body.driver);
        if (!driver) throw new Refused('bad-request', `driver must be one of ${DRIVERS.join(', ')}`);
        s.driver = driver;
        return {};
      },
    },

    '/fill-run/snapshot': { driver: 'fill-run', run: snapshot },
    '/fill-run/fill': {
      driver: 'fill-run',
      async run(s, body) {
        onDomain(s);
        const { ref, described } = await field(s, body);
        if (described.kind === 'password') throw new Refused('not-allowed', 'a password field takes only fillSecret');
        if (described.kind !== 'text') throw new Refused('not-allowed', `${body.field} is a choice: use choose`);
        const key = stringParam(body, 'key', 40);
        const value = stringParam(body, 'value', 500);
        await act(`filling ${body.field}`, () => ref.elements[0]!.fill(value, { timeout: ELEMENT_WAIT_MS }));
        await recordFill(s, ref.elements, key, value);
        return {};
      },
    },
    '/fill-run/fill-secret': {
      driver: 'fill-run',
      run(s, body) {
        const kind = body.secret;
        if (kind !== 'password' && kind !== 'code') throw new Refused('bad-request', 'secret must be password or code');
        return fillSecretInto(s, body, kind);
      },
    },
    '/fill-run/choose': {
      driver: 'fill-run',
      async run(s, body) {
        onDomain(s);
        const { ref, described } = await field(s, body);
        const key = stringParam(body, 'key', 40);
        const value = stringParam(body, 'value', 500);
        const what = `choosing ${JSON.stringify(value)} in ${body.field}`;
        const box = () => {
          if (!BOX_VALUES.includes(value)) throw new Refused('bad-request', `a box is chosen ${BOX_VALUES.map((v) => JSON.stringify(v)).join(' or ')}`);
          return value === 'ticked';
        };
        const option = () => {
          const i = ref.options.indexOf(value);
          if (i < 0) throw new Refused('not-allowed', `${body.field} has no option labelled ${JSON.stringify(value)}`);
          return i;
        };
        const el = ref.elements[0]!;
        if (described.kind === 'select') {
          const i = option();
          await act(what, () => el.selectOption({ index: i }, { timeout: ELEMENT_WAIT_MS }));
        } else if (described.kind === 'radio' && ref.elements.length === ref.options.length) {
          const radio = ref.elements[option()]!;
          await act(what, () => setChecked(radio, true));
        } else if (described.kind === 'box' || described.kind === 'radio') {
          // A radio with no name is a choice of its own, chosen like a box.
          const want = box();
          await act(what, () => setChecked(el, want));
        } else if (described.kind === 'custom-box') {
          const want = box();
          if (described.checked !== want) await act(what, () => el.click({ timeout: ELEMENT_WAIT_MS }));
        } else if (described.kind === 'combobox' || (described.kind === 'text' && described.role === 'combobox')) {
          await act(what, async () => {
            await el.click({ timeout: ELEMENT_WAIT_MS });
            await s.page.getByRole('option', { name: value, exact: true }).first().click({ timeout: ELEMENT_WAIT_MS });
          });
        } else {
          throw new Refused('not-allowed', `choose clicks only an element whose role is ${CHOOSABLE}`);
        }
        await recordFill(s, ref.elements, key, value);
        return {};
      },
    },
    '/fill-run/open': {
      driver: 'fill-run',
      async run(s, body) {
        onDomain(s);
        const ref = s.refs.get(stringParam(body, 'link', 20));
        if (ref?.kind !== 'link') throw new Refused('stale', `${body.link} is no link of the latest snapshot`);
        const target = targetOf(ref.href);
        if (!target) throw new Refused('not-allowed', 'only an http or https link opens');
        if (!onDomains(target.hostname, s.domains)) throw new Refused('off-domain', `the link leads to ${target.hostname}, not to ${s.domains.join(' or ')}`);
        await navigate(s.page, target);
        return {};
      },
    },

    // The same snapshot, for plain code's own use, such as naming the code field and Verify button once the account
    // may exist, when no model reads the page again.
    '/plain-code/snapshot': { driver: 'plain-code', run: snapshot },
    '/plain-code/check': {
      driver: 'plain-code',
      async run(s, body) {
        return (await checkPage(s, body)).check;
      },
    },
    '/plain-code/fingerprint': {
      driver: 'plain-code',
      async run(s) {
        const view = await viewOf(s, null);
        // The URL, each visible form's structure, and what each field holds, never anything a session adds.
        const forms = view.snapshot.forms.map((form, i) => ({ form, values: (view.states[i] ?? []).map((f) => [f.value, f.checked]) }));
        const structure = JSON.stringify({ url: view.snapshot.url, forms }, (k, v) => (k === 'ref' || k === 'filled' ? undefined : v));
        return { fingerprint: createHash('sha256').update(structure).digest('hex') };
      },
    },
    '/plain-code/screenshot': {
      driver: 'plain-code',
      async run(s, body) {
        const outline = body.outline === undefined ? [] : (await element(s, stringParam(body, 'outline', 20))).all;
        const marked = body.mark === undefined ? [] : (await Promise.all(stringListParam(body, 'mark').map((name) => element(s, name)))).flatMap((e) => e.all);
        await prune(s);
        const masked = s.fills.filter((f) => f.secret).flatMap((f) => f.elements);
        const tag = (els: Handle[], attribute: string) => Promise.all(els.map((el) => el.evaluate((e, a) => e.setAttribute(a, ''), attribute).catch(() => {})));
        const untag = (els: Handle[], attribute: string) => Promise.all(els.map((el) => el.evaluate((e, a) => e.removeAttribute(a), attribute).catch(() => {})));
        await tag(masked, 'data-lab1-mask');
        await tag(outline, 'data-lab1-outline');
        await tag(marked, 'data-lab1-mark');
        try {
          const png = await s.page.screenshot({
            fullPage: true,
            animations: 'disabled',
            caret: 'hide',
            timeout: 15_000,
            mask: [s.page.locator('[data-lab1-mask]')],
            style: [
              '[data-lab1-outline] { outline: 4px solid #e03131 !important; outline-offset: 3px !important; }',
              '[data-lab1-mark] { outline: 4px solid #f08c00 !important; outline-offset: 3px !important; }',
            ].join('\n'),
          });
          return { png: png.toString('base64') };
        } finally {
          await untag(masked, 'data-lab1-mask');
          await untag(outline, 'data-lab1-outline');
          await untag(marked, 'data-lab1-mark');
        }
      },
    },
    '/plain-code/press': {
      driver: 'plain-code',
      async run(s, body) {
        onDomain(s);
        const { check, button, el } = await checkPage(s, body);
        if (!check.pass) throw new Refused('check-failed', `the page check failed: ${check.failures.map((f) => `${f.rule}${f.field ? ` on ${f.field}` : ''}`).join('; ')}`, check);
        const name = body.button;
        if (!(await el.isVisible())) throw new Refused('not-pressable', `${name} isn't visible`);
        if (!(await el.isEnabled())) throw new Refused('not-pressable', `${name} is disabled`);
        if (!button.onlySubmit) throw new Refused('not-pressable', `${name} isn't the only submit control of its form`);
        if (!button.fillsInForm.every(Boolean)) throw new Refused('not-pressable', `a field filled on this page isn't in the form ${name} submits`);
        // Only a click that never began is certainly no press: one that failed after it began counts as done (ADR 0007).
        await act(`pressing ${name}`, () => el.click({ trial: true, timeout: ELEMENT_WAIT_MS }));
        const pressedAt = new Date().toISOString();
        try {
          await el.click({ timeout: ELEMENT_WAIT_MS });
          return { pressedAt };
        } catch (e) {
          return { pressedAt, uncertain: `the click may not have gone through: ${firstLine(e)}` };
        }
      },
    },
    '/plain-code/fill-code': {
      driver: 'plain-code',
      run: (s, body) => fillSecretInto(s, body, 'code'),
    },
    '/plain-code/open-link': {
      driver: 'plain-code',
      async run(s, body) {
        const target = targetOf(body.url);
        if (!target) throw new Refused('bad-request', 'url must be an http or https URL with no username or password');
        // The session closes right after the verification link is opened (ADR 0006). The link is a Secret, which the
        // refusal of one that won't load leaves out.
        try {
          const loaded = await loadPage(s.page, target);
          if (!loaded.ok) throw new Refused(loaded.kind, `the verification link didn't load (${loaded.kind})`);
          loaded.stop();
        } finally {
          await close(s);
        }
        return {};
      },
    },
  };

  return {
    paths: new Set(['/session/open', ...Object.keys(actions)]),

    async handle(path: string, body: Body | null): Promise<SessionOutcome> {
      try {
        if (path === '/session/open') return { ok: true, ...(await open(body ?? {})) };
        const action = actions[path];
        if (!action) throw new Refused('bad-request', `no action ${path}`);
        const s = sessions.get(String(body?.session ?? ''));
        if (!s) throw new Refused('unknown-session', 'no such session: it closed, or never opened');
        const answer = await inTurn(s, () => {
          if (action.driver && s.driver !== action.driver) {
            throw new Refused('not-driving', `${path} needs ${action.driver} driving, and ${s.driver === 'none' ? 'nobody' : s.driver} is`);
          }
          return action.run(s, body ?? {});
        });
        return { ok: true, ...answer };
      } catch (e) {
        if (e instanceof Refused) return { ok: false, error: { kind: e.kind, message: e.message, ...(e.check ? { check: e.check } : {}) } };
        throw e;
      }
    },

    async closeAll() {
      await Promise.all([...sessions.values()].map(close));
    },
  };
}
