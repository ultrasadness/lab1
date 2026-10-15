// PROTOTYPE, throwaway: three variants of a Product's Walkthrough journey on Discord, for lab1 #12.
// A: forum post per Product, whole Walkthrough on one card, per-field Edit.
// B: one DM stream, short card that expands, Approve confirmed in a modal, the card becomes the Registration.
// C: #c-inbox holds only what needs you, a thread per Product holds the rest; exceptions-only Walkthrough,
//    Edit on a tailnet page, Correct by replying in the thread.
// All state is in memory; nothing registers, sends or reads mail. Run: node bot.mjs
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { Client, GatewayIntentBits, Partials, ChannelType, Events } from 'discord.js';
import {
  t, sep, box, sec, row, btn, link, gallery, select, msg, edit, hash, when, Style, Accent, EPHEMERAL, V2,
  PRODUCTS, ORDER, dossierText, fieldLine, consequence, rulesLine, wallsLine, termsLinks, STEP_TEXT, progressText,
  wallText, WALL_ROUTES, handoffText, QUILL_SHOTS, submitTapText, amendText, replyText, REPLY_V1, REPLY_GMAIL, ruleText, RULE,
} from './kit.mjs';

const TOKEN = readFileSync(`${process.env.HOME}/.config/lab1/discord-bot-token`, 'utf8').trim();
const TAILNET = process.env.TAILNET_URL ?? 'https://oracle-free-arm-a1-20260513.tailf1f385.ts.net:8446';
const HTTP_PORT = 8446;
const out = (j, components, opts = {}) => msg(S.person, components, { ...opts, mention: opts.ping && j.v !== 'B' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// NO_MESSAGE_CONTENT=1 runs without the privileged intent; only variant C's typed Corrections need it.
const CONTENT = !process.env.NO_MESSAGE_CONTENT;
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, ...(CONTENT ? [GatewayIntentBits.MessageContent] : [])],
  partials: [Partials.Channel],
});

// ---------- In-memory state ----------
const S = { guild: null, person: null, ch: {}, dm: null, simVariant: 'A', journeys: new Map(), tags: {} };
let seq = 0;
const newJourney = (v, slug) => {
  const p = PRODUCTS[slug];
  const j = {
    id: `${v}${++seq}`, v, p, version: 1, readAt: Date.now(), fields: structuredClone(p.fields), terms: structuredClone(p.terms),
    wt: 'waiting', correcting: false, details: false, reg: null, shot: 1, pageShot: 1, reply: null, m: {}, token: randomBytes(9).toString('hex'),
  };
  S.journeys.set(j.id, j);
  return j;
};
const wtHash = (j) => hash({ v: j.version, f: j.fields, t: j.terms });
const email = (j) => j.fields.find((f) => f.key === 'email').value;
const latest = (v, pred = () => true) => [...S.journeys.values()].reverse().find((j) => j.v === v && pred(j));

// ---------- Channels ----------
async function fetchMsg(channelId, id) { const c = await client.channels.fetch(channelId); return c.messages.fetch(id); }
async function editMsg(ref, payload) { if (!ref) return; const m = await fetchMsg(ref.ch, ref.id); await m.edit(payload); }
async function send(channel, payload, replyTo) {
  const m = await channel.send(replyTo ? { ...payload, reply: { messageReference: replyTo, failIfNotExists: false } } : payload);
  return { ch: channel.id, id: m.id };
}

const TAGS = ['Walkthrough', 'Registering', 'Needs you', 'registered', 'waitlisted', 'handed off', 'abandoned'];
async function setup(guild) {
  S.guild = guild; S.person = guild.ownerId;
  const all = await guild.channels.fetch();
  const find = (name, type) => all.find((c) => c?.name === name && c.type === type);
  let cat = find('prototype-12', ChannelType.GuildCategory)
    ?? await guild.channels.create({ name: 'prototype-12', type: ChannelType.GuildCategory });
  const make = async (name, type, extra = {}) => find(name, type) ?? guild.channels.create({ name, type, parent: cat.id, ...extra });
  S.ch.control = await make('proto-control', ChannelType.GuildText, { topic: 'Prototype for lab1 #12: post variants and simulate events from here.' });
  if (guild.features.includes('COMMUNITY')) {
    S.ch.forum = await make('a-products', ChannelType.GuildForum, { availableTags: TAGS.map((name) => ({ name })) });
    for (const tag of S.ch.forum.availableTags) S.tags[tag.name] = tag.id;
  } else console.warn('Community is off: variant A (forum) is unavailable until it is enabled.');
  S.ch.inbox = await make('c-inbox', ChannelType.GuildText, { topic: 'Variant C: only what needs you.' });
  S.ch.products = await make('c-products', ChannelType.GuildText, { topic: 'Variant C: one thread per Product.' });
  S.dm = await (await client.users.fetch(S.person)).createDM();
  await guild.commands.set([{ name: 'rules', description: 'List the Rules the Assistant applies, by scope' }]);
  await postControl();
}

