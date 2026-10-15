// PROTOTYPE, throwaway: three variants of how a Miner day's list of Dossiers and Skips looks on Discord, for lab1 #29.
// A: #a-miner, one silent message per day; every Launch as a line of text, grouped; Correct through two menus.
// B: #needs-you, one card per day that @mentions you; ten lines a page, each with its own Correct button.
// C: #c-days, a forum post per day; every Launch on show, one message per band, each line with its own Correct button.
// The Launches are real (Featured, Oct 11–14, 2026, from the Product Hunt API); the fits are the hand-judged stand-ins
// from the Miner prototype (#9). Corrections are stubbed. All state is in memory. Run: ./run.sh day
import { readFileSync } from 'node:fs';
import { Client, GatewayIntentBits, ChannelType, Events } from 'discord.js';
import { t, sep, box, sec, row, btn, when, Style, Accent, EPHEMERAL, V2, SILENT } from './kit.mjs';

const TOKEN = readFileSync(`${process.env.HOME}/.config/lab1/discord-bot-token`, 'utf8').trim();
const LAUNCHES = JSON.parse(readFileSync(new URL('./days.json', import.meta.url), 'utf8'));
const FLOOR = 7;
const DAYS = { '2026-10-11': 'Sun Oct 11', '2026-10-12': 'Mon Oct 12', '2026-10-13': 'Tue Oct 13', '2026-10-14': 'Wed Oct 14' };
const TAGS = ['Walkthrough', 'Registering', 'Needs you', 'registered', 'waitlisted', 'handed off', 'abandoned'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
if (process.env.SELFTEST) client.rest.on('rateLimited', (r) => console.log('rate limited', r.route, r.timeToReset, 'ms'));

// ---------- In-memory state ----------
const S = { guild: null, person: null, ch: {}, tags: {}, day: '2026-10-14', copies: new Map(), posts: new Map(), log: [] };
let seq = 0;

// ---------- The Miner's day (as decided in #9) ----------
function buildDay(key) {
  const ls = LAUNCHES.filter((l) => l.day === key).map((l) => ({ ...l }));
  const n = ls.length, k = Math.ceil(Math.sqrt(n));
  const fits = ls.filter((l) => l.flag !== 'np').map((l) => l.fit).sort((a, b) => b - a);
  const kth = fits[k - 1], line = Math.max(FLOOR, kth);
  for (const l of ls) {
    l.kind = l.flag === 'np' ? 'np' : l.fit >= line ? 'dossier' : 'skip';
    l.orig = { kind: l.kind, fit: l.fit };
  }
  const order = { dossier: 0, skip: 1, np: 2 };
  ls.sort((a, b) => order[a.kind] - order[b.kind] || b.fit - a.fit || a.rank - b.rank);
  return { key, label: DAYS[key], n, k, kth, line, ls };
}
// Bands use the first judgment, so a corrected line stays where it was.
function band(day, l) {
  const o = l.orig;
  if (o.kind === 'dossier') return 'Dossiers';
  if (o.kind === 'np') return 'Not Products';
  if (o.fit === day.line - 1) return `Near misses · fit ${day.line - 1}`;
  if (o.fit >= 3) return `Further off · fit 3–${day.line - 2}`;
  return 'Far off · fit 0–2';
}
function groups(day) {
  const g = new Map();
  for (const l of day.ls) { const b = band(day, l); if (!g.has(b)) g.set(b, []); g.get(b).push(l); }
  return [...g];
}
const counts = (day) => {
  const d = day.ls.filter((l) => l.kind === 'dossier').length;
  return { d, s: day.n - d, fixed: day.ls.filter((l) => l.corrected).length };
};
const ord = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

// ---------- Text every variant shares ----------
const phPost = (l) => `https://www.producthunt.com/posts/${l.slug}`;
const phDay = (day) => `https://www.producthunt.com/leaderboard/daily/${day.key.replace(/-/g, '/')}`;
const nameOf = (l, linked = true) => (linked ? `**[${l.name}](${phPost(l)})**` : `**${l.name}**`);
function head(day, l) {
  if (l.rejudging) return '✎ re-judging after your Correction…';
  const after = l.corrected ? ' after your Correction' : '';
  if (l.kind === 'dossier') return `Dossier · fit ${l.fit}${after}`;
  if (l.kind === 'np') return 'Skip · not a Product';
  return `Skip · fit ${l.fit}${after}, line ${day.line}${l.corrected && l.orig.kind === 'dossier' ? ' · Dossier withdrawn' : ''}`;
}
const postRef = (l) => (l.kind === 'dossier' && l.post && !l.rejudging ? ` → <#${l.post}>` : '');
const wasNote = (l) => (l.corrected && !l.rejudging ? `\n-# was ${l.corrected.was} · you said “${l.corrected.text}”` : '');
const fullLine = (day, l) => `${nameOf(l)} · ${head(day, l)} · ${l.reason}${postRef(l)}${wasNote(l)}`;

function summary(day) {
  const { d, s, fixed } = counts(day);
  const why = day.kth < FLOOR
    ? `the ${ord(day.k)} best Fit is ${day.kth}, so the floor of ${FLOOR} sets it`
    : `the ${ord(day.k)} best Fit (√${day.n} → ${day.k})`;
  return `**${d} Dossier${d === 1 ? '' : 's'}** · ${s} Skips · ${day.n} Featured Launches · Day's line **${day.line}**\n`
    + `-# Line: ${why}${fixed ? ` · ${fixed} changed by your Correction` : ''}`;
}
const footer = (day, extra = '') => `-# Data sourced from [Product Hunt](${phDay(day)})${extra}`;

function dossierStandIn(day, l) {
  return [
    `## ${l.name} · ${l.tagline}`,
    `**${head(day, l)}** (${day.label}, Day's line ${day.line}) · ${l.reason}`,
    l.offer ? `**Offer:** ${l.offer}` : '**Offer:** none found',
    '-# Stand-in for the Dossier: the real one reads the Product\'s site and cites every claim. Its Walkthrough would follow in #needs-you (#12).',
    `-# [Launch on Product Hunt](${phPost(l)}) · Data sourced from Product Hunt`,
  ].join('\n');
}

// ---------- Counting what Discord limits ----------
function stats(components) {
  let n = 0, chars = 0;
  const walk = (cs) => { for (const c of cs) { n++; if (c.type === 10) chars += c.content.length; if (c.components) walk(c.components); if (c.accessory) walk([c.accessory]); } };
  walk(components);
  return { n, chars };
}
const tooLong = (e) => e?.code === 50035;
function note(line) { S.log.push(`${new Date().toISOString().slice(11, 16)} ${line}`); S.log = S.log.slice(-8); console.log(line); }

// ---------- Discord plumbing ----------
async function editMsg(ref, payload) { const c = await client.channels.fetch(ref.ch); const m = await c.messages.fetch(ref.id); await m.edit(payload); }
async function send(channel, payload) { const m = await channel.send(payload); return { ch: channel.id, id: m.id }; }
const silent = (components) => ({ flags: V2 | SILENT, components, allowedMentions: { parse: [] } });
const quiet = (components) => ({ flags: V2, components, allowedMentions: { parse: [] } });
const selectIn = (custom_id, placeholder, options) => ({ type: 1, components: [{ type: 3, custom_id, placeholder, options }] });

async function ensurePost(day, l) {
  const key = `${day.key}|${l.id}|${l.corrected ? 'c' : ''}`;
  if (!S.posts.has(key)) {
    const th = await S.ch.products.threads.create({
      name: `${l.name} · ${l.tagline}`.slice(0, 100), appliedTags: [S.tags.Walkthrough].filter(Boolean),
      message: silent([box(Accent.progress, t(dossierStandIn(day, l)))]),
    });
    S.posts.set(key, th.id);
  }
  l.post = S.posts.get(key);
}

// ---------- Variant A: one message, lines as text, Correct through menus ----------
const MODES = ['full', 'compact', 'names', 'bare'];
function lineA(day, l, mode) {
  const b = band(day, l), near = b === 'Dossiers' || b.startsWith('Near');
  if (l.rejudging || l.corrected) return fullLine(day, l);
  const nm = nameOf(l, mode === 'full' || near);
  return `${nm} · ${l.kind === 'np' ? '' : `fit ${l.fit} · `}${l.reason}${postRef(l)}`;
}
function renderA(c) {
  const day = c.day, mode = MODES[c.mode];
  const parts = [t(`## Miner · ${day.label}\n${summary(day)}`)];
  for (const [title, ls] of groups(day)) {
    const tight = (mode === 'names' && (title.startsWith('Far') || title === 'Not Products'))
      || (mode === 'bare' && title !== 'Dossiers' && !title.startsWith('Near'));
    const plain = tight ? ls.filter((l) => !l.corrected && !l.rejudging) : [];
    const lines = ls.filter((l) => !plain.includes(l)).map((l) => lineA(day, l, mode));
    if (plain.length) lines.push(plain.map((l) => l.name).join(' · '));
    parts.push(t(`### ${title}${title === 'Dossiers' || title === 'Not Products' ? '' : ` · Skips`}\n${lines.join('\n')}`));
  }
  const cut = { names: ' · far-off Skips by name only, to stay under Discord\'s 4,000 characters', bare: ' · only Dossiers and near misses keep their reason, to stay under Discord\'s 4,000 characters' }[mode] ?? '';
  parts.push(t(footer(day, `${mode === 'full' ? ' · names link to each Launch' : ' · Dossiers and near misses link to their Launch'}${cut}`)));
  const option = (l) => ({
    value: String(l.id),
    label: `${l.name} · ${l.kind === 'np' ? 'not a Product' : `${l.kind === 'dossier' ? 'Dossier' : 'Skip'} · fit ${l.fit}`}${l.corrected ? ' ✎' : ''}`.slice(0, 100),
    description: l.reason.slice(0, 100),
  });
  const opts = day.ls.map(option), first = opts.slice(0, 25), rest = opts.slice(25);
  return [box(Accent.progress, parts,
    selectIn(`d|ca|${c.id}|0`, rest.length ? `Correct one of the first ${first.length}…` : 'Correct a Launch…', first),
    rest.length ? selectIn(`d|ca|${c.id}|1`, `Correct one of the other ${rest.length}…`, rest) : null)];
}
// Post the fullest form Discord accepts; each refusal is logged, since the character limit is what A is testing.
async function writeA(c, first) {
  for (;;) {
    const comps = renderA(c), st = stats(comps);
    try {
      if (first) c.msgs.main = await send(S.ch.a, silent(comps)); else await editMsg(c.msgs.main, quiet(comps));
      c.last = st; return;
    } catch (e) {
      if (!tooLong(e) || c.mode === MODES.length - 1) throw e;
      note(`A · Discord refused the "${MODES[c.mode]}" form: ${st.chars} characters, ${st.n} components (${e.message.split('\n').slice(1).join(' ').trim()})`);
      c.mode += 1;
    }
  }
}

// ---------- Variant B: a card in #needs-you, ten lines a page ----------
const PAGE = 10;
function pagesB(day) {
  const top = day.ls.filter((l) => ['Dossiers'].includes(band(day, l)) || band(day, l).startsWith('Near'));
  const rest = day.ls.filter((l) => !top.includes(l));
  const chunks = [];
  for (let i = 0; i < top.length; i += PAGE) chunks.push(top.slice(i, i + PAGE));
  for (let i = 0; i < rest.length; i += PAGE) chunks.push(rest.slice(i, i + PAGE));
  return chunks.map((ls) => ({ ls, title: [...new Set(ls.map((l) => band(day, l)))].join(' · ') }));
}
function renderB(c) {
  const day = c.day, { d, s } = counts(day);
  const mention = t(`<@${S.person}>`);
  if (c.done) {
    return [mention, box(Accent.done, t(`-# ✓ Miner · ${day.label} · ${d} Dossiers · ${s} Skips · line ${day.line} · seen ${when(c.done)}`)),
      row(btn(`d|bo|${c.id}`, 'Open again'))];
  }
  const pages = pagesB(day), p = pages[c.page];
  return [mention,
    box(Accent.approval,
      t(`## Miner · ${day.label}\n${summary(day)}\n-# Page ${c.page + 1} of ${pages.length} · ${p.title}`),
      p.ls.map((l) => sec(fullLine(day, l), btn(`d|co|${c.id}|${l.id}`, 'Correct', Style.Secondary, !!l.rejudging))),
      t(footer(day))),
    row(btn(`d|bp|${c.id}|${c.page - 1}`, '◀ Back', Style.Secondary, c.page === 0),
      btn(`d|bp|${c.id}|${c.page + 1}`, 'Next ▶', Style.Primary, c.page === pages.length - 1),
      btn(`d|bd|${c.id}`, 'Done'))];
}
const pingB = (c) => ({ flags: V2, components: renderB(c), allowedMentions: S.noPing ? { parse: [] } : { users: [S.person] } });

// ---------- Variant C: a forum post per day, one message per band ----------
const PER_MSG = 12;
function starterC(c) {
  const day = c.day, dossiers = day.ls.filter((l) => l.kind === 'dossier');
  return [box(Accent.progress,
    t(`## Miner · ${day.label}\n${summary(day)}`),
    t(`**Dossiers:** ${dossiers.map((l) => (l.post ? `<#${l.post}>` : l.name)).join(' · ') || 'none today'}`),
    t(footer(day, ' · every Launch follows below by band, each with Correct')))];
}
function chunksC(day) {
  const out = [];
  for (const [title, ls] of groups(day)) {
    const parts = Math.ceil(ls.length / PER_MSG);
    for (let i = 0; i < parts; i++) out.push({ title: parts > 1 ? `${title} (${i + 1}/${parts})` : title, ids: ls.slice(i * PER_MSG, (i + 1) * PER_MSG).map((l) => l.id) });
  }
  return out;
}
function bandC(c, chunk) {
  const day = c.day, ls = chunk.ids.map((id) => day.ls.find((l) => l.id === id));
  return [box(chunk.title === 'Dossiers' ? Accent.approval : Accent.progress,
    t(`### ${chunk.title}`),
    ls.map((l) => sec(fullLine(day, l), btn(`d|co|${c.id}|${l.id}`, 'Correct', Style.Secondary, !!l.rejudging))))];
}
const threadTitle = (c) => { const { d } = counts(c.day); return `${c.day.label} · ${d} Dossier${d === 1 ? '' : 's'} · line ${c.day.line}`; };

// ---------- Posting a variant ----------
async function postVariant(v) {
  const day = buildDay(S.day);
  for (const l of day.ls.filter((x) => x.kind === 'dossier')) await ensurePost(day, l);
  const c = { id: `${v}${++seq}`, v, day, mode: 0, page: 0, msgs: {} };
  S.copies.set(c.id, c);
  if (v === 'A') {
    await writeA(c, true);
    note(`A · ${day.label} · 1 message · ${c.last.n}/40 components · ${c.last.chars} characters · "${MODES[c.mode]}" form`);
  } else if (v === 'B') {
    c.msgs.main = await send(S.ch.needs, pingB(c));
    const pages = pagesB(day), worst = Math.max(...pages.map((_, i) => stats(renderB({ ...c, page: i })).n));
    note(`B · ${day.label} · 1 card · ${pages.length} pages · up to ${worst}/40 components a page`);
  } else {
    const th = await S.ch.days.threads.create({ name: threadTitle(c), message: silent(starterC(c)) });
    c.msgs.thread = th.id; c.msgs.starter = { ch: th.id, id: th.id };
    c.chunks = chunksC(day); c.msgs.bands = [];
    for (const ch of c.chunks) c.msgs.bands.push(await send(th, silent(bandC(c, ch))));
    const worst = Math.max(...c.chunks.map((ch) => stats(bandC(c, ch)).n));
    note(`C · ${day.label} · 1 post · ${1 + c.chunks.length} messages · up to ${worst}/40 components each`);
  }
}

// ---------- Corrections (stubbed) ----------
const plainHead = (day, l) => head(day, { ...l, rejudging: false }).replace(/\*\*/g, '');
function correctModal(c, l) {
  return {
    custom_id: `d|cm|${c.id}|${l.id}`, title: `Correct · ${l.name}`.slice(0, 45),
    components: [t(`${plainHead(c.day, l)} · ${l.reason}`),
      { type: 18, label: 'What did it get wrong?', component: { type: 4, custom_id: 'text', style: 2, max_length: 1000, required: true } }],
  };
}
async function rerender(c, l) {
  if (c.v === 'A') return writeA(c, false);
  if (c.v === 'B') return editMsg(c.msgs.main, quiet(renderB(c)));
  const i = c.chunks.findIndex((ch) => ch.ids.includes(l.id));
  await editMsg(c.msgs.bands[i], quiet(bandC(c, c.chunks[i])));
  await editMsg(c.msgs.starter, quiet(starterC(c)));
}
async function correct(c, l, text) {
  const day = c.day;
  l.rejudging = true; await rerender(c, l);
  await sleep(3000);
  const was = plainHead(day, { ...l, corrected: l.corrected });
  if (l.kind === 'dossier') { l.kind = 'skip'; l.fit = 3; } else { l.kind = 'dossier'; l.fit = Math.min(10, day.line + 1); }
  l.corrected = { was, text, at: Date.now() }; l.rejudging = false;
  if (l.kind === 'dossier') await ensurePost(day, l);
  else if (l.post) await (await client.channels.fetch(l.post)).send(silent([box(Accent.progress, t(`-# Withdrawn by your Correction ${when()}: “${text}”`))]));
  await rerender(c, l);
  if (c.v === 'C') await (await client.channels.fetch(c.msgs.thread)).setName(threadTitle(c)).catch(() => {});
  await sleep(1500);
  await propose(c, l, text);
}
async function propose(c, l, text) {
  const want = l.kind === 'dossier', clause = l.reason.split(';')[0];
  const p = { id: `${c.id}-${l.id}-${++seq}`, line: `**${want ? 'Want' : "Don't want"}** + ${clause[0].toUpperCase()}${clause.slice(1)}.` };
  S.copies.set(p.id, p);
  await send(S.ch.needs, {
    flags: V2, allowedMentions: S.noPing ? { parse: [] } : { users: [S.person] },
    components: [t(`<@${S.person}>`), box(Accent.rule,
      t(`### Proposed Interest scope change · not an Approval\nFrom your Correction on **${l.name}** (${c.day.label}): “${text}”\n${p.line}\n-# Stand-in wording. Keep edits the Interest scope in your Profile; ${l.name} is fixed either way.`)),
    row(btn(`d|pk|${p.id}`, 'Keep', Style.Primary), btn(`d|px|${p.id}`, 'Discard'))],
  });
}

// ---------- Control panel ----------
function controlPayload() {
  const dayOpts = Object.entries(DAYS).map(([key, label]) => {
    const d = buildDay(key), { d: n } = counts(d);
    return { value: key, label: `${label} · ${d.n} Launches · ${n} Dossiers`, default: key === S.day };
  });
  return quiet([
    box(Accent.info,
      t('## Prototype · How does the day\'s list of Dossiers and Skips look on Discord?'),
      t(`**A** · <#${S.ch.a.id}>: one silent message per day. Every Launch is a line of text, grouped by band; Correct goes through two menus.\n`
        + `**B** · <#${S.ch.needs.id}>: one card per day that @mentions you. Ten lines a page, each with its own Correct button; Done shrinks it to one line.\n`
        + `**C** · <#${S.ch.days.id}>: a forum post per day. Every Launch is on show, one message per band, each line with its own Correct button.`),
      t(`-# Real Featured Launches from Oct 11–14, 2026, read through the Product Hunt API; the fits are the hand-judged stand-ins from #9. `
        + `Each Dossier gets a post in <#${S.ch.products.id}>, shared by all three. Corrections are stubbed: a corrected Skip comes back as a Dossier at the line + 1, `
        + 'a corrected Dossier comes back at fit 3 and is withdrawn, and either way a proposed Interest scope change lands in #needs-you. '
        + 'Each Dossier\'s Walkthrough would land in #needs-you too (#12); none are posted here.'),
      selectIn('k|day', 'Day', dayOpts),
      row(btn('k|post|A', 'Post A · #a-miner', Style.Primary), btn('k|post|B', 'Post B · #needs-you', Style.Primary), btn('k|post|C', 'Post C · #c-days', Style.Primary), btn('k|reset', 'Reset all', Style.Danger)),
      t(S.log.length ? `-# ${S.log.join('\n-# ')}` : '-# Nothing posted yet.')),
  ]);
}
async function refreshControl() { await editMsg(S.ch.controlMsg, controlPayload()); }

async function setup(guild) {
  S.guild = guild; S.person = guild.ownerId;
  if (!guild.features.includes('COMMUNITY')) throw new Error('Community must be on for the forums.');
  const all = await guild.channels.fetch();
  const find = (name, type) => all.find((c) => c?.name === name && c.type === type);
  const cat = find('prototype-29', ChannelType.GuildCategory) ?? await guild.channels.create({ name: 'prototype-29', type: ChannelType.GuildCategory });
  const make = async (name, type, extra = {}) => find(name, type) ?? guild.channels.create({ name, type, parent: cat.id, ...extra });
  S.ch.control = await make('proto-29', ChannelType.GuildText, { topic: 'Prototype for lab1 #29: post a day\'s list in each variant from here.' });
  S.ch.a = await make('a-miner', ChannelType.GuildText, { topic: 'Variant A: one message per Miner day.' });
  S.ch.needs = await make('needs-you', ChannelType.GuildText, { topic: 'Everything waiting on you (#12). Variant B puts the day\'s card here.' });
  S.ch.days = await make('c-days', ChannelType.GuildForum, { topic: 'Variant C: one post per Miner day.' });
  S.ch.products = await make('products', ChannelType.GuildForum, { topic: 'One post per Product (#12); here only the Dossiers.', availableTags: TAGS.map((name) => ({ name })) });
  for (const tag of S.ch.products.availableTags) S.tags[tag.name] = tag.id;
  const recent = await S.ch.control.messages.fetch({ limit: 20 });
  const mine = recent.find((m) => m.author.id === client.user.id && m.components.length);
  if (mine) { S.ch.controlMsg = { ch: S.ch.control.id, id: mine.id }; await mine.edit(controlPayload()); } else {
    const m = await S.ch.control.send(controlPayload()); m.pin().catch(() => {}); S.ch.controlMsg = { ch: S.ch.control.id, id: m.id };
  }
}
async function resetAll() {
  S.copies.clear(); S.posts.clear(); S.log = [];
  for (const forum of [S.ch.days, S.ch.products]) for (const th of (await forum.threads.fetchActive()).threads.values()) if (th.parentId === forum.id) await th.delete().catch(() => {});
  for (const ch of [S.ch.a, S.ch.needs]) for (const m of (await ch.messages.fetch({ limit: 100 })).values()) await m.delete().catch(() => {});
}

// ---------- Interactions ----------
const say = (i, content) => i.reply({ content, flags: EPHEMERAL });
client.on(Events.InteractionCreate, async (i) => {
  try {
    const id = i.customId ?? '';
    if (!id.startsWith('d|') && !id.startsWith('k|')) return i.isRepliable() && say(i, 'That belongs to the #12 prototype, which isn\'t running now.');
    if (i.user.id !== S.person) return say(i, 'Only the person can act here.');
    const [kind, act, cid, arg] = id.split('|');
    if (kind === 'k') {
      if (act === 'day') { S.day = i.values[0]; return i.update(controlPayload()); }
      await i.deferUpdate();
      if (act === 'reset') await resetAll(); else await postVariant(cid);
      return refreshControl();
    }
    const c = S.copies.get(cid);
    if (!c) return say(i, 'This prototype restarted, so that message is stale. Post the variant again from #proto-29.');
    const launch = (lid) => c.day.ls.find((l) => String(l.id) === String(lid));
    switch (act) {
      case 'ca': return i.showModal(correctModal(c, launch(i.values[0])));
      case 'co': return i.showModal(correctModal(c, launch(arg)));
      case 'cm': await i.deferUpdate(); return correct(c, launch(arg), i.fields.getTextInputValue('text'));
      case 'bp': c.page = Number(arg); return i.update(quiet(renderB(c)));
      case 'bd': c.done = Date.now(); return i.update(quiet(renderB(c)));
      case 'bo': c.done = null; return i.update(quiet(renderB(c)));
      case 'pk': case 'px':
        return i.update(quiet([box(Accent.progress, t(`-# ${act === 'pk' ? `✓ Kept ${when()} · Interest scope` : `Discarded ${when()} · the Correction still fixed its Launch`} · ${c.line}`))]));
    }
  } catch (e) {
    console.error(e);
    note(`⚠️ ${e.message.split('\n')[0]}`);
    if (i.isRepliable() && !i.replied && !i.deferred) await say(i, `⚠️ ${e.message}`).catch(() => {});
    else await refreshControl().catch(() => {});
  }
});

client.once(Events.ClientReady, async () => {
  const guild = client.guilds.cache.first();
  if (!guild) { console.log('Not in a server yet: invite the bot, then restart.'); return; }
  await setup(await guild.fetch());
  console.log(`Ready as ${client.user.tag} in ${guild.name}; control in #proto-29`);
  for (const v of (process.env.PREPOST ?? '').split(',').filter(Boolean)) { await postVariant(v); await refreshControl(); }
  if (process.env.SELFTEST) await selftest().catch((e) => { console.error('SELFTEST FAILED', e); process.exit(1); });
});

// SELFTEST=1: post every variant for every day and correct a Skip and a Dossier in each, with no @mentions, then reset.
async function selftest() {
  S.noPing = true;
  for (const key of Object.keys(DAYS)) {
    S.day = key;
    for (const v of ['A', 'B', 'C']) {
      console.log('selftest', key, v, 'post'); await postVariant(v);
      const c = [...S.copies.values()].at(-1);
      console.log('selftest', key, v, 'correct');
      const skip = c.day.ls.find((l) => l.kind === 'skip'), dossier = c.day.ls.find((l) => l.kind === 'dossier');
      await correct(c, skip, 'selftest: I would use this');
      if (dossier) await correct(c, dossier, 'selftest: not for me');
      if (v === 'B') for (let p = 0; p < pagesB(c.day).length; p++) { c.page = p; await editMsg(c.msgs.main, quiet(renderB(c))); }
    }
    await refreshControl();
  }
  console.log(S.log.join('\n'));
  if (process.env.SELFTEST !== 'keep') await resetAll();
  S.noPing = false; S.log = []; await refreshControl();
  console.log('SELFTEST OK');
}
client.login(TOKEN);
