// The live store (ADR 0007): one SQLite file the bot alone writes, the single source of truth for live state.
// It holds the Miner dates the bot has taken on, each date's Launches, judgments by Post id, the person's Corrections
// of them with the judgments their runs gave and what their sorting runs and the person made of them, Day's lines by
// date, the day posts on Discord, the Retries a capped date waits on, the tries at each Launch's Dossier that ended
// without one, Products by root domain with their Launches, Dossiers and posts, each Product's Walkthrough versions
// and the person's Corrections of them, Approvals and Registrations, run and model-request records with each run's
// Rule-set commit and each request's notional dollars, the providers that dropped out, the index of raw inputs kept
// outside git, the files waiting to be written to the Personal database, and the times its history diverged.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Role } from './config.ts';
import type { PageRead } from './browser.ts';
import type { Dossier } from './dossier/dossier.ts';
import { errorText } from './log.ts';
import type { DayLine } from './miner/day-line.ts';
import type { JudgmentRecord } from './miner/judging.ts';
import type { RunCap } from './pi-runs.ts';
import type { Proposal, SortedItem } from './rules/sorting.ts';
import type { VersionCause } from './walkthrough/card.ts';
import type { Walkthrough } from './walkthrough/walkthrough.ts';

/** A reply's exact tokens. `input` counts every input token, the `cached` ones among them. */
export interface Tokens {
  input: number;
  cached: number;
  output: number;
}

/** A Miner date the bot has taken on: one whose start passed while the bot ran, or that it caught up on. */
export interface MinerDay {
  date: string;
  takenAt: string;
  /** The latest reason the date couldn't finish, for its late line. */
  problem: string | null;
  lateNotedAt: string | null;
  /** When the date left the catch-up window without its list, and when #status was told. */
  droppedAt: string | null;
  dropNotedAt: string | null;
}

/** A Featured Launch as the Miner judges it: Product Hunt data only. */
export interface Launch {
  postId: string;
  /** Product Hunt's order of the day, 1 first. */
  rank: number;
  name: string;
  tagline: string;
  description: string;
  slug: string;
  topics: string[];
  /** Product Hunt's redirect to the Product's website. */
  website: string;
  /** The earliest comment by one of the Launch's makers, matched by user id; none if no maker commented. */
  makerComment: string | null;
  /** Every comment by one of its makers, that one first, with its Product Hunt id. */
  makerComments: { id: string; text: string }[];
}

export interface Judgment extends JudgmentRecord {
  date: string;
  runId: string;
  role: Role;
  provider: string;
  model: string | null;
  /** The model request whose reply held the judgment; one reply can judge several Launches. */
  requestId: number;
  judgedAt: string;
}

/**
 * A Correction the person made on a line of a day post: what they wrote, and the judgment its run gave. The Launch's
 * first judgment stays as it was, so each Correction is one more version of it.
 */
export interface Correction {
  id: number;
  postId: string;
  date: string;
  /** What the person wrote: what the judgment got wrong. */
  text: string;
  submittedAt: string;
  /** The judgment the run recorded, once it has. */
  judgment: Judgment | null;
  /** Why the run recorded no judgment; the Launch keeps the one it had. */
  unjudged: string | null;
  /** Why what the Correction changed isn't all done yet, such as a Dossier that couldn't be written. */
  problem: string | null;
  /** When the day post, any Product post and the day's file show the Correction. */
  doneAt: string | null;
}

/**
 * What a Correction's sorting run made of it, once its item was redone, and what became of that: fix only, declined
 * for a Hard limit, unsorted when the run recorded no sort, or a proposal the person keeps, edits or discards on its
 * card in #needs-you.
 */
export interface StoredSort {
  /** The Correction it sorts, by its kind and id, such as `miner:12` or `walkthrough:3`. */
  correction: string;
  /** The item the Correction was made on, as its card and a kept Rule name it. */
  item: SortedItem;
  outcome: 'fix-only' | 'declined' | 'unsorted' | 'proposed';
  /** The Hard limit a declined Correction asks past. */
  hardLimit: string | null;
  /** What it proposes, as the person last edited it. */
  proposal: Proposal | null;
  /** 1 as the run proposed it, one more for each edit. */
  version: number;
  /** Why it is unsorted. */
  why: string | null;
  /** The Rules the sorting run applied, by name. */
  rulesApplied: string[];
  runId: string | null;
  sortedAt: string;
  /** When the item's history showed it, a proposal's card included. */
  shownAt: string | null;
  /** The card in #needs-you, marked before it is sent. */
  cardIntended: boolean;
  cardMessageId: string | null;
  /** When the person tapped Keep, until it is kept or why it wasn't is known. */
  keepTappedAt: string | null;
  /** Why the latest Keep wasn't done, such as the Rule budget. */
  notKept: string | null;
  keptAt: string | null;
  /** The file Keep wrote. */
  keptPath: string | null;
  discardedAt: string | null;
  /** When the card and the item's history showed what the person decided. */
  settledAt: string | null;
}

export interface StoredDayLine extends DayLine {
  date: string;
  drawnAt: string;
}

/**
 * The day post on Discord. Each part is marked as intended before it is sent, so after a stop an intended part
 * without an id may have gone out and is read back from Discord before anything is sent again.
 */
export interface DayPost {
  date: string;
  postIntended: boolean;
  /** The title the post was created under, or last renamed to. */
  title: string | null;
  threadId: string | null;
  /** Message ids by their place in the post; the first is the summary, which is the post itself. */
  messageIds: string[];
  /** How many messages, the summary included, were intended so far. */
  messagesIntended: number;
  postedAt: string | null;
}

/** A judging run that hit a cap: how many Launches it was judging, and the cap. */
export interface CappedRun {
  launches: number;
  cap: RunCap;
}

/**
 * Launches whose judging run hit a cap after its automatic retry, or after the person's Retry. They wait for the
 * person to tap Retry on the notice in the day's post, and then for the run that Retry starts.
 */
export interface MinerRetry {
  id: number;
  date: string;
  /** The Launches still without a judgment. */
  postIds: string[];
  /** The capped runs, oldest first: a run and its automatic retry, or the one run a Retry started. */
  cappedRuns: CappedRun[];
  /** Whether the last capped run was one the person's Retry started. */
  afterRetry: boolean;
  createdAt: string;
  tappedAt: string | null;
  /** When the run the tap started ended; until then the Launches still wait on it. */
  ranAt: string | null;
}

/** A Product, keyed by the root domain of its site, with its one post in the Products forum. */
export interface Product {
  id: number;
  rootDomain: string;
  /** The post's title, from the Product's first Dossier Launch. */
  title: string;
  createdAt: string;
  /** The post was about to be created; marked before it is sent. */
  postIntended: boolean;
  threadId: string | null;
  /** When a Correction put its Dossier below the day's line, closing its post; cleared if one puts it back. */
  withdrawnAt: string | null;
}

/**
 * The tries at a Launch's Dossier that ended without one (#100): its landing page wouldn't load, or its run failed, hit
 * its cap or recorded none. A run the Assistant stopped itself, or a crash cut short, never ended so, and isn't one.
 */
export interface DossierTries {
  postId: string;
  /** How many, which the limit counts. */
  tries: number;
  /** Why the latest one ended without a Dossier, and when. */
  why: string;
  unwrittenAt: string;
  /** When #status was told it won't be tried again. */
  stopNotedAt: string | null;
  /** Whether it waits for its role to have a provider again: no run started, and no try counted (#46). */
  waiting: boolean;
}

/** One version of a Product's Dossier, with the run that wrote it. */
export interface StoredDossier {
  productId: number;
  version: number;
  dossier: Dossier;
  runId: string;
  provider: string;
  model: string | null;
  writtenAt: string;
}

export interface ModelRequest {
  id: number;
  runId: string;
  role: Role;
  provider: string;
  model: string | null;
  status: number;
  tokens: Tokens | null;
  /** The tokens in notional dollars, at the list price of the model the provider serves; 0 with no tokens. */
  dollars: number;
  at: string;
}

/** Why a provider dropped out (#46): its limit, an empty balance, failing, a gateway quota spent, or a dead role key. */
export type DropoutKind = 'limit' | 'balance' | 'failing' | 'quota' | 'key';

/**
 * A provider's time out of use (#46), from its first failure until it next serves a request. The lines and card that
 * tell of it are each marked before they are sent, and an uncertain send counts as sent (ADR 0007).
 */
export interface ProviderDropout {
  id: number;
  /** The provider, or `''` when a role's key or the new-api user holding the keys takes all of them. */
  provider: string;
  /** The one role it is out for, or `''` for every role it takes. */
  role: string;
  kind: DropoutKind;
  /** What it answered, when it is failing. */
  detail: string | null;
  since: string;
  /** When it is next tried. */
  until: string;
  /** Whether `until` is the reset time its error gave. */
  resetKnown: boolean;
  notedAt: string | null;
  cardIntended: boolean;
  cardMessageId: string | null;
  cardShrunkAt: string | null;
  backAt: string | null;
  backNotedAt: string | null;
}

export interface RunRecord {
  id: string;
  kind: string;
  role: Role;
  item: string;
  startedAt: string;
  /** The Personal database commit the run's Rules were read at. */
  rulesCommit: string;
}

export interface RawInput {
  id: number;
  source: string;
  item: string;
  path: string;
  fetchedAt: string;
  expiresAt: string;
}

/** A file waiting to be written to the Personal database, in a commit of its own. */
export interface PersonalDatabaseWrite {
  /** Where the file goes in the repo, such as `days/2026-10-14.md`. */
  path: string;
  content: string;
  /** The commit's message. */
  message: string;
  /** Written only if the file isn't in the repo yet, and never over one that is. */
  createOnly?: boolean;
  queuedAt: string;
}

/**
 * A time the bot's checkout of the Personal database and GitHub's `main` each had commits the other didn't. The bot
 * commits nothing until `main` holds its commits, which it pushes to a branch of their own for the person to merge.
 */
export interface Divergence {
  id: number;
  foundAt: string;
  /** The checkout's last commit, and `main`'s, when the bot found them diverged. */
  ours: string;
  theirs: string;
  /** The branch on GitHub holding the bot's commits. */
  branch: string;
  branchPushedAt: string | null;
  /** The #needs-you card telling the person, marked before it is sent. */
  cardIntended: boolean;
  cardMessageId: string | null;
}

/**
 * One version of a Product's Walkthrough, with the read it was prepared from, what made it, and where its card and its
 * copy in the Product's post stand. Each part is marked as intended before it is sent, and an uncertain send counts as
 * sent (ADR 0007).
 */
export interface StoredWalkthrough {
  productId: number;
  version: number;
  walkthrough: Walkthrough;
  /** What the person sees and approves, hashed: Approvals are unique on it. */
  hash: string;
  /** The signup page read it was prepared from, which a Correction prepares it again from. */
  read: PageRead;
  cause: VersionCause;
  /** The run that prepared it; none for the person's Edit. */
  runId: string | null;
  preparedAt: string;
  cardIntended: boolean;
  /** The card in #needs-you: an Edit's version is the same card as the version it edits. */
  cardMessageId: string | null;
  copyIntended: boolean;
  copyMessageId: string | null;
  /** When the card, the copy, the Dossier and the post's tags showed this version. */
  shownAt: string | null;
  dismissedAt: string | null;
  lapsedAt: string | null;
  /** When the person tapped Prepare again on it, lapsed. */
  againTappedAt: string | null;
  /** When the card and the Dossier showed it dismissed or lapsed. */
  endShownAt: string | null;
}

/** Why a Product gets no Walkthrough: a wall nothing can get past (#10). */
export interface NoWalkthrough {
  productId: number;
  why: string;
  foundAt: string;
  /** When the Dossier, the post's tags and `registration.md` showed it. */
  shownAt: string | null;
}

/** The person's Correction of one version of a Walkthrough, and what its run made of it. */
export interface WalkthroughCorrection {
  id: number;
  productId: number;
  version: number;
  text: string;
  submittedAt: string;
  /** The version its run prepared. */
  redoneVersion: number | null;
  /** Why its run found no Walkthrough can be offered, so none is. */
  withdrawn: string | null;
  /** Why its run prepared nothing; the version it corrected is open again. */
  unapplied: string | null;
  /** When the cards, the copy, the Dossier and `registration.md` showed what came of it. */
  doneAt: string | null;
  /**
   * For a Correction of an approved Walkthrough (#11): `before-final-press` stopped its Registration and prepares a new
   * version, and `after-final-press` fixes only the record, so no run prepares anything. Null for one not approved.
   */
  ofApproved: 'before-final-press' | 'after-final-press' | null;
}

/** The person's yes to one exact version of an item (ADR 0007), such as a Walkthrough. */
export interface Approval {
  /** The item approved, such as `walkthrough:3` for a Product's Walkthrough. */
  item: string;
  versionHash: string;
  version: number;
  userId: string;
  interactionId: string;
  approvedAt: string;
}