// ---------- Control panel ----------
const SIMS = [
  ['expire', '14 days pass on an unanswered Walkthrough'],
  ['correct-rule', 'A Correction becomes a proposed Rule'],
  ['rule-fail', "A proposed Rule's case fails"],
  ['page-changed', 'Quill CRM page changes before your Submit tap'],
  ['still-showing', 'Form still showing 10 s after the final press'],
  ['verify-nudge', 'Verification mail the Assistant may not open'],
  ['abandon', 'A Registration abandoned after 24 h'],
  ['gmail-edit', 'You edit the Reply draft in Gmail'],
  ['gmail-sent', 'You send the Reply draft from Gmail'],
  ['new-mail', 'New mail in a thread whose draft you hold'],
];
const PUSH = [
  ['push-v2', 'In 10 s: a Components V2 message that @mentions you'],
  ['push-plain', 'In 10 s: a plain-text message that @mentions you'],
  ['push-silent', 'In 10 s: a silent Components V2 message'],
  ['push-edit', 'Now silent, then in 10 s edited to add an @mention'],
];
function controlPayload() {
  return {
    flags: V2, allowedMentions: { parse: [] },
    components: [
      box(Accent.info,
        t('## Prototype · How should a Walkthrough and its Approval look on Discord?'),
        t('**A** · forum post per Product, the whole Walkthrough on one card, Edit beside each field\n'
          + '**B** · one DM stream, a short card with Details, Approve confirmed in a pop-up, the card turns into the Registration\n'
          + '**C** · `#c-inbox` holds only what needs you, a thread per Product holds the rest; shows only what\'s unusual, Edit on a tailnet page, Correct by replying in the thread'),
        t('-# Each Post sends five fictional Products, one per path: Inkwell (clean) · Larkspur (bot check) · Quill CRM (page check fails) · Tessellate (amended Walkthrough) · Relay (form not seen, waitlist). Inkwell gets a Reply draft once registered.')),
      row(btn('c|post|A', 'Post A · forum', Style.Primary, !S.ch.forum), btn('c|post|B', 'Post B · DM', Style.Primary), btn('c|post|C', 'Post C · inbox', Style.Primary), btn('c|reset', 'Reset all', Style.Danger)),
      select('c|simv', `Simulations act on variant ${S.simVariant}`, ['A', 'B', 'C'].map((v) => ({ label: `Simulations act on variant ${v}`, value: v, default: v === S.simVariant }))),
      select('c|sim', 'Simulate…', SIMS.map(([value, label]) => ({ label, value }))),
      select('c|push', 'Notification check (lock the phone after picking)…', PUSH.map(([value, label]) => ({ label, value }))),
    ],
  };
}
async function postControl() {
  const pins = await S.ch.control.messages.fetch({ limit: 20 });
  const mine = pins.find((m) => m.author.id === client.user.id && m.components.length);
  if (mine) await mine.edit(controlPayload()); else (await S.ch.control.send(controlPayload())).pin().catch(() => {});
}

// ---------- Variant: where things go ----------
const threadUrl = (id) => `https://discord.com/channels/${S.guild.id}/${id}`;
async function home(j) { return client.channels.fetch(j.m.home); }
async function actionChannel(j) { return j.v === 'C' ? S.ch.inbox : home(j); }
async function setTags(j, ...names) {
  if (j.v !== 'A') return;
  const th = await home(j);
  await th.setAppliedTags(names.map((n) => S.tags[n]).filter(Boolean)).catch(() => {});
}

async function place(j) {
  const p = j.p;
  if (j.v === 'A') {
    const th = await S.ch.forum.threads.create({
      name: `${p.name} · ${p.tagline}`, appliedTags: [S.tags.Walkthrough],
      message: { flags: V2, components: [box(Accent.progress, t(dossierText(p)))], allowedMentions: { parse: [] } },
    });
    j.m.home = th.id;
  } else if (j.v === 'B') {
    j.m.home = S.dm.id;
    j.m.dossier = await send(S.dm, msg(S.person, [box(Accent.progress, t(dossierText(p)))]));
  } else {
    const starter = await S.ch.products.send(msg(S.person, [box(Accent.progress, t(dossierText(p)))]));
    const th = await starter.startThread({ name: `${p.name} · ${p.tagline}` });
    j.m.home = th.id;
  }
}

// ---------- Walkthrough cards ----------
function wtStatusLine(j) {
  if (j.wt === 'approved') return t(`-# ✅ Approved v${j.version} ${when(j.approvedAt)}`);
  if (j.wt === 'dismissed') return t('-# Dismissed · no Registration');
  if (j.wt === 'expired') return t('-# ⏳ Unanswered for 14 days. Prepare again re-reads the signup page.');
  if (j.correcting) return t('-# ✎ Correcting… a new version follows. Approve is off until then.');
  if (j.edited) return t(`-# ✎ ${j.edited}`);
  return null;
}
function wtButtons(j, extra = []) {
  if (j.wt === 'expired') return [row(btn(`p|pa|${j.id}`, 'Prepare again', Style.Primary))];
  if (j.wt !== 'waiting') return [];
  const off = j.correcting;
  const approve = btn(`p|ap|${j.id}|${wtHash(j)}`, 'Approve', Style.Success, off);
  if (j.v === 'A') return [row(approve, btn(`p|co|${j.id}`, 'Correct', Style.Secondary, off), btn(`p|di|${j.id}`, 'Dismiss'))];
  if (j.v === 'B') return [row(approve, btn(`p|dt|${j.id}`, j.details ? 'Hide' : 'Details'), btn(`p|ed|${j.id}`, 'Edit', Style.Secondary, off), btn(`p|co|${j.id}`, 'Correct', Style.Secondary, off), btn(`p|di|${j.id}`, 'Dismiss'))];
  return [row(approve, link(`${TAILNET}/edit/${j.id}?t=${j.token}`, 'Edit'), link(threadUrl(j.m.home), 'Open thread'), btn(`p|di|${j.id}`, 'Dismiss'))];
}

function unusual(j) {
  const p = j.p, out = [];
  if (p.host !== p.domain) out.push(`Signs up on \`${p.host}\` (${p.hostNote}), not ${p.domain}`);
  for (const f of j.fields) if (!['first_name', 'last_name', 'email', 'password'].includes(f.key)) out.push(`${f.label} → ${f.value}`);
  if (p.walls) out.push(`Expect a bot check: you'll be asked to Take over`);
  if (p.formNotSeen) out.push('Form not seen: carries only the standard keys');
  return out;
}

