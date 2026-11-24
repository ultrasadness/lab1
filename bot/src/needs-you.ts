// #needs-you (#12): the text channel holding everything that waits on the person. Each card mentions them, so it
// notifies, and once it's handled it shrinks to one line, which an edit does without notifying anyone.
import { actionRow, Accent, container, Flags, text, type Button, type MediaGallery, type MessagePayload, type Section, type TextDisplay } from './discord/components.ts';
import type { Upload } from './discord/rest.ts';
import type { DiscordRest } from './discord/rest.ts';
import type { Log } from './log.ts';

export interface CardOptions {
  /** The card's colour, the needs-you colour unless given. */
  accent?: number;
  /** Buttons below the card. */
  buttons?: Button[];
  /** Files sent with the card, such as the screenshot its media gallery names. */
  files?: Upload[];
}

/** A card that mentions the person in its heading, with any buttons below it. */
export function needsYouCard(personUserId: string, heading: string, body: (TextDisplay | Section | MediaGallery)[], options: CardOptions = {}): MessagePayload {
  return {
    flags: Flags.IS_COMPONENTS_V2,
    components: [
      container(options.accent ?? Accent.needsYou, [text(`<@${personUserId}> **${heading}**`), ...body]),
      ...(options.buttons?.length ? [actionRow(options.buttons)] : []),
    ],
    allowed_mentions: { parse: [], users: [personUserId] },
  };
}

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

  /** A card that mentions the person in its heading, as `needsYouCard` builds it. */
  card(heading: string, body: (TextDisplay | Section | MediaGallery)[], options: CardOptions = {}): MessagePayload {
    return needsYouCard(this.#personUserId, heading, body, options);
  }

  /** Posts a card that mentions the person in its heading. */
  async post(heading: string, body: (TextDisplay | Section | MediaGallery)[], options: CardOptions = {}): Promise<{ messageId: string }> {
    const { messageId } = await this.#discord.sendMessage(this.#channelId, this.card(heading, body, options), options.files);
    this.#log('needs-you.posted', { messageId, heading });
    return { messageId };
  }

  /** Rewrites a card in place, as `card` builds it; an edit notifies nobody. */
  async edit(messageId: string, card: MessagePayload): Promise<void> {
    await this.#discord.editMessage(this.#channelId, messageId, { ...card, flags: Flags.IS_COMPONENTS_V2, allowed_mentions: { parse: [] } });
  }

  /** A handled card as one line, for an edit. */
  shrunk(line: string): MessagePayload {
    return { flags: Flags.IS_COMPONENTS_V2, components: [text(line)], allowed_mentions: { parse: [] } };
  }

  /** Shrinks a handled card to one line. */
  async shrink(messageId: string, line: string): Promise<void> {
    await this.#discord.editMessage(this.#channelId, messageId, this.shrunk(line));
    this.#log('needs-you.shrunk', { messageId, line });
  }
}
