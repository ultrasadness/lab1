// The Dossier on Discord (#33): one silent card, the first message of the Product's post. From the top: the title,
// the head line, Register, What it is, For you, Offers, an optional Note and the Launches, each claim ending in the
// numbers of its sources; then the foot, which lists those sources, the Rules applied, when the pages were read and
// "Data sourced from Product Hunt"; then Add Offer and Correct. A card over Discord's 4,000 characters, once the run
// has rewritten it, has its oldest Launches collapsed and then What it is, For you and Note cut, and says so (#40 §4).
// Every Offer, Launch and citation stays.
import {
  Accent,
  actionRow,
  button,
  container,
  escapeMarkdown,
  fits,
  measure,
  MESSAGE_LIMITS,
  silentMessage,
  text,
  type MessagePayload,
} from '../discord/components.ts';
import { count, launchUrl } from '../miner/day-post.ts';
import { dayLabel, shortTime } from '../pacific.ts';
import { REGISTER_NOTE_MAX } from '../walkthrough/standing.ts';
import { SOURCE_KEYS, SOURCE_NAMES, yoursToActOn, type Dossier, type DossierLaunch, type Offer, type Part, type SourceKey } from './dossier.ts';

/** Add Offer and Correct are wired in #66. */
export const addOfferId = (productId: number) => `add-offer:dossier:${productId}`;
export const correctDossierId = (productId: number) => `correct:dossier:${productId}`;

const STATE_LABELS = { open: 'Open', waitlisted: 'Waitlisted', 'no-account': 'No account needed' } as const;

export const NO_OFFER = (launch: string) => `none in the Launch text or on the site. The [Launch page](${launch}) may show a promo.`;

/** Discord refuses a post title over 100 characters. */
const TITLE_MAX = 100;

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const superscript = (n: number) => [...String(n)].map((d) => SUPERSCRIPT_DIGITS[Number(d)]).join('');

/** The Product post's title, `<Product> · <tagline>`, within Discord's limit. */
export function postTitle(d: Pick<Dossier, 'name' | 'tagline'>): string {
  const title = `${d.name} · ${d.tagline}`.replace(/\s+/g, ' ').trim();
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

/** The sources a Dossier uses, in their fixed order: the Launch always, for attribution, then each one a part cites. */
export function usedSources(d: Dossier): SourceKey[] {
  const { register, whatItIs, forYou, offers, note } = d.record;
  const cited = new Set<SourceKey>(['launch', ...[register, whatItIs, forYou, ...offers, ...(note ? [note] : [])].flatMap((p) => p.sources)]);
  return SOURCE_KEYS.filter((k) => cited.has(k));
}

const latestLaunch = (d: Dossier): DossierLaunch => d.launches.at(-1)!;

/**
 * How a card is cut down to fit: how many of the oldest Launches collapse, how much of What it is, For you and Note
 * stays, and how much of Register and the Offers' text. Null keeps a part whole.
 */
interface Shape {
  collapsed: number;
  kept: number | null;
  keptRest: number | null;
}

const WHOLE: Shape = { collapsed: 0, kept: null, keptRest: null };

/**
 * How many characters over Discord's limit the whole card runs, or 0 when it fits. A Product with an account to make
 * keeps room for what Register will say of its Walkthrough.
 */
export function overBy(d: Dossier, productId: number): number {
  const note = d.record.state === 'no-account' ? null : 'x'.repeat(REGISTER_NOTE_MAX);
  return Math.max(0, measure(cardOf(d, productId, WHOLE, undefined, note).components).text - MESSAGE_LIMITS.text);
}

/**
 * The card as posted: whole when it fits, otherwise with its oldest Launches collapsed, then with What it is, For you
 * and Note cut as little as fits. `fullDossier` links the whole Dossier in git, which a shortened card points to, and
 * Register ends with `registerNote`, what is known of the Product's Walkthrough, when there is one.
 */
export function dossierCard(
  d: Dossier,
  productId: number,
  fullDossier: string | undefined,
  registerNote: string | null = null,
): { message: MessagePayload; shortened: boolean } {
  const whole = cardOf(d, productId, WHOLE, fullDossier, registerNote);
  if (fits(whole)) return { message: whole, shortened: false };
  for (let collapsed = 1; collapsed < d.launches.length; collapsed++) {
    const folded = cardOf(d, productId, { ...WHOLE, collapsed }, fullDossier, registerNote);
    if (fits(folded)) return { message: folded, shortened: true };
  }
  const collapsed = d.launches.length - 1;
  const at = (kept: number, keptRest: number | null) => cardOf(d, productId, { collapsed, kept, keptRest }, fullDossier, registerNote);
  if (fits(at(0, null))) return { message: at(most((kept) => fits(at(kept, null))), null), shortened: true };
  // Only escaping can make the rest overrun, in a record of Markdown characters a page may have steered the model to
  // write. Register and the Offers' text are then cut too, at a word, keeping every Offer, Launch and citation. Within
  // the record's limits even all of them cut leaves room.
  if (!fits(at(0, 0))) throw new Error(`The Dossier of ${d.rootDomain} doesn't fit Discord even with every part cut`);
  return { message: at(0, most((keptRest) => fits(at(0, keptRest)))), shortened: true };
}

/** The largest share, to a thousandth, at which the card still fits; 0 fits. */
function most(fitsAt: (share: number) => boolean): number {
  let [low, high] = [0, 1000];
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fitsAt(mid / 1000)) low = mid;
    else high = mid - 1;
  }
  return low / 1000;
}

