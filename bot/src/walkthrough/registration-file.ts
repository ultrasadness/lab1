// A Product's `registration.md` in the Personal database (#33, ADR 0007): a view the bot writes from the live store,
// never read back. Until the Product has a Registration it says so, or why no Walkthrough is offered. Each Correction
// of its Walkthrough gets a line, with what came of its sort once that has settled, and the Approval gets one naming
// the Signup identity and the vault item holding the password, never the password (ADR 0004). Every date carries its
// year and zone (#37).
import { sortKey, sortNote } from '../rules/sorting.ts';
import { fullTime } from '../pacific.ts';
import { plain } from '../personal-database.ts';
import type { Store } from '../store.ts';
import type { Walkthrough } from './walkthrough.ts';

export const registrationPath = (rootDomain: string) => `products/${rootDomain}/registration.md`;

/** The file's content: its title, then where the Registration stands and its dated lines. */
export function registrationFile(title: string, state: { noWalkthrough: string | null; registered: boolean; lines: string[] }): string {
  const standing = state.registered ? [] : [state.noWalkthrough ? `No Registration: no Walkthrough, since ${state.noWalkthrough}.` : 'No Registration yet.'];
  return [
    `# ${title} · Registration`,
    '',
    '<!-- Appended by the bot at milestones from the live store. Edits here are not read back. -->',
    ...standing,
    ...(state.lines.length > 0 ? [...(standing.length > 0 ? [''] : []), ...state.lines.map((l) => `- ${l}`)] : []),
    '',
  ].join('\n');
}

/** The file as the store now has it, with its commit's message saying what changed. */
export function registrationFileOf(store: Store, productId: number, change: string): { path: string; content: string; message: string } {
  const product = store.product(productId)!;
  const { dossier } = store.latestDossier(productId)!;
  const dated: { at: string; line: string }[] = [];
  for (const c of store.walkthroughCorrectionsOf(productId)) {
    if (!c.doneAt) continue;
    const came = c.withdrawn
      ? `, so no Walkthrough is offered: ${plain(c.withdrawn)}`
      : c.unapplied
        ? `, which couldn't be applied: ${plain(c.unapplied)}`
        : `, prepared again as v${c.redoneVersion}`;
    const sort = sortNote(store.sortOf(sortKey('walkthrough', c.id)));
    dated.push({ at: c.submittedAt, line: `${fullTime(new Date(c.submittedAt))} · Walkthrough v${c.version} corrected: you wrote "${plain(c.text)}"${came}${sort ? `; ${plain(sort)}` : ''}` });
  }
  const registration = store.registration(productId);
  if (registration) {
    const { walkthrough } = store.walkthrough(productId, registration.version)!;
    const vaultItem = registration.vaultItemId ? ` · password in the Password vault, item ${registration.vaultItemId}` : '';
    const handedOff = registration.state === 'handed-off' ? ' · handed off: its terms ban accounts made by a bot' : '';
    dated.push({
      at: registration.approvedAt,
      line: `${fullTime(new Date(registration.approvedAt))} · Walkthrough v${registration.version} approved · ${identityText(walkthrough)}${vaultItem}${handedOff}`,
    });
  }
  dated.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const content = registrationFile(plain(product.title), {
    noWalkthrough: store.noWalkthrough(productId)?.why ?? null,
    registered: Boolean(registration),
    lines: dated.map((d) => d.line),
  });
  return { path: registrationPath(product.rootDomain), content, message: `Registration file: ${dossier.name.trim()} (${product.rootDomain}), ${change}` };
}

/** The Signup identity as the Walkthrough approved it: its names, if it has any, and its plus-address. */
function identityText(w: Walkthrough): string {
  const value = (key: string) => w.fields.find((f) => f.key === key)?.value ?? null;
  const first = value('first-name');
  const last = value('last-name');
  const name = value('full-name') ?? ([first, last].filter(Boolean).join(' ') || null);
  return `${name ? `${plain(name)}, ` : ''}${w.identity.plusAddress}`;
}
