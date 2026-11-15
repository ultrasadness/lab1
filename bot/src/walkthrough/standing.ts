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
  const none = store.noWalkthrough(product.id);
  const latest = store.latestWalkthrough(product.id);
  const registration = store.registration(product.id);
  // An abandoned Registration with a later Walkthrough waiting on the person stands as that Walkthrough does, below.
  const later = latest && registration && latest.version > registration.version && !none && !latest.dismissedAt && !(latest.lapsedAt && !latest.againTappedAt);
  if (registration && !(registration.state === 'abandoned' && later)) {
    const approved = `Walkthrough v${registration.version} approved`;
    switch (registration.state) {
      case 'held':
        return { tags: ['walkthrough'], registerNote: `${approved}; waiting for Bitwarden.` };
      case 'handed-off':
        return { tags: ['handed off'], registerNote: registration.handedOffAt ? `${approved}; submitted, and handed off to you: no verification mail yet.` : `${approved}; handed off to you.` };
      case 'queued':
      case 'filling':
      case 'checking':
      case 'pressing':
        return { tags: ['registering'], registerNote: `${approved}; registering.` };
      case 'check-failed':
      case 'at-wall':
        return { tags: ['needs you'], registerNote: `${approved}; registering, and waiting for you: see its status below.` };
      case 'awaiting-verification':
        return { tags: ['registering'], registerNote: `${approved}; submitted, awaiting verification.` };
      case 'registered':
        return { tags: ['registered'], registerNote: `${approved}; registered.` };
      case 'waitlisted':
        return { tags: ['waitlisted'], registerNote: `${approved}; on the waitlist.` };
      case 'abandoned':
        return { tags: ['abandoned'], registerNote: `${approved}; abandoned: ${registration.endNote ?? 'nothing submitted'}.${none ? ` No Walkthrough is offered any more: ${none.why}.` : ''}` };
    }
  }
  if (none) return { tags: [], registerNote: `No Walkthrough: ${none.why}.` };
  if (!latest) return { tags: [], registerNote: null };
  if (latest.dismissedAt) return { tags: [], registerNote: 'Walkthrough dismissed.' };
  if (latest.lapsedAt && !latest.againTappedAt) return { tags: [], registerNote: 'Walkthrough lapsed, unanswered for 14 days.' };
  return { tags: ['walkthrough'], registerNote: `Walkthrough in <#${needsYouChannelId}>.` };
}
