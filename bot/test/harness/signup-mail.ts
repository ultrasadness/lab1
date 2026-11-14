// Mail in the Signup mailbox, as the tests of reading it (#57) and of what follows a mail use it. The bot's first read
// of the mailbox stores the history id it starts from, and mail Gmail received before it counts as seen, as after a
// lost store (ADR 0007). So a test delivers mail with `delivered`, which waits for that first read before delivering.
import type { Mail } from './fake-gmail.ts';
import { approve, walkthroughPut, WITH_PASSWORD } from './walkthrough-day.ts';
import { GMAIL_POLL_SECONDS, type World } from './world.ts';

/** Codemind's Signup identity, as its Approval leaves it (#53). */
export const PLUS_ADDRESS = 'you+codemind@gmail.com';

/**
 * Delivers mail to the Signup mailbox once the bot's work is done, its first read among it, and waits for the bot's
 * next read, a poll later. Returns each mail's Gmail message id.
 */
export async function delivered(world: World, ...mail: Mail[]): Promise<string[]> {
  await world.assistant.whenIdle();
  const ids = mail.map((m) => world.gmail.deliver(m));
  await world.advanceTo(new Date(world.clock.now().getTime() + GMAIL_POLL_SECONDS * 1000).toISOString());
  return ids;
}

/**
 * Codemind's Walkthrough approved, and its Registration waiting for verification after the final press, or
 * *registered* when its Walkthrough says it logs in straight away.
 */
export async function registered(t: { after(fn: () => Promise<void>): void }, onSubmit?: 'logged-in'): Promise<World> {
  const world = await walkthroughPut(t, WITH_PASSWORD, onSubmit ? { change: (w) => ({ ...w, onSubmit }) } : {});
  await approve(world);
  await world.assistant.whenIdle();
  return world;
}
