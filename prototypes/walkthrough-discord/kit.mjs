// PROTOTYPE, throwaway: component helpers, fixture Products and the content every variant shares.
// Answers "How should a Walkthrough and its Approval look on Discord?" (lab1 #12). Not production code.
import { createHash } from 'node:crypto';

// ---------- Components V2 helpers (raw API JSON) ----------
export const V2 = 1 << 15;
export const SILENT = 1 << 12;
export const EPHEMERAL = 1 << 6;
export const Style = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 };
export const Accent = { approval: 0xe8a33d, needs: 0xed4245, progress: 0x4f545c, done: 0x3ba55c, rule: 0x9b59b6, info: 0x5865f2 };

export const t = (content) => ({ type: 10, content });
export const sep = (divider = true) => ({ type: 14, divider, spacing: 1 });
export const box = (accent, ...components) => ({ type: 17, accent_color: accent, components: components.flat().filter(Boolean) });
export const sec = (text, accessory) => ({ type: 9, components: [t(text)], accessory });
export const row = (...buttons) => ({ type: 1, components: buttons.flat().filter(Boolean) });
export const btn = (custom_id, label, style = Style.Secondary, disabled = false, emoji) =>
  ({ type: 2, custom_id, label, style, disabled, ...(emoji ? { emoji: { name: emoji } } : {}) });
export const link = (url, label) => ({ type: 2, style: Style.Link, url, label });
export const gallery = (url, description) => ({ type: 12, items: [{ media: { url }, description }] });
export const select = (custom_id, placeholder, options) => ({ type: 1, components: [{ type: 3, custom_id, placeholder, options }] });

// Message payloads. `ping` messages @mention the person and notify; the rest are silent.
// In a DM every unsilenced message notifies, so `mention: false` pings without the @mention line.
export const msg = (person, components, { ping = false, mention = ping, files } = {}) => ({
  flags: V2 | (ping ? 0 : SILENT),
  components: mention ? [t(`<@${person}>`), ...components] : components,
  allowedMentions: mention ? { users: [person] } : { parse: [] },
  ...(files ? { files } : {}),
});
export const edit = (components, files) => ({ flags: V2, components, allowedMentions: { parse: [] }, ...(files ? { files } : {}) });

export const hash = (obj) => createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 10);
export const when = (ms = Date.now()) => `<t:${Math.floor(ms / 1000)}:t>`;
export const PH = '-# Data sourced from Product Hunt';

// ---------- Fixture Products (fictional, on .example domains) ----------
// Names and addresses are placeholders, not facts about the person.
export const NAMES = { first: 'Alex', last: 'Example' };

const std = (slug) => [
  { key: 'first_name', label: 'First name', value: NAMES.first, editable: true },
  { key: 'last_name', label: 'Last name', value: NAMES.last, editable: true },
  { key: 'email', label: 'Email', value: `you+${slug}@gmail.com`, alt: 'you@gmail.com', kind: 'identity' },
  { key: 'password', label: 'Password', kind: 'secret', vault: `Registrations › ${slug}` },
];

