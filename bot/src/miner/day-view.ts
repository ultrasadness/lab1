// A Miner day as the store holds it: each Featured Launch with the judgment its line shows, which is its first one or
// the one the person's latest re-judged Correction gave, and its latest Correction. The day post and the day's file
// are both drawn from it, so a Correction changes them alike.
import { asEdit } from '../discord/components.ts';
import type { DiscordRest } from '../discord/rest.ts';
import type { Correction, Judgment, Launch, Store } from '../store.ts';
import { renderDayFile, type DayFile, type DayFileLaunch } from './day-file.ts';
import { renderDayPost, renderRetryNotice, type DayPostLaunch, type RenderedDayPost } from './day-post.ts';
import { sortKey, sortNote } from '../rules/sorting.ts';

// A re-Launch of a Product with a Registration is added to its Dossier, which arrives with #66; until then no Launch counts as one.
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
      rejudged.push({ at: c.judgment.judgedAt, was: judged(shown), text: c.text, sort: sortNote(store.sortOf(sortKey('miner', c.id))) });
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
          declined: store.sortOf(sortKey('miner', c.id))?.hardLimit ?? null,
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

/** The date's post as it now reads, from its stored line: the summary, its Retry notices, then its bands. */
export function dayPostOf(store: Store, date: string): RenderedDayPost {
  const launches = dayLaunches(store, date);
  const productPosts = new Map<string, string>();
  for (const l of launches) {
    const post = store.productOfLaunch(l.postId)?.threadId;
    if (post) productPosts.set(l.postId, post);
  }
  const unwritten = new Map(store.unwrittenDossiers().map((t) => [t.postId, t.why]));
  const { title, messages, launchesIn } = renderDayPost({ date, line: store.dayLine(date)!, launches, productPosts, unwritten });
  const notices = store.minerRetries(date).map((retry) => renderRetryNotice(retry));
  return {
    title,
    messages: [messages[0]!, ...notices, ...messages.slice(1)],
    launchesIn: [launchesIn[0]!, ...notices.map(() => []), ...launchesIn.slice(1)],
  };
}

/**
 * Rewrites the date's posted list as the store now has it: its title and summary, and each message holding one of these
 * Launches' lines. An archived post can't be edited, so the rename unarchives it too.
 */
export async function rewriteDayPost(store: Store, discord: DiscordRest, date: string, postIds: ReadonlySet<string>): Promise<void> {
  const post = store.dayPost(date);
  const threadId = post.threadId!;
  const rendered = dayPostOf(store, date);
  await discord.editThread(threadId, { name: rendered.title, archived: false });
  store.saveDayPostTitle(date, rendered.title);
  for (const [i, message] of rendered.messages.entries()) {
    if (i > 0 && !rendered.launchesIn[i]!.some((id) => postIds.has(id))) continue;
    await discord.editMessage(threadId, post.messageIds[i]!, asEdit(message));
  }
}

/** The date's `days/` file, written from the store, with what changed it if that is given, such as a Correction. */
export function dayFileOf(store: Store, date: string, change?: string): DayFile {
  return renderDayFile({ date, line: store.dayLine(date)!, launches: dayLaunches(store, date), ...(change ? { change } : {}) });
}
