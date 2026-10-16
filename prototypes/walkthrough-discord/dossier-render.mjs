// PROTOTYPE, throwaway: renders one Dossier three ways for Discord (A, B, C) and three ways for git (1, 2, 3), for lab1 #33.
// Every variant draws on the same claims, so they differ only in layout. Not production code.
import { SOURCE_NAMES, INTEREST, READ_AT } from './dossiers.mjs';
import { t, sep, box, sec, row, btn, link, Style, Accent } from './kit.mjs';

export const GIT_BASE = 'https://github.com/ultrasadness/lab1/blob/prototype/dossier-discord/prototypes/walkthrough-discord/dossier-git';
export const gitPaths = (p) => ({
  1: `1-one-file/products/${p.domain}.md`,
  2: `2-folder/products/${p.domain}/dossier.md`,
  3: `3-by-date/dossiers/${p.launches[0].day}-${p.domain}.md`,
});

// ---------- Claims, in reading order ----------
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n) => String(n).split('').map((d) => SUP[d]).join('');
const srcName = (k) => (k === 'L2' ? 'new Launch' : SOURCE_NAMES[k]);
const srcUrl = (p, k) => p.src[k] ?? null;
const latest = (p) => p.launches.at(-1);
const STATE = { open: 'Open', waitlisted: 'Waitlisted', 'no account': 'No account needed' };

export function offerText(o) {
  const needs = o.needs.length ? ` · *${o.needs.join(' · ')}*` : '';
  if (o.fromYou) return `**From you:** ${o.what}${needs}`;
  return `${o.yours ? '**Yours to act on:** ' : ''}${o.what}${needs}`;
}
export const NO_OFFER = (p) => `none in the Launch text or on the site. The [Launch page](${p.src.L}) may show a promo.`;
const launchText = (l, url) => `[${l.label}](${url}) · fit ${l.fit} · #${l.rank} of ${l.of}${l.stub ? ' (stub)' : ''}`;

export function claims(p) {
  const out = [
    { label: 'Register', ...p.register },
    { label: 'What it is', ...p.what },
    { label: 'For you', ...p.use },
  ];
  for (const o of p.offers) out.push({ label: 'Offer', offer: o, text: offerText(o), src: o.src });
  if (p.note) out.push({ label: 'Note', ...p.note });
  return out;
}

// Footnotes number the sources a Dossier uses in a fixed order, so ¹ is always the Launch (cited for attribution).
const KINDS = ['L', 'L2', 'M', 'S', 'P', 'U', 'I'];
function numbering(p) {
  const used = new Set(['L', ...(p.src.L2 ? ['L2'] : []), ...claims(p).flatMap((c) => c.src)]);
  return KINDS.filter((k) => used.has(k));
}
const cite = (order, src) => (src.length ? [...src].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((k) => sup(order.indexOf(k) + 1)).join(' ') : '');

function headLine(p) {
  const l = latest(p);
  const count = p.offers.length;
  const offers = count ? ` · ${count} Offer${count === 1 ? '' : 's'}` : '';
  const wt = p.walkthrough ? '' : ' · no Walkthrough';
  return `**${STATE[p.state]}** · fit ${l.fit} · ${l.label}${offers}${wt}`;
}
const walkHint = (p) => (p.walkthrough ? (p.tag === 'Walkthrough' ? ' Walkthrough in #needs-you.' : '') : '');
const corrected = (p) => (p.correction ? `\n-# v${p.version} · after your Correction ${p.correction.at}: “${p.correction.text}” · stub: nothing was re-checked` : '');
const rejudging = (p) => (p.rejudging ? '\n-# ✎ re-checking after your Correction…' : '');
const addedNote = (p) => (p.offers.some((o) => o.fromYou)
  ? `\n-# Offer added by you ${p.offers.filter((o) => o.fromYou).at(-1).at}: a Walkthrough already approved would need a new Approval to use it.` : '');
const footerLine = (p) => `-# Rules applied: none · read ${READ_AT} · Data sourced from [Product Hunt](${p.src.L})`;
const actions = (id, p) => row(
  btn(`x|ao|${id}`, 'Add Offer', Style.Secondary, !!p.rejudging),
  btn(`x|co|${id}`, 'Correct', Style.Secondary, !!p.rejudging),
);

