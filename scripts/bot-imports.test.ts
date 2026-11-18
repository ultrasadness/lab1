// The bot has no npm dependencies of its own (bot/README.md), checked here since #78 brought in graphql for the tests
// and the schema capture alone. This reads each file under bot/src as text for every module it imports, statically,
// for its side effects or with import(), and fails on one that is neither Node's own (node:) nor a file under
// bot/src. It reads them as text, with scripts/imports.ts, which takes a `from` only in an import or export statement.
// It also fails on node:worker_threads: Node 24 can crash once two threads
// run Wasm, which is why bot/test/harness/bot-thread.ts turns off V8's Wasm code GC for the tests, and nothing does for
// the bot on the VM (#105).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { importsIn } from './imports.ts';

const BOT_SRC = join(import.meta.dirname, '..', 'bot', 'src');

/** Each import in the files under bot/src: the file that has it, where, and the module it names. */
function importsOfTheBot(): { file: string; at: string; specifier: string }[] {
  const files = readdirSync(BOT_SRC, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.ts'));
  assert.ok(files.length > 0, `no TypeScript files under ${BOT_SRC}`);
  return files.flatMap((file) => {
    const source = readFileSync(join(BOT_SRC, file), 'utf8');
    return importsIn(source).map(({ specifier, line }) => ({ file, at: `bot/src/${file}:${line}`, specifier }));
  });
}

test("the bot imports only Node's own modules and its own files", () => {
  const outside = importsOfTheBot()
    .filter(({ specifier }) => !specifier.startsWith('node:'))
    // A path counts only while it stays under bot/src, so ../../node_modules/graphql doesn't.
    .filter(({ file, specifier }) => !(/^\.\.?\//.test(specifier) && resolve(dirname(join(BOT_SRC, file)), specifier).startsWith(BOT_SRC + sep)))
    .map(({ at, specifier }) => `${at} imports ${specifier}`);
  assert.deepEqual(outside, [], `the bot runs with no npm packages, but ${outside.join(', ')}`);
});

test('the bot starts no worker thread', () => {
  const threads = importsOfTheBot()
    .filter(({ specifier }) => specifier === 'node:worker_threads')
    .map(({ at }) => at);
  assert.deepEqual(threads, [], `a second thread running Wasm can crash Node 24 (#105), but ${threads.join(', ')} imports node:worker_threads`);
});

test("a quoted 'from', as an export's type may name the field, is no import, and a real one beside it still is", () => {
  // #61's kept-mail.ts read as an import of everything from `'from'>` to the next quote, two lines on.
  const source = [
    "export const replyAddress = (mail: Pick<KeptMail, 'replyTo' | 'from'>) => mail.replyTo ?? mail.from;",
    "export const at = (address: string) => address.lastIndexOf('@');",
    "export { keptCopy } from './kept-mail.ts';",
  ].join('\n');
  assert.deepEqual(importsIn(source), [{ specifier: './kept-mail.ts', line: 3 }]);
});