/**
 * Where a Registration stands (#11's state table):
 * - `held`: its Approval is kept, and it starts once the Password vault has its password (ADR 0004);
 * - `queued`: it waits for one of the 5 sessions; `filling`: a fill run fills page `page`; `checking` and `pressing`:
 *   plain code checks that page and presses its button;
 * - `check-failed` and `at-wall`: it waits on the person, as `waitsOn` says;
 * - `awaiting-verification`: the final button is pressed, and the Product's verification mail is waited for;
 * - `registered`, `waitlisted`, `handed-off`, `abandoned`: its outcome.
 */
export type RegistrationState =
  | 'held'
  | 'queued'
  | 'filling'
  | 'checking'
  | 'pressing'
  | 'check-failed'
  | 'at-wall'
  | 'awaiting-verification'
  | 'registered'
  | 'waitlisted'
  | 'handed-off'
  | 'abandoned';

/** What a Registration that isn't moving waits on: a wall, a fill run that ended stuck, or a page check that failed. */
export type WaitsOn =
  | { kind: 'wall'; wall: string; note: string | null }
  | { kind: 'stuck'; reason: string; note: string | null }
  | { kind: 'check'; failures: string[] }
  /** Why it can't go on for now, by itself: Bitwarden is unavailable, or its signup page won't load. */
  | { kind: 'held'; why: string };

/** A press of one button, written before plain code presses it and marked done after (ADR 0007). */
export interface PressMark {
  id: number;
  productId: number;
  /** The Walkthrough version whose Approval it is pressed under. */
  version: number;
  /** The browser session it is pressed in. */
  session: string;
  page: number;
  /** The button's label. */
  button: string;
  /** The fingerprint of the page as plain code pressed it. */
  fingerprint: string;
  /** Whether the button's label makes it the final press, rather than one that leads to a next page. */
  final: boolean;
  intendedAt: string;
  doneAt: string | null;
  /** Why the press may not have gone through, when that isn't known. It counts as done all the same. */
  uncertain: string | null;
}

/** A Product's one Registration, from its Approval on. */
export interface StoredRegistration {
  productId: number;
  /** The Walkthrough version approved. */
  version: number;
  state: RegistrationState;
  approvedAt: string;
  /** Whether a vault item may have been created: from here on the Password vault is read before another is made (ADR 0007). */
  vaultItemIntended: boolean;
  /** The vault item holding its password, when it has one. The store never holds the password (ADR 0004). */
  vaultItemId: string | null;
  /** The status message in the Product's post, marked before it is sent. */
  statusIntended: boolean;
  statusMessageId: string | null;
  /** When the status message, the post's tags, `registration.md` and the shrunk card showed the Approval. */
  shownAt: string | null;
  /** The page being filled, checked or pressed, 1 first; 0 until its session opens. */
  page: number;
  /** How many fill runs this page has had that count, which bounds them: one no provider served, or that a shutdown or crash cut off, doesn't. */
  fillRuns: number;
  /** How many sessions were asked for under this Approval, which names each one and bounds them. */
  sessionsOpened: number;
  /** Its session in the browser service, while it has one. */
  sessionId: string | null;
  /** Whether the form refused `+`, so the plain address fills the email field. */
  plainAddress: boolean;
  /** A replacement vault item that may have been created: the Password vault is read for it first (ADR 0007). */
  replacementIntended: Replacement | null;
  /** The vault items a replacement took the place of, oldest first, each with what the form refused and when. */
  replacedItems: { itemId: string; refused: Refused; at: string }[];
  /**
   * What the form refused, which the page's next fill run must fill again before it may name a button: the new
   * password, the email field with the plain address, or both. Cleared once a press leaves the page.
   */
  refill: Refill[];
  /** The stop mark, which plain code checks right before every press: when the person stopped it, and whether by Stop or by Correct. */
  stopAt: string | null;
  stopCause: 'stop' | 'correct' | null;
  waitsOn: WaitsOn | null;
  /** The label of the button being pressed, or last pressed. */
  button: string | null;
  /** When the final button was pressed. From then on the account may exist. */
  submittedAt: string | null;
  /** When it reached its outcome, and for an *abandoned* one, why. */
  endedAt: string | null;
  endNote: string | null;
  /** What was uncertain about its final press, when a restart or a failed click left it unknown. */
  uncertain: string | null;
  /** Whether the notice telling the person of it was sent, or may have been. */
  uncertainTold: boolean;
  /**
   * When the person tapped Start again on it, *abandoned*: the latest Walkthrough version then. A newer version is the
   * one Start again asked for, so until one is prepared, one is due.
   */
  startAgainFrom: number | null;
  /** What the status message, the tags and `registration.md` last showed of it. */
  shownKey: string | null;
  /** How each earlier Approval of it ended, oldest first, before Start again's Approval started it again. */
  history: { version: number; endedAt: string; endNote: string }[];
}

/** What a form refused, which a replacement vault item answers (ADR 0014). */
export type Refused = 'password' | 'plus';

/** A field a fill run must fill again after the form refused what it held. */
export type Refill = 'password' | 'email';

/** A replacement vault item to be made, kept before `bw` is asked for it. */
export interface Replacement {
  /** The new item's notes, naming the item it replaces and why, by which a create whose answer never came is found. */
  notes: string;
  refused: Refused;
  /** Which narrower password a refused password's replacement gets: 1 for the first, 2 for the next. */
  shape: number;
}

/** The fields of a Registration that filling and pressing change. */
export type RegistrationChange = Partial<
  Pick<
    StoredRegistration,
    | 'state'
    | 'page'
    | 'fillRuns'
    | 'sessionsOpened'
    | 'sessionId'
    | 'plainAddress'
    | 'replacementIntended'
    | 'refill'
    | 'waitsOn'
    | 'button'
    | 'submittedAt'
    | 'endedAt'
    | 'endNote'
    | 'uncertain'
    | 'uncertainTold'
    | 'shownKey'
  >
>;

const REGISTRATION_COLUMNS: Record<keyof RegistrationChange, string> = {
  state: 'state',
  page: 'page',
  fillRuns: 'fill_runs',
  sessionsOpened: 'sessions_opened',
  sessionId: 'session_id',
  plainAddress: 'plain_address',
  replacementIntended: 'replacement_intended',
  refill: 'refill',
  waitsOn: 'waits_on',
  button: 'button',
  submittedAt: 'submitted_at',
  endedAt: 'ended_at',
  endNote: 'end_note',
  uncertain: 'uncertain',
  uncertainTold: 'uncertain_told',
  shownKey: 'shown_key',
};

/** The states in which nothing final is pressed, so a Registration can still be stopped (#11). */
export const BEFORE_FINAL_PRESS: readonly RegistrationState[] = ['held', 'queued', 'filling', 'checking', 'pressing', 'check-failed', 'at-wall'];

export const beforeFinalPress = (r: Pick<StoredRegistration, 'state'>) => BEFORE_FINAL_PRESS.includes(r.state);

/** A change to the schema of a store that earlier code left, run once, in order, when the store opens (#98). */
export interface Migration {
  /** What it changes, for the error that names it if it fails. */
  name: string;
  sql: string;
}

/**
 * The schema's migrations, oldest first: the first takes a store from version 1, the baseline, to version 2, and so
 * on. `SCHEMA` is always the latest version, which a new store gets whole. Each schema version that has shipped is kept
 * in `bot/test/fixtures/store-schemas/`, and `bot/README.md` says how to add one.
 */