// ---------- Variant A: one card, footnoted ----------
export function renderA(p, id) {
  const order = numbering(p);
  const cs = claims(p);
  const line = (c) => `**${c.label}:** ${c.text}${cite(order, c.src)}`;
  const offers = cs.filter((c) => c.offer);
  const offerBlock = offers.length
    ? `**Offers**\n${offers.map((c) => `- ${c.text}${cite(order, c.src)}`).join('\n')}`
    : `**Offers:** ${NO_OFFER(p)}`;
  const body = [
    `## ${p.name} · ${p.tagline}`,
    headLine(p),
    `${line(cs[0])}${walkHint(p)}`,
    line(cs[1]),
    line(cs[2]),
    offerBlock,
    ...cs.filter((c) => c.label === 'Note').map(line),
    `**Launches:** ${p.launches.map((l, i) => launchText(l, i ? p.src.L2 : p.src.L)).join(' · ')}`,
  ].join('\n');
  const notes = order.map((k, i) => `${sup(i + 1)} ${srcUrl(p, k) ? `[${srcName(k)}](${srcUrl(p, k)})` : `your ${srcName(k)}`}`).join(' · ');
  return [box(Accent.info, t(body + corrected(p) + addedNote(p) + rejudging(p)), t(`-# ${notes}\n${footerLine(p)}`)), actions(id, p)];
}

// ---------- Variant B: a row per claim, its source as a button beside it ----------
export function renderB(p, id) {
  const cs = claims(p);
  let n = 0;
  const srcBtn = (k) => (srcUrl(p, k) ? link(srcUrl(p, k), `${srcName(k)} ↗`) : btn(`x|nb|${id}|${n++}`, `Your ${srcName(k)}`, Style.Secondary, true));
  const also = (src) => (src.length > 1 ? `\n-# also ${src.slice(1).map((k) => (srcUrl(p, k) ? `[${srcName(k)}](${srcUrl(p, k)})` : `your ${srcName(k)}`)).join(' · ')}` : '');
  const claimRow = (label, c, extra = '') => sec(`**${label}** · ${c.text}${extra}${also(c.src)}`,
    c.src.length ? srcBtn(c.src[0]) : btn(`x|nb|${id}|${n++}`, 'From you', Style.Secondary, true));
  const offers = cs.filter((c) => c.offer);
  return [box(Accent.info,
    t(`## ${p.name} · ${p.tagline}\n${headLine(p)}`),
    sep(),
    claimRow('Register', cs[0], walkHint(p)),
    claimRow('What it is', cs[1]),
    claimRow('For you', cs[2]),
    sep(),
    offers.length ? offers.map((c) => claimRow('Offer', c)) : sec(`**Offers** · ${NO_OFFER(p)}`, srcBtn('L')),
    cs.filter((c) => c.label === 'Note').map((c) => claimRow('Note', c)),
    sep(),
    p.launches.map((l, i) => sec(`**${i ? 'Launched again' : 'Launched'}** · ${launchText(l, i ? p.src.L2 : p.src.L)}`, srcBtn(i ? 'L2' : 'L'))),
    t(`${(corrected(p) + addedNote(p) + rejudging(p)).trim()}\n${footerLine(p)}`.trim())),
  actions(id, p)];
}