function wtCard(j) {
  const p = j.p, live = j.wt === 'waiting' && !j.correcting;
  if (j.v === 'A') {
    const fields = j.fields.map((f) => (f.editable && live ? sec(fieldLine(f), btn(`p|ed|${j.id}|${f.key}`, 'Edit')) : t(fieldLine(f))));
    return [box(Accent.approval, t(`## Walkthrough · ${p.name} · v${j.version}`), t(consequence(j)), sep(), fields, sep(), t(wallsLine(p)), t(rulesLine(j)), wtStatusLine(j)), ...wtButtons(j)];
  }
  if (j.v === 'B') {
    const summary = j.details
      ? [sep(), ...j.fields.map((f) => t(fieldLine(f))), t(wallsLine(p)), t(rulesLine(j))]
      : [t(`-# ${j.fields.length} fields · ${p.formNotSeen ? 'form not seen · ' : ''}${p.walls ? 'bot check expected' : 'no walls expected'} · Rules applied: ${p.rules.length}`)];
    return [box(Accent.approval,
      t(`### Register at ${p.name}? · v${j.version}`),
      t(`as \`${email(j)}\` · accepts ${termsLinks(p, j.terms)} · presses **${p.button}** itself if the page matches`),
      summary, wtStatusLine(j)), ...wtButtons(j)];
  }
  const odd = unusual(j);
  return [box(Accent.approval,
    t(`**${p.name}** · Walkthrough v${j.version} · approve to register`),
    t(`-# Standard: your names · \`${email(j)}\` (plain if \`+\` refused) · new Bitwarden password · ${termsLinks(p, j.terms)}`),
    t(odd.length ? `**Different from usual**\n${odd.map((s) => `- ${s}`).join('\n')}` : 'Nothing unusual.'),
    t(`-# Rules applied: ${p.rules.join(' · ') || 'none'} · reply in the thread to correct it`),
    wtStatusLine(j)), ...wtButtons(j)];
}
function wtThreadCopy(j) { // variant C: the full Walkthrough in the Product's thread, no buttons
  return [box(Accent.progress, t(`### Walkthrough v${j.version}`), t(consequence(j)), ...j.fields.map((f) => t(fieldLine(f))), t(wallsLine(j.p)), t(rulesLine(j)))];
}

async function postWalkthrough(j) {
  if (j.v === 'C') {
    j.m.wtThread = await send(await home(j), msg(S.person, wtThreadCopy(j)));
    j.m.wt = await send(S.ch.inbox, out(j, wtCard(j), { ping: true }));
  } else {
    j.m.wt = await send(await home(j), out(j, wtCard(j), { ping: true }), j.m.dossier?.id);
  }
}
async function renderWt(j, i) {
  if (i) await i.update(edit(wtCard(j))); else await editMsg(j.m.wt, edit(wtCard(j)));
}
// A new version after an edit or Correction: A and C post it as a new message (the old one goes stale), B edits in place.
async function newVersion(j, note) {
  j.version += 1; j.correcting = false; j.edited = note;
  if (j.v === 'B') return renderWt(j);
  await editMsg(j.m.wt, edit([box(Accent.progress, t(`-# ${j.p.name} · Walkthrough v${j.version - 1} · replaced by v${j.version}`))]));
  if (j.v === 'C') await send(await home(j), msg(S.person, [box(Accent.progress, t(`-# ✎ ${note}`))]));
  await postWalkthrough(j);
}

// ---------- Registration progress ----------
const statusCard = (j) => [box(j.reg.outcome ? Accent.done : Accent.progress, t(progressText(j)),
  j.v === 'B' ? t(`-# Walkthrough v${j.version} approved ${when(j.approvedAt)}`) : null),
...(!j.reg.pressed && !j.reg.outcome ? [row(btn(`p|st|${j.id}`, 'Stop', Style.Danger))] : []),
...(j.reg.outcome === 'abandoned' ? [row(btn(`p|sa|${j.id}`, 'Start again', Style.Primary))] : [])];

async function renderStatus(j) {
  if (j.v === 'B') return editMsg(j.m.wt, edit(statusCard(j))); // the Walkthrough card becomes the Registration
  if (!j.m.status) j.m.status = await send(await home(j), msg(S.person, statusCard(j)));
  else await editMsg(j.m.status, edit(statusCard(j)));
}
async function step(j, line) { j.reg.log.push(line); await renderStatus(j); }
async function outcome(j, o) {
  j.reg.outcome = o; await renderStatus(j);
  await setTags(j, o);
  if (o === 'registered' && j.p.slug === 'inkwell' && !j.reply) { await sleep(5000); await postReply(j); }
}

// ---------- "Needs you" messages ----------
async function needsYou(j, components, files) {
  await closeAction(j);
  const ch = await actionChannel(j);
  j.m.action = await send(ch, out(j, components, { ping: true, files }), j.v === 'B' ? j.m.wt.id : undefined);
  if (j.v === 'C') await send(await home(j), msg(S.person, [t(`-# Waiting for you in <#${S.ch.inbox.id}>`)]));
  await setTags(j, 'Needs you');
}
async function closeAction(j, note, i) {
  if (!j.m.action) return;
  const payload = edit([box(Accent.progress, t(`-# ${j.p.name} · ${note ?? 'superseded'}`))]);
  if (i) await i.update(payload); else await editMsg(j.m.action, payload);
  j.m.action = null;
}

const route = (j, r) => (r === 'take' ? btn(`p|tk|${j.id}`, 'Take over', Style.Primary) : btn(`p|ho|${j.id}`, 'Hand off'));
async function wall(j, kind) {
  await setTags(j, 'Needs you');
  await needsYou(j, [box(Accent.needs, t(wallText(j, kind))), row(...WALL_ROUTES[kind].map((r) => route(j, r)), btn(`p|st|${j.id}`, 'Stop', Style.Danger))]);
}
async function submitTap(j) {
  const file = QUILL_SHOTS[j.shot], name = file.split('/')[1];
  await needsYou(j, [box(Accent.needs, t(submitTapText(j)), gallery(`attachment://${name}`, 'The filled form; the outlined button is the one Submit presses')),
    row(btn(`p|sub|${j.id}|${j.shot}`, 'Submit', Style.Success), btn(`p|st|${j.id}`, 'Stop', Style.Danger))],
  [{ attachment: new URL(file, import.meta.url).pathname, name }]);
}
async function amended(j) {
  j.version += 1; j.fields.push(...structuredClone(j.p.amend.added)); j.terms.push(...j.p.amend.terms); j.wt = 'waiting';
  await needsYou(j, [box(Accent.approval, t(amendText(j))),
    row(btn(`p|ap|${j.id}|${wtHash(j)}`, 'Approve', Style.Success), btn(`p|ea|${j.id}`, 'Edit'), btn(`p|st|${j.id}`, 'Stop', Style.Danger))]);
}

