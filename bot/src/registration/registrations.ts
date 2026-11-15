// Filling and pressing a Registration (#56, #11, ADR 0005, ADR 0006, ADR 0007, ADR 0014). Once a Walkthrough is
// approved, its Registration waits *queued* for one of the browser service's 5 sessions, which opens at the signup URL.
// Each page then gets a fill run, a Pi run that acts only through the fixed actions: the bot carries each one out on the
// session, supplying the approved value its key names, and the password by reference. The run ends by naming a button,
// a wall or why it is stuck, with the Rules it applied. Plain code takes it from there:
// - a named button: the page check, then the press, under an *intended* mark written right before it and marked *done*
//   after. A button whose label starts with Continue or Next leads to the next page's fill run, unless plain code's own
//   read of the page it led to shows no form with a visible field: that press was the final one. A page plain code
//   can't read leaves the press uncertain. Any other label is final;
// - after the final press the Registration moves on from the Walkthrough's "what happens on submit", and no model reads
//   its pages again;
// - a wall, a failed check, or more than 5 pages leaves it waiting on the person, its session open;
// - a form that refuses the password gets a new one, and one that refuses `+` the plain address, each in a new vault
//   item, and the page is filled again under the same Approval, its next fill run filling that field first;
// - a session lost before any press opens again at page 1; one lost after a press leaves it waiting on the person,
//   since a new session would press that button again (settled by the person on #56).
// Stop, on the status message, writes a mark that the press's own store write checks, ends the fill run, and leaves the
// Registration *abandoned* with Start again. Correct before the final press is Stop and a new version; after it, only
// the record changes. Everything a step needs is in the store, so a bot that stops picks up where it left off: a fill
// run that died is run again on the same page, a press that was intended and never marked done counts as pressed, and a
// session an outcome left open is closed.
import { createHash } from 'node:crypto';
import type { BrowserService, Refusal, Snapshot } from '../browser.ts';
import { inMinutes, type Clock } from '../clock.ts';
import type { Config } from '../config.ts';
import { asEdit, cut, escapeMarkdown, popup, text, type MessagePayload } from '../discord/components.ts';
import { refused, type DiscordRest } from '../discord/rest.ts';
import type { Dossiers } from '../dossier/dossiers.ts';
import { errorText, type Log } from '../log.ts';
import { CORRECTION_FIELD } from '../miner/corrections.ts';
import type { NeedsYou } from '../needs-you.ts';
import { PasswordVaultUnavailable, type PasswordVault } from '../password-vault.ts';
import type { PersonalDatabase } from '../personal-database.ts';
import type { PiRunner } from '../pi-runs.ts';
import { NoProviderLeft } from '../providers.ts';
import { checkRulesApplied, type Rule } from '../rules/rules.ts';
import {
  beforeFinalPress,
  type PressMark,
  type Refill,
  type Refused,
  type RegistrationChange,
  type RegistrationState,
  type Replacement,
  type StoredRegistration,
  type Store,
  type WaitsOn,
} from '../store.ts';
import { refusalText, registrationFileOf } from '../walkthrough/registration-file.ts';
import { standingOf } from '../walkthrough/standing.ts';
import { hasPasswordField, type Walkthrough } from '../walkthrough/walkthrough.ts';
import type { Tapped } from '../walkthrough/walkthroughs.ts';
import { fillKeys, fillPrompt, snapshotText, type FillKey } from './fill-prompt.ts';
import { registrationAction, registrationStatus, type StatusInput } from './status.ts';

/** After this many pages a Registration goes to the person (ADR 0006). */
const MAX_PAGES = 5;
/** How many fill runs one page gets under one Approval: the first, and one for each refusal answered or run that died. */
const FILL_RUNS_PER_PAGE = 3;
/** How many sessions one Approval may open: the first, and one for each session lost before any press. */
const SESSIONS_PER_APPROVAL = 3;
/** A button with such a label leads to a next page (#56); any other is the final press. */
const NEXT_PAGE = /^\s*(continue|next)\b/i;
/**
 * The refusals of a press that mean nothing was pressed: each is made before the click begins (browser/src/sessions.ts).
 * Any other answer, or none, may be a press.
 */
export const NOT_PRESSED = ['check-failed', 'not-pressable', 'blocked', 'off-domain', 'stale', 'not-allowed', 'not-driving', 'bad-request', 'unknown-session'];
/** The page after a press is read once it has held still this long, or as it stands at the limit (CODING_STANDARDS.md). */
const SETTLE = { stillMs: 1_500, readMs: 500, limitMs: 5_000 };
/** How long what Discord, GitHub or the browser service didn't take waits before it is tried again: a showing, a notice, a close. */
const RETRY_MINUTES = 5;

const WALLS = ['bot-check', 'oauth-only', 'phone', 'blocked', 'card', 'free-email', 'invite-only'];
const STUCK = ['password-refused', 'plus-refused', 'no-button', 'value-missing', 'page-error', 'other'];
const ACTIVE: RegistrationState[] = ['filling', 'checking', 'pressing', 'queued'];
/** The states that hold no session: an outcome, or the Handoff its terms ask for. */
const ENDED: RegistrationState[] = ['registered', 'waitlisted', 'handed-off', 'abandoned'];
const EVERY: RegistrationState[] = ['held', 'queued', 'filling', 'checking', 'pressing', 'check-failed', 'at-wall', 'awaiting-verification', ...ENDED];

/** How a fill run ended its page, with the Rules it applied. */
type Finish = ({ result: 'button'; ref: string; label: string } | { result: 'wall'; wall: string; note: string | null } | { result: 'stuck'; reason: string; note: string | null }) & {
  rulesApplied: string[];
};

/** The fill run now going on, and what its actions need. */
interface FillRun {
  productId: number;
  session: string;
  keys: FillKey[];
  /** The password, for a fill by reference; undefined when the Walkthrough has no password field. */
  password: string | undefined;
  /** What the form refused that this run hasn't filled again yet. It names no button until it has. */
  refill: Set<Refill>;
  /** The latest snapshot's buttons, by ref. */
  buttons: Map<string, string>;
  finish: Finish | null;
  /** Whether the session answered that it is gone. */
  sessionLost: boolean;
}

/** Whether a step moved the Registration on, left it for a later try, or the Assistant stopped. */
type Stepped = 'moved' | 'later' | 'stopped';

/** What a page a Continue or Next led to shows, as plain code reads it. */
type NextPage = 'form' | 'no-form' | 'unreadable';

