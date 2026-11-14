// A test reaches the bot only through the harness in bot/test/harness/ (bot/README.md), checked here where it is
// mechanical (#93). A test that imports from bot/src, such as judgingPrompt
// from bot/src/miner/judging.ts, asserts on how the bot builds something. This reads each TypeScript file under
// bot/test as text, a helper beside the tests as well as a test, and fails on an import, static, for its side effects
// or with import(), whose quoted path or file: URL resolves to a file under bot/src. The harness's own files may import
// bot/src, as world.ts imports startAssistant. What a test asserts on stays with review, and so does what text can't
// show: a specifier the test computes, as with new URL() or import.meta.resolve(), and a value the harness re-exports.
// It reads them as text, with scripts/imports.ts as scripts/bot-imports.test.ts does, which takes a `from` only in an
// import or export statement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importsIn } from './imports.ts';

const BOT_TEST = join(import.meta.dirname, '..', 'bot', 'test');
const BOT_SRC = join(import.meta.dirname, '..', 'bot', 'src');
const HARNESS = join(BOT_TEST, 'harness');

/** Each import in `source`, the text of `file` under bot/test, that resolves to a file under bot/src. */
function importsPastHarness(file: string, source: string): string[] {
  if (join(BOT_TEST, file).startsWith(HARNESS + sep)) return [];
  const pastHarness: string[] = [];
  for (const { specifier, line } of importsIn(source)) {
    const path = specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier;
    if (!resolve(dirname(join(BOT_TEST, file)), path).startsWith(BOT_SRC + sep)) continue;
    pastHarness.push(`bot/test/${file}:${line} imports ${specifier}`);
  }
  return pastHarness;
}

test('a bot test reaches bot/src only through the harness', () => {
  const files = readdirSync(BOT_TEST, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.ts'));
  assert.ok(files.some((file) => file.endsWith('.test.ts')), `no tests under ${BOT_TEST}`);
  const pastHarness = files.flatMap((file) => importsPastHarness(file, readFileSync(join(BOT_TEST, file), 'utf8')));
  assert.deepEqual(pastHarness, [], `a test reaches the bot only through bot/test/harness/, but ${pastHarness.join(', ')}`);
});

test('the check refuses a test that imports judgingPrompt from bot/src', () => {
  const source = [
    "import { test } from 'node:test';",
    "import { startWorld } from './harness/world.ts';",
    "import { judgingPrompt } from '../src/miner/judging.ts';",
  ].join('\n');
  assert.deepEqual(importsPastHarness('judging.test.ts', source), [
    'bot/test/judging.test.ts:3 imports ../src/miner/judging.ts',
  ]);
});

test('the check refuses a test that loads bot/src with import()', () => {
  const source = [
    "test('judges', async () => {",
    "  const { judgingPrompt } = await import('../src/miner/judging.ts');",
    '});',
  ].join('\n');
  assert.deepEqual(importsPastHarness('judging.test.ts', source), [
    'bot/test/judging.test.ts:2 imports ../src/miner/judging.ts',
  ]);
});

test('the check lets the harness import bot/src', () => {
  const source = "import { startAssistant, type Assistant } from '../../src/assistant.ts';";
  assert.deepEqual(importsPastHarness('harness/world.ts', source), []);
});

test('the check refuses a test that names bot/src by a file: URL', () => {
  const url = pathToFileURL(join(BOT_SRC, 'miner', 'judging.ts')).href;
  const source = `import { judgingPrompt } from '${url}';`;
  assert.deepEqual(importsPastHarness('judging.test.ts', source), [`bot/test/judging.test.ts:1 imports ${url}`]);
});

test('the check refuses an import of bot/src split over lines, at the line its statement starts on', () => {
  const source = ["import { test } from 'node:test';", 'import {', '  judgingPrompt,', "} from '../src/miner/judging.ts';"].join('\n');
  assert.deepEqual(importsPastHarness('judging.test.ts', source), ['bot/test/judging.test.ts:2 imports ../src/miner/judging.ts']);
});

test('the check reads a `from` outside an import or export statement as no import', () => {
  const source = [
    '/** Mail received from `../src/mail/gmail.ts`, up to `to`. */',
    "const sender = header('from')[0] ?? '../src/store.ts';",
    "const note = `sent from '../src/assistant.ts'`;",
  ].join('\n');
  assert.deepEqual(importsPastHarness('mail.test.ts', source), []);
});