const MIGRATIONS: Migration[] = [
  {
    name: 'add ping_write, the row each healthchecks.io ping writes first, to show the store takes a write (#85)',
    sql: `CREATE TABLE ping_write (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  written_at TEXT NOT NULL
);`,
  },
  {
    name: "add registrations' vault item, the id of the Bitwarden item holding its password, and its intended mark (#54)",
    sql: `ALTER TABLE registrations ADD COLUMN vault_item_intended INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN vault_item_id TEXT;`,
  },
  {
    name: "add provider_dropouts, each provider's time out of use, and dossier_tries' waiting mark for a Dossier that waits on a provider (#46)",
    sql: `CREATE TABLE provider_dropouts (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  since TEXT NOT NULL,
  until TEXT NOT NULL,
  reset_known INTEGER NOT NULL,
  noted_at TEXT,
  card_intended INTEGER NOT NULL DEFAULT 0,
  card_message_id TEXT,
  card_shrunk_at TEXT,
  back_at TEXT,
  back_noted_at TEXT
);
CREATE UNIQUE INDEX provider_dropouts_open ON provider_dropouts(provider, role) WHERE back_at IS NULL;
ALTER TABLE dossier_tries ADD COLUMN waiting INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    name: "add what filling and pressing a Registration keeps: its page, session, stop mark and outcome, the presses' intended and done marks, and whether a Correction was of an approved Walkthrough (#56)",
    sql: `ALTER TABLE registrations ADD COLUMN page INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN fill_runs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN sessions_opened INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN session_id TEXT;
ALTER TABLE registrations ADD COLUMN plain_address INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN replacement_intended TEXT;
ALTER TABLE registrations ADD COLUMN replaced_items TEXT NOT NULL DEFAULT '[]';
ALTER TABLE registrations ADD COLUMN stop_at TEXT;
ALTER TABLE registrations ADD COLUMN stop_cause TEXT;
ALTER TABLE registrations ADD COLUMN waits_on TEXT;
ALTER TABLE registrations ADD COLUMN button TEXT;
ALTER TABLE registrations ADD COLUMN submitted_at TEXT;
ALTER TABLE registrations ADD COLUMN ended_at TEXT;
ALTER TABLE registrations ADD COLUMN end_note TEXT;
ALTER TABLE registrations ADD COLUMN uncertain TEXT;
ALTER TABLE registrations ADD COLUMN uncertain_told INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN start_again_from INTEGER;
ALTER TABLE registrations ADD COLUMN shown_key TEXT;
ALTER TABLE registrations ADD COLUMN refill TEXT NOT NULL DEFAULT '[]';
ALTER TABLE registrations ADD COLUMN history TEXT NOT NULL DEFAULT '[]';
ALTER TABLE walkthrough_corrections ADD COLUMN of_approved TEXT;
CREATE TABLE presses (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  version INTEGER NOT NULL,
  session TEXT NOT NULL,
  page INTEGER NOT NULL,
  button TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  final INTEGER NOT NULL,
  intended_at TEXT NOT NULL,
  done_at TEXT,
  uncertain TEXT
);`,
  },
];

/** The latest schema, which a new store gets whole at the latest version. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS miner_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS miner_days (
  date TEXT PRIMARY KEY,
  taken_at TEXT NOT NULL,
  problem TEXT,
  late_noted_at TEXT,
  dropped_at TEXT,
  drop_noted_at TEXT
);
CREATE TABLE IF NOT EXISTS miner_dates (
  date TEXT PRIMARY KEY,
  featured_count INTEGER NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS launches (
  post_id TEXT PRIMARY KEY,
  date TEXT NOT NULL REFERENCES miner_dates(date),
  rank INTEGER NOT NULL,
  launch TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS launches_by_date ON launches(date, rank);
CREATE TABLE IF NOT EXISTS judgments (
  post_id TEXT PRIMARY KEY REFERENCES launches(post_id),
  date TEXT NOT NULL,
  fit INTEGER NOT NULL CHECK (fit BETWEEN 0 AND 10),
  not_a_product INTEGER NOT NULL,
  reason TEXT NOT NULL,
  rules_applied TEXT NOT NULL,
  run_id TEXT NOT NULL,
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  request_id INTEGER NOT NULL REFERENCES model_requests(id),
  judged_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES launches(post_id),
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  fit INTEGER CHECK (fit BETWEEN 0 AND 10),
  not_a_product INTEGER,
  reason TEXT,
  rules_applied TEXT,
  run_id TEXT,
  role TEXT,
  provider TEXT,
  model TEXT,
  request_id INTEGER REFERENCES model_requests(id),
  judged_at TEXT,
  unjudged TEXT,
  problem TEXT,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS corrections_by_date ON corrections(date, id);
CREATE TABLE IF NOT EXISTS sorts (
  correction TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  outcome TEXT NOT NULL,
  hard_limit TEXT,
  proposal TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  why TEXT,
  rules_applied TEXT NOT NULL,
  run_id TEXT REFERENCES runs(id),
  sorted_at TEXT NOT NULL,
  shown_at TEXT,
  card_intended INTEGER NOT NULL DEFAULT 0,
  card_message_id TEXT,
  keep_tapped_at TEXT,
  not_kept TEXT,
  kept_at TEXT,
  kept_path TEXT,
  discarded_at TEXT,
  settled_at TEXT
);
CREATE TABLE IF NOT EXISTS day_lines (
  date TEXT PRIMARY KEY,
  featured_count INTEGER NOT NULL,
  line INTEGER NOT NULL,
  floor INTEGER NOT NULL,
  k INTEGER NOT NULL,
  kth INTEGER,
  eligible_count INTEGER NOT NULL,
  drawn_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS day_posts (
  date TEXT PRIMARY KEY,
  title TEXT,
  thread_id TEXT,
  messages_intended INTEGER NOT NULL DEFAULT 0,
  posted_at TEXT
);
CREATE TABLE IF NOT EXISTS day_post_messages (
  date TEXT NOT NULL,
  idx INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (date, idx)
);
CREATE TABLE IF NOT EXISTS miner_retries (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL REFERENCES miner_dates(date),
  post_ids TEXT NOT NULL,
  capped_runs TEXT NOT NULL,
  after_retry INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  tapped_at TEXT,
  ran_at TEXT
);
CREATE INDEX IF NOT EXISTS miner_retries_by_date ON miner_retries(date, id);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  root_domain TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  post_intended INTEGER NOT NULL DEFAULT 0,
  thread_id TEXT,
  withdrawn_at TEXT
);
CREATE TABLE IF NOT EXISTS product_launches (
  post_id TEXT PRIMARY KEY REFERENCES launches(post_id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dossiers (
  product_id INTEGER NOT NULL REFERENCES products(id),
  version INTEGER NOT NULL,
  dossier TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  provider TEXT NOT NULL,
  model TEXT,
  written_at TEXT NOT NULL,
  PRIMARY KEY (product_id, version)
);
CREATE TABLE IF NOT EXISTS dossier_tries (
  post_id TEXT PRIMARY KEY REFERENCES launches(post_id),
  tries INTEGER NOT NULL,
  why TEXT NOT NULL,
  unwritten_at TEXT NOT NULL,
  stop_noted_at TEXT,
  unshown INTEGER NOT NULL DEFAULT 0,
  waiting INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS signup_tags (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  tag TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS walkthroughs (
  product_id INTEGER NOT NULL REFERENCES products(id),
  version INTEGER NOT NULL,
  walkthrough TEXT NOT NULL,
  hash TEXT NOT NULL,
  read TEXT NOT NULL,
  cause TEXT NOT NULL,
  run_id TEXT REFERENCES runs(id),
  prepared_at TEXT NOT NULL,
  card_intended INTEGER NOT NULL DEFAULT 0,
  card_message_id TEXT,
  copy_intended INTEGER NOT NULL DEFAULT 0,
  copy_message_id TEXT,
  shown_at TEXT,
  dismissed_at TEXT,
  lapsed_at TEXT,
  again_tapped_at TEXT,
  end_shown_at TEXT,
  PRIMARY KEY (product_id, version)
);
CREATE TABLE IF NOT EXISTS no_walkthroughs (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  why TEXT NOT NULL,
  found_at TEXT NOT NULL,
  shown_at TEXT
);
CREATE TABLE IF NOT EXISTS walkthrough_corrections (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  redone_version INTEGER,
  withdrawn TEXT,
  unapplied TEXT,
  done_at TEXT,
  of_approved TEXT
);
CREATE TABLE IF NOT EXISTS approvals (
  item TEXT NOT NULL,
  version_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  interaction_id TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (item, version_hash)
);
CREATE TABLE IF NOT EXISTS registrations (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  version INTEGER NOT NULL,
  state TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  status_intended INTEGER NOT NULL DEFAULT 0,
  status_message_id TEXT,
  shown_at TEXT,
  vault_item_intended INTEGER NOT NULL DEFAULT 0,
  vault_item_id TEXT,
  page INTEGER NOT NULL DEFAULT 0,
  fill_runs INTEGER NOT NULL DEFAULT 0,
  sessions_opened INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  plain_address INTEGER NOT NULL DEFAULT 0,
  replacement_intended TEXT,
  replaced_items TEXT NOT NULL DEFAULT '[]',
  stop_at TEXT,
  stop_cause TEXT,
  waits_on TEXT,
  button TEXT,
  submitted_at TEXT,
  ended_at TEXT,
  end_note TEXT,
  uncertain TEXT,
  uncertain_told INTEGER NOT NULL DEFAULT 0,
  start_again_from INTEGER,
  shown_key TEXT,
  refill TEXT NOT NULL DEFAULT '[]',
  history TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS presses (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  version INTEGER NOT NULL,
  session TEXT NOT NULL,
  page INTEGER NOT NULL,
  button TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  final INTEGER NOT NULL,
  intended_at TEXT NOT NULL,
  done_at TEXT,
  uncertain TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  role TEXT NOT NULL,
  item TEXT NOT NULL,
  started_at TEXT NOT NULL,
  rules_commit TEXT NOT NULL,
  ended_at TEXT,
  outcome TEXT
);
CREATE INDEX IF NOT EXISTS runs_by_item ON runs(role, item);
CREATE TABLE IF NOT EXISTS model_requests (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  status INTEGER NOT NULL,
  input_tokens INTEGER,
  cached_tokens INTEGER,
  output_tokens INTEGER,
  dollars REAL NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS model_requests_by_run ON model_requests(run_id);
CREATE TABLE IF NOT EXISTS provider_dropouts (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  since TEXT NOT NULL,
  until TEXT NOT NULL,
  reset_known INTEGER NOT NULL,
  noted_at TEXT,
  card_intended INTEGER NOT NULL DEFAULT 0,
  card_message_id TEXT,
  card_shrunk_at TEXT,
  back_at TEXT,
  back_noted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_dropouts_open ON provider_dropouts(provider, role) WHERE back_at IS NULL;
CREATE TABLE IF NOT EXISTS raw_inputs (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  item TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS raw_inputs_by_expiry ON raw_inputs(expires_at);
CREATE TABLE IF NOT EXISTS personal_database_writes (
  path TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  message TEXT NOT NULL,
  create_only INTEGER NOT NULL DEFAULT 0,
  queued_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS personal_database_divergences (
  id INTEGER PRIMARY KEY,
  found_at TEXT NOT NULL,
  ours TEXT NOT NULL,
  theirs TEXT NOT NULL,
  branch TEXT NOT NULL,
  branch_pushed_at TEXT,
  card_intended INTEGER NOT NULL DEFAULT 0,
  card_message_id TEXT,
  rejoined_at TEXT
);
CREATE TABLE IF NOT EXISTS ping_write (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  written_at TEXT NOT NULL
);
`;

type Row = Record<string, SQLInputValue>;

const tokensOf = (row: Row): Tokens | null =>
  row.input_tokens === null ? null : { input: Number(row.input_tokens), cached: Number(row.cached_tokens), output: Number(row.output_tokens) };

const textOrNull = (value: SQLInputValue | undefined) => (value === null || value === undefined ? null : String(value));

const minerDayOf = (row: Row): MinerDay => ({
  date: String(row.date),
  takenAt: String(row.taken_at),
  problem: textOrNull(row.problem),
  lateNotedAt: textOrNull(row.late_noted_at),
  droppedAt: textOrNull(row.dropped_at),
  dropNotedAt: textOrNull(row.drop_noted_at),
});

const walkthroughOf = (row: Row): StoredWalkthrough => ({
  productId: Number(row.product_id),
  version: Number(row.version),
  walkthrough: JSON.parse(String(row.walkthrough)) as Walkthrough,
  hash: String(row.hash),
  read: JSON.parse(String(row.read)) as PageRead,
  cause: JSON.parse(String(row.cause)) as VersionCause,
  runId: textOrNull(row.run_id),
  preparedAt: String(row.prepared_at),
  cardIntended: Boolean(row.card_intended),
  cardMessageId: textOrNull(row.card_message_id),
  copyIntended: Boolean(row.copy_intended),
  copyMessageId: textOrNull(row.copy_message_id),
  shownAt: textOrNull(row.shown_at),
  dismissedAt: textOrNull(row.dismissed_at),
  lapsedAt: textOrNull(row.lapsed_at),
  againTappedAt: textOrNull(row.again_tapped_at),
  endShownAt: textOrNull(row.end_shown_at),
});

const walkthroughCorrectionOf = (row: Row): WalkthroughCorrection => ({
  id: Number(row.id),
  productId: Number(row.product_id),
  version: Number(row.version),
  text: String(row.text),
  submittedAt: String(row.submitted_at),
  redoneVersion: row.redone_version === null ? null : Number(row.redone_version),
  withdrawn: textOrNull(row.withdrawn),
  unapplied: textOrNull(row.unapplied),
  doneAt: textOrNull(row.done_at),
  ofApproved: textOrNull(row.of_approved) as WalkthroughCorrection['ofApproved'],
});

const registrationOf = (row: Row): StoredRegistration => ({
  productId: Number(row.product_id),
  version: Number(row.version),
  state: String(row.state) as StoredRegistration['state'],
  approvedAt: String(row.approved_at),
  vaultItemIntended: Boolean(row.vault_item_intended),
  vaultItemId: textOrNull(row.vault_item_id),
  statusIntended: Boolean(row.status_intended),
  statusMessageId: textOrNull(row.status_message_id),
  shownAt: textOrNull(row.shown_at),
  page: Number(row.page),
  fillRuns: Number(row.fill_runs),
  sessionsOpened: Number(row.sessions_opened),
  sessionId: textOrNull(row.session_id),
  plainAddress: Boolean(row.plain_address),
  replacementIntended: row.replacement_intended === null ? null : (JSON.parse(String(row.replacement_intended)) as Replacement),
  replacedItems: JSON.parse(String(row.replaced_items)) as StoredRegistration['replacedItems'],
  refill: JSON.parse(String(row.refill)) as Refill[],
  history: JSON.parse(String(row.history)) as StoredRegistration['history'],
  stopAt: textOrNull(row.stop_at),
  stopCause: textOrNull(row.stop_cause) as StoredRegistration['stopCause'],
  waitsOn: row.waits_on === null ? null : (JSON.parse(String(row.waits_on)) as WaitsOn),
  button: textOrNull(row.button),
  submittedAt: textOrNull(row.submitted_at),
  endedAt: textOrNull(row.ended_at),
  endNote: textOrNull(row.end_note),
  uncertain: textOrNull(row.uncertain),
  uncertainTold: Boolean(row.uncertain_told),
  startAgainFrom: row.start_again_from === null ? null : Number(row.start_again_from),
  shownKey: textOrNull(row.shown_key),
});

const pressOf = (row: Row): PressMark => ({
  id: Number(row.id),
  productId: Number(row.product_id),
  version: Number(row.version),
  session: String(row.session),
  page: Number(row.page),
  button: String(row.button),
  fingerprint: String(row.fingerprint),
  final: Boolean(row.final),
  intendedAt: String(row.intended_at),
  doneAt: textOrNull(row.done_at),
  uncertain: textOrNull(row.uncertain),
});

const approvalOf = (row: Row): Approval => ({
  item: String(row.item),
  versionHash: String(row.version_hash),
  version: Number(row.version),
  userId: String(row.user_id),
  interactionId: String(row.interaction_id),
  approvedAt: String(row.approved_at),
});

const dossierTriesOf = (row: Row): DossierTries => ({
  postId: String(row.post_id),
  tries: Number(row.tries),
  why: String(row.why),
  unwrittenAt: String(row.unwritten_at),
  stopNotedAt: textOrNull(row.stop_noted_at),
  waiting: Boolean(row.waiting),
});

const providerDropoutOf = (row: Row): ProviderDropout => ({
  id: Number(row.id),
  provider: String(row.provider),
  role: String(row.role),
  kind: String(row.kind) as DropoutKind,
  detail: textOrNull(row.detail),
  since: String(row.since),
  until: String(row.until),
  resetKnown: Boolean(row.reset_known),
  notedAt: textOrNull(row.noted_at),
  cardIntended: Boolean(row.card_intended),
  cardMessageId: textOrNull(row.card_message_id),
  cardShrunkAt: textOrNull(row.card_shrunk_at),
  backAt: textOrNull(row.back_at),
  backNotedAt: textOrNull(row.back_noted_at),
});

const productOf = (row: Row): Product => ({
  id: Number(row.id),
  rootDomain: String(row.root_domain),
  title: String(row.title),
  createdAt: String(row.created_at),
  postIntended: Boolean(row.post_intended),
  threadId: textOrNull(row.thread_id),
  withdrawnAt: textOrNull(row.withdrawn_at),
});

/** A judgment, from a row of judgments or of a Correction that has one: both hold it in the same columns. */
const judgmentOf = (row: Row): Judgment => ({
  postId: String(row.post_id),
  date: String(row.date),
  fit: Number(row.fit),
  notAProduct: Boolean(row.not_a_product),
  reason: String(row.reason),
  rulesApplied: JSON.parse(String(row.rules_applied)) as string[],
  runId: String(row.run_id),
  role: String(row.role) as Role,
  provider: String(row.provider),
  model: textOrNull(row.model),
  requestId: Number(row.request_id),
  judgedAt: String(row.judged_at),
});

const correctionOf = (row: Row): Correction => ({
  id: Number(row.id),
  postId: String(row.post_id),
  date: String(row.date),
  text: String(row.text),
  submittedAt: String(row.submitted_at),
  judgment: row.judged_at === null ? null : judgmentOf(row),
  unjudged: textOrNull(row.unjudged),
  problem: textOrNull(row.problem),
  doneAt: textOrNull(row.done_at),
});

const sortOf = (row: Row): StoredSort => ({
  correction: String(row.correction),
  item: JSON.parse(String(row.item)) as SortedItem,
  outcome: String(row.outcome) as StoredSort['outcome'],
  hardLimit: textOrNull(row.hard_limit),
  proposal: row.proposal === null ? null : (JSON.parse(String(row.proposal)) as Proposal),
  version: Number(row.version),
  why: textOrNull(row.why),
  rulesApplied: JSON.parse(String(row.rules_applied)) as string[],
  runId: textOrNull(row.run_id),
  sortedAt: String(row.sorted_at),
  shownAt: textOrNull(row.shown_at),
  cardIntended: Boolean(row.card_intended),
  cardMessageId: textOrNull(row.card_message_id),
  keepTappedAt: textOrNull(row.keep_tapped_at),
  notKept: textOrNull(row.not_kept),
  keptAt: textOrNull(row.kept_at),
  keptPath: textOrNull(row.kept_path),
  discardedAt: textOrNull(row.discarded_at),
  settledAt: textOrNull(row.settled_at),
});

const minerRetryOf = (row: Row): MinerRetry => ({
  id: Number(row.id),
  date: String(row.date),
  postIds: JSON.parse(String(row.post_ids)) as string[],
  cappedRuns: JSON.parse(String(row.capped_runs)) as CappedRun[],
  afterRetry: Boolean(row.after_retry),
  createdAt: String(row.created_at),
  tappedAt: textOrNull(row.tapped_at),
  ranAt: textOrNull(row.ran_at),
});

export class Store {
  #db: DatabaseSync;

  private constructor(path: string, migrations: Migration[]) {
    this.#db = new DatabaseSync(path);
    try {
      // Node turns foreign keys on by default. They stay off while migrations run, so a migration can rebuild a table
      // that keys point at, and each migration checks them itself before it commits.
      this.#db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF;');
      this.#migrate(path, migrations);
      this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  /** Opens the store at `path`, a new one if the file is empty or missing, and brings it to the latest schema. */
  static open(path: string, migrations = MIGRATIONS): Store {
    return new Store(path, migrations);
  }

  /**
   * Brings the store to the latest schema version, before anything reads or writes it. A store newer than the code is
   * refused untouched, as #98 settled: code that knows only an older schema would fail at its first query of a table
   * a migration changed.
   */
  #migrate(path: string, migrations: Migration[]): void {
    const latest = 1 + migrations.length;
    const recorded = Number(this.#db.prepare('PRAGMA user_version').get()!.user_version);
    if (recorded > latest) {
      throw new Error(
        `The live store ${path} is at schema version ${recorded}, newer than this code, which knows up to version ${latest}. ` +
          `Upgrade to code that knows version ${recorded} again, or restore the store from a backup made before it reached that version, losing the live state since.`,
      );
    }
    if (recorded === 0 && !this.#db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table'").get()) {
      this.#transaction(() => {
        this.#db.exec(SCHEMA);
        this.#db.exec(`PRAGMA user_version = ${latest}`);
      });
      return;
    }
    // Tables with no version recorded were left by code from before #98, whose schema is the baseline.
    if (recorded === 0) this.#db.exec('PRAGMA user_version = 1');
    for (let version = Math.max(recorded, 1); version < latest; version++) {
      const migration = migrations[version - 1]!;
      try {
        this.#transaction(() => {
          this.#db.exec(migration.sql);
          const broken = this.#db.prepare('PRAGMA foreign_key_check').get();
          if (broken) throw new Error(`it leaves a key of ${String(broken.table)} pointing at no row of ${String(broken.parent)}`);
          this.#db.exec(`PRAGMA user_version = ${version + 1}`);
        });
      } catch (error) {
        throw new Error(
          `The migration to schema version ${version + 1} (${migration.name}) failed, so the live store ${path} stays at version ${version}: ${errorText(error)}`,
        );
      }
    }
  }

  close(): void {
    this.#db.close();
  }

  #transaction<T>(fn: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  // ---------- The healthchecks.io ping ----------

  /** Writes the time, as each healthchecks.io ping does first, to show the store takes a write. Throws if it can't. */
  savePingWrite(at: string): void {
    this.#db.prepare('INSERT INTO ping_write (id, written_at) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET written_at = excluded.written_at').run(at);
  }

  // ---------- The Miner dates the bot has taken on ----------

  /** The latest date the Miner has taken on or dropped; every later date is still to come. */
  minerCursor(): string | undefined {
    const row = this.#db.prepare('SELECT date FROM miner_cursor WHERE id = 1').get();
    return row ? String(row.date) : undefined;
  }

  saveMinerCursor(date: string): void {
    this.#db.prepare('INSERT INTO miner_cursor (id, date) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET date = excluded.date').run(date);
  }

  /** Takes on a date, or records it as dropped at once when it is already outside the window. */
  addMinerDay(date: string, takenAt: string, droppedAt: string | null): void {
    this.#db
      .prepare('INSERT INTO miner_days (date, taken_at, dropped_at) VALUES (?, ?, ?) ON CONFLICT (date) DO NOTHING')
      .run(date, takenAt, droppedAt);
  }

  minerDay(date: string): MinerDay | undefined {
    const row = this.#db.prepare('SELECT * FROM miner_days WHERE date = ?').get(date);
    return row ? minerDayOf(row) : undefined;
  }

  /** Every date taken on, oldest first. */
  minerDays(): MinerDay[] {
    return this.#db.prepare('SELECT * FROM miner_days ORDER BY date').all().map(minerDayOf);
  }

  saveMinerDayProblem(date: string, problem: string | null): void {
    this.#db.prepare('UPDATE miner_days SET problem = ? WHERE date = ?').run(problem, date);
  }

  /** Marks the late line as said, or as not said after all. */
  saveMinerDayLateNoted(date: string, at: string | null): void {
    this.#db.prepare('UPDATE miner_days SET late_noted_at = ? WHERE date = ?').run(at, date);
  }

  saveMinerDayDropped(date: string, at: string): void {
    this.#db.prepare('UPDATE miner_days SET dropped_at = ? WHERE date = ? AND dropped_at IS NULL').run(at, date);
  }

  /** Marks the dropped line as said, or as not said after all. */
  saveMinerDaysDropNoted(dates: string[], at: string | null): void {
    const update = this.#db.prepare('UPDATE miner_days SET drop_noted_at = ? WHERE date = ?');
    this.#transaction(() => {
      for (const date of dates) update.run(at, date);
    });
  }

  // ---------- A Miner date's Launches ----------

  /** The date's Featured Launches in Product Hunt order, or undefined if the date hasn't been fetched. */
  launchesFor(date: string): Launch[] | undefined {
    const known = this.#db.prepare('SELECT 1 FROM miner_dates WHERE date = ?').get(date);
    if (!known) return undefined;
    return this.#db
      .prepare('SELECT launch FROM launches WHERE date = ? ORDER BY rank, post_id')
      .all(date)
      .map((row) => JSON.parse(String(row.launch)) as Launch);
  }

  /** A Launch the Miner fetched, with the date it was featured on. */
  launch(postId: string): (Launch & { date: string }) | undefined {
    const row = this.#db.prepare('SELECT date, launch FROM launches WHERE post_id = ?').get(postId);
    return row ? { ...(JSON.parse(String(row.launch)) as Launch), date: String(row.date) } : undefined;
  }

  /** Keeps the date's whole set of Featured Launches; the set is fixed once fetched. */
  saveLaunches(date: string, launches: Launch[], fetchedAt: string): void {
    this.#transaction(() => {
      this.#db.prepare('INSERT INTO miner_dates (date, featured_count, fetched_at) VALUES (?, ?, ?)').run(date, launches.length, fetchedAt);
      const insert = this.#db.prepare('INSERT INTO launches (post_id, date, rank, launch) VALUES (?, ?, ?, ?)');
      for (const launch of launches) insert.run(launch.postId, date, launch.rank, JSON.stringify(launch));
    });
  }

  // ---------- Judgments ----------

  judgmentsFor(date: string): Judgment[] {
    return this.#db.prepare('SELECT * FROM judgments WHERE date = ?').all(date).map(judgmentOf);
  }

  hasJudgment(postId: string): boolean {
    return Boolean(this.#db.prepare('SELECT 1 FROM judgments WHERE post_id = ?').get(postId));
  }

  /** Keeps a judgment as it is made. */
  saveJudgment(j: Judgment): void {
    this.#db
      .prepare(
        `INSERT INTO judgments (post_id, date, fit, not_a_product, reason, rules_applied, run_id, role, provider, model,
           request_id, judged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        j.postId,
        j.date,
        j.fit,
        j.notAProduct ? 1 : 0,
        j.reason,
        JSON.stringify(j.rulesApplied),
        j.runId,
        j.role,
        j.provider,
        j.model,
        j.requestId,
        j.judgedAt,
      );
  }

  // ---------- Corrections of judgments ----------

  /** Keeps a Correction as the person sends it, before its run. Returns its id. */
  saveCorrection(c: { postId: string; date: string; text: string; submittedAt: string }): number {
    const result = this.#db
      .prepare('INSERT INTO corrections (post_id, date, text, submitted_at) VALUES (?, ?, ?, ?)')
      .run(c.postId, c.date, c.text, c.submittedAt);
    return Number(result.lastInsertRowid);
  }

  /** The date's Corrections, oldest first. */
  correctionsFor(date: string): Correction[] {
    return this.#db.prepare('SELECT * FROM corrections WHERE date = ? ORDER BY id').all(date).map(correctionOf);
  }

  /** The Corrections whose work isn't done, oldest first. */
  unfinishedCorrections(): Correction[] {
    return this.#db.prepare('SELECT * FROM corrections WHERE done_at IS NULL ORDER BY id').all().map(correctionOf);
  }

  correction(id: number): Correction | undefined {
    const row = this.#db.prepare('SELECT * FROM corrections WHERE id = ?').get(id);
    return row ? correctionOf(row) : undefined;
  }

  /** Keeps the judgment a Correction's run recorded. Only the first counts; a later one returns false. */
  saveCorrectionJudgment(id: number, j: Judgment): boolean {
    const result = this.#db
      .prepare(
        `UPDATE corrections SET fit = ?, not_a_product = ?, reason = ?, rules_applied = ?, run_id = ?, role = ?, provider = ?,
           model = ?, request_id = ?, judged_at = ?
         WHERE id = ? AND judged_at IS NULL AND unjudged IS NULL`,
      )
      .run(j.fit, j.notAProduct ? 1 : 0, j.reason, JSON.stringify(j.rulesApplied), j.runId, j.role, j.provider, j.model, j.requestId, j.judgedAt, id);
    return Number(result.changes) > 0;
  }

  saveCorrectionUnjudged(id: number, why: string): void {
    this.#db.prepare('UPDATE corrections SET unjudged = ? WHERE id = ? AND judged_at IS NULL').run(why, id);
  }

  saveCorrectionProblem(id: number, problem: string | null): void {
    this.#db.prepare('UPDATE corrections SET problem = ? WHERE id = ?').run(problem, id);
  }

  saveCorrectionDone(id: number, at: string): void {
    this.#db.prepare('UPDATE corrections SET done_at = ?, problem = NULL WHERE id = ?').run(at, id);
  }

  // ---------- What Corrections' sorting runs made of them ----------

  /** The Corrections re-judged and done whose sort the item's history doesn't show yet, oldest first. */
  unsortedCorrections(): Correction[] {
    return this.#db
      .prepare(
        `SELECT corrections.* FROM corrections LEFT JOIN sorts ON sorts.correction = 'miner:' || corrections.id
         WHERE corrections.done_at IS NOT NULL AND corrections.judged_at IS NOT NULL AND sorts.shown_at IS NULL
         ORDER BY corrections.id`,
      )
      .all()
      .map(correctionOf);
  }

  sortOf(correction: string): StoredSort | undefined {
    const row = this.#db.prepare('SELECT * FROM sorts WHERE correction = ?').get(correction);
    return row ? sortOf(row) : undefined;
  }

  /** Keeps what a sorting run made of a Correction. Only the first counts; a later one returns false. */
  saveSort(s: Pick<StoredSort, 'correction' | 'item' | 'outcome' | 'hardLimit' | 'proposal' | 'why' | 'rulesApplied' | 'runId' | 'sortedAt'>): boolean {
    const result = this.#db
      .prepare(
        `INSERT INTO sorts (correction, item, outcome, hard_limit, proposal, why, rules_applied, run_id, sorted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (correction) DO NOTHING`,
      )
      .run(
        s.correction,
        JSON.stringify(s.item),
        s.outcome,
        s.hardLimit,
        s.proposal && JSON.stringify(s.proposal),
        s.why,
        JSON.stringify(s.rulesApplied),
        s.runId,
        s.sortedAt,
      );
    return Number(result.changes) > 0;
  }

  saveSortShown(correction: string, at: string): void {
    this.#db.prepare('UPDATE sorts SET shown_at = ? WHERE correction = ?').run(at, correction);
  }

  /** Marks the proposal's card as about to be sent, or as not sent after all. */
  saveSortCardIntended(correction: string, intended: boolean): void {
    this.#db.prepare('UPDATE sorts SET card_intended = ? WHERE correction = ?').run(intended ? 1 : 0, correction);
  }

  saveSortCard(correction: string, messageId: string): void {
    this.#db.prepare('UPDATE sorts SET card_message_id = ? WHERE correction = ?').run(messageId, correction);
  }

  /**
   * The proposals the person's taps left work for, oldest first: a Keep to do, a decision to show, or a card to show
   * open again after a Keep that couldn't be done.
   */
  undoneProposals(): StoredSort[] {
    return this.#db
      .prepare(
        `SELECT * FROM sorts WHERE outcome = 'proposed' AND settled_at IS NULL
           AND (keep_tapped_at IS NOT NULL OR kept_at IS NOT NULL OR discarded_at IS NOT NULL OR not_kept IS NOT NULL)
         ORDER BY sorted_at, rowid`,
      )
      .all()
      .map(sortOf);
  }

  /**
   * Records Keep tapped on this version of a proposal. Only a tap on the latest version of one still open counts; any
   * other returns false.
   */
  saveSortKeepTapped(correction: string, version: number, at: string): boolean {
    const result = this.#db
      .prepare(
        `UPDATE sorts SET keep_tapped_at = ?, not_kept = NULL
         WHERE correction = ? AND version = ? AND outcome = 'proposed' AND keep_tapped_at IS NULL AND kept_at IS NULL
           AND discarded_at IS NULL`,
      )
      .run(at, correction, version);
    return Number(result.changes) > 0;
  }

  /**
   * Keeps the person's edit of this version of a proposal as its next version. Only an edit of the latest version of
   * one still open counts; any other returns false.
   */
  saveSortEdited(correction: string, version: number, proposal: Proposal): boolean {
    const result = this.#db
      .prepare(
        `UPDATE sorts SET proposal = ?, version = version + 1, not_kept = NULL
         WHERE correction = ? AND version = ? AND outcome = 'proposed' AND keep_tapped_at IS NULL AND kept_at IS NULL
           AND discarded_at IS NULL`,
      )
      .run(JSON.stringify(proposal), correction, version);
    return Number(result.changes) > 0;
  }

  /** Records Discard tapped on this version of a proposal still open; any other tap returns false. */
  saveSortDiscarded(correction: string, version: number, at: string): boolean {
    const result = this.#db
      .prepare(
        `UPDATE sorts SET discarded_at = ?
         WHERE correction = ? AND version = ? AND outcome = 'proposed' AND keep_tapped_at IS NULL AND kept_at IS NULL
           AND discarded_at IS NULL`,
      )
      .run(at, correction, version);
    return Number(result.changes) > 0;
  }

  /** Records a proposal kept, with the file Keep writes queued, both at once. */
  saveSortKept(correction: string, write: PersonalDatabaseWrite): void {
    this.#transaction(() => {
      this.queuePersonalDatabaseWrite(write);
      this.#db.prepare('UPDATE sorts SET kept_at = ?, kept_path = ? WHERE correction = ?').run(write.queuedAt, write.path, correction);
    });
  }

  /** The Keep tapped couldn't be done, for this reason; the proposal is open again. */
  saveSortNotKept(correction: string, why: string): void {
    this.#db.prepare('UPDATE sorts SET keep_tapped_at = NULL, not_kept = ? WHERE correction = ?').run(why, correction);
  }

  saveSortSettled(correction: string, at: string): void {
    this.#db.prepare('UPDATE sorts SET settled_at = ? WHERE correction = ?').run(at, correction);
  }

  // ---------- Day's lines ----------

  dayLine(date: string): StoredDayLine | undefined {
    const row = this.#db.prepare('SELECT * FROM day_lines WHERE date = ?').get(date);
    if (!row) return undefined;
    return {
      date,
      featuredCount: Number(row.featured_count),
      line: Number(row.line),
      floor: Number(row.floor),
      k: Number(row.k),
      kth: row.kth === null ? null : Number(row.kth),
      eligibleCount: Number(row.eligible_count),
      drawnAt: String(row.drawn_at),
    };
  }

  /** Stores the date's line. It is drawn once; a later call keeps the first. */
  saveDayLine(line: StoredDayLine): void {
    this.#db
      .prepare(
        `INSERT INTO day_lines (date, featured_count, line, floor, k, kth, eligible_count, drawn_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (date) DO NOTHING`,
      )
      .run(line.date, line.featuredCount, line.line, line.floor, line.k, line.kth, line.eligibleCount, line.drawnAt);
  }

  // ---------- Day posts on Discord ----------

  dayPost(date: string): DayPost {
    const row = this.#db.prepare('SELECT * FROM day_posts WHERE date = ?').get(date);
    const messageIds = this.#db
      .prepare('SELECT message_id FROM day_post_messages WHERE date = ? ORDER BY idx')
      .all(date)
      .map((m) => String(m.message_id));
    return {
      date,
      postIntended: Boolean(row),
      title: textOrNull(row?.title),
      threadId: row?.thread_id ? String(row.thread_id) : null,
      messageIds,
      messagesIntended: Number(row?.messages_intended ?? 0),
      postedAt: row?.posted_at ? String(row.posted_at) : null,
    };
  }

  /** Marks the post, or the message at `index`, as about to be sent. */
  saveDayPostIntended(date: string, index: number): void {
    this.#db
      .prepare(
        `INSERT INTO day_posts (date, messages_intended) VALUES (?, ?)
         ON CONFLICT (date) DO UPDATE SET messages_intended = max(messages_intended, excluded.messages_intended)`,
      )
      .run(date, index + 1);
  }

  /** Marks the post as about to be created under this title. */
  saveDayPostCreating(date: string, title: string): void {
    this.#db
      .prepare(
        `INSERT INTO day_posts (date, title, messages_intended) VALUES (?, ?, 1)
         ON CONFLICT (date) DO UPDATE SET title = excluded.title, messages_intended = max(messages_intended, 1)`,
      )
      .run(date, title);
  }

  saveDayPostTitle(date: string, title: string): void {
    this.#db.prepare('UPDATE day_posts SET title = ? WHERE date = ?').run(title, date);
  }

  /** Keeps the post's id, which is also the id of its first message. */
  saveDayPostThread(date: string, threadId: string): void {
    this.#transaction(() => {
      this.#db.prepare('UPDATE day_posts SET thread_id = ? WHERE date = ?').run(threadId, date);
      this.#db.prepare('INSERT INTO day_post_messages (date, idx, message_id) VALUES (?, 0, ?)').run(date, threadId);
    });
  }

  saveDayPostMessage(date: string, index: number, messageId: string): void {
    this.#db.prepare('INSERT INTO day_post_messages (date, idx, message_id) VALUES (?, ?, ?)').run(date, index, messageId);
  }

  saveDayPosted(date: string, at: string): void {
    this.#db.prepare('UPDATE day_posts SET posted_at = ? WHERE date = ?').run(at, date);
  }

  // ---------- Retries a capped Miner date waits on ----------

  saveMinerRetry(retry: Omit<MinerRetry, 'id' | 'tappedAt' | 'ranAt'>): number {
    const result = this.#db
      .prepare('INSERT INTO miner_retries (date, post_ids, capped_runs, after_retry, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(retry.date, JSON.stringify(retry.postIds), JSON.stringify(retry.cappedRuns), retry.afterRetry ? 1 : 0, retry.createdAt);
    return Number(result.lastInsertRowid);
  }

  /** The date's Retries, in the order their notices go into the day's post. */
  minerRetries(date: string): MinerRetry[] {
    return this.#db.prepare('SELECT * FROM miner_retries WHERE date = ? ORDER BY id').all(date).map(minerRetryOf);
  }

  minerRetry(id: number): MinerRetry | undefined {
    const row = this.#db.prepare('SELECT * FROM miner_retries WHERE id = ?').get(id);
    return row ? minerRetryOf(row) : undefined;
  }

  /** Records the person's tap. Only the first tap counts; a later one returns false. */
  saveMinerRetryTapped(id: number, at: string): boolean {
    const result = this.#db.prepare('UPDATE miner_retries SET tapped_at = ? WHERE id = ? AND tapped_at IS NULL').run(at, id);
    return Number(result.changes) > 0;
  }

  saveMinerRetryRan(id: number, at: string): void {
    this.#db.prepare('UPDATE miner_retries SET ran_at = ? WHERE id = ?').run(at, id);
  }

  // ---------- Products, their Launches and Dossiers ----------

  productByDomain(rootDomain: string): Product | undefined {
    const row = this.#db.prepare('SELECT * FROM products WHERE root_domain = ?').get(rootDomain);
    return row ? productOf(row) : undefined;
  }

  /** The Product a Launch belongs to, once the Launch's site was read for a Dossier. */
  productOfLaunch(postId: string): Product | undefined {
    const row = this.#db
      .prepare('SELECT products.* FROM products JOIN product_launches ON product_launches.product_id = products.id WHERE post_id = ?')
      .get(postId);
    return row ? productOf(row) : undefined;
  }

  product(id: number): Product | undefined {
    const row = this.#db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    return row ? productOf(row) : undefined;
  }

  /**
   * Keeps a new Product with its first Dossier, the Launch it was written for, and the files it brings to the
   * Personal database, all at once. Returns the Product's id.
   */
  saveNewProduct(p: {
    postId: string;
    title: string;
    dossier: Omit<StoredDossier, 'productId' | 'version'>;
    files: Omit<PersonalDatabaseWrite, 'queuedAt'>[];
  }): number {
    const at = p.dossier.writtenAt;
    return this.#transaction(() => {
      const created = this.#db
        .prepare('INSERT INTO products (root_domain, title, created_at) VALUES (?, ?, ?)')
        .run(p.dossier.dossier.rootDomain, p.title, at);
      const id = Number(created.lastInsertRowid);
      this.#db.prepare('INSERT INTO product_launches (post_id, product_id, added_at) VALUES (?, ?, ?)').run(p.postId, id, at);
      const d = p.dossier;
      this.#db
        .prepare('INSERT INTO dossiers (product_id, version, dossier, run_id, provider, model, written_at) VALUES (?, 1, ?, ?, ?, ?, ?)')
        .run(id, JSON.stringify(d.dossier), d.runId, d.provider, d.model, at);
      for (const file of p.files) this.queuePersonalDatabaseWrite({ ...file, queuedAt: at });
      return id;
    });
  }

  /** Files a Launch under a Product that already has a Dossier, as a re-Launch. */
  saveProductLaunch(postId: string, productId: number, at: string): void {
    this.#db.prepare('INSERT INTO product_launches (post_id, product_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(postId, productId, at);
  }

  /** The Product's latest Dossier. */
  latestDossier(productId: number): StoredDossier | undefined {
    const row = this.#db.prepare('SELECT * FROM dossiers WHERE product_id = ? ORDER BY version DESC LIMIT 1').get(productId);
    if (!row) return undefined;
    return {
      productId,
      version: Number(row.version),
      dossier: JSON.parse(String(row.dossier)) as Dossier,
      runId: String(row.run_id),
      provider: String(row.provider),
      model: textOrNull(row.model),
      writtenAt: String(row.written_at),
    };
  }

  /** Marks the Product's post as about to be created. */
  saveProductPostIntended(id: number): void {
    this.#db.prepare('UPDATE products SET post_intended = 1 WHERE id = ?').run(id);
  }

  /** Keeps the post's id, which is also the id of its first message, the Dossier. */
  saveProductPost(id: number, threadId: string): void {
    this.#db.prepare('UPDATE products SET thread_id = ? WHERE id = ?').run(threadId, id);
  }

  /** The tries at a Launch's Dossier that ended without one, if any did. */
  dossierTries(postId: string): DossierTries | undefined {
    const row = this.#db.prepare('SELECT * FROM dossier_tries WHERE post_id = ?').get(postId);
    return row ? dossierTriesOf(row) : undefined;
  }

  /** The Launches filed under no Product whose Dossier a try ended without. */
  unwrittenDossiers(): DossierTries[] {
    return this.#db
      .prepare(
        `SELECT * FROM dossier_tries
         WHERE NOT EXISTS (SELECT 1 FROM product_launches WHERE product_launches.post_id = dossier_tries.post_id)
         ORDER BY post_id`,
      )
      .all()
      .map(dossierTriesOf);
  }

  /**
   * The Launches whose Dossier a try ended without once, filed under a Product whose post isn't up: not taken by
   * Discord yet, or withdrawn.
   */
  unpostedTriedDossiers(): string[] {
    return this.#db
      .prepare(
        `SELECT dossier_tries.post_id FROM dossier_tries
           JOIN product_launches ON product_launches.post_id = dossier_tries.post_id
           JOIN products ON products.id = product_launches.product_id
         WHERE products.thread_id IS NULL OR products.withdrawn_at IS NOT NULL
         ORDER BY dossier_tries.post_id`,
      )
      .all()
      .map((row) => String(row.post_id));
  }

  saveDossierStopNoted(postId: string, at: string | null): void {
    this.#db.prepare('UPDATE dossier_tries SET stop_noted_at = ? WHERE post_id = ?').run(at, postId);
  }

  /** Marks the queue's tries at these Launches' Dossiers as not yet shown in their dates' lists, or as shown. */
  saveDossiersUnshown(postIds: string[], unshown: boolean): void {
    const update = this.#db.prepare('UPDATE dossier_tries SET unshown = ? WHERE post_id = ?');
    this.#transaction(() => {
      for (const postId of postIds) update.run(unshown ? 1 : 0, postId);
    });
  }

  /** The Launches whose Dossier the queue tried, not yet shown in their dates' lists, by date. */
  unshownDossiers(): { date: string; postIds: string[] }[] {
    const rows = this.#db
      .prepare('SELECT launches.date, dossier_tries.post_id FROM dossier_tries JOIN launches USING (post_id) WHERE unshown = 1 ORDER BY date, post_id')
      .all();
    return [...Map.groupBy(rows, (r) => String(r.date))].map(([date, rs]) => ({ date, postIds: rs.map((r) => String(r.post_id)) }));
  }

  /**
   * Counts one more try that ended without the Launch's Dossier, and keeps why. A stop told under a lower limit is told
   * again.
   */
  saveDossierUnwritten(postId: string, why: string, at: string): void {
    this.#db
      .prepare(
        `INSERT INTO dossier_tries (post_id, tries, why, unwritten_at) VALUES (?, 1, ?, ?)
         ON CONFLICT DO UPDATE SET tries = tries + 1, why = excluded.why, unwritten_at = excluded.unwritten_at, stop_noted_at = NULL, waiting = 0`,
      )
      .run(postId, why, at);
  }

  /** Keeps why the Launch's Dossier waits for its role to have a provider again. No try is counted (#46). */
  saveDossierWaiting(postId: string, why: string, at: string): void {
    this.#db
      .prepare(
        `INSERT INTO dossier_tries (post_id, tries, why, unwritten_at, waiting) VALUES (?, 0, ?, ?, 1)
         ON CONFLICT DO UPDATE SET why = excluded.why, waiting = 1`,
      )
      .run(postId, why, at);
  }

  /** Marks the Product's Dossier as withdrawn by a Correction, or as put back. */
  saveProductWithdrawn(id: number, at: string | null): void {
    this.#db.prepare('UPDATE products SET withdrawn_at = ? WHERE id = ?').run(at, id);
  }

  // ---------- Walkthroughs, Approvals and Registrations ----------

  /** The Product's plus-address tag (ADR 0003), kept once made: `base`, or `base` with a number when another has it. */
  signupTag(productId: number, base: string): string {
    return this.#transaction(() => {
      const kept = this.#db.prepare('SELECT tag FROM signup_tags WHERE product_id = ?').get(productId);
      if (kept) return String(kept.tag);
      for (let n = 1; ; n++) {
        const tag = n === 1 ? base : `${base}${n}`;
        const taken = this.#db.prepare('SELECT 1 FROM signup_tags WHERE tag = ?').get(tag);
        if (taken) continue;
        this.#db.prepare('INSERT INTO signup_tags (product_id, tag) VALUES (?, ?)').run(productId, tag);
        return tag;
      }
    });
  }

  /**
   * The Products that wait on a Walkthrough being prepared: each open or waitlisted Product whose Dossier is posted and
   * not withdrawn, with no wall that rules one out, and either no Registration and no Walkthrough yet, or one the
   * person tapped Prepare again on, or an *abandoned* Registration the person tapped Start again on with no newer
   * Walkthrough yet, or whose later Walkthrough lapsed and got Prepare again.
   */
  productsDueWalkthrough(): Product[] {
    return this.#db
      .prepare(
        `SELECT products.* FROM products
         WHERE thread_id IS NOT NULL AND withdrawn_at IS NULL
           AND (SELECT json_extract(dossier, '$.record.state') FROM dossiers WHERE dossiers.product_id = products.id
                ORDER BY version DESC LIMIT 1) IN ('open', 'waitlisted')
           AND NOT EXISTS (SELECT 1 FROM no_walkthroughs WHERE no_walkthroughs.product_id = products.id)
           AND CASE WHEN EXISTS (SELECT 1 FROM registrations WHERE registrations.product_id = products.id)
               THEN EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = products.id AND r.state = 'abandoned' AND (
                      r.start_again_from = (SELECT MAX(version) FROM walkthroughs WHERE walkthroughs.product_id = products.id)
                      OR EXISTS (SELECT 1 FROM walkthroughs w WHERE w.product_id = products.id AND w.version > r.version
                                 AND w.again_tapped_at IS NOT NULL
                                 AND w.version = (SELECT MAX(version) FROM walkthroughs WHERE walkthroughs.product_id = products.id))))
               ELSE COALESCE((SELECT again_tapped_at IS NOT NULL FROM walkthroughs WHERE walkthroughs.product_id = products.id
                              ORDER BY version DESC LIMIT 1), 1)
               END
         ORDER BY products.id`,
      )
      .all()
      .map(productOf);
  }

  /**
   * Keeps a new version of a Product's Walkthrough as its latest, and returns its number. A Correction's version is
   * recorded as what came of that Correction, at once.
   */
  saveWalkthrough(w: {
    productId: number;
    walkthrough: Walkthrough;
    hash: string;
    read: PageRead;
    cause: VersionCause;
    runId: string | null;
    preparedAt: string;
    /** For an Edit: the card it edits, which this version is shown on too. */
    cardMessageId?: string | null;
    correctionId?: number;
  }): number {
    return this.#transaction(() => {
      const last = this.#db.prepare('SELECT MAX(version) AS v FROM walkthroughs WHERE product_id = ?').get(w.productId);
      const version = Number(last?.v ?? 0) + 1;
      const sameCard = w.cardMessageId !== undefined;
      this.#db
        .prepare(
          `INSERT INTO walkthroughs (product_id, version, walkthrough, hash, read, cause, run_id, prepared_at, card_intended, card_message_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          w.productId,
          version,
          JSON.stringify(w.walkthrough),
          w.hash,
          JSON.stringify(w.read),
          JSON.stringify(w.cause),
          w.runId,
          w.preparedAt,
          sameCard ? 1 : 0,
          w.cardMessageId ?? null,
        );
      if (w.correctionId !== undefined) {
        this.#db.prepare('UPDATE walkthrough_corrections SET redone_version = ? WHERE id = ?').run(version, w.correctionId);
      }
      return version;
    });
  }

  walkthrough(productId: number, version: number): StoredWalkthrough | undefined {
    const row = this.#db.prepare('SELECT * FROM walkthroughs WHERE product_id = ? AND version = ?').get(productId, version);
    return row ? walkthroughOf(row) : undefined;
  }

  latestWalkthrough(productId: number): StoredWalkthrough | undefined {
    const row = this.#db.prepare('SELECT * FROM walkthroughs WHERE product_id = ? ORDER BY version DESC LIMIT 1').get(productId);
    return row ? walkthroughOf(row) : undefined;
  }

  /** Versions not yet shown, or dismissed or lapsed and not yet shown so, oldest first. */
  unshownWalkthroughs(): StoredWalkthrough[] {
    return this.#db
      .prepare(
        `SELECT * FROM walkthroughs WHERE shown_at IS NULL OR ((dismissed_at IS NOT NULL OR lapsed_at IS NOT NULL) AND end_shown_at IS NULL)
         ORDER BY prepared_at, product_id, version`,
      )
      .all()
      .map(walkthroughOf);
  }

  /**
   * The latest version of each Walkthrough still waiting on the person: not approved, dismissed or lapsed, not under a
   * Correction, and of a Dossier not withdrawn. A version prepared after its Product's Registration was *abandoned*
   * waits like any other.
   */
  openWalkthroughs(): StoredWalkthrough[] {
    return this.#db
      .prepare(
        `SELECT w.* FROM walkthroughs w
         WHERE w.version = (SELECT MAX(version) FROM walkthroughs WHERE product_id = w.product_id)
           AND w.dismissed_at IS NULL AND w.lapsed_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = w.product_id AND p.withdrawn_at IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.product_id = w.product_id AND (r.state != 'abandoned' OR r.version >= w.version))
           AND NOT EXISTS (SELECT 1 FROM no_walkthroughs n WHERE n.product_id = w.product_id)
           AND NOT EXISTS (SELECT 1 FROM walkthrough_corrections c WHERE c.product_id = w.product_id AND c.version = w.version AND c.done_at IS NULL)
         ORDER BY w.prepared_at, w.product_id`,
      )
      .all()
      .map(walkthroughOf);
  }

  /** Marks a version's card as about to be sent, or as not sent after all. */
  saveWalkthroughCardIntended(productId: number, version: number, intended: boolean): void {
    this.#db.prepare('UPDATE walkthroughs SET card_intended = ? WHERE product_id = ? AND version = ?').run(intended ? 1 : 0, productId, version);
  }

  saveWalkthroughCard(productId: number, version: number, messageId: string): void {
    this.#db.prepare('UPDATE walkthroughs SET card_message_id = ? WHERE product_id = ? AND version = ?').run(messageId, productId, version);
  }

  /** Marks a version's copy in the Product's post as about to be sent, or as not sent after all. */
  saveWalkthroughCopyIntended(productId: number, version: number, intended: boolean): void {
    this.#db.prepare('UPDATE walkthroughs SET copy_intended = ? WHERE product_id = ? AND version = ?').run(intended ? 1 : 0, productId, version);
  }

  saveWalkthroughCopy(productId: number, version: number, messageId: string): void {
    this.#db.prepare('UPDATE walkthroughs SET copy_message_id = ? WHERE product_id = ? AND version = ?').run(messageId, productId, version);
  }

  saveWalkthroughShown(productId: number, version: number, at: string): void {
    this.#db.prepare('UPDATE walkthroughs SET shown_at = ? WHERE product_id = ? AND version = ?').run(at, productId, version);
  }

  /** Records Dismiss on a version still open; any other returns false. */
  saveWalkthroughDismissed(productId: number, version: number, at: string): boolean {
    return this.#endOpen('dismissed_at', productId, version, at);
  }

  /** Records a version lapsed while still open; any other returns false. */
  saveWalkthroughLapsed(productId: number, version: number, at: string): boolean {
    return this.#endOpen('lapsed_at', productId, version, at);
  }

  #endOpen(column: 'dismissed_at' | 'lapsed_at', productId: number, version: number, at: string): boolean {
    const open = this.openWalkthroughs().some((w) => w.productId === productId && w.version === version);
    if (!open) return false;
    this.#db.prepare(`UPDATE walkthroughs SET ${column} = ? WHERE product_id = ? AND version = ?`).run(at, productId, version);
    return true;
  }

  /** Records Prepare again on the latest version, lapsed, once; any other tap returns false. */
  saveWalkthroughAgainTapped(productId: number, version: number, at: string): boolean {
    const result = this.#db
      .prepare(
        `UPDATE walkthroughs SET again_tapped_at = ?
         WHERE product_id = ? AND version = ? AND lapsed_at IS NOT NULL AND again_tapped_at IS NULL
           AND version = (SELECT MAX(version) FROM walkthroughs WHERE product_id = ?)`,
      )
      .run(at, productId, version, productId);
    return Number(result.changes) > 0;
  }

  saveWalkthroughEndShown(productId: number, version: number, at: string): void {
    this.#db.prepare('UPDATE walkthroughs SET end_shown_at = ? WHERE product_id = ? AND version = ?').run(at, productId, version);
  }

  noWalkthrough(productId: number): NoWalkthrough | undefined {
    const row = this.#db.prepare('SELECT * FROM no_walkthroughs WHERE product_id = ?').get(productId);
    return row
      ? { productId, why: String(row.why), foundAt: String(row.found_at), shownAt: textOrNull(row.shown_at) }
      : undefined;
  }

  /** Records that a Product gets no Walkthrough, and why: the first reason found stands. */
  saveNoWalkthrough(productId: number, why: string, at: string): void {
    this.#db.prepare('INSERT INTO no_walkthroughs (product_id, why, found_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(productId, why, at);
  }

  unshownNoWalkthroughs(): NoWalkthrough[] {
    return this.#db
      .prepare('SELECT product_id FROM no_walkthroughs WHERE shown_at IS NULL ORDER BY found_at')
      .all()
      .map((row) => this.noWalkthrough(Number(row.product_id))!);
  }

  saveNoWalkthroughShown(productId: number, at: string): void {
    this.#db.prepare('UPDATE no_walkthroughs SET shown_at = ? WHERE product_id = ?').run(at, productId);
  }

  /** Keeps the person's Correction of a version, and returns its id. */
  saveWalkthroughCorrection(c: { productId: number; version: number; text: string; submittedAt: string; ofApproved?: WalkthroughCorrection['ofApproved'] }): number {
    const result = this.#db
      .prepare('INSERT INTO walkthrough_corrections (product_id, version, text, submitted_at, of_approved) VALUES (?, ?, ?, ?, ?)')
      .run(c.productId, c.version, c.text, c.submittedAt, c.ofApproved ?? null);
    return Number(result.lastInsertRowid);
  }

  walkthroughCorrection(id: number): WalkthroughCorrection | undefined {
    const row = this.#db.prepare('SELECT * FROM walkthrough_corrections WHERE id = ?').get(id);
    return row ? walkthroughCorrectionOf(row) : undefined;
  }

  /** A Product's Walkthrough Corrections, oldest first. */
  walkthroughCorrectionsOf(productId: number): WalkthroughCorrection[] {
    return this.#db.prepare('SELECT * FROM walkthrough_corrections WHERE product_id = ? ORDER BY id').all(productId).map(walkthroughCorrectionOf);
  }

  unfinishedWalkthroughCorrections(): WalkthroughCorrection[] {
    return this.#db.prepare('SELECT * FROM walkthrough_corrections WHERE done_at IS NULL ORDER BY id').all().map(walkthroughCorrectionOf);
  }

  /**
   * Walkthrough Corrections whose item is redone, or found to need no Walkthrough, or which fix only the record, and
   * whose sort isn't shown yet.
   */
  unsortedWalkthroughCorrections(): WalkthroughCorrection[] {
    return this.#db
      .prepare(
        `SELECT c.* FROM walkthrough_corrections c LEFT JOIN sorts ON sorts.correction = 'walkthrough:' || c.id
         WHERE c.done_at IS NOT NULL AND (c.redone_version IS NOT NULL OR c.withdrawn IS NOT NULL OR c.of_approved = 'after-final-press') AND sorts.shown_at IS NULL
         ORDER BY c.id`,
      )
      .all()
      .map(walkthroughCorrectionOf);
  }

  /** Records that a Correction's run found no Walkthrough can be offered, so the Product gets none. */
  saveWalkthroughCorrectionWithdrawn(id: number, why: string, at: string): void {
    this.#transaction(() => {
      const { product_id } = this.#db.prepare('SELECT product_id FROM walkthrough_corrections WHERE id = ?').get(id)!;
      this.#db.prepare('UPDATE walkthrough_corrections SET withdrawn = ? WHERE id = ?').run(why, id);
      this.saveNoWalkthrough(Number(product_id), why, at);
    });
  }

  /** Records that a Correction of an approved Walkthrough came too late to stop its Registration, so it fixes only the record. */
  saveWalkthroughCorrectionRecordOnly(id: number): void {
    this.#db.prepare("UPDATE walkthrough_corrections SET of_approved = 'after-final-press' WHERE id = ?").run(id);
  }

  saveWalkthroughCorrectionUnapplied(id: number, why: string): void {
    this.#db.prepare('UPDATE walkthrough_corrections SET unapplied = ? WHERE id = ?').run(why, id);
  }

  saveWalkthroughCorrectionDone(id: number, at: string): void {
    this.#db.prepare('UPDATE walkthrough_corrections SET done_at = ? WHERE id = ?').run(at, id);
  }

  /**
   * Records the person's Approval of one version of a Product's Walkthrough, and the Registration it starts, at once.
   * Only one Approval counts per version, and a Product has at most one Registration: a later tap returns the Approval
   * already kept. An *abandoned* Registration is the one a later version's Approval starts again (#11), from its first
   * page, keeping its vault item and its status message.
   */
  approveWalkthrough(a: Omit<Approval, 'item'> & { productId: number; state: RegistrationState }): 'approved' | { already: Approval } {
    const item = `walkthrough:${a.productId}`;
    return this.#transaction(() => {
      const latest = this.#db.prepare('SELECT * FROM approvals WHERE item = ? ORDER BY approved_at DESC LIMIT 1').get(item);
      const registration = this.registration(a.productId);
      const again = registration?.state === 'abandoned' && a.version > registration.version;
      if (latest && !again) return { already: approvalOf(latest) };
      const same = this.#db.prepare('SELECT * FROM approvals WHERE item = ? AND version_hash = ?').get(item, a.versionHash);
      if (same) return { already: approvalOf(same) };
      this.#db
        .prepare('INSERT INTO approvals (item, version_hash, version, user_id, interaction_id, approved_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(item, a.versionHash, a.version, a.userId, a.interactionId, a.approvedAt);
      if (again) {
        // How the earlier Approval ended stays in the Registration's history, which `registration.md` shows.
        const history = [...registration.history, { version: registration.version, endedAt: registration.endedAt!, endNote: registration.endNote ?? 'nothing submitted' }];
        this.#db
          .prepare(
            `UPDATE registrations SET version = ?, state = ?, approved_at = ?, shown_at = NULL, page = 0, fill_runs = 0, sessions_opened = 0,
               stop_at = NULL, stop_cause = NULL, waits_on = NULL, button = NULL, ended_at = NULL, end_note = NULL, refill = '[]',
               start_again_from = NULL, shown_key = NULL, history = ?
             WHERE product_id = ?`,
          )
          .run(a.version, a.state, a.approvedAt, JSON.stringify(history), a.productId);
      } else {
        this.#db
          .prepare('INSERT INTO registrations (product_id, version, state, approved_at) VALUES (?, ?, ?, ?)')
          .run(a.productId, a.version, a.state, a.approvedAt);
      }
      return 'approved';
    });
  }

  /** The latest Approval of a Product's Walkthrough, once it has one. */
  walkthroughApproval(productId: number): Approval | undefined {
    const row = this.#db.prepare('SELECT * FROM approvals WHERE item = ? ORDER BY approved_at DESC LIMIT 1').get(`walkthrough:${productId}`);
    return row ? approvalOf(row) : undefined;
  }

  /** Every Approval of a Product's Walkthroughs, oldest first. */
  walkthroughApprovals(productId: number): Approval[] {
    return this.#db.prepare('SELECT * FROM approvals WHERE item = ? ORDER BY approved_at').all(`walkthrough:${productId}`).map(approvalOf);
  }

  registration(productId: number): StoredRegistration | undefined {
    const row = this.#db.prepare('SELECT * FROM registrations WHERE product_id = ?').get(productId);
    return row ? registrationOf(row) : undefined;
  }

  unshownRegistrations(): StoredRegistration[] {
    return this.#db.prepare('SELECT * FROM registrations WHERE shown_at IS NULL ORDER BY approved_at').all().map(registrationOf);
  }

  /** The Registrations whose Approval waits on the Password vault, oldest first. */
  heldRegistrations(): StoredRegistration[] {
    return this.#db.prepare("SELECT * FROM registrations WHERE state = 'held' ORDER BY approved_at").all().map(registrationOf);
  }

  /** Marks that a vault item may be created for this Registration from now on, before `bw` is asked for one. */
  saveRegistrationVaultIntended(productId: number): void {
    this.#db.prepare('UPDATE registrations SET vault_item_intended = 1 WHERE product_id = ?').run(productId);
  }

  /** Keeps the id of the vault item holding the password, and starts the Registration in the state given. */
  saveRegistrationVaultItem(productId: number, itemId: string, state: 'queued' | 'handed-off'): void {
    // One the person stopped while it was held stays *abandoned*, and keeps the item made for it.
    this.#db.prepare("UPDATE registrations SET vault_item_id = ?, state = CASE WHEN state = 'held' THEN ? ELSE state END WHERE product_id = ?").run(itemId, state, productId);
  }

  /** Marks the Registration's status message as about to be sent, or as not sent after all. */
  saveRegistrationStatusIntended(productId: number, intended: boolean): void {
    this.#db.prepare('UPDATE registrations SET status_intended = ? WHERE product_id = ?').run(intended ? 1 : 0, productId);
  }

  saveRegistrationStatus(productId: number, messageId: string): void {
    this.#db.prepare('UPDATE registrations SET status_message_id = ? WHERE product_id = ?').run(messageId, productId);
  }

  saveRegistrationShown(productId: number, at: string): void {
    this.#db.prepare('UPDATE registrations SET shown_at = ? WHERE product_id = ?').run(at, productId);
  }

  // ---------- Filling and pressing a Registration (#56) ----------

  /** The Registrations in these states, oldest Approval first. */
  registrationsIn(states: RegistrationState[]): StoredRegistration[] {
    return this.#db
      .prepare(`SELECT * FROM registrations WHERE state IN (${states.map(() => '?').join(', ')}) ORDER BY approved_at, product_id`)
      .all(...states)
      .map(registrationOf);
  }

  /**
   * Changes what filling and pressing keep of a Registration. One *abandoned* meanwhile, as by Stop, keeps what it has,
   * unless `evenIfAbandoned`, as for what was shown of it or a session closed.
   */
  saveRegistration(productId: number, change: RegistrationChange, options: { evenIfAbandoned?: boolean } = {}): void {
    const entries = Object.entries(change) as [keyof RegistrationChange, unknown][];
    if (entries.length === 0) return;
    const value = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'object' && v !== null ? JSON.stringify(v) : (v as string | number | null));
    const guard = options.evenIfAbandoned ? '' : " AND state != 'abandoned'";
    this.#db
      .prepare(`UPDATE registrations SET ${entries.map(([key]) => `${REGISTRATION_COLUMNS[key]} = ?`).join(', ')} WHERE product_id = ?${guard}`)
      .run(...entries.map(([, v]) => value(v)), productId);
  }

  /**
   * Writes the person's stop mark, unless it is there already (`stopped-already`, as for an *abandoned* Registration),
   * the final button is being pressed or was (`too-late`), or the Registration has reached its outcome otherwise
   * (`over`).
   */
  stopRegistration(productId: number, at: string, cause: 'stop' | 'correct'): 'stopped' | 'stopped-already' | 'too-late' | 'over' {
    return this.#transaction(() => {
      const r = this.registration(productId);
      if (!r) return 'over';
      if (r.state === 'abandoned' || (r.stopAt && beforeFinalPress(r))) return 'stopped-already';
      if (r.state === 'registered' || r.state === 'waitlisted' || r.state === 'handed-off') return 'over';
      if (!beforeFinalPress(r) || (r.state === 'pressing' && this.openPress(productId)?.final)) return 'too-late';
      this.#db.prepare('UPDATE registrations SET stop_at = ?, stop_cause = ? WHERE product_id = ?').run(at, cause, productId);
      return 'stopped';
    });
  }

  /**
   * Ends a stopped Registration *abandoned*, once: false when it isn't stopped or has ended already, and while a press
   * is under way, whose outcome decides it. Its session stays named until it is closed.
   */
  abandonStopped(productId: number, note: string, at: string): boolean {
    return this.#transaction(() => {
      const r = this.registration(productId);
      if (!r?.stopAt || !beforeFinalPress(r) || r.state === 'pressing') return false;
      this.#db
        .prepare("UPDATE registrations SET state = 'abandoned', ended_at = ?, end_note = ?, waits_on = NULL, refill = '[]' WHERE product_id = ?")
        .run(at, note, productId);
      return true;
    });
  }

  /**
   * Writes the *intended* mark of a press, right before it, and moves the Registration to pressing, unless the stop
   * mark is there: `stopped` then, and nothing is pressed.
   */
  intendPress(mark: Omit<PressMark, 'id' | 'doneAt' | 'uncertain'>): number | 'stopped' {
    return this.#transaction(() => {
      if (this.registration(mark.productId)?.stopAt) return 'stopped';
      const result = this.#db
        .prepare('INSERT INTO presses (product_id, version, session, page, button, fingerprint, final, intended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(mark.productId, mark.version, mark.session, mark.page, mark.button, mark.fingerprint, mark.final ? 1 : 0, mark.intendedAt);
      this.#db.prepare("UPDATE registrations SET state = 'pressing', button = ? WHERE product_id = ?").run(mark.button, mark.productId);
      return Number(result.lastInsertRowid);
    });
  }

  /** Marks a press done, with what was uncertain about it, if anything. */
  savePressDone(id: number, at: string, uncertain: string | null): void {
    this.#db.prepare('UPDATE presses SET done_at = ?, uncertain = ? WHERE id = ?').run(at, uncertain, id);
  }

  /** Takes back the mark of a press the browser service refused, so that nothing was pressed. */
  dropPress(id: number): void {
    this.#db.prepare('DELETE FROM presses WHERE id = ? AND done_at IS NULL').run(id);
  }

  /** The Registration's press that is intended and not done, if it has one. */
  openPress(productId: number): PressMark | undefined {
    const row = this.#db.prepare('SELECT * FROM presses WHERE product_id = ? AND done_at IS NULL ORDER BY id DESC LIMIT 1').get(productId);
    return row ? pressOf(row) : undefined;
  }

  /** Whether any button was pressed under this Approval, or may have been: a refused press leaves no mark. */
  pressedUnder(productId: number, version: number): boolean {
    return Boolean(this.#db.prepare('SELECT 1 FROM presses WHERE product_id = ? AND version = ?').get(productId, version));
  }

  /** The Registration's latest press. */
  lastPress(productId: number): PressMark | undefined {
    const row = this.#db.prepare('SELECT * FROM presses WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(productId);
    return row ? pressOf(row) : undefined;
  }

  /** Records Start again on an *abandoned* Registration; false on any other. */
  saveStartAgain(productId: number, from: number): boolean {
    const result = this.#db.prepare("UPDATE registrations SET start_again_from = ? WHERE product_id = ? AND state = 'abandoned'").run(from, productId);
    return Number(result.changes) > 0;
  }

  /** Makes a replacement the Registration's vault item, keeping the one it replaces and what the form refused. */
  saveReplacementItem(productId: number, itemId: string, refused: Refused, at: string): void {
    this.#transaction(() => {
      const r = this.registration(productId)!;
      const replaced = r.vaultItemId ? [...r.replacedItems, { itemId: r.vaultItemId, refused, at }] : r.replacedItems;
      this.#db
        .prepare('UPDATE registrations SET vault_item_id = ?, replaced_items = ?, replacement_intended = NULL WHERE product_id = ?')
        .run(itemId, JSON.stringify(replaced), productId);
    });
  }

  // ---------- Runs and model requests ----------

  startRun(run: RunRecord): void {
    this.#db
      .prepare('INSERT INTO runs (id, kind, role, item, started_at, rules_commit) VALUES (?, ?, ?, ?, ?, ?)')
      .run(run.id, run.kind, run.role, run.item, run.startedAt, run.rulesCommit);
  }

  finishRun(id: string, outcome: string, endedAt: string): void {
    this.#db.prepare('UPDATE runs SET outcome = ?, ended_at = ? WHERE id = ?').run(outcome, endedAt, id);
  }

  recordModelRequest(request: Omit<ModelRequest, 'id'>): number {
    const result = this.#db
      .prepare(
        `INSERT INTO model_requests (run_id, role, provider, model, status, input_tokens, cached_tokens, output_tokens, dollars, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.runId,
        request.role,
        request.provider,
        request.model,
        request.status,
        request.tokens?.input ?? null,
        request.tokens?.cached ?? null,
        request.tokens?.output ?? null,
        request.dollars,
        request.at,
      );
    return Number(result.lastInsertRowid);
  }

  /** The run's latest answered model request: the one whose reply holds the tool calls now running. */
  lastModelRequest(runId: string): ModelRequest | undefined {
    const row = this.#db.prepare('SELECT * FROM model_requests WHERE run_id = ? ORDER BY id DESC LIMIT 1').get(runId);
    if (!row) return undefined;
    return {
      id: Number(row.id),
      runId,
      role: String(row.role) as Role,
      provider: String(row.provider),
      model: row.model === null ? null : String(row.model),
      status: Number(row.status),
      tokens: tokensOf(row),
      dollars: Number(row.dollars),
      at: String(row.at),
    };
  }

  /** A run's exact tokens and notional dollars over all its requests, and the providers and models that served them. */
  runTotals(runId: string): { requests: number; tokens: Tokens; dollars: number; providers: string[]; models: string[] } {
    const rows = this.#db.prepare('SELECT * FROM model_requests WHERE run_id = ? ORDER BY id').all(runId);
    const tokens = { input: 0, cached: 0, output: 0 };
    let dollars = 0;
    for (const row of rows) {
      tokens.input += Number(row.input_tokens ?? 0);
      tokens.cached += Number(row.cached_tokens ?? 0);
      tokens.output += Number(row.output_tokens ?? 0);
      dollars += Number(row.dollars);
    }
    // A provider that refused a request served none of it.
    const served = rows.filter((r) => Number(r.status) >= 200 && Number(r.status) < 300);
    const distinct = (key: string) => [...new Set(served.map((r) => r[key]).filter((v) => v !== null).map(String))];
    return { requests: rows.length, tokens, dollars, providers: distinct('provider'), models: distinct('model') };
  }

  /** What the role's runs on an item, such as the Miner's on a date, have spent over all their requests. */
  spentOn(role: Role, item: string): number {
    const row = this.#db
      .prepare(
        `SELECT coalesce(sum(m.dollars), 0) AS dollars FROM model_requests m JOIN runs r ON r.id = m.run_id
         WHERE r.role = ? AND r.item = ?`,
      )
      .get(role, item);
    return Number(row?.dollars ?? 0);
  }

  // ---------- Providers that dropped out ----------

  /**
   * Keeps a provider's drop-out. If it is out already, only what it answered this time and when it is next tried change,
   * and its line is due again if why it is out is new, such as a limit turned into an empty balance.
   */
  saveProviderDropout(d: Pick<ProviderDropout, 'provider' | 'role' | 'kind' | 'detail' | 'since' | 'until' | 'resetKnown'>): void {
    this.#db
      .prepare(
        `INSERT INTO provider_dropouts (provider, role, kind, detail, since, until, reset_known) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider, role) WHERE back_at IS NULL
         DO UPDATE SET noted_at = CASE WHEN kind = excluded.kind THEN noted_at END, kind = excluded.kind, detail = excluded.detail,
           until = excluded.until, reset_known = excluded.reset_known`,
      )
      .run(d.provider, d.role, d.kind, d.detail, d.since, d.until, d.resetKnown ? 1 : 0);
  }

  /** Every provider out of use now, oldest first. */
  openProviderDropouts(): ProviderDropout[] {
    return this.#db.prepare('SELECT * FROM provider_dropouts WHERE back_at IS NULL ORDER BY id').all().map(providerDropoutOf);
  }

  /** The drop-outs with a line still to say or a card still to shrink, oldest first. */
  untoldProviderDropouts(): ProviderDropout[] {
    return this.#db
      .prepare(
        `SELECT * FROM provider_dropouts
         WHERE noted_at IS NULL OR (back_at IS NOT NULL AND (back_noted_at IS NULL OR (card_message_id IS NOT NULL AND card_shrunk_at IS NULL)))
         ORDER BY id`,
      )
      .all()
      .map(providerDropoutOf);
  }

  saveProviderBack(id: number, at: string): void {
    this.#db.prepare('UPDATE provider_dropouts SET back_at = ? WHERE id = ?').run(at, id);
  }

  /** Marks the line saying it dropped out as said, or as not said after all. */
  saveProviderDropoutNoted(id: number, at: string | null): void {
    this.#db.prepare('UPDATE provider_dropouts SET noted_at = ? WHERE id = ?').run(at, id);
  }

  /** Marks the line saying it's back as said, or as not said after all. */
  saveProviderBackNoted(id: number, at: string | null): void {
    this.#db.prepare('UPDATE provider_dropouts SET back_noted_at = ? WHERE id = ?').run(at, id);
  }

  /** Marks the card as about to be sent, or as not sent after all. */
  saveProviderCardIntended(id: number, intended: boolean): void {
    this.#db.prepare('UPDATE provider_dropouts SET card_intended = ? WHERE id = ?').run(intended ? 1 : 0, id);
  }

  saveProviderCard(id: number, messageId: string): void {
    this.#db.prepare('UPDATE provider_dropouts SET card_message_id = ? WHERE id = ?').run(messageId, id);
  }

  saveProviderCardShrunk(id: number, at: string): void {
    this.#db.prepare('UPDATE provider_dropouts SET card_shrunk_at = ? WHERE id = ?').run(at, id);
  }

  // ---------- Raw inputs ----------

  addRawInput(raw: Omit<RawInput, 'id'>): void {
    this.#db
      .prepare('INSERT INTO raw_inputs (source, item, path, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(raw.source, raw.item, raw.path, raw.fetchedAt, raw.expiresAt);
  }

  expiredRawInputs(now: string): RawInput[] {
    return this.#db
      .prepare('SELECT * FROM raw_inputs WHERE expires_at <= ? ORDER BY id')
      .all(now)
      .map((row) => ({
        id: Number(row.id),
        source: String(row.source),
        item: String(row.item),
        path: String(row.path),
        fetchedAt: String(row.fetched_at),
        expiresAt: String(row.expires_at),
      }));
  }

  removeRawInput(id: number): void {
    this.#db.prepare('DELETE FROM raw_inputs WHERE id = ?').run(id);
  }

  // ---------- Files waiting to be written to the Personal database ----------

  /** Queues a file to write. A file already waiting at the same path is replaced: only the latest is written. */
  queuePersonalDatabaseWrite(write: PersonalDatabaseWrite): void {
    this.#db
      .prepare(
        `INSERT INTO personal_database_writes (path, content, message, create_only, queued_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET content = excluded.content, message = excluded.message,
           create_only = excluded.create_only, queued_at = excluded.queued_at`,
      )
      .run(write.path, write.content, write.message, write.createOnly ? 1 : 0, write.queuedAt);
  }

  /** The files waiting, oldest first. */
  personalDatabaseWrites(): PersonalDatabaseWrite[] {
    return this.#db
      .prepare('SELECT * FROM personal_database_writes ORDER BY queued_at, path')
      .all()
      .map((row) => ({
        path: String(row.path),
        content: String(row.content),
        message: String(row.message),
        createOnly: Boolean(row.create_only),
        queuedAt: String(row.queued_at),
      }));
  }

  /** Marks a file written, unless a newer version of it was queued meanwhile. */
  removePersonalDatabaseWrite(path: string, content: string): void {
    this.#db.prepare('DELETE FROM personal_database_writes WHERE path = ? AND content = ?').run(path, content);
  }

  // ---------- Times the Personal database's history diverged ----------

  /** The divergence not yet rejoined, if there is one. */
  openDivergence(): Divergence | undefined {
    const row = this.#db.prepare('SELECT * FROM personal_database_divergences WHERE rejoined_at IS NULL ORDER BY id DESC LIMIT 1').get();
    if (!row) return undefined;
    return {
      id: Number(row.id),
      foundAt: String(row.found_at),
      ours: String(row.ours),
      theirs: String(row.theirs),
      branch: String(row.branch),
      branchPushedAt: textOrNull(row.branch_pushed_at),
      cardIntended: Boolean(row.card_intended),
      cardMessageId: textOrNull(row.card_message_id),
    };
  }

  saveDivergence(d: Pick<Divergence, 'foundAt' | 'ours' | 'theirs' | 'branch'>): void {
    this.#db
      .prepare('INSERT INTO personal_database_divergences (found_at, ours, theirs, branch) VALUES (?, ?, ?, ?)')
      .run(d.foundAt, d.ours, d.theirs, d.branch);
  }

  saveDivergenceBranchPushed(id: number, at: string): void {
    this.#db.prepare('UPDATE personal_database_divergences SET branch_pushed_at = ? WHERE id = ?').run(at, id);
  }

  /** Marks the card as about to be sent, or as not sent after all. */
  saveDivergenceCardIntended(id: number, intended: boolean): void {
    this.#db.prepare('UPDATE personal_database_divergences SET card_intended = ? WHERE id = ?').run(intended ? 1 : 0, id);
  }

  saveDivergenceCard(id: number, messageId: string): void {
    this.#db.prepare('UPDATE personal_database_divergences SET card_message_id = ? WHERE id = ?').run(messageId, id);
  }

  saveDivergenceRejoined(id: number, at: string): void {
    this.#db.prepare('UPDATE personal_database_divergences SET rejoined_at = ? WHERE id = ?').run(at, id);
  }
}