export class Registrations {
  #config: Config;
  #store: Store;
  #browser: BrowserService;
  #pi: PiRunner;
  #discord: DiscordRest;
  #needsYou: NeedsYou;
  #dossiers: Dossiers;
  #personalDatabase: PersonalDatabase;
  #passwordVault: PasswordVault;
  #fillsDue: () => void;
  #correctionsDue: () => void;
  #walkthroughsDue: () => void;
  #showApproval: (productId: number) => Promise<void>;
  #stoppedCard: (productId: number) => MessagePayload;
  #plainWork: (work: () => Promise<void>) => void;
  #clock: Clock;
  #log: Log;
  #filling: FillRun | undefined;
  /** Each Registration's password, read back for its fills, by the vault item holding it. In memory only. */
  #passwords = new Map<number, { itemId: string; value: string }>();
  /** Each Registration's showing under way, so that its edits go out in order. */
  #shows = new Map<number, Promise<void>>();
  /** What the Dossier's tags and `registration.md` last showed, since this bot started. */
  #standings = new Map<number, string>();
  #files = new Map<number, string>();
  /** The Registrations whose showing, or uncertain press's notice, Discord or GitHub didn't take: tried again shortly. */
  #unshown = new Set<number>();
  #cancelRetry: (() => void) | undefined;
  #stopped = false;

  constructor(options: {
    config: Config;
    store: Store;
    browser: BrowserService;
    pi: PiRunner;
    discord: DiscordRest;
    needsYou: NeedsYou;
    dossiers: Dossiers;
    personalDatabase: PersonalDatabase;
    passwordVault: PasswordVault;
    /** Queues the filling of each Registration now due, in the background lane. */
    fillsDue(): void;
    /** Queues the work of the Walkthrough Corrections sent, in the background lane. */
    correctionsDue(): void;
    /** Queues the preparation of each Walkthrough now due, in the background lane. */
    walkthroughsDue(): void;
    /** Shows a Registration whose Approval isn't shown yet: its card's line, its status message, the tags and git. */
    showApproval(productId: number): Promise<void>;
    /** What the card of an Approval held on Bitwarden becomes once the person stops it. */
    stoppedCard(productId: number): MessagePayload;
    /** Does plain-code work at once, outside the lane, such as showing again what Discord didn't take. */
    plainWork(work: () => Promise<void>): void;
    clock: Clock;
    log: Log;
  }) {
    this.#config = options.config;
    this.#store = options.store;
    this.#browser = options.browser;
    this.#pi = options.pi;
    this.#discord = options.discord;
    this.#needsYou = options.needsYou;
    this.#dossiers = options.dossiers;
    this.#personalDatabase = options.personalDatabase;
    this.#passwordVault = options.passwordVault;
    this.#fillsDue = options.fillsDue;
    this.#correctionsDue = options.correctionsDue;
    this.#walkthroughsDue = options.walkthroughsDue;
    this.#showApproval = options.showApproval;
    this.#stoppedCard = options.stoppedCard;
    this.#plainWork = options.plainWork;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  stop(): void {
    this.#stopped = true;
    this.#cancelRetry?.();
  }

