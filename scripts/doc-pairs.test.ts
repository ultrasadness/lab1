// The doc-pair check (#82): each paired doc's English and Chinese sides stay in step through the pair's record,
// and mirror each other's headings, code blocks, list items, inline code and language links. A Chinese side links
// to other pairs' Chinese sides and to headings that exist, and keeps each paragraph's Chinese text on one line.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDocs } from './doc-pairs.ts';

const EN = `# Guide

English | [中文](guide.zh.md)

What the guide is for.

## Run

Start it like this.

\`\`\`sh
npm start
\`\`\`
`;

const ZH = `# 指南

[English](guide.md) | 中文

这份指南的用途。

## 运行

这样启动。

\`\`\`sh
npm start
\`\`\`
`;

/** A throwaway repo root holding `files`, removed when the test ends. */
function repo(t: TestContext, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'doc-pairs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) write(root, path, text);
  return root;
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

/** The check, with `args`, on a repo whose one pair is guide.md. */
function run(root: string, ...args: string[]): ReturnType<typeof checkDocs> {
  return checkDocs(args, root, ['guide.md']);
}

/** A repo whose one pair, guide.md, was recorded at `en` and `zh`. */
function recorded(t: TestContext, en = EN, zh = ZH): string {
  const root = repo(t, { 'guide.md': en, 'guide.zh.md': zh });
  assert.equal(run(root, '--write', 'guide.md').ok, true);
  return root;
}

test('a pair recorded with --write is in step, with one record entry per section keyed by its heading path', (t) => {
  const root = repo(t, { 'guide.md': EN, 'guide.zh.md': ZH });
  assert.equal(run(root).ok, false, 'not yet recorded');

  const recording = run(root, '--write', 'guide.md');
  assert.equal(recording.ok, true, recording.output);
  assert.match(read(root, 'guide.i18n.yaml'), /^\/guide:\n {2}en: [0-9a-f]{16}\n {2}zh: [0-9a-f]{16}\n\/guide\/run:\n {2}en: [0-9a-f]{16}\n {2}zh: [0-9a-f]{16}\n$/);

  const check = run(root);
  assert.equal(check.ok, true, check.output);
});

test('a word changed on one side fails the check, naming the pair, the section, the side and how to re-record', (t) => {
  const root = recorded(t);
  write(root, 'guide.md', EN.replace('Start it like this.', 'Start it like that.'));

  const check = run(root);
  assert.equal(check.ok, false);
  assert.match(check.output, /guide\.md.*\n.*\/guide\/run: changed in guide\.md since the pair was recorded/);
  assert.doesNotMatch(check.output, /\/guide:/, 'the other section is still in step');
  assert.match(check.output, /npm run check:docs -- --write guide\.md/);

  write(root, 'guide.md', EN);
  write(root, 'guide.zh.md', ZH.replace('这份指南的用途。', '这份指南用来做什么。'));
  assert.match(run(root).output, /\/guide: changed in guide\.zh\.md since the pair was recorded/);

  write(root, 'guide.md', EN.replace('What the guide is for.', 'What the guide does.'));
  assert.match(run(root).output, /\/guide: changed in guide\.md and guide\.zh\.md since the pair was recorded/);

  assert.equal(run(root, '--write', 'guide.md').ok, true);
  assert.equal(run(root).ok, true, 're-recorded');
});

test('whitespace and line wrapping inside a block leave the pair in step', (t) => {
  const root = recorded(t);
  write(root, 'guide.md', EN.replace('What the guide is for.', 'What the guide\nis   for.\n\n'));
  const check = run(root);
  assert.equal(check.ok, true, check.output);
});

test('code blocks are left out of the hash, and must match one to one', (t) => {
  const root = recorded(t);
  const record = read(root, 'guide.i18n.yaml');

  write(root, 'guide.md', EN.replace('npm start', 'npm run start'));
  const check = run(root);
  assert.equal(check.ok, false);
  assert.match(check.output, /\/guide\/run: code block 1 differs between the two sides/);
  assert.doesNotMatch(check.output, /changed in/, 'the record still matches');

  write(root, 'guide.zh.md', ZH.replace('npm start', 'npm run start'));
  const both = run(root);
  assert.equal(both.ok, true, both.output);
  run(root, '--write', 'guide.md');
  assert.equal(read(root, 'guide.i18n.yaml'), record, 'the same record');

  write(root, 'guide.zh.md', ZH.replace('```sh\nnpm start\n```\n', ''));
  assert.match(run(root).output, /\/guide\/run: code block 1 differs between the two sides/);
});

test('text before the first heading is keyed /, a heading by its GitHub anchors, and a repeated path gets ~2', (t) => {
  const en = `Before.\n\n# Guide\n\nEnglish | [中文](guide.zh.md)\n\n## Day's line, \`Fit\`\n\nA.\n\n### Notes\n\nB.\n\n## Day's line, \`Fit\`\n\nC.\n\n### Notes\n\nD.\n`;
  const zh = `之前。\n\n# 指南\n\n[English](guide.md) | 中文\n\n## Day's line、\`Fit\`\n\n甲。\n\n### 备注\n\n乙。\n\n## Day's line、\`Fit\`\n\n丙。\n\n### 备注\n\n丁。\n`;
  const root = recorded(t, en, zh);
  const keys = [...read(root, 'guide.i18n.yaml').matchAll(/^(\S.*):$/gm)].map((m) => m[1]);
  assert.deepEqual(keys, ['/', '/guide', '/guide/days-line-fit', '/guide/days-line-fit/notes', '/guide/days-line-fit~2', '/guide/days-line-fit/notes~2']);

  write(root, 'guide.zh.md', zh.replace('丁', '戊'));
  assert.match(run(root).output, /\/guide\/days-line-fit\/notes~2: changed in guide\.zh\.md/);
});

test('headings must match in depth and order, and until they do nothing else is compared or recorded', (t) => {
  const root = recorded(t);
  const record = read(root, 'guide.i18n.yaml');

  write(root, 'guide.zh.md', ZH.replace('## 运行', '### 运行'));
  assert.match(run(root).output, /\/guide\/run: a level 2 heading in guide\.md, but level 3 in guide\.zh\.md \("### 运行"\)/);
  assert.doesNotMatch(run(root).output, /changed in/);

  write(root, 'guide.zh.md', ZH.replace('## 运行', '运行'));
  assert.match(run(root).output, /\/guide\/run: guide\.zh\.md has no heading to match it/);

  write(root, 'guide.zh.md', `${ZH}\n## 附录\n\n更多。\n`);
  assert.match(run(root).output, /guide\.zh\.md has a heading guide\.md doesn't, after \/guide\/run: "## 附录"/);

  const refused = run(root, '--write', 'guide.md');
  assert.equal(refused.ok, false);
  assert.match(refused.output, /"## 附录"/);
  assert.equal(read(root, 'guide.i18n.yaml'), record, 'not re-recorded');
});

test('each side links to the other right after its H1, by the file name alone', (t) => {
  const root = recorded(t);

  write(root, 'guide.md', EN.replace('English | [中文](guide.zh.md)\n\n', ''));
  assert.match(run(root).output, /guide\.md: the line after its H1 must be "English \| \[中文\]\(guide\.zh\.md\)"/);

  write(root, 'guide.md', EN.replace('English | [中文](guide.zh.md)\n\n', 'English | [中文](guide.zh.md)\n'));
  assert.match(run(root).output, /guide\.md: the line after its H1 must be "English \| \[中文\]\(guide\.zh\.md\)", with a blank line after it/);

  write(root, 'guide.md', EN);
  write(root, 'guide.zh.md', ZH.replace('[English](guide.md) | 中文', '[English](guide.md)'));
  assert.match(run(root).output, /guide\.zh\.md: the line after its H1 must be "\[English\]\(guide\.md\) \| 中文"/);

  const nested = repo(t, { 'docs/guide.md': EN, 'docs/guide.zh.md': ZH });
  const recording = checkDocs(['--write', 'docs/guide.md'], nested, ['docs/guide.md']);
  assert.equal(recording.ok, true, recording.output);
  assert.equal(checkDocs([], nested, ['docs/guide.md']).ok, true);
});

test('a pair missing any of its three files fails the check, naming each one, and is not recorded', (t) => {
  const root = repo(t, { 'guide.md': EN });
  const check = run(root);
  assert.equal(check.ok, false);
  assert.match(check.output, /^guide\.md is out of step with guide\.zh\.md:\n {2}guide\.zh\.md and guide\.i18n\.yaml are missing\n/);
  assert.match(check.output, /npm run check:docs -- --write guide\.md/);

  const refused = run(root, '--write', 'guide.md');
  assert.equal(refused.ok, false);
  assert.match(refused.output, /guide\.zh\.md is missing/);

  write(root, 'guide.zh.md', ZH);
  assert.match(run(root).output, /\n {2}guide\.i18n\.yaml is missing\n/);

  const empty = repo(t, {});
  assert.match(checkDocs([], empty, ['guide.md']).output, /\n {2}guide\.md, guide\.zh\.md and guide\.i18n\.yaml are missing\n/);
});

test('a section added, renamed or removed since the pair was recorded is named, and so is a record that cannot be read', (t) => {
  const root = recorded(t);

  write(root, 'guide.md', `${EN}\n## Stop\n\nStop it.\n`);
  write(root, 'guide.zh.md', `${ZH}\n## 停止\n\n停下。\n`);
  assert.match(run(root).output, /\n {2}\/guide\/stop: new since the pair was recorded\n/);
  assert.doesNotMatch(run(root).output, /\/guide\/run/);

  write(root, 'guide.md', EN.replace('## Run', '## Start'));
  write(root, 'guide.zh.md', ZH.replace('## 运行', '## 启动'));
  assert.match(run(root).output, /\n {2}\/guide\/start: new since the pair was recorded\n/);
  assert.match(run(root).output, /\n {2}\/guide\/run: in guide\.i18n\.yaml, but no longer a section of guide\.md\n/);

  write(root, 'guide.md', EN);
  write(root, 'guide.zh.md', ZH);
  write(root, 'guide.i18n.yaml', read(root, 'guide.i18n.yaml').replace(/zh: \w+\n$/, 'zh: <<<<<<< HEAD\n'));
  assert.match(run(root).output, /\n {2}guide\.i18n\.yaml can't be read at line 6: "  zh: <<<<<<< HEAD"\n/);
});

test('a directory in scope pairs each English doc in it, so a new doc there fails the check until it is paired', (t) => {
  const root = repo(t, {
    'docs/adr/0001-guide.md': EN.replaceAll('guide', '0001-guide'),
    'docs/adr/0001-guide.zh.md': ZH.replaceAll('guide', '0001-guide'),
    'docs/adr/notes/0002-nested.md': '# Nested\n',
    'docs/adr/diagram.svg': '<svg/>',
  });
  const pairs = ['docs/adr/'];
  const recording = checkDocs(['--write', 'docs/adr/0001-guide.md'], root, pairs);
  assert.equal(recording.ok, true, recording.output);
  assert.equal(checkDocs([], root, pairs).output, '1 doc pair in step.\n', 'only the docs right in the directory');

  write(root, 'docs/adr/0002-next.md', '# Next\n');
  const check = checkDocs([], root, pairs);
  assert.equal(check.ok, false);
  assert.match(check.output, /^docs\/adr\/0002-next\.md is out of step with docs\/adr\/0002-next\.zh\.md:\n {2}docs\/adr\/0002-next\.zh\.md and docs\/adr\/0002-next\.i18n\.yaml are missing\n/);
  assert.equal(checkDocs(['--list'], root, pairs).output, 'docs/adr/0001-guide.md  in step\ndocs/adr/0002-next.md   missing docs/adr/0002-next.zh.md and docs/adr/0002-next.i18n.yaml\n');
});

test('a link on a Chinese side to the English side of a pair fails the check, naming the Chinese side to link instead', (t) => {
  const code = '\n```md\n[code](notes/other.md)\n```\n';
  const en = `${EN}\nSee the other guide, [a site](https://example.com/notes/other.md) and \`[code](notes/other.md)\`.\n${code}`;
  const zh = (target: string) => `${ZH}\n见[另一份](${target})、[说明](agents.md)、[外链](https://example.com/notes/other.md)和 \`[code](notes/other.md)\`。\n${code}`;
  const other = (target: string) => `${ZH.replaceAll('guide', 'other')}\n见[指南](${target})。\n`;
  const root = repo(t, {
    'guide.md': en,
    'guide.zh.md': zh('notes/other.zh.md#运行'),
    'notes/other.md': EN.replaceAll('guide', 'other'),
    'notes/other.zh.md': other('../guide.zh.md'),
    'agents.md': '# Agents\n',
  });
  const pairs = ['guide.md', 'notes/other.md'];
  assert.equal(checkDocs(['--write', 'guide.md', 'notes/other.md'], root, pairs).ok, true);
  const check = checkDocs([], root, pairs);
  assert.equal(check.ok, true, check.output);

  write(root, 'guide.zh.md', zh('notes/other.md#run'));
  write(root, 'notes/other.zh.md', other('../guide.md'));
  const linked = checkDocs([], root, pairs);
  assert.equal(linked.ok, false);
  assert.match(linked.output, /\n {2}guide\.zh\.md: the link to notes\/other\.md#run must point at its Chinese side, notes\/other\.zh\.md#run\n/);
  assert.match(linked.output, /\n {2}notes\/other\.zh\.md: the link to \.\.\/guide\.md must point at its Chinese side, \.\.\/guide\.zh\.md\n/);
  assert.equal(checkDocs(['--list'], root, pairs).output, 'guide.md        out of step\nnotes/other.md  out of step\n');

  write(root, 'notes/other.zh.md', `${ZH.replaceAll('guide', 'other')}\n见[指南][g]和[根](/guide.md)。\n\n[g]: ../guide.md\n`);
  const output = checkDocs([], root, pairs).output;
  assert.match(output, /notes\/other\.zh\.md: the link to \/guide\.md must point at its Chinese side, \/guide\.zh\.md\n/);
  assert.match(output, /notes\/other\.zh\.md: the link to \.\.\/guide\.md must point at its Chinese side, \.\.\/guide\.zh\.md\n/);
});

test('a line break inside a Chinese paragraph between two Chinese characters fails the check, naming its line', (t) => {
  const root = recorded(t, EN, ZH.replace('这份指南的用途。', '**Guide**：\n这份指南讲 Pi\n怎么用。硬换行  \n照常\\\n可以。\n_避免使用_：Manual'));
  const check = run(root);
  assert.equal(check.ok, true, check.output);

  write(root, 'guide.zh.md', ZH.replace('这份指南的用途。', '这份指南的\n用途。还有\n“更多”。'));
  const broken = run(root);
  assert.equal(broken.ok, false);
  assert.match(broken.output, /\n {2}guide\.zh\.md:5: a line break between "的" and "用" renders as a space inside Chinese text; join the two lines\n/);
  assert.match(broken.output, /\n {2}guide\.zh\.md:6: a line break between "有" and "“" renders as a space inside Chinese text; join the two lines\n/);
});

test('a link on a Chinese side to an anchor that names no heading in its doc fails the check', (t) => {
  const en = `${EN}\nSee [Run](#run), [the other](notes/other.md#run-1), [agents](agents.md#agents) and [a site](https://example.com/#top).\n`;
  const zh = (links: string) => `${ZH}\n见${links}和[网站](https://example.com/#top)。\n`;
  const root = repo(t, {
    'guide.md': en,
    'guide.zh.md': zh('[运行](#运行)、[编码的](#%E8%BF%90%E8%A1%8C)、[另一份](notes/other.zh.md#运行-1)、[说明](agents.md#agents)'),
    'notes/other.md': `${EN.replaceAll('guide', 'other')}\n## Run\n\nAgain.\n`,
    'notes/other.zh.md': `${ZH.replaceAll('guide', 'other')}\n## 运行\n\n再来。\n`,
    'agents.md': '# Agents\n',
  });
  const pairs = ['guide.md', 'notes/other.md'];
  assert.equal(checkDocs(['--write', 'guide.md', 'notes/other.md'], root, pairs).ok, true);
  const check = checkDocs([], root, pairs);
  assert.equal(check.ok, true, check.output);

  write(root, 'guide.zh.md', zh('[运行](#run)、[另一份](notes/other.zh.md#运行-2)、[说明](agents.md#nope)'));
  const output = checkDocs([], root, pairs).output;
  assert.match(output, /\n {2}guide\.zh\.md: the link to #run names no heading in guide\.zh\.md\n/);
  assert.match(output, /\n {2}guide\.zh\.md: the link to notes\/other\.zh\.md#运行-2 names no heading in notes\/other\.zh\.md\n/);
  assert.match(output, /\n {2}guide\.zh\.md: the link to agents\.md#nope names no heading in agents\.md\n/);
});

test('a section has as many list items on both sides, and the same inline code and URLs its links point at', (t) => {
  const en = EN.replace('Start it like this.', 'Start it like this:\n\n- run `npm start`;\n- read [the docs](https://example.com/docs).');
  const zh = ZH.replace('这样启动。', '这样启动：\n\n- 运行 `npm start`；\n- 读[文档](https://example.com/docs)。');
  const root = recorded(t, en, zh);
  const record = read(root, 'guide.i18n.yaml');
  const check = run(root);
  assert.equal(check.ok, true, check.output);

  write(root, 'guide.zh.md', zh.replace('\n- 读', ' 读'));
  assert.match(run(root).output, /\n {2}\/guide\/run: 2 list items in guide\.md, but 1 in guide\.zh\.md\n/);

  write(root, 'guide.zh.md', zh.replace('`npm start`', '`npm run start`'));
  const code = run(root).output;
  assert.match(code, /\n {2}\/guide\/run: inline code `npm start` appears 1 time in guide\.md, but 0 times in guide\.zh\.md\n/);
  assert.match(code, /\n {2}\/guide\/run: inline code `npm run start` appears 0 times in guide\.md, but 1 time in guide\.zh\.md\n/);

  write(root, 'guide.zh.md', zh.replace('https://example.com/docs', 'https://example.com/zh/docs'));
  assert.match(run(root).output, /\n {2}\/guide\/run: a link to https:\/\/example\.com\/docs appears 1 time in guide\.md, but 0 times in guide\.zh\.md\n/);

  const refused = run(root, '--write', 'guide.md');
  assert.equal(refused.ok, false);
  assert.equal(read(root, 'guide.i18n.yaml'), record, 'not re-recorded');
});

test('--list prints each pair state and never fails, and a check that passes says how many pairs are in step', (t) => {
  const root = recorded(t);
  write(root, 'other.md', '# Other\n');
  write(root, 'third.md', EN.replaceAll('guide', 'third'));
  write(root, 'third.zh.md', ZH.replaceAll('guide', 'third'));
  assert.equal(checkDocs(['--write', 'third.md'], root, ['third.md']).ok, true);
  assert.equal(checkDocs([], root, ['guide.md', 'third.md']).output, '2 doc pairs in step.\n');

  write(root, 'third.zh.md', ZH.replaceAll('guide', 'third').replace('这样启动。', '这样开始。'));
  const list = checkDocs(['--list'], root, ['guide.md', 'other.md', 'third.md']);
  assert.equal(list.ok, true);
  assert.equal(list.output, 'guide.md  in step\nother.md  missing other.zh.md and other.i18n.yaml\nthird.md  out of step\n');
});

test('--write takes any of a pair\'s files or its stem, and refuses a doc that is not a pair', (t) => {
  const root = repo(t, { 'guide.md': EN, 'guide.zh.md': ZH });
  for (const name of ['guide.zh.md', 'guide.i18n.yaml', 'guide', './guide.md']) {
    rmSync(join(root, 'guide.i18n.yaml'), { force: true });
    const recording = run(root, '--write', name);
    assert.equal(recording.output, 'Recorded guide.md and guide.zh.md in guide.i18n.yaml.\n', name);
    assert.equal(run(root).ok, true, name);
  }

  const refused = run(root, '--write', 'notes.md');
  assert.equal(refused.ok, false);
  assert.match(refused.output, /notes\.md is not one of the doc pairs \(guide\.md\)/);
  assert.match(run(root, '--write').output, /^Usage: /);
  assert.match(run(root, '--lsit').output, /^Usage: /);
});
