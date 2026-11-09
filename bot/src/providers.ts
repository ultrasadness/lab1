// A role's providers (ADR 0011, ADR 0013, #46): which of them can serve a request now, and telling the person when one can't. A
// 429 or a 402 takes the whole provider out, for every role that lists it; anything else takes out only the one role's
// `role@provider` name, since on 2026-11-06 a name with no channel answered 503 while the Miner's name beside it worked
// (settled on #46). A spent gateway quota or a dead key takes out all of one role's providers, which share its key, and
// a spent quota of the new-api user holding every key takes out every role's.
//
// Each drop-out lives in the store, so a restart keeps skipping the provider and still says what it hadn't. Once its
// time is up the provider is tried again, by the next request, whatever its place in the role's order: if it serves,
// it's back; if not, it stays out a while longer with nothing more said, unless why it is out has changed.
import { text } from './discord/components.ts';
import { refused } from './discord/rest.ts';
import type { Clock } from './clock.ts';
import type { Config, Role } from './config.ts';
import { errorText, type Log } from './log.ts';
import type { NeedsYou } from './needs-you.ts';
import { pacificDate, pacificTime, shortTime } from './pacific.ts';
import type { Status } from './status.ts';
import type { ProviderDropout, Store } from './store.ts';

/** Why a run didn't start, or fails: its role has no provider left. The caller keeps the work for a later try. */
export class NoProviderLeft extends Error {}

/** What new-api's answer says of the provider, the role's key or the request. */
export type Fault =
  /** The request's own fault, which another provider wouldn't change: it goes back to the run. */
  | { kind: 'request' }
  /** A 401: the role's key or the provider's own, which only `GET /api/usage/token/` tells apart. */
  | { kind: 'unauthorized' }
  | DropOut;

/** What takes a provider, or a role's key, out of use. */
export type DropOut =
  | { kind: 'limit'; resetsAt: Date | null }
  | { kind: 'balance' }
  | { kind: 'failing'; detail: string }
  /** A spent gateway quota: the role's key's, or with `everyRole`, that of the new-api user holding every key (settled on #46). */
  | { kind: 'quota'; everyRole: boolean }
  /** new-api doesn't know the role's key (settled on #46). */
  | { kind: 'key' };

/** The 4xx answers that say the request is wrong, whichever provider it goes to. */
const REQUEST_FAULTS = new Set([400, 404, 413, 422]);
/** Longer than any window a provider has, so a reset time past it is no reset time: Plus's longest is a week. */
const LONGEST_RESET_MS = 8 * 24 * 60 * 60 * 1000;

/** Reads new-api's answer to a request. Any body at all has an answer: one that isn't what it should be reads as no detail. */
export function faultOf(status: number, body: string, now: Date): Fault {
  const error = errorIn(body);
  if (status === 401) return { kind: 'unauthorized' };
  if (status === 402) return { kind: 'balance' };
  if (status === 429) return { kind: 'limit', resetsAt: resetIn(error, now) };
  if (status === 403 && error.code === 'insufficient_user_quota') return { kind: 'quota', everyRole: true };
  if (status === 403 && error.code === 'pre_consume_token_quota_failed') return { kind: 'quota', everyRole: false };
  if (REQUEST_FAULTS.has(status)) return { kind: 'request' };
  // The code goes on Discord, so it is kept only when it reads as a code.
  const code = typeof error.code === 'string' && /^[\w.-]{1,60}$/.test(error.code) ? ` ${error.code}` : '';
  return { kind: 'failing', detail: `${status}${code}` };
}

/** What a failure in the middle of a reply says of the provider: the same as the status its code names. */
export function faultInStream(error: unknown, now: Date): DropOut {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const status = typeof code === 'number' && code >= 400 && code < 600 ? code : 500;
  const fault = faultOf(status, JSON.stringify({ error }), now);
  return fault.kind === 'request' || fault.kind === 'unauthorized' ? { kind: 'failing', detail: 'an error part way through its reply' } : fault;
}

function errorIn(body: string): { code?: unknown; metadata?: unknown } {
  try {
    const parsed = JSON.parse(body) as { error?: unknown } | null;
    return typeof parsed?.error === 'object' && parsed.error !== null ? parsed.error : {};
  } catch {
    return {};
  }
}

