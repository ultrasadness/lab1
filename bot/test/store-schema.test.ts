// The live store's schema version (#98). Each schema version code has shipped is kept in
// `bot/test/fixtures/store-schemas/<version>.sql`. The bot opens a store left at each one, and the store it leaves has
// a new store's tables, columns, indexes and keys, as SQLite reports them. A store newer than the code is refused, as
// settled on #98, and one with tables but no recorded version is the baseline, version 1. These tests read the store
// file itself, since the store's shape is what #98 is about.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startWorld } from './harness/world.ts';

const FIXTURES = new URL('./fixtures/store-schemas/', import.meta.url);
const STORE = 'assistant.sqlite';
const NOW = '2026-10-12T07:30:00Z'; // 00:30 PDT, before the Miner's start

/** A folder for the bot's live store that outlives the bot, as `/var/lib/assistant` does on the VM. */
function dataDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'assistant-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const fixture = (version: number) => readFileSync(new URL(`${version}.sql`, FIXTURES), 'utf8');

/** Leaves a store in `dir` as code at a schema version would: its tables, and `version` recorded, or none for 0. */
function placeStore(dir: string, sql: string, version: number): void {
  const db = new DatabaseSync(join(dir, STORE));
  db.exec(sql);
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
}

/** Starts the bot on the store in `dir`, or on a new one there, with the store's own migrations or `migrations`, and stops it. */
async function startOn(dir: string, migrations?: { name: string; sql: string }[]): Promise<void> {
  const world = await startWorld({ now: NOW, dataDir: dir, migrations });
  await world.stop();
}

const byJson = (a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b));

/**
 * The store's schema version, and its tables, columns, indexes and keys as `sqlite_master` and SQLite's pragmas report
 * them. Columns and keys are compared by what they are, not their place, which `ALTER TABLE … ADD COLUMN` puts last:
 * the bot names every column it writes.
 */
function shapeOf(dir: string) {
  const db = new DatabaseSync(join(dir, STORE), { readOnly: true });
  try {
    const all = (sql: string) => db.prepare(sql).all().map((row) => ({ ...row }));
    const tables = all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((row) => String(row.name));
    return {
      version: Number(db.prepare('PRAGMA user_version').get()!.user_version),
      objects: all("SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"),
      tables: Object.fromEntries(
        tables.map((table) => [
          table,
          {
            columns: all(`PRAGMA table_info(${table})`)
              .map(({ cid: _, ...column }) => column)
              .sort(byJson),
            indexes: all(`PRAGMA index_list(${table})`)
              .map(({ seq: _, ...index }) => ({ ...index, columns: all(`PRAGMA index_xinfo(${index.name})`) }))
              .sort(byJson),
            keys: all(`PRAGMA foreign_key_list(${table})`)
              .map(({ id: _, ...key }) => key)
              .sort(byJson),
          },
        ]),
      ),
    };
  } finally {
    db.close();
  }
}

/** The shape of the store the bot makes when it starts with none. */
async function newStore(t: TestContext) {
  const dir = dataDir(t);
  await startOn(dir);
  return shapeOf(dir);
}

const columnsOf = (dir: string, table: string) => shapeOf(dir).tables[table]?.columns.map((column) => column.name);

test('a store left at each released schema opens with the tables, columns, indexes and keys of a new store', async (t) => {
  const latest = await newStore(t);
  const versions = readdirSync(FIXTURES)
    .map((file) => Number(file.replace(/\.sql$/, '')))
    .sort((a, b) => a - b);
  assert.deepEqual(
    versions,
    Array.from({ length: latest.version }, (_, i) => i + 1),
    `a fixture for each schema version up to the code's, ${latest.version}`,
  );
  for (const version of versions) {
    const dir = dataDir(t);
    placeStore(dir, fixture(version), version);
    await startOn(dir);
    assert.deepEqual(shapeOf(dir), latest, `the store left at schema version ${version}`);
  }
});

test('a store newer than the code is refused, and left as it was', async (t) => {
  const { version: latest } = await newStore(t);
  const dir = dataDir(t);
  placeStore(dir, fixture(latest), latest + 1);
  const before = readFileSync(join(dir, STORE));

  await assert.rejects(startOn(dir), (error: Error) => {
    assert.match(error.message, new RegExp(`is at schema version ${latest + 1}, newer than this code, which knows up to version ${latest}\\.`));
    assert.match(error.message, new RegExp(`Upgrade to code that knows version ${latest + 1} again, or restore the store from a backup`));
    return true;
  });
  assert.deepEqual(readFileSync(join(dir, STORE)), before, 'not a byte of the store written');
});