export const PRODUCTS = {
  inkwell: {
    slug: 'inkwell', name: 'Inkwell', tagline: 'Notes that link themselves', domain: 'inkwell.example',
    host: 'accounts.inkwell.example', hostNote: "Clerk, Inkwell's sign-in provider",
    terms: [['Terms', 'https://inkwell.example/terms'], ['Privacy Policy', 'https://inkwell.example/privacy']],
    fit: 9, line: 7, state: 'open',
    offer: '3 months of Pro free with code `PHINK`, until Oct 31',
    use: 'Matches *Want: note-taking that cross-links research*.',
    fields: [...std('inkwell'),
      { key: 'heard', label: 'How did you hear about us?', value: 'Product Hunt', editable: true, unusual: true },
      { key: 'news', label: '"Product news" box', value: 'left unticked', editable: true, kind: 'choice' }],
    walls: null, button: 'Create account', rules: ['Leave marketing boxes unticked'], script: 'clean',
  },
  larkspur: {
    slug: 'larkspur', name: 'Larkspur', tagline: 'Calendar that books focus time', domain: 'larkspur.example',
    host: 'larkspur.example', terms: [['Terms', 'https://larkspur.example/legal/terms']],
    fit: 8, line: 7, state: 'open', offer: null,
    use: 'Matches *Want: calendar and scheduling tools*.',
    fields: std('larkspur'),
    walls: "expect a bot check (Cloudflare Turnstile seen on the page); you'll be asked to Take over",
    button: 'Sign up', rules: [], script: 'botcheck',
  },
  quillcrm: {
    slug: 'quillcrm', name: 'Quill CRM', tagline: 'A CRM for one-person companies', domain: 'quillcrm.example',
    host: 'app.quillcrm.example', terms: [['Terms of Service', 'https://quillcrm.example/tos'], ['Privacy Policy', 'https://quillcrm.example/privacy']],
    fit: 7, line: 7, state: 'open', offer: 'Free for teams up to 3 (Maker comment)',
    use: 'Matches *Leans: small-business tools*; on the line.',
    fields: [...std('quillcrm'),
      { key: 'team_size', label: 'Team size', value: '(left empty)', editable: true },
      { key: 'news', label: '"Tips and offers" box', value: 'left unticked', editable: true, kind: 'choice' }],
    walls: null, button: 'Start free', rules: ['Leave marketing boxes unticked'], script: 'submittap',
  },
  tessellate: {
    slug: 'tessellate', name: 'Tessellate', tagline: 'Whiteboard for async teams', domain: 'tessellate.example',
    host: 'tessellate.example', terms: [['Terms', 'https://tessellate.example/terms']],
    fit: 8, line: 7, state: 'open', offer: null,
    use: 'Matches *Want: visual thinking tools*.',
    fields: std('tessellate'),
    walls: null, button: 'Create workspace', rules: [], script: 'amend',
    amend: {
      added: [{ key: 'company', label: 'Company name', value: 'Personal', editable: true, why: 'required on page 2' }],
      terms: [['Data Processing Addendum', 'https://tessellate.example/dpa']],
    },
  },
  relay: {
    slug: 'relay', name: 'Relay', tagline: 'Inbox for your RSS and newsletters', domain: 'relay.example',
    host: 'relay.example', terms: [['Terms', 'https://relay.example/terms']],
    fit: 7, line: 7, state: 'waitlisted', offer: 'Early-access members keep the free tier for life (description)',
    use: 'Matches *Want: reading tools*.',
    fields: std('relay'), formNotSeen: true,
    walls: null, button: 'Join waitlist', rules: [], script: 'waitlist',
  },
};
export const ORDER = ['inkwell', 'larkspur', 'quillcrm', 'tessellate', 'relay'];

// ---------- Content every variant shares ----------
export const termsLinks = (p, terms = p.terms) => terms.map(([n, u]) => `[${n}](${u})`).join(' and ');

export function dossierText(p) {
  return [
    `## ${p.name} · ${p.tagline}`,
    `**${p.state === 'waitlisted' ? 'Waitlisted' : 'Open'}** · Fit ${p.fit} (line ${p.line}) · sign up with email on \`${p.host}\`¹`,
    p.offer ? `**Offer:** ${p.offer}²` : '**Offer:** none found',
    `**For you:** ${p.use}`,
    `-# ¹ [signup page](https://${p.host}/signup) · ² [Launch on Product Hunt](https://www.producthunt.com/) · ${PH.slice(3)}`,
  ].join('\n');
}

export function fieldLine(f, { unusualMark = false } = {}) {
  if (f.kind === 'secret') return `**${f.label}** · new random one, saved to Bitwarden › ${f.vault}`;
  if (f.kind === 'identity') return `**${f.label}** · \`${f.value}\` · or \`${f.alt}\` if \`+\` is refused`;
  return `**${f.label}** · ${f.value}${unusualMark && f.unusual ? ' ◆' : ''}`;
}

export function consequence(j) {
  const p = j.p;
  const host = p.host === p.domain ? `\`${p.host}\`` : `\`${p.host}\` (${p.hostNote ?? 'not the Product’s own domain'})`;
  return `**If you approve,** the Assistant creates an account at **${p.name}** on ${host} as \`${j.fields.find((f) => f.key === 'email').value}\`, `
    + `and presses **${p.button}** itself if the filled form matches this Walkthrough. You accept ${termsLinks(p, j.terms)}.`;
}

export const rulesLine = (j) => `-# Rules applied: ${j.p.rules.length ? j.p.rules.join(' · ') : 'none'} · read from the signup page ${when(j.readAt)}`;
export const wallsLine = (p) => p.formNotSeen
  ? '**Form not seen:** the read found no form, so this carries only the standard keys.'
  : `**Walls:** ${p.walls ?? 'none expected'}`;

export const STEP_TEXT = {
  queued: 'Queued',
  filling: (n) => `Filling page ${n}`,
  checking: 'Checking the filled page against the Walkthrough',
  pressing: (b) => `Pressing **${b}**`,
  submitted: 'Submitted · waiting for the verification mail',
  verified: 'Verification link opened by plain code (DMARC pass, 0:21 after submit)',
};