/**
 * The reset time a 429 gives, if it gives a usable one. new-api keeps `error.metadata`, which is how OpenRouter's reset
 * reaches the bot; it drops CPA's `Retry-After` and `reset_seconds`, so ChatGPT Plus never gives one (the trial on #46).
 */
function resetIn(error: { metadata?: unknown }, now: Date): Date | null {
  const headers = (error.metadata as { headers?: unknown } | null | undefined)?.headers;
  if (typeof headers !== 'object' || headers === null) return null;
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === 'x-ratelimit-reset')?.[1];
  // In milliseconds: a count in seconds reads as long past, and so as no reset time.
  const at = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return at > now.getTime() && at <= now.getTime() + LONGEST_RESET_MS ? new Date(at) : null;
}

export class Providers {
  #config: Pick<Config, 'roles' | 'providers' | 'gateway'>;
  #store: Store;
  #status: Status;
  #needsYou: NeedsYou;
  #clock: Clock;
  #log: Log;
  #plainWork: (work: Promise<void>) => void;
  /** The telling under way: one at a time, so its lines keep their order. */
  #telling: Promise<void> = Promise.resolve();

  constructor(options: {
    config: Pick<Config, 'roles' | 'providers' | 'gateway'>;
    store: Store;
    status: Status;
    needsYou: NeedsYou;
    clock: Clock;
    log: Log;
    /** Runs work outside the request that started it, so Discord never holds up a model request. */
    plainWork(work: Promise<void>): void;
  }) {
    this.#config = options.config;
    this.#store = options.store;
    this.#status = options.status;
    this.#needsYou = options.needsYou;
    this.#clock = options.clock;
    this.#log = options.log;
    this.#plainWork = options.plainWork;
  }

  /** Whether the provider may be asked for this role now: not out, or out and due to be tried again. */
  usable(role: Role, provider: string): boolean {
    const now = this.#clock.now().toISOString();
    return !this.#store.openProviderDropouts().some((d) => covers(d, role, provider) && d.until > now);
  }

  /**
   * Whether the provider is out for this role, and its time to be tried again has come. Such a one is asked ahead of the
   * role's order, or a provider further down it would never hear again once one above it serves (settled on #46).
   */
  dueToBeTried(role: Role, provider: string): boolean {
    const now = this.#clock.now().toISOString();
    const out = this.#store.openProviderDropouts().filter((d) => covers(d, role, provider));
    return out.length > 0 && out.every((d) => d.until <= now);
  }

  /** Why the role has no provider it may ask now, if so. */
  noProviderLeft(role: Role): string | undefined {
    const names = this.#namesOf(role);
    if (names.some((name) => this.usable(role, name))) return undefined;
    const open = this.#store.openProviderDropouts();
    const why = names.map((name) => open.find((d) => covers(d, role, name))).filter((d) => d !== undefined);
    return `${roleName(role)} has no provider left: ${[...new Set(why.map((d) => this.#why(d)))].join(', ')}`;
  }

