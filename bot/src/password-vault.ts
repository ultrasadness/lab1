// The Password vault (ADR 0004, ADR 0009): a *Registrations* collection in the person's Bitwarden organization, which
// the bot's own account reaches through the `bw` command, one process per operation, so nothing listens. The session
// key lives only in this object's memory and reaches `bw` through its environment. A password reaches `bw` on stdin,
// never on a command line, and the bot makes it here, never a model. The Assistant only creates items: this offers no
// way to change or delete one, so a form that refuses a password, or the plus-address, gets a new item whose notes name
// the one it replaces (ADR 0014). A fill reads the password back, and holds it at the last door from that moment.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { errorText, type Log } from './log.ts';
import { kill } from './process-group.ts';
import type { SecretGuard } from './secret-guard.ts';

/** Bitwarden can't do what was asked now: `bw` failed, took too long or isn't there, or the account isn't as it should be. */
export class PasswordVaultUnavailable extends Error {}

/** What a vault item says, as it is found again: what the person sees in Bitwarden, without the password. */
export interface VaultLogin {
  /** The Product's name. */
  name: string;
  /** The Product's root domain, as a URL, which AutoFill needs. */
  website: string;
  /** The Signup identity's address. */
  username: string;
  /** For a replacement: which item it replaces and why. The first item of a Registration has none. */
  notes?: string;
  /** For a replacement of a refused password: which narrower password it gets, 1 for the first. The first item gets the default. */
  replacement?: number;
}

/** What a new item is made with: a new password, or for a replacement that keeps it, the password the bot read back. */
export type NewItem = VaultLogin & { password?: string };

/** The bot's Bitwarden API key, which logs `bw` in without a prompt. */
export interface ApiKey {
  clientId: string;
  clientSecret: string;
}

/** The one collection the bot's account belongs to. */
const COLLECTION = 'Registrations';
const STDERR_KEPT = 2000;

const PASSWORD_CHARS = 24;
/** Every character class, with the symbols forms take most widely: no quote, backslash, angle bracket or space. */
const PASSWORD_CLASSES = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', '!@#$%^&*-_=+?'];

/**
 * A new random password: 24 characters with every character class (ADR 0004). A form refused that one, so a
 * replacement is narrower: letters and digits alone, 24 of them first, then 16 for a form that caps the length.
 */
