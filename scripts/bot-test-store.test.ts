// "What a test asserts on" (CODING_STANDARDS.md), checked where it is mechanical (#92). A test of the bot that opens
// the live store's SQLite file can inspect internal tables, so this reads each TypeScript file under bot/test as text,
// the harness's own files too, and fails on one that names node:sqlite, Node's own way to open that file. Two tests
// may: store-schema.test.ts reads the store's tables because #98 asks it to, and health-ping.test.ts holds the
// store's write lock to show a store that can't take a write. What text can't show stays with review, such as a test
// that runs the sqlite3 command. A comment that names node:sqlite counts as well: that fails loudly, and none is there
// today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BOT_TEST = join(import.meta.dirname, '..', 'bot', 'test');
const MAY_OPEN_THE_STORE = ['store-schema.test.ts', 'health-ping.test.ts'];

/** Each line of `source`, the text of `file` under bot/test, that names node:sqlite. */
function storeOpeners(file: string, source: string): string[] {
  if (MAY_OPEN_THE_STORE.includes(file)) return [];
  return source.split('\n').flatMap((line, i) => (line.includes('node:sqlite') ? [`bot/test/${file}:${i + 1} names node:sqlite`] : []));
}

test('only the two tests named here open the live store', () => {
  const files = readdirSync(BOT_TEST, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.ts'));
  assert.ok(files.some((file) => file.endsWith('.test.ts')), `no tests under ${BOT_TEST}`);
  const openers = files.flatMap((file) => storeOpeners(file, readFileSync(join(BOT_TEST, file), 'utf8')));
  assert.deepEqual(openers, [], `a test asserts on what is outside the bot (CODING_STANDARDS.md), but ${openers.join(', ')}`);
});

test('the check refuses a test that imports node:sqlite', () => {
  const source = ["import { test } from 'node:test';", "import { DatabaseSync } from 'node:sqlite';"].join('\n');
  assert.deepEqual(storeOpeners('miner-day.test.ts', source), ['bot/test/miner-day.test.ts:2 names node:sqlite']);
});

test('the check refuses a harness file that loads node:sqlite', () => {
  const source = "const { DatabaseSync } = process.getBuiltinModule('node:sqlite');";
  assert.deepEqual(storeOpeners('harness/world.ts', source), ['bot/test/harness/world.ts:1 names node:sqlite']);
});

test('the check lets the two named tests through', () => {
  const source = "import { DatabaseSync } from 'node:sqlite';";
  assert.deepEqual(storeOpeners('store-schema.test.ts', source), []);
  assert.deepEqual(storeOpeners('health-ping.test.ts', source), []);
});
