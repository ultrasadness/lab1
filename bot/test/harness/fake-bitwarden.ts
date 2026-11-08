// Bitwarden as a test sees it: the *Registrations* collection and the items in it, each `bw` command the bot ran, and
// the switches that make Bitwarden fail. The bot runs the fake CLI in `fake-bw.ts`, which keeps its state in a folder
// here, so a test reads what a real vault and command line would show, across restarts and kills of the bot.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface VaultItem {
  id: string;
  organizationId: string;
  collectionIds: string[];
  type: number;
  name: string;
  notes: string | null;
  login: { username: string; password: string; uris: { match: number | null; uri: string }[]; totp: string | null };
}

/** One `bw` command the bot ran: its arguments, which `BW_` variables it was given, and whether it read stdin. */
export interface BwCall {
  args: string[];
  env: string[];
  stdin: boolean;
}

/** What `fake-bw.ts` writes. */
export interface BitwardenState {
  /** Whether the CLI's data folder holds a login, which lasts across runs of the bot. */
  loggedIn: boolean;
  /** Each session key `bw unlock` printed; only the latest opens the vault. */
  sessionKeys: string[];
  /** Each session key `bw login` printed inside its message, which opens nothing the bot needs. */
  loginKeys: string[];
  items: VaultItem[];
  calls: BwCall[];
  /** Whether a `create item` has reached the point `holdCreate` names. */
  heldCreate: boolean;
}

/** What a test sets, which `fake-bw.ts` reads. */
export interface BitwardenControl {
  account: { clientId: string; clientSecret: string; masterPassword: string };
  collections: { object: 'collection'; id: string; organizationId: string; name: string }[];
  down: boolean;
  /** Where a `create item` stops and never answers: before the vault has the item, or after. */
  holdCreate: 'before' | 'after' | null;
  failAfterCreate: boolean;
}

const ORGANIZATION = '3f0c2b1e-0000-4000-8000-00000000000a';
export const REGISTRATIONS = '3f0c2b1e-0000-4000-8000-00000000000b';

export class FakeBitwarden {
  /** How the bot runs this `bw`. */
  readonly command: string[];
  #folder: string;
  #control: BitwardenControl;

  constructor(folder: string, account: BitwardenControl['account']) {
    mkdirSync(folder, { recursive: true });
    this.#folder = folder;
    this.command = [process.execPath, fileURLToPath(new URL('./fake-bw.ts', import.meta.url)), folder];
    this.#control = {
      account,
      collections: [{ object: 'collection', id: REGISTRATIONS, organizationId: ORGANIZATION, name: 'Registrations' }],
      down: false,
      holdCreate: null,
      failAfterCreate: false,
    };
    this.#setControl({});
    writeFileSync(join(folder, 'state.json'), JSON.stringify({ loggedIn: false, sessionKeys: [], loginKeys: [], items: [], calls: [], heldCreate: false } satisfies BitwardenState));
  }

  get #state(): BitwardenState {
    return JSON.parse(readFileSync(join(this.#folder, 'state.json'), 'utf8')) as BitwardenState;
  }

  #setControl(change: Partial<BitwardenControl>): void {
    this.#control = { ...this.#control, ...change };
    const next = join(this.#folder, 'control.next.json');
    writeFileSync(next, JSON.stringify(this.#control));
    renameSync(next, join(this.#folder, 'control.json'));
  }

  /** The items in the vault, oldest first. */
  get items(): VaultItem[] {
    return this.#state.items;
  }

  /** Every `bw` command the bot ran, oldest first. */
  get calls(): BwCall[] {
    return this.#state.calls;
  }

  /** Each session key `bw` has given the bot. */
  get sessionKeys(): string[] {
    return this.#state.sessionKeys;
  }

  /** Each session key `bw login` has printed. */
  get loginKeys(): string[] {
    return this.#state.loginKeys;
  }

  /** Whether a `create item` is being held, as `holdCreate` asks. */
  get heldCreate(): boolean {
    return this.#state.heldCreate;
  }

  /** While true, Bitwarden's servers don't answer: a login, a sync and a create fail. */
  set down(down: boolean) {
    this.#setControl({ down });
  }

  /** Has a `create item` take its request and never answer, as a test's way to kill the bot in the middle of one. */
  set holdCreate(holdCreate: BitwardenControl['holdCreate']) {
    this.#setControl({ holdCreate });
  }

  /** While true, a `create item` fails after the vault has taken the item, as when the answer is lost on the way back. */
  set failAfterCreate(failAfterCreate: boolean) {
    this.#setControl({ failAfterCreate });
  }

  /** The bot's account sees these collections besides *Registrations*, as if it had been given more. */
  addCollection(name: string): void {
    this.#setControl({ collections: [...this.#control.collections, { object: 'collection', id: `other-${name}`, organizationId: ORGANIZATION, name }] });
  }

  /** Takes back what `addCollection` gave. */
  removeOtherCollections(): void {
    this.#setControl({ collections: this.#control.collections.filter((c) => c.id === REGISTRATIONS) });
  }

  /** The person changed the bot's master password, so the one in its credentials no longer unlocks the vault. */
  set masterPassword(masterPassword: string) {
    this.#setControl({ account: { ...this.#control.account, masterPassword } });
  }
}
