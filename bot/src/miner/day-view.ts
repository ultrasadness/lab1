// A Miner day as the store holds it: each Featured Launch with the judgment its line shows, which is its first one or
// the one the person's latest re-judged Correction gave, and its latest Correction. The day post and the day's file
// are both drawn from it, so a Correction changes them alike.
import type { Correction, Judgment, Launch, Store, StoredSort } from '../store.ts';
import { renderDayFile, type DayFile, type DayFileLaunch } from './day-file.ts';
import { declinedText, renderDayPost, renderRetryNotice, type DayPostLaunch, type RenderedDayPost } from './day-post.ts';

// No Product has a Registration yet, so no Launch is a re-Launch of a registered Product; they arrive with #66.
export const reLaunchOfRegistered = (_launch: Launch) => false;

export type DayLaunch = DayPostLaunch & DayFileLaunch;

/** The date's Featured Launches in Product Hunt order, each as its line shows it. Every one must have a judgment. */
export function dayLaunches(store: Store, date: string): DayLaunch[] {
  const judgments = new Map(store.judgmentsFor(date).map((j) => [j.postId, j]));
  const corrections = Map.groupBy(store.correctionsFor(date), (c) => c.postId);
  return (store.launchesFor(date) ?? []).map((l) => {
    const first = judgments.get(l.postId)!;
    const reLaunch = reLaunchOfRegistered(l);
    const judged = (j: Judgment) => ({ fit: j.fit, notAProduct: j.notAProduct, reLaunchOfRegistered: reLaunch });
    // Each re-judged Correction, with the judgment it was made on.
    let shown = first;
    const rejudged: DayFileLaunch['corrections'] = [];
    let latest: { correction: Correction; was: Judgment } | undefined;
    for (const c of corrections.get(l.postId) ?? []) {
      latest = { correction: c, was: shown };
      if (!c.judgment) continue;
      rejudged.push({ at: c.judgment.judgedAt, was: judged(shown), text: c.text, sort: sortNote(store.sortOf(c.id)) });
      shown = c.judgment;
    }
    const c = latest?.correction;
    const product = c && store.productOfLaunch(l.postId);
    return {
      postId: l.postId,
      rank: l.rank,
      name: l.name,
      slug: l.slug,
      ...judged(shown),
      reason: shown.reason,
      rulesApplied: shown.rulesApplied,
      ...(shown === first ? {} : { first: { ...judged(first), reason: first.reason, rulesApplied: first.rulesApplied } }),
      ...(c && {
        correction: {
          text: c.text,
          state: c.judgment ? 're-judged' : c.unjudged ? 'not re-judged' : 're-judging',
          was: judged(latest!.was),
          why: c.unjudged ?? c.problem,
          withdrawnPost: product?.withdrawnAt ? product.threadId : null,
          declined: store.sortOf(c.id)?.hardLimit ?? null,
        },
      }),
      corrections: rejudged,
    };
  });
}

/** The judgment a Correction was made on: the Launch's first, or the one the latest Correction before it gave. */
export function judgmentBefore(store: Store, correction: Correction): Judgment {
  let shown = store.judgmentsFor(correction.date).find((j) => j.postId === correction.postId)!;
  for (const c of store.correctionsFor(correction.date)) {
    if (c.id >= correction.id) break;
    if (c.postId === correction.postId && c.judgment) shown = c.judgment;
  }
  return shown;
}

/**
 * What came of a Correction's sort, as the day's file says it once nothing more waits on it, with the Rules its run
 * applied.
 */
function sortNote(sort: StoredSort | undefined): string | null {
  const note = settledSort(sort);
  const rules = sort?.rulesApplied.length ? ` (Rules applied: ${sort.rulesApplied.join(', ')})` : '';
  return note && `${note}${rules}`;
}

function settledSort(sort: StoredSort | undefined): string | null {
  switch (sort?.outcome) {
    case 'fix-only':
      return 'fix only';
    case 'unsorted':
      return `fix only, as it couldn't be sorted: ${sort.why}`;
    case 'declined':
      return declinedText(sort.hardLimit!);
    case 'proposed': {
      const p = sort.proposal!;
      if (sort.discardedAt) return 'fix only, its proposal discarded';
      if (!sort.keptAt) return null;
      if (p.kind === 'interest-scope') return 'changed the Interest scope';
      return `${p.kind === 'rule' ? 'taught' : 'amended'} the Rule "${p.name}"`;
    }
    default:
      return null;
  }
}

/** The date's post as it now reads, from its stored line: the summary, its Retry notices, then its bands. */
export function dayPostOf(store: Store, date: string): RenderedDayPost {
  const launches = dayLaunches(store, date);
  const productPosts = new Map<string, string>();
  for (const l of launches) {
    const post = store.productOfLaunch(l.postId)?.threadId;
    if (post) productPosts.set(l.postId, post);
  }
  const { title, messages, launchesIn } = renderDayPost({ date, line: store.dayLine(date)!, launches, productPosts });
  const notices = store.minerRetries(date).map((retry) => renderRetryNotice(retry));
  return {
    title,
    messages: [messages[0]!, ...notices, ...messages.slice(1)],
    launchesIn: [launchesIn[0]!, ...notices.map(() => []), ...launchesIn.slice(1)],
  };
}

/** The date's `days/` file, written from the store, with what changed it if that is given, such as a Correction. */
export function dayFileOf(store: Store, date: string, change?: string): DayFile {
  return renderDayFile({ date, line: store.dayLine(date)!, launches: dayLaunches(store, date), ...(change ? { change } : {}) });
}