// ---------- Scripts (one per path) ----------
// `go` shows a step, waits, and ends the script quietly if the person stopped the Registration meanwhile.
const STOPPED = Symbol('stopped');
async function go(j, line, ms = 1500) { if (j.reg.outcome) throw STOPPED; await step(j, line); await sleep(ms); if (j.reg.outcome) throw STOPPED; }
const script = (fn) => (...a) => fn(...a).catch((e) => { if (e !== STOPPED) console.error('script', e); });

const press = script(async (j) => {
  j.reg.pressed = true; await go(j, STEP_TEXT.pressing(j.p.button));
  if (j.p.script === 'waitlist') { await go(j, 'Joined the waitlist', 0); return outcome(j, 'waitlisted'); }
  await go(j, STEP_TEXT.submitted, 4000);
  await go(j, STEP_TEXT.verified, 0); await outcome(j, 'registered');
});
const run = script(async (j) => {
  await go(j, STEP_TEXT.queued);
  await go(j, STEP_TEXT.filling(1), 3000);
  switch (j.p.script) {
    case 'botcheck': return wall(j, 'bot-check');
    case 'submittap': await go(j, STEP_TEXT.checking); await go(j, 'Check failed: Team size was preset by the page', 0); return submitTap(j);
    case 'amend':
      if (!j.reg.amended) {
        await go(j, 'Page 1 checked · pressed **Continue**'); await go(j, STEP_TEXT.filling(2), 2000);
        await go(j, 'Page 2 asks for a value and terms the Walkthrough lacks', 0); j.reg.amended = true; return amended(j);
      }
    // falls through when started again after the amended Walkthrough was approved
    default: await go(j, STEP_TEXT.checking); return press(j);
  }
});
const resumeAfterAmend = script(async (j) => { await go(j, STEP_TEXT.filling(2), 2000); await go(j, STEP_TEXT.checking); return press(j); });
const afterTakeover = script(async (j, submitted) => {
  if (submitted) { j.reg.pressed = true; await go(j, 'You submitted in the Takeover', 0); await go(j, STEP_TEXT.submitted, 3000); await go(j, STEP_TEXT.verified, 0); return outcome(j, 'registered'); }
  await go(j, 'Takeover ended: no account was made', 0); await go(j, STEP_TEXT.checking); return press(j);
});
async function startRegistration(j) {
  j.reg = { log: [], outcome: null, pressed: false };
  await setTags(j, 'Registering');
  run(j);
}

// ---------- Reply draft ----------
const replyHash = (j) => hash({ v: j.reply.version, b: j.reply.body });
function replyCard(j) {
  const d = j.reply, locked = d.state !== 'waiting';
  const lock = { approved: `-# ✅ Approved ${when(d.at)} · sent with drafts.send`, 'sent-by-you': `-# ✉️ Sent by you from Gmail ${when(d.at)}`, discarded: '-# Discarded' }[d.state];
  const ap = j.v === 'B' ? `p|rab|${j.id}|${replyHash(j)}` : `p|rap|${j.id}|${replyHash(j)}`;
  if (j.v === 'C') {
    const first = d.body.split('. ')[0];
    return [box(Accent.approval, t(`**Reply to Maya at ${j.p.name}** · v${d.version}${d.held ? ' · your text' : ''}`), t(`> ${first}…`),
      t('-# Full text in the thread · reply there to correct it'), lock ? t(lock) : null),
    ...(locked ? [] : [row(btn(ap, 'Approve', Style.Success), link('https://mail.google.com/mail/u/0/#drafts', 'Edit in Gmail'), link(threadUrl(j.m.home), 'Open thread'), btn(`p|rdi|${j.id}`, 'Discard'))])];
  }
  const text = j.v === 'B' && !d.full ? replyText(j).replace(d.body, `${d.body.split('. ')[0]}…`) : replyText(j);
  const buttons = j.v === 'B'
    ? [btn(ap, 'Approve', Style.Success), btn(`p|rsh|${j.id}`, d.full ? 'Hide' : 'Show all'), btn(`p|red|${j.id}`, 'Edit'), btn(`p|rco|${j.id}`, 'Correct'), btn(`p|rdi|${j.id}`, 'Discard')]
    : [btn(ap, 'Approve', Style.Success), btn(`p|red|${j.id}`, 'Edit'), btn(`p|rco|${j.id}`, 'Correct'), btn(`p|rdi|${j.id}`, 'Discard')];
  return [box(Accent.approval, t(text), lock ? t(lock) : null), ...(locked ? [] : [row(...buttons)])];
}
async function postReply(j) {
  j.reply = { version: 1, body: REPLY_V1, held: false, state: 'waiting', rules: 'Keep replies to founders under 80 words' };
  if (j.v === 'C') j.m.replyThread = await send(await home(j), msg(S.person, [box(Accent.progress, t(replyText(j)))]));
  j.m.reply = await send(await actionChannel(j), out(j, replyCard(j), { ping: true }));
}
async function renderReply(j, i) {
  if (j.v === 'C' && j.m.replyThread) await editMsg(j.m.replyThread, edit([box(Accent.progress, t(replyText(j)))]));
  if (i) await i.update(edit(replyCard(j))); else await editMsg(j.m.reply, edit(replyCard(j)));
}

// ---------- Proposed Rules ----------
function ruleCard(j, rule) {
  const r = rule.failed ? { ...rule, caseResult: "✗ didn't change the outcome on Quill CRM's stored page (0 of 3)" } : rule;
  const buttons = rule.failed
    ? [btn(`p|rw|${j.id}`, 'Reword', Style.Primary), btn(`p|rp|${j.id}`, 'Pick another item'), btn(`p|ru|${j.id}`, 'Keep as unproven'), btn(`p|rx|${j.id}`, 'Discard')]
    : [btn(`p|rk|${j.id}`, 'Keep', Style.Primary), btn(`p|re|${j.id}`, 'Edit'), btn(`p|rx|${j.id}`, 'Discard')];
  return [box(Accent.rule, t(ruleText(r)), r.state ? t(`-# ${r.state}`) : null), ...(r.state ? [] : [row(...buttons)])];
}
async function proposeRule(j, rule) {
  j.rule = rule;
  j.m.rule = await send(await actionChannel(j), out(j, ruleCard(j, rule), { ping: true }));
}

