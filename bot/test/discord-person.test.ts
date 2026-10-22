// Who the bot answers on Discord: only the person's own user id, with no privileged gateway intent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EPHEMERAL, PRIVILEGED_INTENTS, popupOf } from './harness/fake-discord.ts';
import { MINER_DAYS_FORUM, PERSON, STRANGER, startWorld } from './harness/world.ts';
import { fixtureDay } from './harness/fake-product-hunt.ts';

test('the bot uses no privileged intent and acts only for the person', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  await world.advanceTo('2026-10-12T08:00:00Z');
  await world.discord.connected();

  assert.ok(world.discord.identifies.length > 0);
  for (const identify of world.discord.identifies) assert.equal(identify.intents & PRIVILEGED_INTENTS, 0);

  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  const runs = world.model.runs.length;
  const band = post!.messages[1]!;
  const correct = band.lines[0]!.button!;

  const stranger = await world.discord.tap({ userId: STRANGER, customId: correct.customId, channelId: post!.id, messageId: band.id });
  assert.equal(stranger.type, 4);
  assert.ok((stranger.data?.flags ?? 0) & EPHEMERAL, 'only the one who tapped sees the answer');
  assert.equal(stranger.data?.content, 'This Assistant acts only for its person.');

  // The person's tap opens Correct's pop-up, and changes nothing until they send it.
  const person = await world.discord.tap({ userId: PERSON, customId: correct.customId, channelId: post!.id, messageId: band.id });
  assert.equal(popupOf(person)?.title, 'Correct · Dropstone CLI');
  assert.equal(world.model.runs.length, runs, 'no tap started a run');
  assert.deepEqual(world.discord.forumPosts(MINER_DAYS_FORUM), [post]);

  // A stranger who sends the pop-up anyway corrects nothing.
  const sent = await world.discord.submitPopup({ userId: STRANGER, customId: correct.customId, channelId: post!.id, messageId: band.id, fields: { what: 'Not for you.' } });
  assert.equal(sent.data?.content, 'This Assistant acts only for its person.');
  await world.assistant.whenIdle();
  assert.equal(world.model.runs.length, runs);
  assert.deepEqual(world.discord.forumPosts(MINER_DAYS_FORUM), [post]);
});
