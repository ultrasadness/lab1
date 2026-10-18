// The live store (ADR 0007): one SQLite file the bot alone writes, the single source of truth for live state.
// It holds the Miner dates the bot has taken on, each date's Launches, judgments by Post id, Day's lines by date, the
// day posts on Discord, the Retries a capped date waits on, run and model-request records, and the index of raw
// inputs kept outside git.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Role } from './config.ts';
import type { DayLine } from './miner/day-line.ts';
import type { JudgmentRecord } from './miner/judging.ts';
import type { RunCap } from './pi-runs.ts';

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
  /** The earliest comment by one of the Launch's makers, matched by user id; none if no maker commented. */
  makerComment: string | null;
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

export interface ModelRequest {
  id: number;
  runId: string;
  role: Role;
  provider: string;
  model: string | null;
  status: number;
  tokens: Tokens | null;
  at: string;
}

export interface RunRecord {
  id: string;
  kind: string;
  role: Role;
  item: string;
  startedAt: string;
}

export interface RawInput {
  id: number;
  source: string;
  item: string;
  path: string;
  fetchedAt: string;
  expiresAt: string;
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
CREATE TABLE IF NOT EXISTS day_lines (
  date TEXT PRIMARY KEY,
  featured_count INTEGER NOT NULL,
  line INTEGER NOT NULL,
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
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  role TEXT NOT NULL,
  item TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  outcome TEXT
);
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
    return this.#db
      .prepare('SELECT * FROM judgments WHERE date = ?')
      .all(date)
      .map((row) => ({
        postId: String(row.post_id),
        date: String(row.date),
        fit: Number(row.fit),
        notAProduct: Boolean(row.not_a_product),
        reason: String(row.reason),
        rulesApplied: JSON.parse(String(row.rules_applied)) as string[],
        runId: String(row.run_id),
        role: String(row.role) as Role,
        provider: String(row.provider),
        model: row.model === null ? null : String(row.model),
        requestId: Number(row.request_id),
        judgedAt: String(row.judged_at),
      }));
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

  // ---------- Day's lines ----------

  dayLine(date: string): StoredDayLine | undefined {
    const row = this.#db.prepare('SELECT * FROM day_lines WHERE date = ?').get(date);
    if (!row) return undefined;
    return {
      date,
      featuredCount: Number(row.featured_count),
      line: Number(row.line),
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
        `INSERT INTO day_lines (date, featured_count, line, k, kth, eligible_count, drawn_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (date) DO NOTHING`,
      )
      .run(line.date, line.featuredCount, line.line, line.k, line.kth, line.eligibleCount, line.drawnAt);
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

  // ---------- Runs and model requests ----------

  startRun(run: RunRecord): void {
    this.#db
      .prepare('INSERT INTO runs (id, kind, role, item, started_at) VALUES (?, ?, ?, ?, ?)')
      .run(run.id, run.kind, run.role, run.item, run.startedAt);
  }

  finishRun(id: string, outcome: string, endedAt: string): void {
    this.#db.prepare('UPDATE runs SET outcome = ?, ended_at = ? WHERE id = ?').run(outcome, endedAt, id);
  }

  recordModelRequest(request: Omit<ModelRequest, 'id'>): number {
    const result = this.#db
      .prepare(
        `INSERT INTO model_requests (run_id, role, provider, model, status, input_tokens, cached_tokens, output_tokens, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      at: String(row.at),
    };
  }

  /** A run's exact tokens over all its requests, and the providers and models that served them. */
  runTotals(runId: string): { requests: number; tokens: Tokens; providers: string[]; models: string[] } {
    const rows = this.#db.prepare('SELECT * FROM model_requests WHERE run_id = ? ORDER BY id').all(runId);
    const tokens = { input: 0, cached: 0, output: 0 };
    for (const row of rows) {
      tokens.input += Number(row.input_tokens ?? 0);
      tokens.cached += Number(row.cached_tokens ?? 0);
      tokens.output += Number(row.output_tokens ?? 0);
    }
    const distinct = (key: string) => [...new Set(rows.map((r) => r[key]).filter((v) => v !== null).map(String))];
    return { requests: rows.length, tokens, providers: distinct('provider'), models: distinct('model') };
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
}