  /** Takes the provider, or the role's key, out of use, and says so if this is the first the person hears of it. */
  dropOut(role: Role, provider: string, what: DropOut): void {
    const now = this.#clock.now();
    const retry = new Date(now.getTime() + this.#config.gateway.retryMinutes * 60_000);
    const resetsAt = what.kind === 'limit' ? what.resetsAt : null;
    const scope = scopeOf(what, role, provider);
    const until = resetsAt ?? retry;
    this.#store.saveProviderDropout({
      ...scope,
      kind: what.kind,
      detail: what.kind === 'failing' ? what.detail : null,
      since: now.toISOString(),
      until: until.toISOString(),
      resetKnown: resetsAt !== null,
    });
    this.#log('provider.dropped-out', { ...scope, kind: what.kind, ...(what.kind === 'failing' ? { detail: what.detail } : {}), until: until.toISOString() });
    this.#tell();
  }

  /** The provider served a request for this role, so whatever had it out is over. */
  served(role: Role, provider: string): void {
    const at = this.#clock.now().toISOString();
    const back = this.#store.openProviderDropouts().filter((d) => covers(d, role, provider));
    for (const d of back) {
      this.#store.saveProviderBack(d.id, at);
      this.#log('provider.back', { provider: d.provider, role: d.role, kind: d.kind });
    }
    // A line or a card Discord didn't take goes again now, as a request is what shows Discord may be back too.
    if (back.length > 0 || this.#store.untoldProviderDropouts().length > 0) this.#tell();
  }

  /** Says whatever a stop, or a Discord that refused, left unsaid. */
  resume(): void {
    this.#tell();
  }

  #tell(): void {
    this.#telling = this.#telling.then(() => this.#sayUntold()).catch((error: unknown) => this.#log('provider.telling-failed', { error: errorText(error) }));
    this.#plainWork(this.#telling);
  }

  async #sayUntold(): Promise<void> {
    for (const d of this.#store.untoldProviderDropouts()) {
      if (!d.notedAt) await this.#say(this.#droppedLine(d), (at) => this.#store.saveProviderDropoutNoted(d.id, at));
      if (!d.backAt) continue;
      if (!d.backNotedAt) await this.#say(this.#backLine(d), (at) => this.#store.saveProviderBackNoted(d.id, at));
      if (d.cardMessageId && !d.cardShrunkAt) await this.#shrink(d);
    }
    for (const d of this.#store.openProviderDropouts()) await this.#cardIfNeeded(d);
  }

  /** Says a line once, marked before it is sent. An uncertain send counts as said (ADR 0007). */
  async #say(line: string, mark: (at: string | null) => void): Promise<void> {
    mark(this.#clock.now().toISOString());
    try {
      await this.#status.say(line);
    } catch (error) {
      if (refused(error)) mark(null);
      this.#log('provider.status-failed', { error: errorText(error) });
    }
  }

  /** A card only for an empty balance or a spent gateway quota that leaves a role with no provider, which only the person can mend. */
  async #cardIfNeeded(d: ProviderDropout): Promise<void> {
    if (d.cardIntended || (d.kind !== 'balance' && d.kind !== 'quota')) return;
    const roles = this.#rolesOf(d).filter((role) => this.noProviderLeft(role));
    if (roles.length === 0) return;
    const who = `${listed(roles.map(roleName))} ${roles.length === 1 ? 'has' : 'have'} no provider left`;
    const retry = `Work waits, and the bot tries again every ${this.#config.gateway.retryMinutes} minutes`;
    const heading = d.kind === 'quota' ? 'Gateway quota spent' : `${this.label(d.provider)} is out of balance`;
    const body =
      d.kind === 'quota'
        ? `${who}: new-api has no quota left for ${d.role ? 'the key of that role, or for the user holding it' : 'the user holding the keys'}. Top it up in new-api's admin page. ${retry}.`
        : `${who}. ${retry}, so topping it up is all this needs.`;
    this.#store.saveProviderCardIntended(d.id, true);
    try {
      const { messageId } = await this.#needsYou.post(heading, [text(body)]);
      this.#store.saveProviderCard(d.id, messageId);
    } catch (error) {
      if (refused(error)) this.#store.saveProviderCardIntended(d.id, false);
      this.#log('provider.card-failed', { error: errorText(error) });
    }
  }

  /** Shrinks a card once it's back. Marked only after, since an edit can safely go twice and a stale card would stay up for good. */
  async #shrink(d: ProviderDropout): Promise<void> {
    const what = d.kind === 'quota' ? `Gateway quota for ${this.#names(d)}` : `${this.label(d.provider)}'s balance`;
    try {
      await this.#needsYou.shrink(d.cardMessageId!, `${what} is back, at ${this.#timeText(new Date(d.backAt!))}.`);
      this.#store.saveProviderCardShrunk(d.id, this.#clock.now().toISOString());
    } catch (error) {
      this.#log('provider.card-failed', { error: errorText(error) });
    }
  }

  /** `ChatGPT Plus at its limit until 14:05 PT · Miner and mail on OpenRouter` */
  #droppedLine(d: ProviderDropout): string {
    const onward = new Map<string, Role[]>();
    for (const role of this.#rolesOf(d)) {
      const next = this.#namesOf(role).find((name) => this.usable(role, name));
      const where = next ? `on ${this.label(next)}` : '';
      onward.set(where, [...(onward.get(where) ?? []), role]);
    }
    const parts = [...onward].map(([where, roles]) => {
      const names = listed(roles.map(roleName));
      return where ? `${names} ${where}` : `${names} ${roles.length === 1 ? 'has' : 'have'} no provider left`;
    });
    return [this.#untilText(d), ...parts].join(' · ');
  }

  /** `ChatGPT Plus is back · Miner and mail on ChatGPT Plus` */
  #backLine(d: ProviderDropout): string {
    if (d.kind === 'quota') return `Gateway quota is back for ${this.#names(d)}`;
    if (d.kind === 'key') return `new-api takes ${this.#names(d)}’s key again`;
    const label = this.label(d.provider);
    if (d.role) return `${label} is back for ${this.#names(d)}`;
    const onIt = this.#rolesOf(d).filter((role) => this.#namesOf(role).find((name) => this.usable(role, name)) === d.provider);
    return onIt.length > 0 ? `${label} is back · ${listed(onIt.map(roleName))} on ${label}` : `${label} is back`;
  }

  /** What has it out, and until when. */
  #untilText(d: ProviderDropout): string {
    const when = this.#timeText(new Date(d.until));
    const tryAgain = `trying again at ${when}`;
    switch (d.kind) {
      case 'limit':
        return d.resetKnown ? `${this.label(d.provider)} at its limit until ${when}` : `${this.label(d.provider)} at its limit, ${tryAgain}`;
      case 'balance':
        return `${this.label(d.provider)} out of balance, top it up, ${tryAgain}`;
      case 'failing':
        return `${this.label(d.provider)} failing for ${this.#names(d)} (${d.detail}), ${tryAgain}`;
      case 'quota':
        return `Gateway quota spent for ${this.#names(d)}, top it up in new-api, ${tryAgain}`;
      case 'key':
        return `new-api refused ${this.#names(d)}’s key, replace it with \`sudo ops/token newapi-key-${d.role}\`, ${tryAgain}`;
    }
  }

  /** What has it out, for a late line. */
  #why(d: ProviderDropout): string {
    const when = this.#timeText(new Date(d.until));
    switch (d.kind) {
      case 'limit':
        return `${this.label(d.provider)} at its limit ${d.resetKnown ? `until ${when}` : `(trying again at ${when})`}`;
      case 'balance':
        return `${this.label(d.provider)} out of balance`;
      case 'failing':
        return `${this.label(d.provider)} failing (${d.detail})`;
      case 'quota':
        return 'gateway quota spent';
      case 'key':
        return 'new-api refused its key';
    }
  }

  /** `14:05 PT` today, or `14:05 PT Thu Oct 15` on another day. */
  #timeText(at: Date): string {
    return pacificDate(at) === pacificDate(this.#clock.now()) ? `${pacificTime(at)} PT` : shortTime(at);
  }

  #namesOf(role: Role): string[] {
    return this.#config.roles[role].providers.map((p) => p.name);
  }

  /** The roles a drop-out takes a provider from. */
  #rolesOf(d: ProviderDropout): Role[] {
    if (d.role) return [d.role as Role];
    const every = Object.keys(this.#config.roles) as Role[];
    return d.provider ? every.filter((role) => this.#namesOf(role).includes(d.provider)) : every;
  }

  /** Those roles, as the person reads them. */
  #names(d: ProviderDropout): string {
    return listed(this.#rolesOf(d).map(roleName));
  }

  /** A provider's name on Discord, from the name its requests are stored under. */
  label(provider: string): string {
    return this.#config.providers[provider]?.label ?? provider;
  }
}

/** Whose use a drop-out ends: `''` stands for every provider, or every role, as the store's unique index keys it. */
function scopeOf(what: DropOut, role: Role, provider: string): { provider: string; role: string } {
  switch (what.kind) {
    case 'limit':
    case 'balance':
      return { provider, role: '' };
    case 'failing':
      return { provider, role };
    case 'key':
      return { provider: '', role };
    case 'quota':
      return { provider: '', role: what.everyRole ? '' : role };
  }
}

/** Whether a drop-out takes this provider from this role. */
function covers(d: ProviderDropout, role: string, provider: string): boolean {
  return (d.provider === provider || d.provider === '') && (d.role === role || d.role === '');
}

/** A role as the person reads it: the Miner is a name, and the others plain words. */
const roleName = (role: string) => (role === 'miner' ? 'Miner' : role);

/** `Miner`, `Miner and mail`, `Miner, mail and registration`. */
const listed = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
