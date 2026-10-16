// PROTOTYPE, throwaway: three variants of a Dossier as the first message of its Product post on Discord, for lab1 #33.
// A: #a-products, one card: every claim with footnote numbers, the sources listed once at the foot.
// B: #b-products, a row per claim with its source as a button beside it.
// C: #c-products, a short verdict with inline source links; the full Dossier sits in git, one tap away.
// The seven Dossiers are real (dossiers.mjs); Registrations, Corrections and the Hindsight re-Launch are stubs.
// All state is in memory. Run: ./run.sh dossier
import { readFileSync } from 'node:fs';
import { Client, GatewayIntentBits, ChannelType, Events } from 'discord.js';
import { t, box, row, btn, link, when, Style, Accent, EPHEMERAL, V2, SILENT } from './kit.mjs';
import { PRODUCTS, RELAUNCH, withRelaunch } from './dossiers.mjs';
import { RENDER, stats, GIT_BASE, gitPaths } from './dossier-render.mjs';

const TOKEN = readFileSync(`${process.env.HOME}/.config/lab1/discord-bot-token`, 'utf8').trim();
const TAGS = ['Walkthrough', 'Registering', 'Needs you', 'registered', 'waitlisted', 'handed off', 'abandoned', 'no account'];
const VARIANTS = {
  A: ['a-products', 'one card: every claim footnoted, the sources listed once at the foot'],
  B: ['b-products', 'a row per claim, its source as a button beside it'],
  C: ['c-products', 'a short verdict with inline source links; the full Dossier in git, one tap away'],
};
const GIT_TREE = 'https://github.com/ultrasadness/lab1/tree/prototype/dossier-discord/prototypes/walkthrough-discord/dossier-git';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---------- In-memory state ----------
const S = { guild: null, person: null, ch: {}, tags: {}, copies: new Map(), log: [] };
let seq = 0;
function note(line) { S.log.push(`${new Date().toISOString().slice(11, 16)} ${line}`); S.log = S.log.slice(-10); console.log(line); }

// ---------- Discord plumbing ----------
const silent = (components) => ({ flags: V2 | SILENT, components, allowedMentions: { parse: [] } });
const quiet = (components) => ({ flags: V2, components, allowedMentions: { parse: [] } });
async function editMsg(ref, payload) { const c = await client.channels.fetch(ref.ch); const m = await c.messages.fetch(ref.id); await m.edit(payload); }
const tooLong = (e) => e?.code === 50035;
const sizeLine = (c) => { const s = stats(RENDER[c.v](c.p, c.id)); return `${s.chars}/4,000 characters (${s.urls} in link URLs) · ${s.n}/40 components`; };

// What follows the Dossier in its post, as stand-ins: #12 settled how these look.
function standIn(p) {
  if (!p.walkthrough) return '-# No Walkthrough follows: there is nothing to register.';
  return [
    p.history.length ? `-# **Walkthrough v1** · copy without buttons · ${p.history[0][1]}` : '-# **Walkthrough v1** · copy without buttons · waiting for your Approval in #needs-you',
    `**${p.name} · ${p.status}**`,
    '-# Stand-ins for the Walkthrough copy and the status message, which #12 settled.',
  ].join('\n');
}

async function postCopy(v, product) {
  const c = { id: `${v}${++seq}`, v, p: structuredClone(product) };
  const forum = S.ch[v];
  try {
    const th = await forum.threads.create({
      name: `${c.p.name} · ${c.p.tagline}`.slice(0, 100),
      appliedTags: [S.tags[c.p.tag]].filter(Boolean),
      message: silent(RENDER[v](c.p, c.id)),
    });
    c.thread = th.id; c.starter = { ch: th.id, id: th.id };
    await th.send(silent([box(Accent.progress, t(standIn(c.p)))]));
    S.copies.set(c.id, c);
    note(`${v} · ${c.p.name} · ${sizeLine(c)}`);
  } catch (e) {
    if (!tooLong(e)) throw e;
    note(`${v} · ${c.p.name} · Discord refused it: ${sizeLine(c)} (${e.message.split('\n').slice(1).join(' ').trim()})`);
  }
}
const rerender = (c) => editMsg(c.starter, quiet(RENDER[c.v](c.p, c.id)));

