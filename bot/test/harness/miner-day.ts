// A posted Miner day and the person's Corrections of its lines, as the Corrections and Rules tests use them.
import { setTimeout as delay } from 'node:timers/promises';
import { popupOf, type InteractionReply, type SeenLine, type SeenMessage, type SeenPost } from './fake-discord.ts';
import { MINER_DAYS_FORUM, PERSON, startWorld, type World } from './world.ts';
import { fixtureDay } from './fake-product-hunt.ts';
import type { ScriptedJudgment } from './fake-model.ts';
import type { Config } from '../../src/config.ts';
import { serveProduct, type FixtureProduct } from './dossier-fixtures.ts';

/**
 * Oct 12 posted at 01:00 PDT with no Launch at or above its line of 7, but these Products' Launches, by a bot whose
 * config `configure` changes if it is given.
 */
export async function dayPosted(
  t: { after(fn: () => Promise<void>): void },
  dossiers: FixtureProduct[] = [],
  configure?: (config: Config) => void,
): Promise<World> {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', ...(configure ? { configure } : {}) }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers(dossiers.map((d) => d.postId));
  for (const product of dossiers) serveProduct(world, product);
  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT
  await world.discord.connected();
  return world;
}

/** The first day post in the Miner days forum. */
export const dayPost = (world: World): SeenPost => world.discord.forumPosts(MINER_DAYS_FORUM)[0]!;

/** The day post's line for a Launch, by its name, with the message it is in. */
export function lineOf(world: World, name: string): { post: SeenPost; message: SeenMessage; line: SeenLine } {
  const post = dayPost(world);
  for (const message of post.messages) {
    const line = message.lines.find((l) => l.text.startsWith(`**[${name}](`));
    if (line) return { post, message, line };
  }
  throw new Error(`No line for ${name} in the day post`);
}

/** Waits until the condition holds, for at most 10 seconds, or longer for what takes several runs to reach. */
export async function until(condition: () => boolean, seconds = 10): Promise<void> {
  for (let waited = 0; !condition(); waited += 20) {
    if (waited > seconds * 1000) throw new Error(`Waited ${seconds} seconds in vain`);
    await delay(20);
  }
}

/** Has the model judge this Launch so from now on, as a re-judging run would. */
export function rejudges(world: World, postId: string, judgment: ScriptedJudgment): void {
  const before = world.model.judgment;
  world.model.judgment = (id) => (id === postId ? judgment : before(id));
}

/** The person taps Correct on the Launch's line and sends what it got wrong. Resolves with the bot's reply to that. */
export async function correct(world: World, name: string, what: string): Promise<InteractionReply> {
  const { post, message, line } = lineOf(world, name);
  const opened = await world.discord.tap({ userId: PERSON, customId: line.button!.customId, channelId: post.id, messageId: message.id });
  const popup = popupOf(opened)!;
  return world.discord.submitPopup({
    userId: PERSON,
    customId: popup.customId,
    channelId: post.id,
    messageId: message.id,
    fields: { [popup.fields[0]!.customId]: what },
  });
}