  #now(): string {
    return this.#clock.now().toISOString();
  }

  // ---------- The lane's job ----------

  /**
   * Closes each session an outcome left open, then moves each Registration that can move as far as it goes: those with
   * a session first, so that they free it, then the queued ones, oldest Approval first. Only a Registration whose
   * Approval is shown is moved, so that its status message, with Stop, is up before anything is filled. One that can't
   * go on for now, such as while all 5 sessions are taken or Bitwarden is unavailable, is left for a later try, and so
   * is one whose step failed and a session that didn't close. Returns whether one is left.
   */
  async work(): Promise<boolean> {
    const unclosed = !(await this.#closeEnded());
    const later = new Set<number>();
    for (;;) {
      if (this.#stopped) return false;
      const due = this.#store.registrationsIn(ACTIVE).filter((x) => x.shownAt !== null && !later.has(x.productId));
      const r = due.find((x) => x.state !== 'queued') ?? due[0];
      if (!r) break;
      let stepped: Stepped;
      try {
        stepped = await this.#step(r);
      } catch (error) {
        this.#log('registration.step-failed', { productId: r.productId, state: r.state, error: errorText(error) });
        stepped = 'later';
      }
      if (stepped === 'stopped') return false;
      if (stepped === 'later') later.add(r.productId);
    }
    return unclosed || later.size > 0;
  }

  async #step(r: StoredRegistration): Promise<Stepped> {
    // A press under way keeps a stopped Registration from being abandoned: what the press led to is settled first.
    if (r.state !== 'pressing' && (await this.#endedByStop(r.productId))) return 'moved';
    switch (r.state) {
      case 'queued':
        return this.#open(r);
      case 'filling':
        return this.#fillPage(r);
      case 'checking':
        // The bot stopped during the page check, so nothing was pressed: the page gets its fill run again.
        this.#save(r.productId, { state: 'filling' });
        return 'moved';
      case 'pressing':
        return this.#recoverPress(r);
      default:
        return 'later';
    }
  }

  /** Changes a Registration that hasn't been abandoned meanwhile. */
  #save(productId: number, change: RegistrationChange): void {
    this.#store.saveRegistration(productId, change);
  }

  #walkthrough(r: StoredRegistration): Walkthrough {
    return this.#store.walkthrough(r.productId, r.version)!.walkthrough;
  }

  /**
   * Whether the Registration is *abandoned*, by a Stop or a Correction acted on now, or before. A press under way keeps
   * a stopped one from being abandoned, since its outcome decides.
   */
  async #endedByStop(productId: number): Promise<boolean> {
    const r = this.#store.registration(productId)!;
    if (r.stopAt && r.state !== 'abandoned') await this.#abandon(productId);
    return this.#store.registration(productId)!.state === 'abandoned';
  }

  /** Opens the Registration's session at the signup URL, if one of the 5 is free. */
  async #open(r: StoredRegistration): Promise<Stepped> {
    const w = this.#walkthrough(r);
    const n = r.sessionsOpened + 1;
    if (n > SESSIONS_PER_APPROVAL) return this.#wait(r.productId, 'at-wall', { kind: 'stuck', reason: 'session-lost', note: null });
    // A session an earlier Approval left open, as when its close failed before Start again, is closed first.
    if (r.sessionId && !(await this.#close(r.productId, r.sessionId))) return this.#hold(r, "its earlier session didn't close");
    // The session's name is kept before it is asked for, so one whose answer never came is never asked for again.
    this.#save(r.productId, { sessionsOpened: n });
    const domains = [...new Set([w.rootDomain, w.signupHost].map((d) => d.toLowerCase()))];
    let opened;
    try {
      opened = await this.#browser.openSession({ registration: `${r.productId}-v${r.version}-${n}`, url: w.startUrl, domains });
    } catch (error) {
      // A service the request never reached opened nothing, so that session's name is free again.
      if (unreached(error)) this.#save(r.productId, { sessionsOpened: n - 1 });
      this.#log('registration.session-unopened', { productId: r.productId, kind: 'unreachable', message: errorText(error) });
      return this.#hold(r, "the browser service can't be reached");
    }
    if (!opened.ok) {
      if (opened.error.kind !== 'already-open') this.#save(r.productId, { sessionsOpened: n - 1 });
      this.#log('registration.session-unopened', { productId: r.productId, kind: opened.error.kind, message: opened.error.message });
      const why = opened.error.kind === 'full' ? 'all 5 browser sessions are in use' : `its signup page won't open (${opened.error.kind})`;
      return this.#hold(r, why);
    }
    // The session is kept at once, so that it is closed whatever comes next.
    this.#store.saveRegistration(r.productId, { sessionId: opened.session }, { evenIfAbandoned: true });
    // A Stop while the session opened has abandoned the Registration, so the session it got is closed.
    if (await this.#endedByStop(r.productId)) {
      await this.#close(r.productId, opened.session);
      return 'moved';
    }
    this.#save(r.productId, { state: 'filling', page: 1, fillRuns: 0, refill: [], waitsOn: null });
    this.#log('registration.session-opened', { productId: r.productId, version: r.version, url: w.startUrl });
    await this.#show(r.productId);
    return 'moved';
  }

  /** One fill run on the Registration's page, then what its finish asks for. */
  async #fillPage(r: StoredRegistration): Promise<Stepped> {
    const { productId } = r;
    const w = this.#walkthrough(r);
    const product = this.#store.product(productId)!;
    const session = r.sessionId!;
    if (r.fillRuns >= FILL_RUNS_PER_PAGE) return this.#wait(productId, 'at-wall', { kind: 'stuck', reason: 'fill-runs-spent', note: null });
    const noProvider = this.#pi.noProviderLeft('registration');
    if (noProvider) return this.#hold(r, noProvider);
    let password: string | undefined;
    try {
      if (r.replacementIntended) await this.#makeReplacement(r, w);
      if (hasPasswordField(w)) password = await this.#password(this.#store.registration(productId)!, w);
    } catch (error) {
      if (!(error instanceof PasswordVaultUnavailable)) throw error;
      // Fills by reference are held while Bitwarden is unavailable (ADR 0004), and no run is spent.
      this.#log('password-vault.unavailable', { productId, why: error.message });
      return this.#hold(r, 'Bitwarden is unavailable');
    }
    const driven = await this.#browser.drive(session, 'fill-run');
    if (!driven.ok) return this.#sessionRefused(r, driven.error);
    this.#save(productId, { waitsOn: null });
    await this.#show(productId);

    const now = this.#store.registration(productId)!;
    const run: FillRun = { productId, session, keys: fillKeys(w, now.plainAddress), password, refill: new Set(now.refill), buttons: new Map(), finish: null, sessionLost: false };
    this.#filling = run;
    let result;
    try {
      result = await this.#pi.run({
        kind: 'fill',
        role: 'registration',
        item: product.rootDomain,
        prompt: fillPrompt({ walkthrough: w, page: r.page, plainAddress: now.plainAddress, refill: now.refill }),
        onAction: (action, _runId, rules) => this.#act(run, action, rules),
      });
    } catch (error) {
      if (!(error instanceof NoProviderLeft)) throw error;
      // No provider served it, so it spent nothing and counts as no fill run.
      return this.#hold(r, error.message);
    } finally {
      this.#filling = undefined;
    }
    // A fill run counts towards the page's bound once it is over, but one the Assistant stopped as it shut down, or
    // that a crash cut off, doesn't, as a Dossier's doesn't (#100).
    if (result.outcome !== 'stopped') this.#save(productId, { fillRuns: r.fillRuns + 1 });
    const { finish } = run;
    this.#log('registration.fill-run', {
      productId,
      page: r.page,
      runId: result.runId,
      outcome: result.outcome,
      finish: finish?.result ?? null,
      ...(finish && finish.result !== 'button' ? { why: finish.result === 'wall' ? finish.wall : finish.reason } : {}),
      ...(finish ? { rulesApplied: finish.rulesApplied } : {}),
    });
    if (await this.#endedByStop(productId)) return 'moved';
    if (result.outcome === 'stopped') return 'stopped';
    const after = this.#store.registration(productId)!;
    // A session that is gone makes whatever the run finished with moot.
    if (run.sessionLost) return this.#sessionLost(after);
    if (!finish) {
      // A fill run that died, or ended with no finish, is run again on the same page under the same Approval (#11).
      await this.#browser.drive(session, 'none').catch(() => {});
      return 'moved';
    }
    if (finish.result === 'button') return this.#checkAndPress(after, w, finish.ref, finish.label);
    if (finish.result === 'wall') return this.#wait(productId, 'at-wall', { kind: 'wall', wall: finish.wall, note: finish.note });
    // Neither a refused password nor a refused `+` is a wall (#10): plain code answers it, and the page is filled again.
    if (finish.reason === 'password-refused' && hasPasswordField(w) && after.vaultItemId) {
      this.#intendReplacement(after, 'password');
      this.#save(productId, { refill: [...new Set<Refill>([...after.refill, 'password'])] });
      this.#log('registration.password-refused', { productId, page: r.page });
      return 'moved';
    }
    if (finish.reason === 'plus-refused' && !after.plainAddress) {
      if (hasPasswordField(w) && after.vaultItemId) this.#intendReplacement(after, 'plus');
      this.#save(productId, { plainAddress: true, refill: [...new Set<Refill>([...after.refill, 'email'])] });
      this.#log('registration.plus-refused', { productId, page: r.page });
      return 'moved';
    }
    return this.#wait(productId, 'at-wall', { kind: 'stuck', reason: finish.reason, note: finish.note });
  }

  // ---------- The fixed actions ----------

  /**
   * Carries out one fixed action of the fill run on the Registration's session. The model names refs and keys; the
   * approved value of a key, and the password, come from here. A refusal says what to do next, and never a value.
   */
  async #act(run: FillRun, action: unknown, rules: readonly Rule[]): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
    const a = (typeof action === 'object' && action !== null ? action : {}) as Record<string, unknown>;
    const name = typeof a.action === 'string' ? a.action : '';
    const refuse = (error: string) => {
      this.#log('registration.action', { productId: run.productId, action: name, ok: false, why: error });
      return { ok: false as const, error };
    };
    const registration = this.#store.registration(run.productId);
    if (this.#filling !== run || !registration || registration.stopAt || registration.state !== 'filling') return refuse('This Registration was stopped. Reply with one short line and stop.');
    if (run.finish) return refuse('The page is finished already. Reply with one short line and stop.');
    const ref = (value: unknown) => (typeof value === 'string' && /^[a-z]\d+$/.test(value) ? value : undefined);
    const key = (wanted: FillKey['action']) => {
      const found = run.keys.find((k) => k.key === a.key);
      if (!found) return `No key ${JSON.stringify(a.key)} is approved. The keys are: ${run.keys.map((k) => k.key).join(', ') || 'none'}.`;
      if (found.action !== wanted) return `The key ${found.key} goes in with ${found.action}.`;
      return found;
    };
    try {
      let answer: { ok: true } | { ok: false; error: Refusal };
      let done = 'Done.';
      switch (name) {
        case 'snapshot': {
          const shot = await this.#browser.snapshot(run.session, 'fill-run');
          if (shot.ok) {
            run.buttons = new Map(shot.snapshot.forms.flatMap((f) => f.submits.flatMap((b) => (b.ref ? [[b.ref, b.label] as const] : []))));
            done = snapshotText(shot);
          }
          answer = shot;
          break;
        }
        case 'fill': {
          const field = ref(a.field);
          const k = key('fill');
          if (!field) return refuse('fill takes a field ref from the latest snapshot, such as f1.');
          if (typeof k === 'string') return refuse(k);
          answer = await this.#browser.fill(run.session, field, k.key, k.value!);
          if (answer.ok && k.of === 'email') run.refill.delete('email');
          done = `Filled ${field} with ${k.key}.`;
          break;
        }
        case 'choose': {
          const field = ref(a.field);
          const k = key('choose');
          if (!field) return refuse('choose takes a field ref from the latest snapshot, such as f1.');
          if (typeof k === 'string') return refuse(k);
          answer = await this.#browser.choose(run.session, field, k.key, k.value!);
          done = `Chose ${k.key} in ${field}.`;
          break;
        }
        case 'fill_secret': {
          const field = ref(a.field);
          if (!field) return refuse('fill_secret takes a field ref from the latest snapshot, such as f2.');
          // An emailed code is plain code's to fill, once there is one (#58).
          if (a.secret !== 'password') return refuse('No code is known for this page. Only the password is filled by reference here.');
          if (run.password === undefined) return refuse('The Walkthrough approves no password, so none is filled.');
          answer = await this.#browser.fillSecret(run.session, field, run.password);
          if (answer.ok) run.refill.delete('password');
          done = `Filled ${field} with the password, by reference.`;
          break;
        }
        case 'open': {
          const link = ref(a.link);
          if (!link) return refuse('open takes a link ref from the latest snapshot, such as l1.');
          answer = await this.#browser.open(run.session, link);
          done = `Opened ${link}. Take a snapshot to see the page.`;
          break;
        }
        case 'finish': {
          const finish = this.#finishOf(run, a, rules);
          if (typeof finish === 'string') return refuse(finish);
          run.finish = finish;
          // From here on the run drives nothing, whatever it calls next.
          await this.#browser.drive(run.session, 'none').catch(() => {});
          this.#log('registration.action', { productId: run.productId, action: name, ok: true });
          return { ok: true, message: 'Finished. Reply with one short line and stop.' };
        }
        default:
          return refuse(`No action ${JSON.stringify(name)}. The actions are snapshot, fill, fill_secret, choose, open and finish.`);
      }
      if (answer.ok) {
        this.#log('registration.action', { productId: run.productId, action: name, ok: true });
        return { ok: true, message: done };
      }
      if (gone(answer.error.kind)) run.sessionLost = true;
      return refuse(`${answer.error.kind}: ${answer.error.message}`);
    } catch (error) {
      return refuse(`The browser can't be reached (${errorText(error)}). Call finish with result stuck and reason page-error.`);
    }
  }

  /** A finish as the run named it, or what is wrong with it, for the model to fix. */
  #finishOf(run: FillRun, a: Record<string, unknown>, rules: readonly Rule[]): Finish | string {
    const checked = checkRulesApplied({ record: { rulesApplied: a.rulesApplied } }, rules);
    if (!checked.ok) return checked.error;
    const rulesApplied = (checked.record as { record: { rulesApplied?: string[] } }).record.rulesApplied ?? [];
    const note = typeof a.note === 'string' && a.note.trim() ? a.note.replace(/\s+/g, ' ').trim().slice(0, 200) : null;
    if (a.result === 'button') {
      if (run.refill.size > 0) {
        const what = [...run.refill].map((f) => (f === 'password' ? 'the password field with fill_secret' : 'the email field with its key'));
        return `The form refused what it held before: fill ${what.join(' and ')} again first, then name the button.`;
      }
      const label = typeof a.button === 'string' ? run.buttons.get(a.button) : undefined;
      if (label === undefined) return `finish with result button names a button ref of the latest snapshot: ${[...run.buttons.keys()].join(', ') || 'it shows none, so finish stuck with reason no-button'}.`;
      return { result: 'button', ref: a.button as string, label, rulesApplied };
    }
    if (a.result === 'wall') return WALLS.includes(String(a.wall)) ? { result: 'wall', wall: String(a.wall), note, rulesApplied } : `wall must be one of ${WALLS.join(', ')}.`;
    if (a.result === 'stuck') return STUCK.includes(String(a.reason)) ? { result: 'stuck', reason: String(a.reason), note, rulesApplied } : `reason must be one of ${STUCK.join(', ')}.`;
    return 'result must be button, wall or stuck.';
  }

  // ---------- The page check and the press ----------

  /** Plain code checks the filled page, and presses the named button if it passes (ADR 0005). */
  async #checkAndPress(r: StoredRegistration, w: Walkthrough, ref: string, label: string): Promise<Stepped> {
    const { productId } = r;
    const session = r.sessionId!;
    this.#save(productId, { state: 'checking', button: label });
    await this.#show(productId);
    const driven = await this.#browser.drive(session, 'plain-code');
    if (!driven.ok) return this.#sessionRefused(r, driven.error);
    const request = { button: ref, signupHost: w.signupHost, terms: w.terms.map((t) => t.href), identity: [w.identity.plusAddress, w.identity.plainAddress] };
    const failed = (error: Refusal) => (gone(error.kind) ? this.#sessionLost(r) : this.#wait(productId, 'check-failed', { kind: 'check', failures: [`${error.kind}: ${error.message}`] }));
    const check = await this.#browser.check(session, request);
    if (!check.ok) return failed(check.error);
    this.#log('registration.checked', { productId, page: r.page, pass: check.pass, failures: check.failures.map((f) => f.rule) });
    if (!check.pass) return this.#wait(productId, 'check-failed', { kind: 'check', failures: check.failures.map(failureText) });
    const fingerprint = await this.#browser.fingerprint(session);
    if (!fingerprint.ok) return failed(fingerprint.error);

    // The stop mark is checked in the same store write that marks the press intended, right before it (#11).
    const mark = { productId, version: r.version, session, page: r.page, button: label, fingerprint: fingerprint.fingerprint, final: !NEXT_PAGE.test(label), intendedAt: this.#now() };
    const id = this.#store.intendPress(mark);
    if (id === 'stopped') {
      await this.#endedByStop(productId);
      return 'moved';
    }
    this.#log('registration.press-intended', { productId, page: r.page, button: label, final: mark.final, press: id, session, fingerprint: mark.fingerprint.slice(0, 16) });
    // The status message says so while the press goes on; the press never waits on Discord.
    const shown = this.#show(productId);
    let pressed: { uncertain?: string } | { refusal: Refusal };
    try {
      const answer = await this.#browser.press(session, request);
      if (answer.ok) pressed = answer.uncertain ? { uncertain: answer.uncertain } : {};
      else if (NOT_PRESSED.includes(answer.error.kind)) pressed = { refusal: answer.error };
      else pressed = { uncertain: `the browser service answered ${answer.error.kind}` };
    } catch (error) {
      pressed = { uncertain: `the browser service gave no answer (${errorText(error)})` };
    }
    if ('refusal' in pressed) {
      // Only a refusal means nothing was pressed (ADR 0007), so only then is the mark taken back.
      this.#store.dropPress(id);
      this.#save(productId, { state: 'checking' });
      this.#log('registration.press-refused', { productId, page: r.page, press: id, kind: pressed.refusal.kind });
      await shown;
      if (await this.#endedByStop(productId)) return 'moved';
      if (pressed.refusal.kind === 'unknown-session') return this.#sessionLost(r);
      const failures = pressed.refusal.check ? pressed.refusal.check.failures.map(failureText) : [`${pressed.refusal.kind}: ${pressed.refusal.message}`];
      return this.#wait(productId, 'check-failed', { kind: 'check', failures });
    }
    // Done is kept before anything else waits, so that only the press itself is ever uncertain.
    const uncertain = pressed.uncertain ?? null;
    this.#store.savePressDone(id, this.#now(), uncertain);
    this.#log('registration.pressed', { productId, page: r.page, button: label, press: id, ...(uncertain ? { uncertain } : {}) });
    await shown;
    return this.#afterPress(productId, { page: r.page, button: label, final: mark.final, uncertain });
  }

  /**
   * What a press that is done leads to. One whose outcome isn't known counts as pressed: the Registration waits for
   * verification, is never pressed again, and the person is told (ADR 0007). A final press moves it on from the
   * Walkthrough's "what happens on submit", and any other to the next page.
   */
  async #afterPress(productId: number, press: Pick<PressMark, 'page' | 'button' | 'final' | 'uncertain'>): Promise<Stepped> {
    const r = this.#store.registration(productId)!;
    const w = this.#walkthrough(r);
    if (press.uncertain) return this.#uncertainPress(productId, press, press.uncertain);
    let final = press.final;
    if (!final) {
      // Plain code reads the page the press led to, never a model: with no form left to fill, the account may exist.
      const next: NextPage = r.sessionId ? await this.#nextPage(r.sessionId) : 'unreadable';
      this.#log('registration.next-page', { productId, page: press.page + 1, next });
      // A page plain code can't read may be the account's, so the press counts as pressed (settled by the person on #56).
      if (next === 'unreadable') return this.#uncertainPress(productId, press, `the page "${press.button}" led to couldn't be read, so it isn't known whether that made the account`);
      final = next === 'no-form';
    }
    if (!final) {
      this.#save(productId, { state: 'filling', page: press.page + 1, fillRuns: 0, refill: [], waitsOn: null });
      // A Stop during a press that turned out not to be the final one ends the Registration now: nothing was submitted.
      if (await this.#endedByStop(productId)) return 'moved';
      if (press.page + 1 > MAX_PAGES) return this.#wait(productId, 'at-wall', { kind: 'wall', wall: 'too-many-pages', note: null });
      await this.#show(productId);
      return 'moved';
    }
    const state = ({ 'verification-email': 'awaiting-verification', waitlist: 'waitlisted', 'logged-in': 'registered' } as const)[w.onSubmit];
    const outcome = state !== 'awaiting-verification';
    const at = this.#now();
    // No fill reads the password once the form is submitted.
    this.#passwords.delete(productId);
    this.#save(productId, { state, submittedAt: at, button: press.button, refill: [], waitsOn: null, ...(outcome ? { endedAt: at } : {}) });
    this.#log('registration.submitted', { productId, page: press.page, button: press.button, state });
    // A Correction sent during the press now fixes only the record.
    if (this.#store.registration(productId)!.stopCause === 'correct') this.#correctionsDue();
    // The session closes at the outcome (ADR 0006). One awaiting verification keeps its session for the code or link.
    if (outcome && r.sessionId) await this.#close(productId, r.sessionId);
    await this.#show(productId);
    return 'moved';
  }

  /** A press that counts as pressed though its outcome isn't known: the Registration waits for verification, and the person is told. */
  async #uncertainPress(productId: number, press: Pick<PressMark, 'page' | 'button'>, uncertain: string): Promise<Stepped> {
    this.#passwords.delete(productId);
    this.#save(productId, { state: 'awaiting-verification', submittedAt: this.#now(), button: press.button, uncertain, refill: [], waitsOn: null });
    this.#log('registration.uncertain-press', { productId, page: press.page, button: press.button, uncertain });
    // A Correction sent during the press now fixes only the record.
    if (this.#store.registration(productId)!.stopCause === 'correct') this.#correctionsDue();
    await this.#show(productId);
    await this.#tellUncertain(productId);
    return 'moved';
  }

  /**
   * What the session's page shows, read by plain code once the page has held still, so that a page still loading isn't
   * taken for one with nothing to fill: a form with a visible field, none, or nothing it could read.
   */
  async #nextPage(session: string): Promise<NextPage> {
    const shot = await settledSnapshot(this.#browser, session, () => this.#stopped);
    if (!shot) return 'unreadable';
    return shot.forms.some((f) => f.fields.length > 0) ? 'form' : 'no-form';
  }

  /** As after a stop during a press: an *intended* mark without *done* counts as pressed, and is never pressed again. */
  async #recoverPress(r: StoredRegistration): Promise<Stepped> {
    const open = this.#store.openPress(r.productId);
    if (open) {
      const uncertain = 'the bot stopped after marking the press and before hearing that it was done';
      this.#store.savePressDone(open.id, this.#now(), uncertain);
      return this.#afterPress(r.productId, { ...open, uncertain });
    }
    // The bot stopped after a press was done and before what it led to was kept: that is settled now. A press that was
    // refused has no mark, so its page is filled again.
    const last = this.#store.lastPress(r.productId);
    if (last && last.session === r.sessionId && last.page === r.page) return this.#afterPress(r.productId, last);
    this.#save(r.productId, { state: 'filling' });
    return 'moved';
  }

  // ---------- Waiting, and sessions ----------

  /** Leaves the Registration waiting on the person, its session open. Their cards come with #59. */
  async #wait(productId: number, state: 'at-wall' | 'check-failed', waitsOn: WaitsOn): Promise<Stepped> {
    if (await this.#endedByStop(productId)) return 'moved';
    this.#save(productId, { state, waitsOn });
    this.#log('registration.waiting', { productId, state, waitsOn });
    await this.#show(productId);
    return 'moved';
  }

  /** Leaves the Registration where it is for a later try, saying why on its status message. */
  async #hold(r: StoredRegistration, why: string): Promise<Stepped> {
    const waitsOn: WaitsOn = { kind: 'held', why };
    if (JSON.stringify(r.waitsOn) !== JSON.stringify(waitsOn)) {
      this.#save(r.productId, { waitsOn });
      await this.#show(r.productId);
    }
    return 'later';
  }

  #sessionRefused(r: StoredRegistration, error: Refusal): Promise<Stepped> {
    return gone(error.kind) ? this.#sessionLost(r) : this.#hold(r, `the browser service refused (${error.kind})`);
  }

  /**
   * A session gone before the final press, as when the browser service restarted. Before any press the Registration
   * queues for a new one; after one, a new session would press that button again, so it waits on the person (settled
   * by the person on #56).
   */
  async #sessionLost(r: StoredRegistration): Promise<Stepped> {
    if (await this.#endedByStop(r.productId)) return 'moved';
    this.#log('registration.session-lost', { productId: r.productId, page: r.page });
    // The service has the session no more, so there is none to close.
    this.#save(r.productId, { sessionId: null });
    if (this.#store.pressedUnder(r.productId, r.version)) return this.#wait(r.productId, 'at-wall', { kind: 'stuck', reason: 'session-lost', note: null });
    this.#save(r.productId, { state: 'queued', page: 0, fillRuns: 0, refill: [], waitsOn: null });
    await this.#show(r.productId);
    return 'moved';
  }

  /**
   * Closes a Registration's session, and only then lets go of it, so that one whose close failed, or that a stop cut
   * off, is closed by the next pass. A session the service no longer has counts as closed. Returns whether it is.
   */
  async #close(productId: number, session: string): Promise<boolean> {
    try {
      const closed = await this.#browser.closeSession(session);
      if (!closed.ok && closed.error.kind !== 'unknown-session') throw new Error(`${closed.error.kind}: ${closed.error.message}`);
    } catch (error) {
      this.#log('registration.session-unclosed', { productId, error: errorText(error) });
      this.#tryAgainLater();
      return false;
    }
    if (this.#store.registration(productId)?.sessionId === session) this.#store.saveRegistration(productId, { sessionId: null }, { evenIfAbandoned: true });
    // A session is free, so a queued Registration can have it.
    this.#fillsDue();
    return true;
  }

  /** Closes the session of a Registration whose verification is over (#58), if it has one. */
  async closeSession(productId: number): Promise<void> {
    const r = this.#store.registration(productId);
    if (r?.sessionId) await this.#close(productId, r.sessionId);
  }

  /** Closes each session an outcome left open. Returns whether every one is closed. */
  async #closeEnded(): Promise<boolean> {
    let closed = true;
    for (const r of this.#store.registrationsIn(ENDED)) {
      if (r.sessionId && !(await this.#close(r.productId, r.sessionId))) closed = false;
    }
    return closed;
  }

  // ---------- The password ----------

  /** The Registration's password, read back from its vault item once, and held at the last door from then on. */
  async #password(r: StoredRegistration, w: Walkthrough): Promise<string> {
    if (!r.vaultItemId) throw new PasswordVaultUnavailable('the Registration has no vault item');
    const kept = this.#passwords.get(r.productId);
    if (kept?.itemId === r.vaultItemId) return kept.value;
    const value = await this.#passwordVault.readPassword(r.vaultItemId, w.product);
    this.#passwords.set(r.productId, { itemId: r.vaultItemId, value });
    return value;
  }

  /** Keeps that a replacement vault item is to be made, before `bw` is asked for it (ADR 0007). */
  #intendReplacement(r: StoredRegistration, refused: Refused): void {
    // Each refused password gets a narrower one than the last (ADR 0014).
    const shape = refused === 'password' ? r.replacedItems.filter((x) => x.refused === 'password').length + 1 : 0;
    const replacement: Replacement = { notes: `Replaces item ${r.vaultItemId}: ${refusalText[refused]}.`, refused, shape };
    this.#save(r.productId, { replacementIntended: replacement });
  }

  /**
   * Makes the replacement vault item the store says is due: the Assistant only creates items (ADR 0004), so a new
   * password, or the plain address, goes into a new item whose notes name the item it replaces. A refused `+` keeps the
   * password the page may hold already, so the account's password is the new item's either way (ADR 0014). One that
   * may have been made already is read back first.
   */
  async #makeReplacement(r: StoredRegistration, w: Walkthrough): Promise<void> {
    const replacement = r.replacementIntended!;
    const password = replacement.refused === 'plus' ? await this.#password(r, w) : undefined;
    const login = { name: w.product, website: `https://${w.rootDomain}`, username: r.plainAddress ? w.identity.plainAddress : w.identity.plusAddress, notes: replacement.notes };
    const found = await this.#passwordVault.findItem(login);
    const itemId = found ?? (await this.#passwordVault.createItem(password ? { ...login, password } : { ...login, replacement: replacement.shape }));
    this.#store.saveReplacementItem(r.productId, itemId, replacement.refused, this.#now());
    if (password) this.#passwords.set(r.productId, { itemId, value: password });
    else this.#passwords.delete(r.productId);
    this.#log(found ? 'vault-item.found' : 'vault-item.replaced', { productId: r.productId, itemId, replaces: r.vaultItemId, refused: replacement.refused });
  }

  // ---------- Stop, Correct and Start again ----------

  /**
   * The person tapped a button of a Registration: Stop, Correct or Start again on its status message, or Stop or Correct
   * on the card of an Approval held on Bitwarden. Undefined if it isn't one.
   */
  tap(customId: string, interaction: { messageId: string | undefined }): Tapped | undefined {
    const tapped = registrationAction(customId);
    if (!tapped) return undefined;
    const { action, productId } = tapped;
    const r = this.#store.registration(productId);
    if (!r) return { refused: 'That Registration is no longer on record.' };
    if (tapped.version !== null && tapped.version !== r.version) return { refused: staleText(tapped.version, r.version) };
    // While its Approval is held on Bitwarden it has no status message, and its buttons are on its card.
    const onCard = r.state === 'held';
    // A status message whose send was uncertain is known by the tap on it (ADR 0007).
    if (!onCard && r.statusIntended && !r.statusMessageId && interaction.messageId) this.#store.saveRegistrationStatus(productId, interaction.messageId);
    const w = this.#walkthrough(r);
    switch (action) {
      case 'stop': {
        const stopped = this.#store.stopRegistration(productId, this.#now(), 'stop');
        if (stopped === 'too-late') return { refused: `Too late to stop: ${r.button ? `“${r.button}”` : 'its final button'} is being pressed, or was, and nothing can be unsent.` };
        if (stopped === 'stopped-already') return { refused: 'It is stopped already.' };
        if (stopped === 'over') return { refused: 'It has ended; there is nothing left to stop.' };
        this.#log('registration.stopped', { productId, by: 'stop', state: r.state });
        return { update: onCard ? this.#stoppedCard(productId) : asEdit(this.#status(productId)), work: () => this.#stopNow(productId) };
      }
      case 'correct': {
        if (r.state === 'handed-off' || r.state === 'abandoned' || (r.stopAt && beforeFinalPress(r))) return { refused: 'There is nothing to correct on it now.' };
        const note = beforeFinalPress(r)
          ? 'This stops the Registration: nothing is submitted, and the new version needs your Approval.'
          : 'The form is already submitted, so this fixes only the record.';
        return { popup: popup(customId, `Correct · Walkthrough v${r.version} · ${w.product}`, [note], CORRECTION_FIELD) };
      }
      default: {
        if (!this.#config.walkthroughs.on) return { refused: 'Walkthroughs are switched off, so none can be prepared now.' };
        if (r.state !== 'abandoned') return { refused: 'Only an abandoned Registration starts again.' };
        if (this.#next(r).kind !== 'none') return { refused: 'A new Walkthrough is on its way already, or none is offered any more.' };
        this.#store.saveStartAgain(productId, this.#store.latestWalkthrough(productId)!.version);
        this.#log('registration.start-again', { productId });
        return {
          update: asEdit(this.#status(productId)),
          work: async () => {
            this.#walkthroughsDue();
            await this.#show(productId);
          },
        };
      }
    }
  }

  /** The person sent the Correct pop-up of a Registration. Undefined if it isn't one. */
  submit(customId: string, field: (customId: string) => string | undefined): Tapped | undefined {
    const sent = registrationAction(customId);
    if (sent?.action !== 'correct') return undefined;
    const { productId } = sent;
    const r = this.#store.registration(productId);
    if (!r) return { refused: 'That Registration is no longer on record.' };
    if (sent.version !== null && sent.version !== r.version) return { refused: staleText(sent.version, r.version) };
    const said = (field(CORRECTION_FIELD.customId) ?? '').trim();
    if (!said) return { refused: 'Say what the Walkthrough got wrong, and Correct again.' };
    if (r.state === 'handed-off') return { refused: 'There is nothing to correct on it now.' };
    const at = this.#now();
    // Before the final press, Correct is Stop plus a new version; after it, it fixes only the record (#11).
    const stopped = this.#store.stopRegistration(productId, at, 'correct');
    if (stopped === 'stopped-already') return { refused: 'It was stopped already, so there is nothing to correct. Start again prepares a fresh Walkthrough.' };
    const ofApproved = stopped === 'stopped' ? 'before-final-press' : 'after-final-press';
    const id = this.#store.saveWalkthroughCorrection({ productId, version: r.version, text: said, submittedAt: at, ofApproved });
    this.#log('registration.corrected', { id, productId, version: r.version, ofApproved });
    return {
      update: r.state === 'held' ? this.#stoppedCard(productId) : asEdit(this.#status(productId)),
      work: async () => {
        if (ofApproved === 'before-final-press') await this.#stopNow(productId);
        this.#correctionsDue();
      },
    };
  }

  /** Ends the stopped Registration's fill run, if one is going, and abandons it. */
  async #stopNow(productId: number): Promise<void> {
    this.#pi.abort('fill', this.#store.product(productId)!.rootDomain);
    await this.#abandon(productId);
  }

  /** Ends a stopped Registration *abandoned*, once, and closes its session. Nothing final was pressed. */
  async #abandon(productId: number): Promise<void> {
    const r = this.#store.registration(productId);
    if (!r?.stopAt) return;
    const note = r.stopCause === 'correct' ? 'stopped by your Correction; nothing submitted' : 'stopped by you; nothing submitted';
    if (!this.#store.abandonStopped(productId, note, this.#now())) return;
    this.#passwords.delete(productId);
    this.#log('registration.abandoned', { productId, note });
    // A Correction that stopped it prepares its new version now.
    if (r.stopCause === 'correct') this.#correctionsDue();
    if (r.sessionId) await this.#close(productId, r.sessionId);
    if (r.shownAt) await this.#show(productId);
    else await this.#showApproval(productId);
  }

  // ---------- Showing ----------

  /** Where a new Walkthrough stands for an abandoned Registration. */
  #next(r: StoredRegistration): StatusInput['next'] {
    const none = this.#store.noWalkthrough(r.productId);
    if (none) return { kind: 'no-walkthrough', why: none.why };
    if (this.#store.openWalkthroughs().some((v) => v.productId === r.productId)) return { kind: 'waiting' };
    const latest = this.#store.latestWalkthrough(r.productId)!;
    const correcting = this.#store.walkthroughCorrectionsOf(r.productId).some((c) => !c.doneAt && c.ofApproved !== 'after-final-press');
    if (correcting || r.startAgainFrom === latest.version) return { kind: 'preparing' };
    return { kind: 'none' };
  }

  #status(productId: number): MessagePayload {
    const registration = this.#store.registration(productId)!;
    return registrationStatus({
      registration,
      walkthrough: this.#walkthrough(registration),
      next: this.#next(registration),
      verification: this.#store.verification(productId) ?? null,
      needsYouChannelId: this.#config.discord.needsYouChannelId,
    });
  }

  /**
   * Shows where the Registration now stands, after any showing of it under way. One that Discord or GitHub didn't take
   * is tried again in a few minutes, and at the next start.
   */
  #show(productId: number): Promise<void> {
    const next = (this.#shows.get(productId) ?? Promise.resolve())
      .then(() => this.#showNow(productId))
      .catch((error: unknown) => {
        this.#log('registration.show-failed', { productId, error: errorText(error) });
        this.#tryAgainLater(productId);
      });
    this.#shows.set(productId, next);
    return next;
  }

  /**
   * The status message edited in place, the post's tags and the Dossier's Register line, and `registration.md`, each
   * only when what it says has changed.
   */
  async #showNow(productId: number): Promise<void> {
    const r = this.#store.registration(productId);
    // Until its Approval is shown there is no status message to edit.
    if (!r?.shownAt) return;
    const product = this.#store.product(productId)!;
    const status = this.#status(productId);
    const standing = JSON.stringify(standingOf(this.#store, product, this.#config.discord.needsYouChannelId));
    const file = registrationFileOf(this.#store, productId, `Registration ${r.state}`);
    const key = createHash('sha256').update(JSON.stringify([status, standing, file.content])).digest('hex');
    if (r.shownKey === key) return;
    if (r.statusMessageId) await this.#discord.editMessage(product.threadId!, r.statusMessageId, asEdit(status));
    if (this.#standings.get(productId) !== standing) {
      await this.#dossiers.restand(productId);
      this.#standings.set(productId, standing);
    }
    if (this.#files.get(productId) !== file.content) {
      this.#personalDatabase.queue(file);
      await this.#personalDatabase.sync();
      this.#files.set(productId, file.content);
    }
    this.#store.saveRegistration(productId, { shownKey: key }, { evenIfAbandoned: true });
  }

  /**
   * In a few minutes: shows a Registration again, and tells of its uncertain press, after Discord or GitHub didn't take
   * it; and has the lane's next pass close each session an outcome left open, after the browser service didn't.
   */
  #tryAgainLater(unshown?: number): void {
    if (unshown !== undefined) this.#unshown.add(unshown);
    if (this.#stopped || this.#cancelRetry) return;
    this.#cancelRetry = inMinutes(this.#clock, RETRY_MINUTES, () => {
      this.#cancelRetry = undefined;
      this.#fillsDue();
      this.#plainWork(async () => {
        const due = [...this.#unshown];
        this.#unshown.clear();
        for (const id of due) {
          await this.#tellUncertain(id);
          await this.#show(id);
        }
      });
    });
  }

  /** Something the status message says of a Registration changed elsewhere, such as its new Walkthrough being shown. */
  changed(productId: number): Promise<void> {
    return this.#show(productId);
  }

  /**
   * Tells the person, once, what was uncertain about a press that counts as pressed. One Discord refused is sent again
   * shortly; an uncertain send counts as sent.
   */
  async #tellUncertain(productId: number): Promise<void> {
    const r = this.#store.registration(productId)!;
    if (!r.uncertain || r.uncertainTold) return;
    const w = this.#walkthrough(r);
    const product = this.#store.product(productId)!;
    this.#store.saveRegistration(productId, { uncertainTold: true }, { evenIfAbandoned: true });
    try {
      // The button's label and what went wrong come from the page and the browser service, so they go as plain text.
      await this.#needsYou.post(`An uncertain press · ${escapeMarkdown(cut(w.product, 60))}`, [
        text(
          `The Assistant was pressing **${escapeMarkdown(r.button ?? 'a button')}** on ${escapeMarkdown(w.signupHost)}, and doesn't know whether the press went through: ${escapeMarkdown(r.uncertain)}. ` +
            `It counts as pressed, so it is never pressed again, and the Registration now waits for the Product's verification mail. If no account was made, nothing more happens by itself. See <#${product.threadId}>.`,
        ),
      ]);
    } catch (error) {
      this.#log('registration.uncertain-untold', { productId, error: errorText(error) });
      if (refused(error)) {
        this.#store.saveRegistration(productId, { uncertainTold: false }, { evenIfAbandoned: true });
        this.#tryAgainLater(productId);
      }
    }
  }

  /**
   * As after a stop: a stop mark not yet acted on abandons its Registration where the lane doesn't take it up, what a
   * Registration's status message, tags and file don't show yet is shown, and the lane takes up the rest: a press left
   * *intended*, which counts as pressed, and a session an outcome left open.
   */
  async resume(): Promise<void> {
    for (const r of this.#store.registrationsIn(EVERY)) {
      try {
        if (r.stopAt && beforeFinalPress(r) && !ACTIVE.includes(r.state)) await this.#abandon(r.productId);
        await this.#tellUncertain(r.productId);
        await this.#show(r.productId);
      } catch (error) {
        this.#log('registration.resume-failed', { productId: r.productId, error: errorText(error) });
      }
    }
    this.#fillsDue();
  }
}

