// A Walkthrough with a password field put to the person, as the tests of the Password vault and the last door use it.
import type { FakePage } from './fake-browser.ts';
import type { ScriptedWalkthrough } from './fake-model.ts';
import { fixtureDay } from './fake-product-hunt.ts';
import { CODEMIND, serveProduct, type FixtureProduct } from './dossier-fixtures.ts';
import { NEEDS_YOU, PERSON, startWorld, type World } from './world.ts';

const SIGNUP: FakePage = {
  url: 'https://app.codemindhq.dev/',
  title: 'Create your Codemind account',
  text: 'Create your Codemind account · Email · Password · Company · Create account',
  forms: [
    {
      formElement: true,
      action: null,
      method: 'post',
      fields: [
        { type: 'email', name: 'email', label: 'Email', required: true, autocomplete: 'email', links: [] },
        { type: 'password', name: 'password', label: 'Password', required: true, autocomplete: 'new-password', links: [] },
        { type: 'text', name: 'company', label: 'Company', required: false, autocomplete: null, links: [] },
      ],
      submits: [{ label: 'Create account', disabled: false }],
      links: [],
    },
  ],
};

/** Codemind, whose signup form asks for a password, and a company that the plain Walkthrough leaves empty. */
export const WITH_PASSWORD: FixtureProduct = { ...CODEMIND, signup: SIGNUP };

/**
 * Oct 12 posted at 01:00 PDT, with this Product's Dossier alone and its Walkthrough in #needs-you, as `change` makes the
 * plain Walkthrough if it is given, by a bot started with `start`'s options.
 */
export async function walkthroughPut(
  t: { after(fn: () => Promise<void>): void },
  product: FixtureProduct,
  options: {
    change?: (walkthrough: ScriptedWalkthrough) => ScriptedWalkthrough;
    start?: Partial<Parameters<typeof startWorld>[0]>;
    /** Sets up the outside world before the day starts. */
    before?: (world: World) => void;
  } = {},
): Promise<World> {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', ...options.start }); // 00:30 PDT
  t.after(() => world.stop());
  options.before?.(world);
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([product.postId]);
  serveProduct(world, product);
  const { change } = options;
  if (change) {
    const plain = world.model.walkthrough;
    world.model.walkthrough = (run) => {
      const walkthrough = plain(run);
      return walkthrough === 'none' ? walkthrough : change(walkthrough);
    };
  }
  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT
  await world.discord.connected();
  await world.assistant.whenIdle();
  return world;
}

/** The person taps Approve on the Walkthrough's card. */
export async function approve(world: World): Promise<void> {
  const card = world.discord.cards(NEEDS_YOU)[0]!;
  const button = card.buttons.find((b) => b.label === 'Approve')!;
  await world.discord.tap({ userId: PERSON, customId: button.customId, channelId: NEEDS_YOU, messageId: card.id });
}
