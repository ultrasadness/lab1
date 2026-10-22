// A Miner day as the store holds it: each Featured Launch with the judgment its line shows, which is its first one or
// the one the person's latest re-judged Correction gave, and its latest Correction. The day post and the day's file
// are both drawn from it, so a Correction changes them alike.
import type { Correction, Judgment, Launch, Store } from '../store.ts';
import { renderDayFile, type DayFile, type DayFileLaunch } from './day-file.ts';
import { renderDayPost, renderRetryNotice, type DayPostLaunch, type RenderedDayPost } from './day-post.ts';

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
      rejudged.push({ at: c.judgment.judgedAt, was: judged(shown), text: c.text });
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
      ...(shown === first ? {} : { first: { ...judged(first), reason: first.reason } }),
      ...(c && {
        correction: {
          text: c.text,
          state: c.judgment ? 're-judged' : c.unjudged ? 'not re-judged' : 're-judging',
          was: judged(latest!.was),
          why: c.unjudged ?? c.problem,
          withdrawnPost: product?.withdrawnAt ? product.threadId : null,
        },
      }),
      corrections: rejudged,
    };
  });
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

/** The date's `days/` file, written from the store, for a Correction of the named Launch if one is given. */
export function dayFileOf(store: Store, date: string, corrected?: string): DayFile {
  return renderDayFile({ date, line: store.dayLine(date)!, launches: dayLaunches(store, date), ...(corrected ? { corrected } : {}) });
}
