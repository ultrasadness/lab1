// A Product's folder in the Personal database (#33): `products/<root domain>/`, with one file per writer.
// - `dossier.md` is always the whole Dossier, never shortened (#40 §4), its citations named links in brackets. The bot
//   rewrites it whenever the Dossier changes, so git keeps every version.
// - `registration.md` holds the Registration's milestone lines, appended from the live store, and until there is a
//   Registration says so on one line (`bot/src/walkthrough/registration-file.ts`).
// - `notes.md` is the person's. The bot creates it once, empty, and never writes it again.
// Every date in them carries its year and zone (#37).
import { launchUrl } from '../miner/day-post.ts';
import { fullDate, fullTime } from '../pacific.ts';
import { plain } from '../personal-database.ts';
import { headLine, launchText, NO_OFFER, offerText, postTitle } from './card.ts';
import { registrationFile, registrationPath } from '../walkthrough/registration-file.ts';
import { SOURCE_NAMES, type Dossier, type Part, type SourceKey } from './dossier.ts';

/** A file to write, with its commit's message; one written only if the file isn't there yet is never overwritten. */
export interface ProductFile {
  path: string;
  content: string;
  message: string;
  createOnly?: boolean;
}

export const productFolder = (rootDomain: string) => `products/${rootDomain}`;
export const dossierPath = (rootDomain: string) => `${productFolder(rootDomain)}/dossier.md`;

/** The Interest scope's file, as linked from a Product's folder. */
const INTEREST_SCOPE = '../../profile/interest-scope.md';

/** The files a Product's first Dossier brings: its Dossier, its Registration file, and the person's notes file. */
export function newProductFiles(d: Dossier, version: number): ProductFile[] {
  const title = plain(postTitle(d));
  const folder = productFolder(d.rootDomain);
  const product = `${d.name.trim()} (${d.rootDomain})`;
  return [
    { path: dossierPath(d.rootDomain), content: dossierFile(d), message: `Dossier v${version}: ${product}` },
    {
      path: registrationPath(d.rootDomain),
      content: registrationFile(title, { noWalkthrough: null, registered: false, lines: [] }),
      message: `Registration file: ${product}, none yet`,
    },
    { path: `${folder}/notes.md`, content: '', message: `Notes file for the person: ${product}`, createOnly: true },
  ];
}

/** The whole Dossier as Markdown. */
export function dossierFile(d: Dossier): string {
  const cite = (sources: SourceKey[]) =>
    ` (${sources.map((k) => (k === 'interest-scope' ? `[your Interest scope](${INTEREST_SCOPE})` : `[${SOURCE_NAMES[k]}](${d.links[k]})`)).join(', ')})`;
  const claim = (label: string, part: Part) => `**${label}:** ${plain(part.text)}${cite(part.sources)}`;
  const { record } = d;
  const first = launchUrl(d.launches[0]!.slug);
  const rules = record.rulesApplied.length > 0 ? record.rulesApplied.map(plain).join(', ') : 'none';
  return [
    `# ${plain(postTitle(d))}`,
    '',
    `${headLine(d, fullDate)} · \`${d.rootDomain}\``,
    '',
    claim('Register', record.register),
    '',
    claim('What it is', record.whatItIs),
    '',
    claim('For you', record.forYou),
    '',
    ...(record.offers.length > 0
      ? ['**Offers**', '', ...record.offers.map((o) => `- ${offerText(o, plain)}${cite(o.sources)}`)]
      : [`**Offers:** ${NO_OFFER(first)}`]),
    ...(record.note ? ['', claim('Note', record.note)] : []),
    '',
    `**Launches:** ${d.launches.map((l) => launchText(l, fullDate)).join('; ')}`,
    '',
    `<sub>Rules applied: ${rules} · read ${fullTime(new Date(d.readAt))} · Data sourced from [Product Hunt](${first})</sub>`,
    '',
    '<sub>The bot rewrites this file whenever the Dossier changes. [Registration](registration.md) · [Notes](notes.md)</sub>',
    '',
  ].join('\n');
}
