// What the person sees of a Registration, and what they tap: its status message in the Product's post, its cards in
// #needs-you, its tags and its `registration.md`, as the tests of filling, walls and Handoffs read them.
import type { InteractionReply, SeenMessage } from './fake-discord.ts';
import { NEEDS_YOU, PERSON, PRODUCTS_FORUM, type World } from './world.ts';

/** The Registration's status message in the Product's post, as the person now sees it. */
export function statusOf(world: World): SeenMessage {
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  return post!.messages.find((m) => m.text.startsWith('**Registration**'))!;
}

/** What the status message says the Registration is doing: what follows `**Registration** · `, up to the Approval. */
export const standing = (world: World) => statusOf(world).text.split(' · Walkthrough v')[0]!.replace('**Registration** · ', '');

/** Each thing the status message has said the Registration is doing, in order. */
export function statusesShown(world: World): string[] {
  const shown: string[] = [];
  for (const body of world.discord.bodies) {
    const at = body.indexOf('**Registration** · ');
    if (at < 0) continue;
    const what = (JSON.parse(`"${body.slice(at).split('"')[0]!}"`) as string).split(' · Walkthrough v')[0]!.replace('**Registration** · ', '');
    if (shown.at(-1) !== what) shown.push(what);
  }
  return shown;
}

/** The person taps a button on the Registration's status message, by its label. */
export function tapStatus(world: World, label: string): Promise<InteractionReply> {
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  const status = statusOf(world);
  const button = status.buttons.find((b) => b.label === label);
  if (!button) throw new Error(`No ${label} on the status message: ${status.buttons.map((b) => b.label).join(', ') || 'no buttons'}`);
  return world.discord.tap({ userId: PERSON, customId: button.customId, channelId: post!.id, messageId: status.id });
}

/** The person taps a button of a card in #needs-you, by the card's place and the button's label. */
export function tapCard(world: World, index: number, label: string): Promise<InteractionReply> {
  const card = world.discord.cards(NEEDS_YOU).at(index)!;
  const button = card.buttons.find((b) => b.label === label);
  if (!button) throw new Error(`No ${label} on card ${index}: ${card.text}`);
  return world.discord.tap({ userId: PERSON, customId: button.customId, channelId: NEEDS_YOU, messageId: card.id });
}

/** The cards in #needs-you, by their text, oldest first. */
export const cardTexts = (world: World) => world.discord.cards(NEEDS_YOU).map((c) => c.text);

export const registrationFile = (world: World, rootDomain = 'codemindhq.dev') => world.git.file(`products/${rootDomain}/registration.md`)!;
export const logged = (world: World, event: string) => world.logs.filter((l) => l.event === event);
export const tags = (world: World) => world.discord.forumPosts(PRODUCTS_FORUM)[0]!.tags;
