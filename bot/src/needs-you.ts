// #needs-you (#12): the text channel holding everything that waits on the person. Each card mentions them, so it
// notifies, and once it's handled it shrinks to one line, which an edit does without notifying anyone.
import { Accent, container, Flags, text, type MessagePayload, type Section, type TextDisplay } from './discord/components.ts';
import type { DiscordRest } from './discord/rest.ts';
import type { Log } from './log.ts';

export class NeedsYou {
  #discord: DiscordRest;
  #channelId: string;
  #personUserId: string;
  #log: Log;

  constructor(options: { discord: DiscordRest; channelId: string; personUserId: string; log: Log }) {
    this.#discord = options.discord;
    this.#channelId = options.channelId;
    this.#personUserId = options.personUserId;
    this.#log = options.log;
  }

  /** Posts a card that mentions the person in its heading. */
  async post(heading: string, body: (TextDisplay | Section)[]): Promise<{ messageId: string }> {
    const card: MessagePayload = {
      flags: Flags.IS_COMPONENTS_V2,
      components: [container(Accent.needsYou, [text(`<@${this.#personUserId}> **${heading}**`), ...body])],
      allowed_mentions: { parse: [], users: [this.#personUserId] },
    };
    const { messageId } = await this.#discord.sendMessage(this.#channelId, card);
    this.#log('needs-you.posted', { messageId, heading });
    return { messageId };
  }

  /** Shrinks a handled card to one line. */
  async shrink(messageId: string, line: string): Promise<void> {
    await this.#discord.editMessage(this.#channelId, messageId, {
      flags: Flags.IS_COMPONENTS_V2,
      components: [text(line)],
      allowed_mentions: { parse: [] },
    });
    this.#log('needs-you.shrunk', { messageId, line });
  }
}