function newPassword(replacement = 0): string {
  const pick = (from: string) => from[randomInt(from.length)]!;
  const classes = replacement === 0 ? PASSWORD_CLASSES : PASSWORD_CLASSES.slice(0, 3);
  const length = replacement <= 1 ? PASSWORD_CHARS : 16;
  const every = classes.join('');
  const chars = [...classes.map(pick), ...Array.from({ length: length - classes.length }, () => pick(every))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/** The bot's Bitwarden API key from its token file, or undefined when the file isn't one. */
export function apiKeyOf(text: string): ApiKey | undefined {
  try {
    const key = JSON.parse(text) as { client_id?: unknown; client_secret?: unknown } | null;
    if (typeof key?.client_id === 'string' && typeof key.client_secret === 'string') return { clientId: key.client_id, clientSecret: key.client_secret };
  } catch {
    // A file that isn't JSON is no API key.
  }
  return undefined;
}

/**
 * The *Registrations* collection, from what `bw list collections` printed, or why that isn't it: the only collection the
 * bot's account may see (ADR 0004). `ops/token` asks the same.
 */
export function onlyCollection(listed: unknown): { id: string; organizationId: string } | { problem: string } {
  const collections = (Array.isArray(listed) ? listed : []) as { id?: unknown; organizationId?: unknown; name?: unknown }[];
  const [only] = collections;
  if (collections.length === 1 && only?.name === COLLECTION && typeof only.id === 'string' && typeof only.organizationId === 'string') {
    return { id: only.id, organizationId: only.organizationId };
  }
  return { problem: `the bot's account sees ${collections.length} collection${collections.length === 1 ? '' : 's'}, and should see only ${COLLECTION}` };
}

export class PasswordVault {
  #command: string[];
  #timeoutMs: number;
  #dataDir: string;
  #apiKey: ApiKey | undefined;
  #masterPassword: string;
  #secrets: SecretGuard;
  #log: Log;
  /** The session key of the last unlock. Forgotten whenever `bw` fails, so the next try unlocks again. */
  #session: string | undefined;
  /** `bw` keeps its state in one data folder, so its commands run one at a time. Each is bounded, so this queue is too. */
  #turn: Promise<unknown> = Promise.resolve();
  #running: ChildProcess | undefined;
  #stopped = false;

  constructor(options: {
    command: string[];
    /** How long one `bw` command may take, its own sync with Bitwarden included. */
    timeoutSeconds: number;
    /** `bw`'s data folder, with the login that lasts across runs of the bot (ADR 0009). */
    dataDir: string;
    /** The API key, or undefined when its token file holds none, which leaves Bitwarden unavailable. */
    apiKey: ApiKey | undefined;
    masterPassword: string;
    /** Holds each password and session key from the moment the bot has one. */
    secrets: SecretGuard;
    log: Log;
  }) {
    this.#command = options.command;
    this.#timeoutMs = options.timeoutSeconds * 1000;
    this.#dataDir = options.dataDir;
    this.#apiKey = options.apiKey;
    this.#masterPassword = options.masterPassword;
    this.#secrets = options.secrets;
    this.#log = options.log;
  }

  /** Ends any `bw` command under way, and starts no more. What it was doing counts as unavailable. */
  stop(): void {
    this.#stopped = true;
    if (this.#running) kill(this.#running);
  }

  /**
   * Saves a new item, with a new password unless one is given, as a replacement for a refused `+` keeps the password
   * already filled (ADR 0014). Returns the item's id: the password goes nowhere but `bw`.
   */
  createItem(item: NewItem): Promise<string> {
    return this.#unlocked(async (session) => {
      const collection = await this.#collection(session);
      const password = item.password ?? newPassword(item.replacement);
      this.#hold(password, item.name);
      const encoded = Buffer.from(
        JSON.stringify({
          organizationId: collection.organizationId,
          collectionIds: [collection.id],
          folderId: null,
          type: 1,
          name: item.name,
          notes: item.notes ?? null,
          favorite: false,
          fields: [],
          login: { uris: [{ match: null, uri: item.website }], username: item.username, password, totp: null },
          reprompt: 0,
        }),
      ).toString('base64');
      const created = this.#json(await this.#bw(['create', 'item', '--nointeraction'], { session, stdin: encoded }), 'create item') as { id?: unknown } | null;
      if (typeof created?.id !== 'string') throw new PasswordVaultUnavailable('bw create item answered with no item id');
      return created.id;
    });
  }

  /** The id of an item already saved for this login, if there is one: how a create whose answer never came is settled. */
  findItem(item: VaultLogin): Promise<string | undefined> {
    return this.#unlocked(async (session) => {
      const collection = await this.#collection(session);
      const items = this.#json(await this.#bw(['list', 'items', '--collectionid', collection.id, '--nointeraction'], { session }), 'list items');
      if (!Array.isArray(items)) throw new PasswordVaultUnavailable('bw list items answered with no list');
      const found = (items as { id?: unknown; name?: unknown; notes?: unknown; login?: { username?: unknown; uris?: { uri?: unknown }[] | null } | null }[]).find(
        (i) =>
          i?.name === item.name &&
          (i.notes ?? null) === (item.notes ?? null) &&
          i.login?.username === item.username &&
          Array.isArray(i.login.uris) &&
          i.login.uris.some((u) => u?.uri === item.website),
      );
      return typeof found?.id === 'string' ? found.id : undefined;
    });
  }

  /**
   * Reads an item's password back for a fill by reference, and holds it at the last door from that moment. An account
   * that can't see passwords gets each one as null (#54's trial), which is Bitwarden being unavailable, never a value
   * to fill, and so is an item that isn't there.
   */
  readPassword(itemId: string, name: string): Promise<string> {
    return this.#unlocked(async (session) => {
      const collection = await this.#collection(session);
      const items = this.#json(await this.#bw(['list', 'items', '--collectionid', collection.id, '--nointeraction'], { session }), 'list items');
      if (!Array.isArray(items)) throw new PasswordVaultUnavailable('bw list items answered with no list');
      const item = (items as { id?: unknown; login?: { password?: unknown } | null }[]).find((i) => i?.id === itemId);
      if (!item) throw new PasswordVaultUnavailable(`the Password vault holds no item ${itemId}`);
      const password = item.login?.password;
      if (typeof password !== 'string' || !password) {
        throw new PasswordVaultUnavailable("bw answers the item's password as null: the bot's account may not see passwords");
      }
      this.#hold(password, name);
      return password;
    });
  }

  #hold(password: string, name: string): void {
    this.#secrets.hold(password, { name: `the password of ${name}`, replace: `Change it at ${name}, and in Bitwarden › ${COLLECTION} › ${name}.` });
  }

  /** Runs one operation on a synced, unlocked Password vault, after any before it. A failure forgets the session key. */
  #unlocked<T>(operation: (session: string) => Promise<T>): Promise<T> {
    const turn = this.#turn.then(async () => {
      try {
        const session = await this.#unlock();
        await this.#bw(['sync', '--nointeraction'], { session });
        return await operation(session);
      } catch (error) {
        this.#session = undefined;
        throw error instanceof PasswordVaultUnavailable ? error : new PasswordVaultUnavailable(errorText(error));
      }
    });
    this.#turn = turn.catch(() => {});
    return turn;
  }

  /** The session key in memory, or a new one: logging in first if `bw`'s data folder holds no login. */
  async #unlock(): Promise<string> {
    if (this.#session) return this.#session;
    const status = this.#json(await this.#bw(['status']), 'status') as { status?: unknown } | null;
    if (status?.status === 'unauthenticated') {
      if (!this.#apiKey) throw new PasswordVaultUnavailable('the bitwarden-api-key token holds no client_id and client_secret');
      await this.#bw(['login', '--apikey', '--nointeraction'], { env: { BW_CLIENTID: this.#apiKey.clientId, BW_CLIENTSECRET: this.#apiKey.clientSecret } });
      this.#log('password-vault.logged-in');
    }
    const session = (await this.#bw(['unlock', '--passwordenv', 'BW_PASSWORD', '--raw', '--nointeraction'], { env: { BW_PASSWORD: this.#masterPassword } })).trim();
    if (!session) throw new PasswordVaultUnavailable('bw unlock answered with no session key');
    this.#secrets.hold(session, {
      name: 'the Bitwarden session key',
      replace: 'Restart the bot, whose next unlock makes a new one: `sudo systemctl restart assistant.service`.',
    });
    this.#session = session;
    return session;
  }

  /** The *Registrations* collection. Any other answer stops the item from going anywhere else. */
  async #collection(session: string): Promise<{ id: string; organizationId: string }> {
    const only = onlyCollection(this.#json(await this.#bw(['list', 'collections', '--nointeraction'], { session }), 'list collections'));
    if ('problem' in only) throw new PasswordVaultUnavailable(only.problem);
    return only;
  }

  #json(text: string, what: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new PasswordVaultUnavailable(`bw ${what} answered with something that isn't JSON`);
    }
  }

  /** One `bw` command, bounded, with only the variables it needs. Its output or an unavailable vault; never its input. */
  #bw(args: string[], input: { session?: string; env?: Record<string, string>; stdin?: string } = {}): Promise<string> {
    if (this.#stopped) return Promise.reject(new PasswordVaultUnavailable('the Assistant is stopping'));
    const [command, ...fixed] = this.#command;
    return new Promise((resolve, reject) => {
      const child = spawn(command!, [...fixed, ...args], {
        env: {
          PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
          ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
          BITWARDENCLI_APPDATA_DIR: this.#dataDir,
          ...input.env,
          ...(input.session ? { BW_SESSION: input.session } : {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        // It leads its own process group, so a kill reaches what it started too.
        detached: true,
      });
      this.#running = child;
      const out: Buffer[] = [];
      let stderr = '';
      let failure: string | undefined;
      const timer = setTimeout(() => {
        failure = `it took longer than ${this.#timeoutMs / 1000} s`;
        kill(child);
      }, this.#timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_KEPT)));
      child.stdin.on('error', () => {});
      child.stdin.end(input.stdin ?? '');
      child.on('error', (error) => (failure = error.message));
      child.on('close', (code) => {
        clearTimeout(timer);
        this.#running = undefined;
        if (!failure && code === 0) return resolve(Buffer.concat(out).toString('utf8'));
        reject(new PasswordVaultUnavailable(`bw ${args[0]} failed: ${failure ?? (stderr.trim().split('\n').at(-1) || `it exited with ${code}`)}`));
      });
    });
  }
}
