// The bot has no npm dependencies of its own (bot/README.md), checked here since #78 brought in graphql for the tests
// and the schema capture alone. This reads each file under bot/src as text for every module it imports, statically,
// for its side effects or with import(), and fails on one that is neither Node's own (node:) nor a file under
// bot/src. It reads them as text, so a quoted name after "from" in a comment or a string also counts as an import:
// that fails loudly, and none is there today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const BOT_SRC = join(import.meta.dirname, '..', 'bot', 'src');
const IMPORT = /\bfrom\s*['"`]([^'"`]+)['"`]|\bimport\s*\(?\s*['"`]([^'"`]+)['"`]/g;

test("the bot imports only Node's own modules and its own files", () => {
  const files = readdirSync(BOT_SRC, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.ts'));
  assert.ok(files.length > 0, `no TypeScript files under ${BOT_SRC}`);
  const outside: string[] = [];
  for (const file of files) {
    const source = readFileSync(join(BOT_SRC, file), 'utf8');
    for (const match of source.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2]!;
      if (specifier.startsWith('node:')) continue;
      // A path counts only while it stays under bot/src, so ../../node_modules/graphql doesn't.
      if (/^\.\.?\//.test(specifier) && resolve(dirname(join(BOT_SRC, file)), specifier).startsWith(BOT_SRC + sep)) continue;
      outside.push(`bot/src/${file}:${source.slice(0, match.index).split('\n').length} imports ${specifier}`);
    }
  }
  assert.deepEqual(outside, [], `the bot runs with no npm packages, but ${outside.join(', ')}`);
});