// ---------- /rules ----------
const RULES = [
  { scope: 'Registration', text: 'Leave marketing boxes unticked.', note: 'cited 4× this week' },
  { scope: 'Registration', text: 'When a form requires a company name, use "Personal".', note: '*unproven*: its case never failed without it' },
  { scope: 'Miner', text: 'A browser extension alone is not a Product I want.', note: '*shaky*: 2 of 3 on DeepSeek last week' },
  { scope: 'Reply draft', text: 'Keep replies to founders under 80 words.', note: 'cited 1× this week' },
];
function rulesList() {
  const by = {};
  RULES.forEach((r, n) => (by[r.scope] ??= []).push([r, n]));
  return [box(Accent.rule, t('## Rules · 4 of ~4k tokens in budget'), ...Object.entries(by).flatMap(([scope, rs]) => [
    t(`### ${scope}`),
    ...rs.flatMap(([r, n]) => [t(r.retired ? `~~${r.text}~~ · retired` : `${r.text}\n-# ${r.note}`),
      ...(r.retired ? [] : [row(btn(`p|lr|x|${n}`, 'Edit'), btn(`p|lx|x|${n}`, 'Retire', Style.Danger))])]),
  ]))];
}

// ---------- Modals ----------
const input = (custom_id, label, value, style = 1, max = 400) => ({ type: 18, label, component: { type: 4, custom_id, style, value, max_length: max, required: true } });
const modal = (custom_id, title, components) => ({ custom_id, title: title.slice(0, 45), components });
const correctModal = (id, title, warn) => modal(id, title, [...(warn ? [t(warn)] : []), input('text', 'What did it get wrong?', '', 2, 1000)]);
function fieldInput(f) {
  if (f.kind === 'choice') return { type: 18, label: f.label.slice(0, 45), component: { type: 21, custom_id: f.key, options: [{ label: 'left unticked', value: 'left unticked', default: f.value === 'left unticked' }, { label: 'ticked', value: 'ticked', default: f.value === 'ticked' }] } };
  return input(f.key, f.label.slice(0, 45), f.value);
}
function readModal(i, f) { return f.kind === 'choice' ? i.fields.getRadioGroup(f.key) : i.fields.getTextInputValue(f.key); }

// ---------- Interaction router ----------
const only = async (i) => {
  if (i.user.id === S.person) return true;
  await i.reply({ content: 'Only the person can act here.', flags: EPHEMERAL }); return false;
};
const say = (i, content) => i.reply({ content, flags: EPHEMERAL });