export function progressText(j) {
  const r = j.reg;
  const lines = r.log.map((l, i) => (i === r.log.length - 1 && !r.outcome ? `▸ ${l}` : `✓ ${l}`));
  const head = r.outcome ? `**${j.p.name} · ${r.outcome}**` : `**${j.p.name} · registering**`;
  return [head, ...lines.map((l) => `-# ${l}`)].join('\n');
}

export function wallText(j, kind) {
  const W = {
    'bot-check': ['stopped at a **bot check**', 'Take over to pass it on your phone, or Hand off to finish in Safari.'],
    phone: ['wants a **phone number**', 'Hand off is the usual route; Take over if you want to type it here.'],
    stuck: ['is **stuck** on a page it can’t read', 'Take over to finish it, or Hand off.'],
    'still-showing': ['form is **still showing** 10 s after **Sign up** was pressed', 'It may have been rejected. Take over to look, or Hand off. Nothing changes until you say.'],
  }[kind];
  return `### ${j.p.name} ${W[0]}\n${W[1]}`;
}
export const WALL_ROUTES = { 'bot-check': ['take', 'hand'], phone: ['hand', 'take'], stuck: ['take', 'hand'], 'still-showing': ['take', 'hand'] };

export function handoffText(j) {
  const email = j.fields.find((f) => f.key === 'email');
  return [
    `### Finish ${j.p.name} in Safari`,
    `1. Open the [signup page](https://${j.p.host}/signup)`,
    `2. Name: \`${j.fields[0].value}\` \`${j.fields[1].value}\``,
    `3. Email: \`${email.value}\``,
    `4. Password: tap the field, then **Passwords** → Bitwarden › ${email.value.split('+')[1]?.split('@')[0] ?? j.p.slug}. It is never sent here.`,
    `5. Accept ${termsLinks(j.p, j.terms)}, submit, then tap **Done**.`,
    '-# The verification mail will arrive in the Signup mailbox; the Assistant opens it if it can.',
  ].join('\n');
}

export const QUILL_SHOTS = { 1: 'shots/quill-filled-v1.png', 2: 'shots/quill-filled-v2.png' };
export function submitTapText(j) {
  return [
    `### ${j.p.name}: the filled page doesn't match`,
    `**Team size** shows \`${j.shot === 2 ? '11–50' : '2–10'}\`. The page preset it; the Walkthrough left it empty.`,
    `Tap **Submit** to press **${j.p.button}** (outlined) on exactly this page. If the page changes first, the tap is refused and you get a new screenshot.`,
  ].join('\n');
}

export function amendText(j) {
  const a = j.p.amend;
  return [
    `### ${j.p.name} · Walkthrough v${j.version} · what page 2 asked for`,
    ...a.added.map((f) => `**+ ${f.label}** · ${f.value} *(${f.why})*`),
    `**+ Terms** · ${termsLinks(j.p, a.terms)}`,
    `-# Already approved in v${j.approvedVersion}: names, \`${j.fields.find((f) => f.key === 'email').value}\`, password, ${termsLinks(j.p)}. Same browser session; it waits up to 24 h.`,
  ].join('\n');
}

export function replyText(j) {
  const d = j.reply;
  return [
    `### Reply draft · ${j.p.name}${d.held ? ' · *your text*' : ''}`,
    `-# From \`you@gmail.com\` (plain address: see #28) · To \`maya@${j.p.domain}\` · in thread "Welcome to ${j.p.name}!"`,
    `> **Maya (founder) wrote:** Thanks for signing up! What made you try ${j.p.name}, and what would make it a keeper?`,
    d.body,
    `-# v${d.version} · ${d.held ? 'edited in Gmail' : `Rules applied: ${d.rules}`}`,
  ].join('\n');
}
export const REPLY_V1 = 'Hi Maya, thanks! I found Inkwell on Product Hunt. I keep research notes across a few tools, and automatic cross-links are what I want most. A keeper for me would be a clean Markdown export.';
export const REPLY_GMAIL = 'Hi Maya! Found you on Product Hunt. Cross-linking is the draw; Markdown export would make it a keeper. Thanks!';

export function ruleText(rule) {
  return [
    `### Proposed Rule · not an Approval`,
    `> ${rule.text}`,
    `**Scope:** ${rule.scope} · **From your Correction on** ${rule.from}`,
    `**Carry-over case:** ${rule.caseText} · ${rule.caseResult}`,
    '-# Keep makes it a Rule in every later run in scope. Nothing is registered or sent by this.',
  ].join('\n');
}
export const RULE = {
  text: 'When a form requires a company name, use "Personal".',
  scope: 'Registration', from: 'Tessellate (Walkthrough v2)',
  caseText: 'replayed Quill CRM\'s stored page with a required Company field', caseResult: '✓ 3 of 3 on both providers',
};