// ---------- Variant C: a short verdict, the full Dossier in git ----------
const firstSentence = (s) => { const m = s.match(/^(.+?[.;])(\s|$)/); return m ? m[1].replace(/;$/, '.') : s; };
export function renderC(p, id) {
  const cs = claims(p);
  const inl = (src) => ` ${src.map((k) => (srcUrl(p, k) ? `[${SHORT[k] ?? srcName(k)}](${srcUrl(p, k)})` : `*(${srcName(k)})*`)).join(' ')}`;
  const offers = cs.filter((c) => c.offer);
  const offer = offers.length
    ? `**Offer:** ${offers[0].text}${inl(offers[0].src)}${offers.length > 1 ? ` · +${offers.length - 1} more in the full Dossier` : ''}`
    : `**Offers:** ${NO_OFFER(p)}`;
  return [box(Accent.info,
    t([
      `## ${p.name} · ${p.tagline}`,
      headLine(p),
      `${p.gist.text}${inl(p.gist.src)}`,
      `${firstSentence(cs[0].text)}${inl(cs[0].src.slice(0, 1))}${walkHint(p)}`,
      offer,
    ].join('\n') + corrected(p) + addedNote(p) + rejudging(p)),
    t(`-# Every claim, with what its source said, is in the full Dossier in git.\n${footerLine(p)}`)),
  row(link(`${GIT_BASE}/${gitPaths(p)[1]}`, 'Full Dossier ↗'),
    btn(`x|ao|${id}`, 'Add Offer', Style.Secondary, !!p.rejudging),
    btn(`x|co|${id}`, 'Correct', Style.Secondary, !!p.rejudging))];
}
const SHORT = { L: 'Launch', M: 'Maker', S: 'site', P: 'pricing', U: 'signup', L2: 'new Launch' };

export const RENDER = { A: renderA, B: renderB, C: renderC };

// ---------- What Discord limits ----------
export function stats(components) {
  let n = 0, chars = 0, urls = 0;
  const walk = (cs) => {
    for (const c of cs) {
      n++;
      if (c.type === 10) { chars += c.content.length; urls += (c.content.match(/\]\((https?:[^)]+)\)/g) ?? []).reduce((a, m) => a + m.length - 3, 0); }
      if (c.components) walk(c.components);
      if (c.accessory) walk([c.accessory]);
    }
  };
  walk(components);
  return { n, chars, urls };
}

// ---------- Git: three layouts of the same Dossier ----------
// Sources are numbered as in variant A. GitHub footnotes are not used: GitHub moves them below everything, Notes included.
const interestQuote = (p) => p.use.interest.map((k) => `“${INTEREST[k]}”`).join(' ');
function footnotes(p) {
  return numbering(p).map((k, i) => {
    if (k === 'I') return `- ${sup(i + 1)} Interest scope, \`profile/interest-scope.md\`: ${interestQuote(p)}`;
    const when = k === 'L' ? `, ${p.launches[0].label}, 2026` : k === 'L2' ? `, ${p.launches[1].label}, 2026` : '';
    const name = k === 'L' ? 'Launch on Product Hunt' : k === 'L2' ? 'Re-Launch on Product Hunt' : srcName(k)[0].toUpperCase() + srcName(k).slice(1);
    return `- ${sup(i + 1)} [${name}](${srcUrl(p, k)})${when}: “${p.quotes[k]}”`;
  }).join('\n');
}
function dossierMd(p, { quotes, title = true }) {
  const cs = claims(p);
  const order = numbering(p);
  const c = (x) => (quotes ? cite(order, x.src) : ` (${x.src.map((k) => (srcUrl(p, k) ? `[${srcName(k)}](${srcUrl(p, k)})` : `your ${srcName(k)}`)).join(', ')})`);
  const offers = cs.filter((x) => x.offer);
  return [
    title ? `# ${p.name} · ${p.tagline}\n` : null,
    `${headLine(p)} · \`${p.domain}\``,
    '',
    `**Register:** ${cs[0].text}${c(cs[0])}`,
    '',
    `**What it is:** ${cs[1].text}${c(cs[1])}`,
    '',
    `**For you:** ${cs[2].text}${c(cs[2])}`,
    '',
    offers.length ? `**Offers**\n\n${offers.map((x) => `- ${x.text}${c(x)}`).join('\n')}` : `**Offers:** ${NO_OFFER(p)}`,
    ...cs.filter((x) => x.label === 'Note').map((x) => `\n**Note:** ${x.text}${c(x)}`),
    '',
    `**Launches:** ${p.launches.map((l, i) => launchText(l, i ? p.src.L2 : p.src.L)).join(' · ')}`,
    '',
    `<sub>Rules applied: none · read ${READ_AT} · Data sourced from [Product Hunt](${p.src.L})</sub>`,
  ].filter((x) => x !== null).join('\n');
}
const historyLines = (p, withName = false) => (p.history.length
  ? p.history.map(([at, what]) => `- ${at} · ${withName ? `**${p.name}** · ` : ''}${what}`).join('\n')
  : (p.walkthrough ? '- (none yet: the Walkthrough waits for your Approval)' : '- (none: nothing to register)'));
