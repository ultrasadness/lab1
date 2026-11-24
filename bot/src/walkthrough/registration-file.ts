// A Product's `registration.md` in the Personal database (#33, ADR 0007): a view the bot writes from the live store,
// never read back. Until the Product has a Registration it says so, or why no Walkthrough is offered. Each Correction
// of its Walkthrough gets a line, with what came of its sort once that has settled, and each Approval gets one naming
// the Signup identity and the vault item then holding the password, never the password (ADR 0004). A vault item that
// replaces another gets a line, then the final press as *submitted*, and the outcome, in bold (#56), with how its
// verification mail was used or put to the person, and its hand-off for want of one (#58). An Approval that
// Start again's Approval followed keeps how it ended. A line, once written, says the same thing whatever happens after,
// and every date carries its year and zone (#37).
import { sortKey, sortNote } from '../rules/sorting.ts';
import { fullTime } from '../pacific.ts';
import { plain } from '../personal-database.ts';
import { handOffCause, type Refused, type Store } from '../store.ts';
import { hasPasswordField, type Walkthrough } from './walkthrough.ts';

/** What a form refused, as a replacement item's notes and `registration.md` say it (ADR 0014). */
export const refusalText: Record<Refused, string> = { password: 'the form refused its password', plus: 'the form refused the + in its address' };

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
    const came =
      c.ofApproved === 'after-final-press'
        ? ', which fixes only the record: the form was already submitted'
        : c.withdrawn
          ? `, so no Walkthrough is offered: ${plain(c.withdrawn)}`
          : c.unapplied
            ? `, which couldn't be applied: ${plain(c.unapplied)}`
            : `, prepared again as v${c.redoneVersion}`;
    const sort = sortNote(store.sortOf(sortKey('walkthrough', c.id)));
    dated.push({ at: c.submittedAt, line: `${fullTime(new Date(c.submittedAt))} · Walkthrough v${c.version} corrected: you wrote "${plain(c.text)}"${came}${sort ? `; ${plain(sort)}` : ''}` });
  }
  const registration = store.registration(productId);
  if (registration) {
    const r = registration;
    const { walkthrough } = store.walkthrough(productId, r.version)!;
    // Each vault item in turn: the one made at the first Approval with a password field, then each replacement.
    const items = [...r.replacedItems.map((x) => x.itemId), ...(r.vaultItemId ? [r.vaultItemId] : [])];
    const itemAt = (at: string) => items[r.replacedItems.filter((x) => x.at <= at).length];
    for (const a of store.walkthroughApprovals(productId)) {
      const approved = store.walkthrough(productId, a.version)?.walkthrough ?? walkthrough;
      const item = hasPasswordField(approved) ? itemAt(a.approvedAt) : undefined;
      const vaultItem = item ? ` · password in the Password vault, item ${item}` : '';
      const handedOff = a.version === r.version && handOffCause(r) === 'terms-ban' ? ' · handed off: its terms ban accounts made by a bot' : '';
      dated.push({ at: a.approvedAt, line: `${fullTime(new Date(a.approvedAt))} · Walkthrough v${a.version} approved · ${identityText(approved)}${vaultItem}${handedOff}` });
    }
    for (const [i, replaced] of r.replacedItems.entries()) {
      const line = `${refusalText[replaced.refused]}: item ${items[i + 1]} in the Password vault replaces item ${replaced.itemId}, which stays there for you to delete`;
      dated.push({ at: replaced.at, line: `${fullTime(new Date(replaced.at))} · ${line}` });
    }
    for (const ended of r.history) dated.push({ at: ended.endedAt, line: `${fullTime(new Date(ended.endedAt))} · **abandoned**: ${plain(ended.endNote)}` });
    const address = r.plainAddress ? walkthrough.identity.plainAddress : walkthrough.identity.plusAddress;
    if (r.submittedAt) {
      const uncertain = r.uncertain ? ` · it isn't known whether the press went through (${plain(r.uncertain)}), so it counts as pressed` : '';
      dated.push({
        at: r.submittedAt,
        line: `${fullTime(new Date(r.submittedAt))} · submitted: pressed "${plain(r.button ?? 'its button')}" on ${walkthrough.signupHost}, as ${address}${uncertain}`,
      });
    }
    if (r.handedOffAt) dated.push({ at: r.handedOffAt, line: `${fullTime(new Date(r.handedOffAt))} · **handed off**: submitted; no verification mail yet` });
    if (r.handOff) dated.push({ at: r.handOff.at, line: `${fullTime(new Date(r.handOff.at))} · **handed off** by you, at ${plain(r.handOff.from)}` });
    // Each Submit tap is an Approval of one page as its screenshot showed it (#59, ADR 0007).
    for (const a of store.submitTapApprovals(productId)) {
      dated.push({ at: a.approvedAt, line: `${fullTime(new Date(a.approvedAt))} · Submit tapped: you approved a page as its screenshot showed it (fingerprint ${a.versionHash.slice(0, 12)})` });
    }
    const v = store.verification(productId);
    // Only a state and a date from the mail, never what it says or why plain code didn't use it (ADR 0010).
    if (v?.way === 'person') {
      dated.push({ at: v.receivedAt, line: `${fullTime(new Date(v.receivedAt))} · verification mail came${v.spam ? ', in Spam' : ''}, and you verify it in Gmail` });
    } else if (v?.doneAt) {
      const how = v.way === 'code' ? `filled the emailed code and pressed "${plain(v.button ?? 'its button')}"` : 'opened the verification link';
      const uncertain = v.uncertain ? ` · it isn't known whether that went through (${plain(v.uncertain)}), so it counts as done` : '';
      dated.push({ at: v.doneAt, line: `${fullTime(new Date(v.doneAt))} · verified: plain code ${how}${uncertain}` });
    }
    // Done on a Handoff card makes it *registered* with no verification mail used (#59).
    const byYou = r.state === 'registered' && !v && handOffCause(r) ? ': you finished it on your own device' : '';
    if (r.endedAt && (r.state === 'registered' || r.state === 'waitlisted')) dated.push({ at: r.endedAt, line: `${fullTime(new Date(r.endedAt))} · **${r.state}**${byYou}` });
    if (r.endedAt && r.state === 'abandoned') dated.push({ at: r.endedAt, line: `${fullTime(new Date(r.endedAt))} · **abandoned**: ${plain(r.endNote ?? 'nothing submitted')}` });
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
