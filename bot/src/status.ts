// #status (#40 §7): a plain text channel for operational lines, such as the Miner's late and dropped lines. Every
// line is silent and mentions nobody. Anything that needs the person goes elsewhere, with a button.
import { silentLine } from './discord/components.ts';
import type { DiscordRest } from './discord/rest.ts';
import type { Log } from './log.ts';

export class Status {
  #discord: DiscordRest;
  #channelId: string;
  #log: Log;

  constructor(options: { discord: DiscordRest; channelId: string; log: Log }) {
    this.#discord = options.discord;
    this.#channelId = options.channelId;
    this.#log = options.log;
  }

  async say(line: string): Promise<void> {
    await this.#discord.sendMessage(this.#channelId, silentLine(line));
    this.#log('status.said', { line });
  }
}
