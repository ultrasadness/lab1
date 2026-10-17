// Discord Components V2 messages, as raw API JSON, and the limits Discord enforces on them.

export const Flags = {
  EPHEMERAL: 1 << 6,
  SUPPRESS_NOTIFICATIONS: 1 << 12,
  IS_COMPONENTS_V2: 1 << 15,
} as const;

/** Discord refuses a Components V2 message over 4,000 characters of text, link URLs included, or 40 components. */
export const MESSAGE_LIMITS = { text: 4000, components: 40 } as const;

export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4 } as const;

export const Accent = { dossiers: 0xe8a33d, progress: 0x4f545c } as const;

export interface TextDisplay {
  type: 10;
  content: string;
}
export interface Button {
  type: 2;
  style: number;
  custom_id: string;
  label: string;
  disabled?: boolean;
}
export interface Section {
  type: 9;
  components: TextDisplay[];
  accessory: Button;
}
export interface Container {
  type: 17;
  accent_color?: number;
  components: (TextDisplay | Section)[];
}
export type Component = TextDisplay | Button | Section | Container;

export interface MessagePayload {
  flags: number;
  components: Component[];
  allowed_mentions: { parse: string[] };
}

export const text = (content: string): TextDisplay => ({ type: 10, content });

export const button = (customId: string, label: string, style: number = ButtonStyle.Secondary): Button => ({
  type: 2,
  style,
  custom_id: customId,
  label,
});

export const section = (content: string, accessory: Button): Section => ({ type: 9, components: [text(content)], accessory });

export const container = (accent: number, components: (TextDisplay | Section)[]): Container => ({
  type: 17,
  accent_color: accent,
  components,
});

/** A message that never notifies and mentions nobody, whatever its text says. */
export const silentMessage = (components: Component[]): MessagePayload => ({
  flags: Flags.IS_COMPONENTS_V2 | Flags.SUPPRESS_NOTIFICATIONS,
  components,
  allowed_mentions: { parse: [] },
});

/** What a message spends of Discord's limits. */
export function measure(components: Component[]): { text: number; components: number } {
  let textLength = 0;
  let count = 0;
  const walk = (cs: Component[]) => {
    for (const c of cs) {
      count += 1;
      if (c.type === 10) textLength += c.content.length;
      if (c.type === 2) textLength += c.label.length;
      if (c.type === 9) {
        walk(c.components);
        walk([c.accessory]);
      }
      if (c.type === 17) walk(c.components);
    }
  };
  walk(components);
  return { text: textLength, components: count };
}

export function fits(message: MessagePayload): boolean {
  const used = measure(message.components);
  return used.text <= MESSAGE_LIMITS.text && used.components <= MESSAGE_LIMITS.components;
}

/**
 * Text from outside (Product Hunt, a model) shown as one plain line: no formatting, masked links or mentions of its
 * own. Characters that only format at the start of a line need no escape, since such text never starts one.
 */
export function escapeMarkdown(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[\\*_~`|[\]<>]/g, (c) => `\\${c}`);
}
