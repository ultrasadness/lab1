// Where a Product stands (#12): the forum tags its post carries, by the names the person gave them, and what its
// Dossier's Register line ends with about its Walkthrough. Both come from the live store, so the post and the Dossier
// say the same thing wherever the change came from.
import { cut } from '../discord/components.ts';
import type { Product, Store } from '../store.ts';

/** The most a Register line's note takes, which a Dossier's length leaves room for. */
export const REGISTER_NOTE_MAX = 200;

export interface Standing {
  /** The tags' names, lowercase, as the forum's tags are found by. */
  tags: string[];
  /** What the Register line ends with, if anything. */
  registerNote: string | null;
}

export function standingOf(store: Store, product: Product, needsYouChannelId: string): Standing {
  const standing = standingFrom(store, product, needsYouChannelId);
  return { ...standing, registerNote: standing.registerNote && cut(standing.registerNote, REGISTER_NOTE_MAX) };
}

function standingFrom(store: Store, product: Product, needsYouChannelId: string): Standing {
  const dossier = store.latestDossier(product.id)?.dossier;
  const noAccount = dossier?.record.state === 'no-account';
  if (product.withdrawnAt) return { tags: [...(noAccount ? ['no account'] : []), 'skipped'], registerNote: null };
  if (!dossier || noAccount) return { tags: noAccount ? ['no account'] : [], registerNote: null };
  const registration = store.registration(product.id);
  if (registration) {
    const approved = `Walkthrough v${registration.version} approved`;
    return registration.state === 'handed-off'
      ? { tags: ['handed off'], registerNote: `${approved}; handed off to you.` }
      : { tags: ['registering'], registerNote: `${approved}; registering.` };
  }
  const none = store.noWalkthrough(product.id);
  if (none) return { tags: [], registerNote: `No Walkthrough: ${none.why}.` };
  const latest = store.latestWalkthrough(product.id);
  if (!latest) return { tags: [], registerNote: null };
  if (latest.dismissedAt) return { tags: [], registerNote: 'Walkthrough dismissed.' };
  if (latest.lapsedAt && !latest.againTappedAt) return { tags: [], registerNote: 'Walkthrough lapsed, unanswered for 14 days.' };
  return { tags: ['walkthrough'], registerNote: `Walkthrough in <#${needsYouChannelId}>.` };
}