async function onButton(i) {
  const [, act, id, arg] = i.customId.split('|');
  if (act === 'lr') { const r = RULES[arg]; return i.showModal(modal(`m|lre|x|${arg}`, `Edit Rule (${r.scope})`, [input('text', 'Rule', r.text, 2)])); }
  if (act === 'lx') { RULES[arg].retired = true; return i.update(edit(rulesList())); }
  const j = S.journeys.get(id);
  if (!j) return say(i, 'This prototype restarted, so that message is stale. Post the variant again from #proto-control.');
  switch (act) {
    case 'ap': {
      if (j.wt === 'approved') return say(i, `Already approved ${when(j.approvedAt)}.`);
      if (arg !== wtHash(j)) return i.reply({ flags: EPHEMERAL | V2, components: [t(`That was an older version. v${j.version} is current:`), ...wtCard(j).slice(0, 1)] });
      if (j.v === 'B' && !j.reg) {
        return i.showModal(modal(`m|bap|${j.id}|${arg}`, `Approve ${j.p.name}?`, [t(consequence(j)),
          { type: 18, label: 'Confirm', component: { type: 22, custom_id: 'ok', required: true, min_values: 1, max_values: 1, options: [{ value: 'yes', label: `Create the account at ${j.p.name}`.slice(0, 100), description: `as ${email(j)}, accepting its terms`.slice(0, 100) }] } }]));
      }
      return approve(j, i);
    }
    case 'ed': {
      if (j.v === 'A') { const f = j.fields.find((x) => x.key === arg); return i.showModal(modal(`m|edf|${j.id}|${arg}`, `Edit · ${f.label}`, [fieldInput(f)])); }
      return i.showModal(modal(`m|eda|${j.id}`, `Edit · ${j.p.name} v${j.version}`, j.fields.filter((f) => f.editable).slice(0, 5).map(fieldInput)));
    }
    case 'ea': return i.showModal(modal(`m|eam|${j.id}`, `Edit · ${j.p.name} v${j.version}`, j.p.amend.added.map((a) => fieldInput(j.fields.find((f) => f.key === a.key)))));
    case 'co': return i.showModal(correctModal(`m|cor|${j.id}`, `Correct · ${j.p.name} Walkthrough`));
    case 'di': j.wt = 'dismissed'; return renderWt(j, i);
    case 'dt': j.details = !j.details; return renderWt(j, i);
    case 'pa': j.wt = 'waiting'; j.readAt = Date.now(); j.version += 1; j.edited = 'Re-read the signup page; nothing changed'; return renderWt(j, i);
    case 'st': {
      if (j.reg?.pressed) return say(i, 'Too late to stop: the final button was already pressed.');
      await closeAction(j, `stopped ${when()}`, i.message.id === j.m.action?.id ? i : null);
      if (!i.replied) await i.deferUpdate();
      j.reg.log.push('Stopped by you'); return outcome(j, 'abandoned');
    }
    case 'sa': await i.deferUpdate(); j.reg.log.push('Started again (same Registration)'); j.reg.outcome = null; await setTags(j, 'Registering'); return run(j);
    case 'tk': {
      await setTags(j, 'Needs you');
      return i.update(edit([box(Accent.needs, t(`### Take over ${j.p.name}`), t('Open the browser, get past the wall, then come back here.\n-# The link works until you tap Continue or I submitted, or for 24 hours.')),
        row(link(`${TAILNET}/take/${j.id}?t=${j.token}`, 'Open the browser'), btn(`p|cn|${j.id}`, 'Continue · no account made'), btn(`p|is|${j.id}`, 'I submitted', Style.Success))]));
    }
    case 'cn': await closeAction(j, `took over · continued ${when()}`, i); return afterTakeover(j, false);
    case 'is': await closeAction(j, `took over · you submitted ${when()}`, i); return afterTakeover(j, true);
    case 'ho': j.reg.log.push('Handed off to you'); await i.update(edit([box(Accent.needs, t(handoffText(j))), row(link(`https://${j.p.host}/signup`, 'Open signup page'), btn(`p|dn|${j.id}`, 'Done', Style.Success))])); return outcome(j, 'handed off');
    case 'dn': await closeAction(j, `handed off · done ${when()}`, i); j.reg.log.push('You finished it'); return outcome(j, 'registered');
    case 'sub': {
      if (Number(arg) !== j.pageShot) { await say(i, 'The page changed since that screenshot, so nothing was pressed. Here is the new one.'); j.shot = j.pageShot; return submitTap(j); }
      await closeAction(j, `you tapped Submit ${when()}`, i); return press(j);
    }
    case 'iv': await closeAction(j, `you verified ${when()}`, i); return;
    // Reply draft
    case 'rap': case 'rab': {
      if (j.reply.state !== 'waiting') return say(i, `Already ${j.reply.state} ${when(j.reply.at)}.`);
      if (arg !== replyHash(j)) return say(i, 'That was an older version of the draft; the message now shows the current one.');
      if (act === 'rab') return i.showModal(modal(`m|brp|${j.id}|${arg}`, 'Send this reply?', [t(`Sends v${j.reply.version} from \`you@gmail.com\` to \`maya@${j.p.domain}\`, exactly as shown.`),
        { type: 18, label: 'Confirm', component: { type: 22, custom_id: 'ok', required: true, min_values: 1, max_values: 1, options: [{ value: 'yes', label: 'Send it' }] } }]));
      j.reply.state = 'approved'; j.reply.at = Date.now(); return renderReply(j, i);
    }
    case 'rsh': j.reply.full = !j.reply.full; return renderReply(j, i);
    case 'red': return i.showModal(modal(`m|red|${j.id}`, 'Edit Reply draft', [input('body', 'Body', j.reply.body, 2, 4000)]));
    case 'rco': return i.showModal(correctModal(`m|rco|${j.id}`, 'Correct · Reply draft', j.reply.held ? '**This replaces your edits.**' : null));
    case 'rdi': j.reply.state = 'discarded'; return renderReply(j, i);
    case 'rrd': await closeAction(j, `redrafted ${when()}`, i); j.reply.held = false; j.reply.version += 1; j.reply.body = `${REPLY_V1} (Redrafted after Maya's new mail.)`; j.reply.state = 'waiting'; return renderReply(j);
    // Proposed Rule
    case 'rk': j.rule.state = `Kept ${when()} · rules/registration/company-name.md`; return i.update(edit(ruleCard(j, j.rule)));
    case 'ru': j.rule.state = `Kept as *unproven* ${when()}`; return i.update(edit(ruleCard(j, j.rule)));
    case 'rx': j.rule.state = `Discarded ${when()} · the Correction still fixed its item`; return i.update(edit(ruleCard(j, j.rule)));
    case 're': case 'rw': return i.showModal(modal(`m|rue|${j.id}`, 'Edit proposed Rule', [input('text', 'Rule', j.rule.text, 2)]));
    case 'rp': j.rule.caseText = "replayed Birch Docs' stored page with a required Company field"; j.rule.failed = false; j.rule.caseResult = '✓ 3 of 3 on both providers'; return i.update(edit(ruleCard(j, j.rule)));
  }
}

async function approve(j, i) {
  j.wt = 'approved'; j.approvedAt = Date.now(); j.approvedVersion = j.version;
  if (j.reg) { // an amended Walkthrough, mid-Registration
    await closeAction(j, `approved v${j.version} ${when()}`, i);
    await step(j, `Amended Walkthrough v${j.version} approved`);
    return resumeAfterAmend(j);
  }
  if (j.v === 'B') { await i.deferUpdate(); return startRegistration(j); }
  if (j.v === 'C') await i.update(edit([box(Accent.progress, t(`-# ✅ ${j.p.name} · v${j.version} approved ${when()} · progress in <#${j.m.home}>`))]));
  else await renderWt(j, i);
  return startRegistration(j);
}