// ---------- Add Offer and Correct (stubbed: nothing is re-read or re-judged) ----------
const label = (lbl, custom_id, { required = false, max = 200, placeholder, description } = {}) => ({
  type: 18, label: lbl, ...(description ? { description } : {}),
  component: { type: 4, custom_id, style: 1, required, max_length: max, ...(placeholder ? { placeholder } : {}) },
});
const addOfferModal = (c) => ({
  custom_id: `x|am|${c.id}`, title: `Add Offer · ${c.p.name}`.slice(0, 45),
  components: [
    t('-# For an Offer you saw that the Assistant couldn’t, such as on the Launch page. It is cited “from you”. Not a Correction.'),
    label('What it gives', 'what', { required: true, placeholder: '3 months of Pro free' }),
    label('Code', 'code', { max: 60, placeholder: 'leave empty if none' }),
    label('Deadline or cap', 'limit', { max: 100, placeholder: 'until Oct 31, first 500 users…' }),
  ],
});
const correctModal = (c) => ({
  custom_id: `x|cm|${c.id}`, title: `Correct · ${c.p.name}`.slice(0, 45),
  components: [
    t(`Dossier v${c.p.version ?? 1} · ${c.p.offers.length} Offer${c.p.offers.length === 1 ? '' : 's'} · fit ${c.p.launches.at(-1).fit}`),
    { type: 18, label: 'What did it get wrong?', component: { type: 4, custom_id: 'text', style: 2, max_length: 1000, required: true } },
  ],
});
async function addOffer(c, f) {
  const code = f.getTextInputValue('code')?.trim(), limit = f.getTextInputValue('limit')?.trim();
  c.p.offers.push({ what: f.getTextInputValue('what').trim(), needs: [code ? `code \`${code}\`` : 'no code', limit].filter(Boolean), src: [], fromYou: true, at: when() });
  await rerender(c);
  note(`${c.v} · ${c.p.name} · Offer added · ${sizeLine(c)}`);
}
async function correct(c, text) {
  c.p.rejudging = true; await rerender(c);
  await sleep(3000);
  c.p.rejudging = false; c.p.version = (c.p.version ?? 1) + 1; c.p.correction = { text, at: when() };
  await rerender(c);
  note(`${c.v} · ${c.p.name} · corrected (stub) · ${sizeLine(c)}`);
}
async function relaunch() {
  const hits = [...S.copies.values()].filter((c) => c.p.key === RELAUNCH.product && c.p.launches.length === 1);
  if (!hits.length) return note('Re-Launch: no Hindsight post without one yet. Post a variant first.');
  for (const c of hits) {
    const { correction, version, offers } = c.p;
    c.p = { ...withRelaunch(c.p), correction, version };
    c.p.offers = [...offers, RELAUNCH.offer];
    await rerender(c);
    const th = await client.channels.fetch(c.thread);
    await th.send(silent([box(Accent.progress, t(`-# Launched again ${RELAUNCH.launch.label} as “${RELAUNCH.launch.name}” · added to the Dossier above · stub: no such Launch exists`))]));
    note(`${c.v} · Hindsight re-Launched · ${sizeLine(c)}`);
  }
}

// ---------- Control panel ----------
function controlPayload() {
  const by = (k) => PRODUCTS.find((p) => p.key === k);
  const gitLine = (n, name) => `**${n} · ${name}:** [Inferock](${GIT_BASE}/${gitPaths(by('inferock'))[n]}) · [Hindsight, re-Launched](${GIT_BASE}/${gitPaths(by('hindsight'))[n]}) · [all](${GIT_TREE}/${['1-one-file/products', '2-folder/products', '3-by-date'][n - 1]})`;
  return quiet([
    box(Accent.info,
      t('## Prototype · How does a Dossier read in its Product post, and how is it kept in git?'),
      t(Object.entries(VARIANTS).map(([v, [name, what]]) => `**${v}** · <#${S.ch[v].id}>: ${what}.`).join('\n')),
      t('-# Seven real Dossiers from the Featured Launches of Oct 11–14, written by hand from the Launch, its Maker comment, the landing, pricing and signup pages. '
        + 'Each post follows its Dossier with stand-ins for the Walkthrough copy and status (#12). Registrations are stubs. '
        + 'Add Offer and Correct work but re-read nothing. **Re-Launch** adds a stub Nov 4 Launch, with a new Offer, to every Hindsight post.'),
      t(`### The same Dossiers in git\n${gitLine(1, 'one file per Product')}\n${gitLine(2, 'a folder per Product, a file per writer')}\n${gitLine(3, 'by date, one Registration log')}`),
      row(Object.keys(VARIANTS).map((v) => btn(`k|post|${v}`, `Post ${v}`, Style.Primary)),
        btn('k|relaunch', 'Re-Launch Hindsight'), btn('k|reset', 'Reset all', Style.Danger)),
      t(S.log.length ? `-# ${S.log.join('\n-# ')}` : '-# Nothing posted yet.')),
  ]);
}
async function refreshControl() { await editMsg(S.ch.controlMsg, controlPayload()); }

