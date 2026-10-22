// Discord Components V2 messages, as raw API JSON, and the limits Discord enforces on them.

export const Flags = {
  EPHEMERAL: 1 << 6,
  SUPPRESS_NOTIFICATIONS: 1 << 12,
  IS_COMPONENTS_V2: 1 << 15,
} as const;

/** Discord refuses a Components V2 message over 4,000 characters of text, link URLs included, or 40 components. */
export const MESSAGE_LIMITS = { text: 4000, components: 40 } as const;

export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 } as const;

/** Card colours. A proposed Rule or Interest scope change is purple (#12), never an Approval's. */
export const Accent = { dossiers: 0xe8a33d, progress: 0x4f545c, needsYou: 0xd9534f, rule: 0x9b59b6 } as const;

export interface TextDisplay {
  type: 10;
  content: string;
}
export interface Button {
  type: 2;
  style: number;
  /** Every button has one except a link button, which has a URL instead. */
  custom_id?: string;
  url?: string;
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
/** A row of up to 5 buttons. */
export interface ActionRow {
  type: 1;
  components: Button[];
}
export type Component = TextDisplay | Button | Section | Container | ActionRow;

/** A field the person types into, in a pop-up. */
export interface TextInput {
  type: 4;
  custom_id: string;
  /** 1 is one line, 2 a paragraph. */
  style: 1 | 2;
  required: boolean;
  max_length: number;
  /** What the field holds when the pop-up opens. */
  value?: string;
}
/** A pop-up field with its label. */
export interface Label {
  type: 18;
  label: string;
  component: TextInput;
}

/** A pop-up: Discord allows a title of at most 45 characters. */
export interface Popup {
  custom_id: string;
  title: string;
  components: (TextDisplay | Label)[];
}

export const POPUP_TITLE_LIMIT = 45;

export interface MessagePayload {
  flags: number;
  components: Component[];
  /** Who the message may notify: nobody, unless a user's id is listed. */
  allowed_mentions: { parse: string[]; users?: string[] };
}

/** A plain text message, such as a #status line. */
export interface PlainMessage {
  content: string;
  flags: number;
  allowed_mentions: { parse: string[] };
}

/** Discord refuses plain content over 2,000 characters. */
export const PLAIN_CONTENT_LIMIT = 2000;

export const text = (content: string): TextDisplay => ({ type: 10, content });

export const button = (customId: string, label: string, style: number = ButtonStyle.Secondary, disabled = false): Button => ({
  type: 2,
  style,
  custom_id: customId,
  label,
  ...(disabled ? { disabled } : {}),
});

/** A button that opens a page, and sends the bot nothing. */
export const linkButton = (label: string, url: string): Button => ({ type: 2, style: ButtonStyle.Link, url, label });

export const section = (content: string, accessory: Button): Section => ({ type: 9, components: [text(content)], accessory });

export const actionRow = (buttons: Button[]): ActionRow => ({ type: 1, components: buttons });

export const container = (accent: number, components: (TextDisplay | Section)[]): Container => ({
  type: 17,
  accent_color: accent,
  components,
});

/** A pop-up field: a paragraph unless it is one line, empty unless it holds a value. */
export interface PopupField {
  customId: string;
  label: string;
  maxLength: number;
  oneLine?: boolean;
  value?: string;
}

/** A pop-up with its fields below any text it shows first. Its title is cut to fit. */
export const popup = (customId: string, title: string, texts: string[], ...fields: PopupField[]): Popup => ({
  custom_id: customId,
  title: title.length > POPUP_TITLE_LIMIT ? `${title.slice(0, POPUP_TITLE_LIMIT - 1)}…` : title,
  components: [
    ...texts.map(text),
    ...fields.map(
      (field): Label => ({
        type: 18,
        label: field.label,
        component: {
          type: 4,
          custom_id: field.customId,
          style: field.oneLine ? 1 : 2,
          required: true,
          max_length: field.maxLength,
          ...(field.value === undefined ? {} : { value: field.value }),
        },
      }),
    ),
  ],
});

/** Text cut to at most `max` characters, ending in an ellipsis where it was cut. */
export const cut = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`);

/** A message that never notifies and mentions nobody, whatever its text says. */
export const silentMessage = (components: Component[]): MessagePayload => ({
  flags: Flags.IS_COMPONENTS_V2 | Flags.SUPPRESS_NOTIFICATIONS,
  components,
  allowed_mentions: { parse: [] },
});

/** A plain line that never notifies and mentions nobody, cut to fit Discord's limit. */
export const silentLine = (content: string): PlainMessage => ({
  content: content.length > PLAIN_CONTENT_LIMIT ? `${content.slice(0, PLAIN_CONTENT_LIMIT - 1)}…` : content,
  flags: Flags.SUPPRESS_NOTIFICATIONS,
  allowed_mentions: { parse: [] },
});

/** The same message as an edit. An edit keeps the message's flags and may send only IS_COMPONENTS_V2. */
export const asEdit = (message: MessagePayload): MessagePayload => ({ ...message, flags: Flags.IS_COMPONENTS_V2 });

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
      if (c.type === 17 || c.type === 1) walk(c.components);
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