function cardOf(d: Dossier, productId: number, shape: Shape, fullDossier: string | undefined, registerNote: string | null): MessagePayload {
  const used = usedSources(d);
  const cite = (sources: SourceKey[]) => sources.map((k) => superscript(used.indexOf(k) + 1)).join(' ');
  const claim = (label: string, part: Part, kept: number | null) => `**${label}:** ${escapeMarkdown(shorten(part.text, kept))}${cite(part.sources)}`;
  const { record } = d;
  const first = launchUrl(d.launches[0]!.slug);
  const cutRest = (value: string) => shorten(value, shape.keptRest);
  const offers =
    record.offers.length > 0
      ? ['**Offers**', ...record.offers.map((o) => `- ${offerText(o, escapeMarkdown, cutRest)}${cite(o.sources)}`)]
      : [`**Offers:** ${NO_OFFER(first)}`];
  const launches = d.launches.slice(shape.collapsed).map((l) => launchText(l, dayLabel));
  if (shape.collapsed > 0) launches.unshift(`+ ${count(shape.collapsed, 'earlier Launch', 'earlier Launches')}`);
  const body = [
    `## ${escapeMarkdown(postTitle(d))}`,
    headLine(d, dayLabel),
    `${claim('Register', record.register, shape.keptRest)}${registerNote ? ` ${registerNote}` : ''}`,
    claim('What it is', record.whatItIs, shape.kept),
    claim('For you', record.forYou, shape.kept),
    ...offers,
    ...(record.note ? [claim('Note', record.note, shape.kept)] : []),
    `**Launches:** ${launches.join('; ')}`,
  ];
  const sources = used.map((k, i) => `${superscript(i + 1)} ${k === 'interest-scope' ? 'your Interest scope' : `[${SOURCE_NAMES[k]}](${d.links[k]})`}`);
  const rules = record.rulesApplied.length > 0 ? record.rulesApplied.map(escapeMarkdown).join(', ') : 'none';
  const foot = [
    `-# ${sources.join(' · ')}`,
    `-# Rules applied: ${rules} · read ${shortTime(new Date(d.readAt))} · Data sourced from [Product Hunt](${first})`,
    ...(shape.collapsed > 0 || shape.kept !== null
      ? [`-# Shortened to fit Discord · ${fullDossier ? `[full Dossier in git ↗](${fullDossier})` : 'full Dossier in git ↗'}`]
      : []),
  ];
  return silentMessage([
    container(Accent.dossiers, [text(body.join('\n')), text(foot.join('\n'))]),
    actionRow([button(addOfferId(productId), 'Add Offer'), button(correctDossierId(productId), 'Correct')]),
  ]);
}

/**
 * `**Open** · fit 9 · Wed Oct 14 · 2 Offers`, from the latest Launch, with its day as `date` writes it; a Product with
 * no account says so.
 */
export function headLine(d: Dossier, date: (date: string) => string): string {
  const latest = latestLaunch(d);
  const offers = d.record.offers.length > 0 ? ` · ${count(d.record.offers.length, 'Offer')}` : '';
  const walkthrough = d.record.state === 'no-account' ? ' · no Walkthrough' : '';
  return `**${STATE_LABELS[d.record.state]}** · fit ${latest.fit} · ${date(latest.date)}${offers}${walkthrough}`;
}

/** A Launch as `[Wed Oct 14](…) · fit 7 · #26 of 48`, with its day as `date` writes it. */
export const launchText = (l: DossierLaunch, date: (date: string) => string) =>
  `[${date(l.date)}](${launchUrl(l.slug)}) · fit ${l.fit} · #${l.rank} of ${l.featuredCount}`;

/** An Offer with what it needs: `30 days of Memlake · *no card · until Dec 4*`, its text cut by `cut` if given. */
export function offerText(o: Offer, escape: (value: string) => string, cut: (value: string) => string = (value) => value): string {
  const card = { needed: 'card needed', 'not needed': 'no card', 'not stated': 'card not stated' }[o.card];
  const marks = [
    ...(o.code ? [`code \`${o.code.replace(/`/g, '')}\``] : []),
    card,
    ...[o.deadline, o.cap, o.condition].filter((m): m is string => m !== null).map((m) => escape(cut(m))),
  ];
  return `${yoursToActOn(o) ? '**Yours to act on:** ' : ''}${escape(cut(o.what))} · *${marks.join(' · ')}*`;
}

/** The text cut to a share of its length, at a word where there is one, ending in "…"; whole when kept is null. */
function shorten(value: string, kept: number | null): string {
  if (kept === null) return value;
  const length = Math.floor(value.length * kept);
  if (length >= value.length) return value;
  const cut = value.slice(0, length);
  const word = cut.lastIndexOf(' ');
  return `${(word > 0 ? cut.slice(0, word) : cut).replace(/[\s,;:.]+$/, '')}…`;
}
