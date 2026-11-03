// The last door (ADR 0009): every other way of keeping a Secret from a model, the person's Discord or git can fail, so
// the bot refuses any model request, at the forwarder, any Discord payload and any commit to the Personal database
// holding the exact value of a Secret it holds, and tells the person what to replace. It holds its tokens and keys from
// the moment it reads them, and a generated password or a session key from the moment it has one. A value is held only
// in this process's memory, so after a restart a password made earlier isn't held.
import { errorText, type Log } from './log.ts';

/** What the person is told about a Secret: what it is called, and how to replace it. */
export interface HeldSecret {
  name: string;
  replace: string;
}

export type Door = 'a model request' | 'a Discord message' | 'a commit to the Personal database';

const STOPPED: Record<Door, string> = {
  'a model request': 'A model request held its exact value. The bot refused the request, so no provider received it, but the value got as far as a run.',
  'a Discord message': 'A Discord message held its exact value. The bot refused the message, so Discord never received it.',
  'a commit to the Personal database': 'A file for the Personal database held its exact value. The bot didn’t commit it, so GitHub never received it, and that file stays as it was.',
};

/** What goes in a #needs-you notice about a Secret stopped at a door. It holds the Secret's name, never its value. */
export function secretNotice(secret: HeldSecret, door: Door): { heading: string; body: string } {
  return { heading: `Replace ${secret.name}`, body: `${STOPPED[door]} ${secret.replace}` };
}

/**
 * A value as a payload may carry it: as it stands, inside a JSON string, as a tool call's arguments are, and as a URL
 * carries it in a path or in a form's query.
 */
function formsOf(value: string): string[] {
  const whole = value.toWellFormed();
  return [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(whole), new URLSearchParams([['', whole]]).toString().slice(1)];
}

/** Calls `visit` with every string in a JSON-like value, its objects' keys among them. */
function eachString(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') return visit(value);
  if (Array.isArray(value)) return value.forEach((item) => eachString(item, visit));
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    visit(key);
    eachString(item, visit);
  }
}

export class SecretGuard {
  #log: Log;
  #post: (secret: HeldSecret, door: Door) => Promise<void>;
  #plainWork: (work: Promise<void>) => void;
  #forms = new Map<string, HeldSecret>();
  /** The Secrets the person has been told of, or is being told of now, once each while this process runs. */
  #told = new Set<string>();

  constructor(options: {
    log: Log;
    /** Posts the notice about a Secret stopped at a door. */
    post(secret: HeldSecret, door: Door): Promise<void>;
    /** Does plain-code work at once, which never queues in the lane. */
    plainWork(work: Promise<void>): void;
  }) {
    this.#log = options.log;
    this.#post = options.post;
    this.#plainWork = options.plainWork;
  }

  /** Holds a Secret from now on. A token file left empty has no value to look for. */
  hold(value: string, secret: HeldSecret): void {
    if (!value) return;
    for (const form of formsOf(value)) this.#forms.set(form, secret);
  }

  /**
   * Refuses a payload about to leave if it holds a Secret: logs each one and tells the person. Returns their names, for
   * the caller to stop it; none lets it through.
   */
  refuse(payload: unknown, door: Door): string[] {
    const found = new Map<string, HeldSecret>();
    eachString(payload, (text) => {
      for (const [form, secret] of this.#forms) {
        if (text.includes(form)) found.set(secret.name, secret);
      }
    });
    for (const secret of found.values()) {
      this.#log('secret.refused', { door, secret: secret.name });
      this.#tell(secret, door);
    }
    return [...found.keys()];
  }

  /** One notice per Secret. One that doesn't go out is tried again at the next refusal. */
  #tell(secret: HeldSecret, door: Door): void {
    if (this.#told.has(secret.name)) return;
    this.#told.add(secret.name);
    this.#plainWork(
      this.#post(secret, door).catch((error: unknown) => {
        this.#told.delete(secret.name);
        this.#log('secret.notice-failed', { secret: secret.name, error: errorText(error) });
      }),
    );
  }
}