const SAMPLE_NOTE = { inferock: '- Try Watch on the Codex key first. *(Sample note, written by the prototype in place of yours.)*' };
const notesBody = (p) => SAMPLE_NOTE[p.key] ?? '';

export function gitFiles(products) {
  const files = {};
  for (const p of products) {
    // 1: one file per Product, holding more than the message: what each source said, the Registration, your notes.
    files[gitPaths(p)[1]] = [
      dossierMd(p, { quotes: true }),
      '',
      '## Sources',
      '',
      footnotes(p),
      '',
      '## Registration',
      '',
      '<!-- Written by the bot at milestones from the live store. Edits here are not read back. -->',
      historyLines(p),
      '',
      '## Notes',
      '',
      '<!-- Yours. The bot keeps everything below this line as it is. -->',
      notesBody(p),
      '',
    ].join('\n');
    // 2: a folder per Product, one file per writer; the Dossier mirrors the Discord message.
    const dir = `2-folder/products/${p.domain}`;
    files[`${dir}/dossier.md`] = `${dossierMd(p, { quotes: false })}\n\n<sub>The bot rewrites this file whenever the Dossier changes. [Registration](registration.md) · [Notes](notes.md)</sub>\n`;
    files[`${dir}/registration.md`] = `# ${p.name} · Registration\n\n<!-- Appended by the bot at milestones from the live store. Edits here are not read back. -->\n${historyLines(p)}\n`;
    files[`${dir}/notes.md`] = `# ${p.name} · Notes\n\n<!-- Yours. The bot created this file once and never writes to it again. -->\n${notesBody(p)}\n`;
  }
  // 3: by date: a Dossier file per Launch day, one Registration log for every Product, notes per Product.
  for (const p of products) {
    const notesLink = `../notes/${p.domain}.md`;
    p.launches.forEach((l, i) => {
      const asOf = { ...p, launches: p.launches.slice(0, i + 1), offers: p.offers.filter((o) => (i ? true : !o.src.includes('L2'))), src: i ? p.src : { ...p.src, L2: undefined } };
      const earlier = i ? `\n\n<sub>Re-Launch of \`${p.domain}\`. Earlier Dossier: [${p.launches[0].label}](${p.launches[0].day}-${p.domain}.md).</sub>` : '';
      const later = !i && p.launches.length > 1 ? `\n\n<sub>Launched again: [${p.launches[1].label}](${p.launches[1].day}-${p.domain}.md).</sub>` : '';
      files[`3-by-date/dossiers/${l.day}-${p.domain}.md`] = [
        `${dossierMd(asOf, { quotes: true })}${earlier}${later}`,
        '',
        '## Sources',
        '',
        footnotes(asOf),
        '',
        `<sub>Registration: [registrations.md](../registrations.md) · Notes: [notes/${p.domain}.md](${notesLink})</sub>`,
        '',
      ].join('\n');
    });
    files[`3-by-date/notes/${p.domain}.md`] = `# ${p.name} · Notes\n\n<!-- Yours. The bot never writes here. -->\n${notesBody(p)}\n`;
  }
  const log = products.flatMap((p) => p.history.map(([at, what]) => ({ at, line: `- ${at} · **${p.name}** · ${what}` })));
  const order = (s) => { const [m, d, hm] = s.match(/(\w+) (\d+), (\d+:\d+)/).slice(1); return `${m === 'Nov' ? 11 : 10}-${d.padStart(2, '0')} ${hm}`; };
  log.sort((a, b) => order(a.at).localeCompare(order(b.at)));
  files['3-by-date/registrations.md'] = `# Registrations\n\n<!-- Appended by the bot at milestones from the live store, every Product in one log. Edits here are not read back. -->\n${log.map((x) => x.line).join('\n')}\n`;
  return files;
}