// The tests below give the bot migrations of their own, after the baseline, to show how it runs them.
const NOTES = { name: 'add the notes table', sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY)' };
const NOTE_TEXT = { name: 'give each note its text', sql: 'ALTER TABLE notes ADD COLUMN text TEXT' };

test('a store with tables and no recorded version is the baseline, version 1, and runs the migrations after it', async (t) => {
  const dir = dataDir(t);
  placeStore(dir, fixture(1), 0);

  await startOn(dir, [NOTES]);
  assert.equal(shapeOf(dir).version, 2);
  assert.deepEqual(columnsOf(dir, 'notes'), ['id'], 'not taken for a new store, which gets SCHEMA whole');
});

test('an older store runs each migration after its version, in order', async (t) => {
  // Run the other way round, or the first one again, these fail: the second needs the table the first adds.
  const baseline = dataDir(t);
  placeStore(baseline, fixture(1), 1);
  await startOn(baseline, [NOTES, NOTE_TEXT]);
  assert.equal(shapeOf(baseline).version, 3);
  assert.deepEqual(columnsOf(baseline, 'notes'), ['id', 'text']);

  const atNotes = dataDir(t);
  placeStore(atNotes, `${fixture(1)}\n${NOTES.sql};`, 2);
  await startOn(atNotes, [NOTES, NOTE_TEXT]);
  assert.equal(shapeOf(atNotes).version, 3);
  assert.deepEqual(columnsOf(atNotes, 'notes'), ['id', 'text']);
});

test('a migration that fails leaves the store at its previous version and the bot not started, naming the migration', async (t) => {
  const dir = dataDir(t);
  placeStore(dir, fixture(1), 1);
  const tags = { name: 'add the tags table', sql: 'CREATE TABLE tags (id INTEGER PRIMARY KEY); INSERT INTO missing VALUES (1);' };

  await assert.rejects(startOn(dir, [NOTES, tags, NOTE_TEXT]), (error: Error) => {
    assert.match(error.message, /^The migration to schema version 3 \(add the tags table\) failed, so the live store .* stays at version 2: no such table: missing$/);
    return true;
  });
  assert.equal(shapeOf(dir).version, 2);
  assert.deepEqual(columnsOf(dir, 'notes'), ['id'], 'the migration before it kept, and none after it run');
  assert.equal(columnsOf(dir, 'tags'), undefined, 'none of it kept');
});

test('a migration may rebuild a table that keys point at, and fails if it leaves a key pointing at no row', async (t) => {
  const rows = "INSERT INTO miner_dates VALUES ('2026-10-12', 1, '2026-10-12T08:00:00Z'); INSERT INTO launches VALUES ('1', '2026-10-12', 1, '{}');";
  const columns = 'date TEXT PRIMARY KEY, featured_count INTEGER NOT NULL, fetched_at TEXT NOT NULL';
  // As https://www.sqlite.org/lang_altertable.html#otheralter rebuilds a table.
  const rebuild = {
    name: 'note each Miner date',
    sql: `CREATE TABLE miner_dates_new (${columns}, note TEXT);
      INSERT INTO miner_dates_new (date, featured_count, fetched_at) SELECT date, featured_count, fetched_at FROM miner_dates;
      DROP TABLE miner_dates;
      ALTER TABLE miner_dates_new RENAME TO miner_dates;`,
  };
  const rebuilt = dataDir(t);
  placeStore(rebuilt, `${fixture(1)}\n${rows}`, 1);
  await startOn(rebuilt, [rebuild]);
  assert.equal(shapeOf(rebuilt).version, 2);
  assert.deepEqual(columnsOf(rebuilt, 'miner_dates'), ['date', 'featured_count', 'fetched_at', 'note']);

  const emptied = { name: 'empty the Miner dates', sql: `DROP TABLE miner_dates; CREATE TABLE miner_dates (${columns});` };
  const dangling = dataDir(t);
  placeStore(dangling, `${fixture(1)}\n${rows}`, 1);
  await assert.rejects(startOn(dangling, [emptied]), (error: Error) => {
    assert.match(error.message, /^The migration to schema version 2 \(empty the Miner dates\) failed, so the live store .* stays at version 1: it leaves a key of launches pointing at no row of miner_dates$/);
    return true;
  });
  assert.equal(shapeOf(dangling).version, 1);
});