/**
 * The session's page as plain code reads it once it has held still (CODING_STANDARDS.md): read until its URL and its
 * forms' fields and buttons stay the same for 1.5 s, or as it stands 5 s on. Null when the last read got no page.
 */
export async function settledSnapshot(browser: BrowserService, session: string, stopped: () => boolean): Promise<Snapshot | null> {
  const start = Date.now();
  const read = async (): Promise<Snapshot | null> => {
    try {
      const shot = await browser.snapshot(session, 'plain-code');
      return shot.ok ? shot.snapshot : null;
    } catch {
      return null;
    }
  };
  const shape = (s: Snapshot | null) => (s ? JSON.stringify([s.url, s.forms.map((f) => [f.fields.map((x) => [x.type, x.label]), f.submits.map((b) => [b.label, b.disabled])])]) : null);
  let seen = await read();
  let still = Date.now();
  while (!stopped() && Date.now() - still < SETTLE.stillMs && Date.now() - start < SETTLE.limitMs) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE.readMs));
    const next = await read();
    if (shape(next) !== shape(seen)) still = Date.now();
    seen = next;
  }
  return seen;
}

/** Why a tap or a pop-up from an earlier Approval does nothing. */
const staleText = (was: number, now: number) => `Nothing was done: that was shown for Walkthrough v${was}, and v${now} is the one approved now. Use the status message as it stands.`;

/** Whether a refusal means the session is gone: closed, or closed by the service at its 60-second action limit. */
const gone = (kind: string) => kind === 'unknown-session' || kind === 'timeout';

/** Whether a request to the browser service failed before it reached the service, so that it did nothing there. */
const unreached = (error: unknown) => ['ECONNREFUSED', 'ENOENT'].includes(String((error as { code?: unknown } | null)?.code));

/** One failed rule of the page check, as the status message says it. */
function failureText(f: { rule: string; field: string | null; validity?: string }): string {
  return `${f.rule}${f.validity ? ` (${f.validity})` : ''}${f.field ? ` on “${f.field.replace(/\s+/g, ' ').trim().slice(0, 80)}”` : ''}`;
}