async function setup(guild) {
  S.guild = guild; S.person = guild.ownerId;
  if (!guild.features.includes('COMMUNITY')) throw new Error('Community must be on for the forums.');
  const all = await guild.channels.fetch();
  const cat = all.find((c) => c?.name === 'prototype-33' && c.type === ChannelType.GuildCategory)
    ?? await guild.channels.create({ name: 'prototype-33', type: ChannelType.GuildCategory });
  const make = async (name, type, extra = {}) => all.find((c) => c?.name === name && c.type === type && c.parentId === cat.id)
    ?? guild.channels.create({ name, type, parent: cat.id, ...extra });
  S.ch.control = await make('proto-33', ChannelType.GuildText, { topic: 'Prototype for lab1 #33: post the Dossiers in each variant from here.' });
  for (const [v, [name, what]] of Object.entries(VARIANTS)) {
    S.ch[v] = await make(name, ChannelType.GuildForum, { topic: `Variant ${v}: ${what}.`, availableTags: TAGS.map((n) => ({ name: n })) });
  }
  for (const tag of S.ch.A.availableTags) S.tags[tag.name] = tag.id;
  for (const v of ['B', 'C']) for (const tag of S.ch[v].availableTags) S.tags[`${v}|${tag.name}`] = tag.id;
  const recent = await S.ch.control.messages.fetch({ limit: 20 });
  const mine = recent.find((m) => m.author.id === client.user.id && m.components.length);
  if (mine) { S.ch.controlMsg = { ch: S.ch.control.id, id: mine.id }; await mine.edit(controlPayload()); } else {
    const m = await S.ch.control.send(controlPayload()); m.pin().catch(() => {}); S.ch.controlMsg = { ch: S.ch.control.id, id: m.id };
  }
}
async function resetAll() {
  S.copies.clear(); S.log = [];
  for (const v of Object.keys(VARIANTS)) {
    const f = S.ch[v];
    for (const th of (await f.threads.fetchActive()).threads.values()) if (th.parentId === f.id) await th.delete().catch(() => {});
  }
}
async function postVariant(v) {
  const tagOf = (name) => (v === 'A' ? S.tags[name] : S.tags[`${v}|${name}`]);
  const saved = S.tags; S.tags = Object.fromEntries(TAGS.map((n) => [n, tagOf(n)]));
  try { for (const p of PRODUCTS) await postCopy(v, p); } finally { S.tags = saved; }
}

// ---------- Interactions ----------
const say = (i, content) => i.reply({ content, flags: EPHEMERAL });
client.on(Events.InteractionCreate, async (i) => {
  try {
    const id = i.customId ?? '';
    if (!id.startsWith('x|') && !id.startsWith('k|')) return i.isRepliable() && say(i, 'That belongs to another prototype, which isn\'t running now.');
    if (i.user.id !== S.person) return say(i, 'Only the person can act here.');
    const [kind, act, cid] = id.split('|');
    if (kind === 'k') {
      await i.deferUpdate();
      if (act === 'reset') await resetAll(); else if (act === 'relaunch') await relaunch(); else await postVariant(cid);
      return refreshControl();
    }
    const c = S.copies.get(cid);
    if (!c) return say(i, 'This prototype restarted, so that post is stale. Post the variant again from #proto-33.');
    switch (act) {
      case 'ao': return i.showModal(addOfferModal(c));
      case 'co': return i.showModal(correctModal(c));
      case 'am': await i.deferUpdate(); await addOffer(c, i.fields); return refreshControl();
      case 'cm': await i.deferUpdate(); await correct(c, i.fields.getTextInputValue('text')); return refreshControl();
    }
  } catch (e) {
    console.error(e);
    note(`⚠️ ${e.message.split('\n')[0]}`);
    if (i.isRepliable() && !i.replied && !i.deferred) await say(i, `⚠️ ${e.message}`).catch(() => {});
    await refreshControl().catch(() => {});
  }
});

client.once(Events.ClientReady, async () => {
  const guild = client.guilds.cache.first();
  if (!guild) { console.log('Not in a server yet: invite the bot, then restart.'); return; }
  await setup(await guild.fetch());
  console.log(`Ready as ${client.user.tag} in ${guild.name}; control in #proto-33`);
  if (process.env.SELFTEST) await selftest().catch((e) => { console.error('SELFTEST FAILED', e); process.exit(1); });
});

// SELFTEST=1: post every variant, add an Offer and a Correction to one post each, re-Launch Hindsight, then reset.
async function selftest() {
  for (const v of Object.keys(VARIANTS)) await postVariant(v);
  const fake = (vals) => ({ getTextInputValue: (k) => vals[k] ?? '' });
  for (const v of Object.keys(VARIANTS)) {
    const c = [...S.copies.values()].find((x) => x.v === v && x.p.key === 'inferock');
    await addOffer(c, fake({ what: 'selftest: 3 months of Pro free', code: 'PHTEST', limit: 'until Oct 31' }));
    await correct(c, 'selftest: the signup credit amount is $5');
  }
  await relaunch();
  await refreshControl();
  console.log(S.log.join('\n'));
  if (process.env.SELFTEST !== 'keep') { await resetAll(); S.log = []; await refreshControl(); }
  console.log('SELFTEST OK');
  if (process.env.SELFTEST !== 'keep') process.exit(0);
}
client.login(TOKEN);
