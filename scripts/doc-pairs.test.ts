// The doc-pair check (#82): each paired doc's English and Chinese sides stay in step through the pair's record,
// and mirror each other's headings, code blocks and language links.
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