async function onModal(i) {
  const [, kind, id, arg] = i.customId.split('|');
  if (kind === 'lre') { RULES[arg].text = i.fields.getTextInputValue('text'); RULES[arg].note = '*edited*: its case re-runs now'; return i.update(edit(rulesList())); }
  const j = S.journeys.get(id);
  if (!j) return say(i, 'This prototype restarted; post the variant again.');
  switch (kind) {
    case 'bap': if (arg !== wtHash(j)) return say(i, 'The Walkthrough changed while the confirm was open; nothing was approved.'); return approve(j, i);
    case 'edf': case 'eda': case 'eam': {
      const changed = [];
      for (const f of j.fields.filter((x) => x.editable)) {
        const v = (() => { try { return readModal(i, f); } catch { return undefined; } })();
        if (v !== undefined && v !== f.value) { changed.push(`${f.label}: ${v}`); f.value = v; }
      }
      if (!changed.length) return i.deferUpdate();
      j.version += 1;
      if (kind === 'eam') { await closeAction(j, `amended Walkthrough replaced by v${j.version}`, i); return reAmend(j); }
      j.edited = `Edited by you: ${changed.join(' · ')}`;
      return renderWt(j, i); // the person is looking at it: same message, new version, fresh Approve
    }
    case 'cor': {
      j.correcting = true; await renderWt(j, i);
      await sleep(3000);
      return newVersion(j, `Corrected: “${i.fields.getTextInputValue('text')}”`).then(() => sleep(2500)).then(() => proposeRule(j, { ...RULE, from: `${j.p.name} (Walkthrough v${j.version - 1})` }));
    }
    case 'red': j.reply.body = i.fields.getTextInputValue('body'); j.reply.version += 1; j.reply.held = false; return renderReply(j, i);
    case 'rco': await i.deferUpdate(); await sleep(2500); j.reply.version += 1; j.reply.held = false; j.reply.body = `${REPLY_V1.split('. ').slice(0, 2).join('. ')}. (Corrected: ${i.fields.getTextInputValue('text')})`; return renderReply(j);
    case 'brp': j.reply.state = 'approved'; j.reply.at = Date.now(); return renderReply(j, i);
    case 'rue': j.rule.text = i.fields.getTextInputValue('text'); j.rule.failed = false; return i.update(edit(ruleCard(j, j.rule)));
  }
}
async function reAmend(j) { // re-show the amended Walkthrough after the person edited its new values
  await needsYou(j, [box(Accent.approval, t(amendText(j).replace(/^### (.*)$/m, '### $1 · edited by you'))), row(btn(`p|ap|${j.id}|${wtHash(j)}`, 'Approve', Style.Success), btn(`p|ea|${j.id}`, 'Edit'), btn(`p|st|${j.id}`, 'Stop', Style.Danger))]);
}

// ---------- Control actions ----------
async function postVariant(v) {
  for (const slug of ORDER) { const j = newJourney(v, slug); await place(j); await postWalkthrough(j); await sleep(400); }
}
async function resetAll() {
  S.journeys.clear();
  if (S.ch.forum) for (const th of (await S.ch.forum.threads.fetchActive()).threads.values()) if (th.parentId === S.ch.forum.id) await th.delete().catch(() => {});
  for (const ch of [S.ch.inbox, S.ch.products]) {
    const ms = await ch.messages.fetch({ limit: 100 });
    for (const m of ms.values()) { if (m.hasThread) await m.thread.delete().catch(() => {}); await m.delete().catch(() => {}); }
  }
  const dms = await S.dm.messages.fetch({ limit: 100 });
  for (const m of dms.values()) if (m.author.id === client.user.id) await m.delete().catch(() => {});
}
async function simulate(kind) {
  const v = S.simVariant;
  const need = (pred, what) => { const j = latest(v, pred); if (!j) throw new Error(`No ${what} in variant ${v} yet: post it first.`); return j; };
  switch (kind) {
    case 'expire': { const j = need((x) => x.wt === 'waiting' && !x.reg, 'unanswered Walkthrough'); j.wt = 'expired'; return renderWt(j); }
    case 'correct-rule': { const j = need((x) => x.p.slug === 'tessellate', 'Tessellate'); return proposeRule(j, { ...RULE }); }
    case 'rule-fail': { const j = need((x) => x.p.slug === 'tessellate', 'Tessellate'); return proposeRule(j, { ...RULE, failed: true }); }
    case 'page-changed': { const j = need((x) => x.p.slug === 'quillcrm' && x.m.action, 'Quill CRM Submit tap'); j.pageShot = 2; return; }
    case 'still-showing': { const j = need((x) => x.reg && !x.reg.outcome, 'running Registration'); return wall(j, 'still-showing'); }
    case 'verify-nudge': {
      const j = need((x) => x.reg, 'Registration');
      return needsYou(j, [box(Accent.needs, t(`### Verify ${j.p.name} in Gmail`), t(`The verification mail came from \`notify@mailer-relay.example\`, not ${j.p.domain}, so the Assistant won't open its link. Tap it in Gmail yourself.`)),
        row(link('https://mail.google.com/mail/u/0/#inbox', 'Open Gmail'), btn(`p|iv|${j.id}`, 'I verified', Style.Success))]);
    }
    case 'abandon': { const j = need((x) => x.reg && !x.reg.outcome && !x.reg.pressed, 'Registration before its final press'); await closeAction(j, 'closed after 24 h'); j.reg.log.push('Nothing final pressed in 24 h'); return outcome(j, 'abandoned'); }
    case 'gmail-edit': { const j = need((x) => x.reply?.state === 'waiting', 'waiting Reply draft'); j.reply.body = REPLY_GMAIL; j.reply.held = true; j.reply.version += 1; return renderReply(j); }
    case 'gmail-sent': { const j = need((x) => x.reply?.state === 'waiting', 'waiting Reply draft'); j.reply.state = 'sent-by-you'; j.reply.at = Date.now(); return renderReply(j); }
    case 'new-mail': {
      const j = need((x) => x.reply?.held, 'Reply draft you hold (simulate the Gmail edit first)');
      return needsYou(j, [box(Accent.needs, t(`### Maya wrote again in a thread you hold`), t('-# Your draft is unchanged. Redraft replaces it with a new one that answers both mails.')),
        row(btn(`p|rrd|${j.id}`, 'Redraft', Style.Primary))]);
    }
  }
}
async function pushCheck(kind) {
  const ch = S.ch.control;
  if (kind === 'push-edit') {
    const m = await ch.send(msg(S.person, [box(Accent.info, t('Edit check: this message is silent now. In 10 s it gets an @mention by edit.'))]));
    await sleep(10000);
    return m.edit({ flags: V2, components: [t(`<@${S.person}>`), box(Accent.info, t('Edit check: @mention added by edit. Did a push arrive?'))], allowedMentions: { users: [S.person] } });
  }
  await sleep(10000);
  if (kind === 'push-plain') return ch.send({ content: `<@${S.person}> Push check: a plain-text message. What did the lock screen show?`, allowedMentions: { users: [S.person] } });
  if (kind === 'push-silent') return ch.send(msg(S.person, [box(Accent.info, t('Push check: a silent V2 message. Did anything arrive?'))]));
  return ch.send(msg(S.person, [box(Accent.approval, t('### Register at Inkwell? · v1'), t('Push check: a Components V2 message with an @mention. What did the lock screen show?'))], { ping: true }));
}

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand() && i.commandName === 'rules') return i.reply({ flags: V2, components: rulesList(), allowedMentions: { parse: [] } });
    if (!(await only(i))) return;
    if (i.isStringSelectMenu()) {
      const [, what] = i.customId.split('|'), val = i.values[0];
      if (what === 'simv') { S.simVariant = val; return i.update(controlPayload()); }
      await i.update(controlPayload());
      return (what === 'sim' ? simulate(val) : pushCheck(val)).catch((e) => S.ch.control.send({ content: `⚠️ ${e.message}` }));
    }
    if (i.isButton() && i.customId.startsWith('c|')) {
      const [, act, v] = i.customId.split('|');
      await i.deferUpdate();
      if (act === 'reset') return resetAll();
      return postVariant(v);
    }
    if (i.isButton()) return await onButton(i);
    if (i.isModalSubmit()) return await onModal(i);
  } catch (e) {
    console.error(e);
    if (i.isRepliable() && !i.replied && !i.deferred) await i.reply({ content: `⚠️ ${e.message}`, flags: EPHEMERAL }).catch(() => {});
  }
});

// Variant C: a free-text reply in a Product's thread is a Correction of the item waiting there.
client.on(Events.MessageCreate, async (m) => {
  if (m.author.id !== S.person || !m.channel.isThread()) return;
  const j = [...S.journeys.values()].find((x) => x.v === 'C' && x.m.home === m.channelId);
  if (!j) return;
  if (!CONTENT) return m.reply({ content: "Message Content Intent is off, so I can't read this Correction yet.", allowedMentions: { parse: [] } });
  if (j.reply?.state === 'waiting') {
    await m.react('✎').catch(() => m.react('📝'));
    await sleep(2500); j.reply.version += 1; j.reply.held = false;
    j.reply.body = `${REPLY_V1.split('. ').slice(0, 2).join('. ')}. (Corrected: ${m.content})`; return renderReply(j);
  }
  if (j.wt === 'waiting' && !j.reg) {
    await m.react('📝'); j.correcting = true; await renderWt(j); await sleep(3000);
    await newVersion(j, `Corrected: “${m.content}”`); await sleep(2500);
    return proposeRule(j, { ...RULE, from: `${j.p.name} (Walkthrough v${j.version - 1})` });
  }
  return m.reply({ content: 'Nothing is waiting in this thread to correct.', allowedMentions: { parse: [] } });
});

// ---------- Tailnet pages: the Takeover stand-in and variant C's Edit page ----------
const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:17px -apple-system,sans-serif;margin:0;padding:20px;max-width:560px;color:#111;background:#fafafa}label{display:block;font-weight:600;margin:14px 0 4px}input,select{width:100%;font-size:17px;padding:10px;box-sizing:border-box;border:1px solid #ccc;border-radius:8px}button{margin-top:20px;width:100%;padding:14px;font-size:17px;background:#2563eb;color:#fff;border:0;border-radius:8px}.m{color:#666;font-size:14px}code{font-size:13px}</style>${body}`;
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), [, kind, id] = u.pathname.split('/'), j = S.journeys.get(id);
  console.log(new Date().toISOString(), req.method, u.pathname, 'UA:', req.headers['user-agent']);
  if (!j || u.searchParams.get('t') !== j.token) { res.writeHead(404); return res.end('Not found'); }
  const ua = String(req.headers['user-agent'] ?? '').replace(/</g, '&lt;');
  if (kind === 'take') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(page('Take over', `<h2>Take over · ${j.p.name}</h2><p>Here the noVNC view of this Registration's browser would open (see #21). This stand-in only checks how a tailnet link opens from Discord on the iPhone.</p><p class="m">Opened in: <code>${ua}</code></p><p>Go back to Discord and tap <b>Continue</b> or <b>I submitted</b>.</p>`));
  }
  if (kind === 'edit' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html' });
    const inputs = j.fields.filter((f) => f.editable).map((f) => (f.kind === 'choice'
      ? `<label>${f.label}</label><select name="${f.key}">${['left unticked', 'ticked'].map((o) => `<option${o === f.value ? ' selected' : ''}>${o}</option>`).join('')}</select>`
      : `<label>${f.label}</label><input name="${f.key}" value="${f.value.replace(/"/g, '&quot;')}">`)).join('');
    const fixed = j.fields.filter((f) => !f.editable).map((f) => `<p class="m">${fieldLine(f).replace(/\*\*|`/g, '')}</p>`).join('');
    return res.end(page('Edit Walkthrough', `<h2>${j.p.name} · Walkthrough v${j.version}</h2><form method="post">${inputs}${fixed}<button>Save as v${j.version + 1}</button></form><p class="m">Saving doesn't approve. Approve the new version in Discord. Opened in: <code>${ua}</code></p>`));
  }
  if (kind === 'edit' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    const form = new URLSearchParams(body), changed = [];
    for (const f of j.fields.filter((x) => x.editable)) { const v = form.get(f.key); if (v != null && v !== f.value) { changed.push(`${f.label}: ${v}`); f.value = v; } }
    res.writeHead(200, { 'content-type': 'text/html' });
    if (!changed.length) return res.end(page('No change', '<p>Nothing changed. Go back to Discord.</p>'));
    await newVersion(j, `Edited by you on the tailnet page: ${changed.join(' · ')}`);
    return res.end(page('Saved', `<h2>Saved as v${j.version}</h2><p>Go back to Discord: the new version is in #c-inbox with a fresh Approve.</p>`));
  }
  res.writeHead(404); res.end('Not found');
}).listen(HTTP_PORT, '127.0.0.1');

client.once(Events.ClientReady, async () => {
  const guild = client.guilds.cache.first();
  if (!guild) { console.log('Not in a server yet: invite the bot, then restart.'); return; }
  await setup(await guild.fetch());
  console.log(`Ready as ${client.user.tag} in ${guild.name}; control in #proto-control; tailnet pages on ${TAILNET}`);
});
client.on(Events.GuildCreate, async (g) => { if (!S.guild) await setup(await g.fetch()); });
// Community turned on while running: create variant A's forum and enable Post A.
client.on(Events.GuildUpdate, async (_old, g) => { if (S.guild && !S.ch.forum && g.features.includes('COMMUNITY')) { await setup(await g.fetch()); console.log('Community on: forum created'); } });
client.login(TOKEN);
