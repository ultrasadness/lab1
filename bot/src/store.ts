// The live store (ADR 0007): one SQLite file the bot alone writes, the single source of truth for live state.
// It holds the Miner dates the bot has taken on, each date's Launches, judgments by Post id, the person's Corrections
// of them with the judgments their runs gave and what their sorting runs and the person made of them, Day's lines by
// date, the day posts on Discord, the Retries a capped date
// waits on, Products by root domain with their Launches, Dossiers and posts, run and model-request records with each
// run's Rule-set commit and each request's notional dollars, the index of raw inputs kept outside git, the files
// waiting to be written to the Personal database, and the times its history diverged.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Role } from './config.ts';
import type { Dossier } from './dossier/dossier.ts';
import type { DayLine } from './miner/day-line.ts';
import type { JudgmentRecord } from './miner/judging.ts';
import type { RunCap } from './pi-runs.ts';
import type { Proposal, SortedItem } from './rules/sorting.ts';

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
  correctionId: number;
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
  correction_id INTEGER PRIMARY KEY REFERENCES corrections(id),
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
  correctionId: Number(row.correction_id),
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

  private constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.#db.exec(SCHEMA);
  }

  static open(path: string): Store {
    return new Store(path);
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
        `SELECT corrections.* FROM corrections LEFT JOIN sorts ON sorts.correction_id = corrections.id
         WHERE corrections.done_at IS NOT NULL AND corrections.judged_at IS NOT NULL AND sorts.shown_at IS NULL
         ORDER BY corrections.id`,
      )
      .all()
      .map(correctionOf);
  }

  sortOf(correctionId: number): StoredSort | undefined {
    const row = this.#db.prepare('SELECT * FROM sorts WHERE correction_id = ?').get(correctionId);
    return row ? sortOf(row) : undefined;
  }

  /** Keeps what a sorting run made of a Correction. Only the first counts; a later one returns false. */
  saveSort(s: Pick<StoredSort, 'correctionId' | 'item' | 'outcome' | 'hardLimit' | 'proposal' | 'why' | 'rulesApplied' | 'runId' | 'sortedAt'>): boolean {
    const result = this.#db
      .prepare(
        `INSERT INTO sorts (correction_id, item, outcome, hard_limit, proposal, why, rules_applied, run_id, sorted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (correction_id) DO NOTHING`,
      )
      .run(
        s.correctionId,
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

  saveSortShown(correctionId: number, at: string): void {
    this.#db.prepare('UPDATE sorts SET shown_at = ? WHERE correction_id = ?').run(at, correctionId);
  }

  /** Marks the proposal's card as about to be sent, or as not sent after all. */
  saveSortCardIntended(correctionId: number, intended: boolean): void {
    this.#db.prepare('UPDATE sorts SET card_intended = ? WHERE correction_id = ?').run(intended ? 1 : 0, correctionId);
  }

  saveSortCard(correctionId: number, messageId: string): void {
    this.#db.prepare('UPDATE sorts SET card_message_id = ? WHERE correction_id = ?').run(messageId, correctionId);
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
         ORDER BY correction_id`,
      )
      .all()
      .map(sortOf);
  }

  /**
   * Records Keep tapped on this version of a proposal. Only a tap on the latest version of one still open counts; any
   * other returns false.
   */
  saveSortKeepTapped(correctionId: number, version: number, at: string): boolean {
    const result = this.#db
      .prepare(
        `UPDATE sorts SET keep_tapped_at = ?, not_kept = NULL
         WHERE correction_id = ? AND version = ? AND outcome = 'proposed' AND keep_tapped_at IS NULL AND kept_at IS NULL
           AND discarded_at IS NULL`,
      )
      .run(at, correctionId, version);
    return Number(result.changes) > 0;
  }

  /**
   * Keeps the person's edit of this version of a proposal as its next version. Only an edit of the latest version of
   * one still open counts; any other returns false.
   */
  saveSortEdited(correctionId: number, version: number, proposal: Proposal): boolean {
    const result = this.#db
      .prepare(
        `UPDATE sorts SET proposal = ?, version = version + 1, not_kept = NULL
         WHERE correction_id = ? AND version = ? AND outcome = 'proposed' AND keep_tapped_at IS NULL AND kept_at IS NULL
           AND discarded_at IS NULL`,
      )
      .run(JSON.stringify(proposal), correctionId, version);
    return Number(result.changes) > 0;
  }

  /** Records Discard tapped on this version of a proposal still open; any other tap returns false. */
  saveSortDiscarded(correctionId: number, version: number, at: string): boolean {
    const result = this.#db
      .prepare(
        `UPDATE sorts SET discarded_at = ?
         WHERE correction_id = ? AND version = ? AND outcome = 'proposed' AND keep_tapped_at IS NULL AND kept_at IS NULL
           AND discarded_at IS NULL`,
      )
      .run(at, correctionId, version);
    return Number(result.changes) > 0;
  }

  /** Records a proposal kept, with the file Keep writes queued, both at once. */
  saveSortKept(correctionId: number, write: PersonalDatabaseWrite): void {
    this.#transaction(() => {
      this.queuePersonalDatabaseWrite(write);
      this.#db.prepare('UPDATE sorts SET kept_at = ?, kept_path = ? WHERE correction_id = ?').run(write.queuedAt, write.path, correctionId);
    });
  }

  /** The Keep tapped couldn't be done, for this reason; the proposal is open again. */
  saveSortNotKept(correctionId: number, why: string): void {
    this.#db.prepare('UPDATE sorts SET keep_tapped_at = NULL, not_kept = ? WHERE correction_id = ?').run(why, correctionId);
  }

  saveSortSettled(correctionId: number, at: string): void {
    this.#db.prepare('UPDATE sorts SET settled_at = ? WHERE correction_id = ?').run(at, correctionId);
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

  /** Marks the Product's Dossier as withdrawn by a Correction, or as put back. */
  saveProductWithdrawn(id: number, at: string | null): void {
    this.#db.prepare('UPDATE products SET withdrawn_at = ? WHERE id = ?').run(at, id);
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
    const distinct = (key: string) => [...new Set(rows.map((r) => r[key]).filter((v) => v !== null).map(String))];
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
