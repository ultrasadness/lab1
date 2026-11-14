// A fake `bw`: one process per command, as the real CLI is, with the Password vault's state in a folder the test reads
// (`fake-bitwarden.ts`). It answers as @bitwarden/cli 2026.10.0 did on the real account on 2026-11-08, in the trial on #54,
// which printed the shape of each answer (`ops/bitwarden/trial` prints them today): `status`, each list and each item as
// JSON on stdout, `unlock --raw` only the session key, 88 characters, and `create` the item it read from stdin, with no
// key for a null it was sent (`notes`, `folderId`, a URI's `match`). With --nointeraction, `login` prints a session key
// inside its message, which nothing needs. The first command on a new data folder says on stderr that it made a data
// file, even when it goes on to succeed. An account on *Can edit, except passwords* gets each password as null, and its
// create still works. An item sent with notes, as a replacement's is (#56), is answered with them under `notes`, after
// `organizationId`, by `create` and by `list items` alike: the trial's run on the real account on 2026-11-14 (#109) was
// the first to send notes, and `ops/test/bitwarden-trial.test.ts` holds what it printed.
//
// What a failure says rests on less, and each one seen was on stderr with exit code 1. "You are not logged in." and a
// wrong API key's line were seen on 2026-11-03, with no account and a made-up key. A login that can't reach the server
// was seen on 2026-11-09, on a closed local port with a made-up key: many lines, the last of them the one this prints,
// with that port's address. The rest comes from the CLI's source (`build/bw.js`), as does that without --nointeraction a
// locked vault asks for the password.
//
//   node fake-bw.ts <folder> <bw's arguments…>
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BitwardenControl, BitwardenState, VaultItem } from './fake-bitwarden.ts';

const [folder, ...args] = process.argv.slice(2) as [string, ...string[]];
const control = JSON.parse(readFileSync(join(folder, 'control.json'), 'utf8')) as BitwardenControl;
const state = JSON.parse(readFileSync(join(folder, 'state.json'), 'utf8')) as BitwardenState;

const save = () => {
  const next = join(folder, `state.${process.pid}.json`);
  writeFileSync(next, JSON.stringify(state));
  renameSync(next, join(folder, 'state.json'));
};
const fail = (message: string): never => {
  process.stderr.write(message);
  save();
  process.exit(1);
};
const print = (value: unknown) => {
  process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
};
/** Says so, and never answers: a kill ends this process, or the bot's time limit does. */
const hold = async () => {
  state.heldCreate = true;
  save();
  setInterval(() => {}, 1000);
  await new Promise(() => {});
};
/** An item as the real `bw` prints it: no key for a null the bot sent, and keys, lists and dates it never sent. */
const answer = (item: VaultItem) => ({
  type: item.type,
  name: item.name,
  favorite: false,
  reprompt: 0,
  id: item.id,
  collectionIds: item.collectionIds,
  object: 'item',
  organizationId: item.organizationId,
  ...(item.notes === null ? {} : { notes: item.notes }),
  fields: [],
  login: { uris: item.login.uris.map(({ uri }) => ({ uri })), fido2Credentials: [], username: item.login.username, password: control.hidesPasswords ? null : item.login.password, passwordRevisionDate: null },
  passwordHistory: [],
  creationDate: new Date().toISOString(),
  revisionDate: new Date().toISOString(),
  attachments: [],
});
const readStdin = async () => {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
};

const words = args.filter((a) => !a.startsWith('--'));
const [command, object] = words;
const creating = command === 'create' && object === 'item';
const input = creating && words.length === 2 ? await readStdin() : undefined;
state.calls.push({
  args,
  env: Object.keys(process.env).filter((name) => name.startsWith('BW_')).sort(),
  stdin: input !== undefined,
});

if (!state.dataFileMade) {
  process.stderr.write(`Could not find data file, "${join(folder, 'data.json')}"; creating it instead.\n`);
  state.dataFileMade = true;
}

const session = state.sessionKeys.at(-1);
const unlocked = session !== undefined && process.env.BW_SESSION === session;

if (command === 'status') {
  print({ serverUrl: null, lastSync: null, status: !state.loggedIn ? 'unauthenticated' : unlocked ? 'unlocked' : 'locked' });
  save();
  process.exit(0);
}
if (!args.includes('--nointeraction')) fail('The real bw would ask at the terminal here, and wait.');
if (command === 'login') {
  if (control.down) fail('FetchError: request to https://identity.bitwarden.com/connect/token failed, reason: connect ECONNREFUSED');
  const { clientId, clientSecret } = control.account;
  if (process.env.BW_CLIENTID !== clientId || process.env.BW_CLIENTSECRET !== clientSecret) fail('client_id or client_secret is incorrect. Try again.');
  state.loggedIn = true;
  const key = randomBytes(64).toString('base64');
  state.loginKeys.push(key);
  print(`You are logged in!\n\nTo unlock your vault, set your session key to the \`BW_SESSION\` environment variable. ex:\n$ export BW_SESSION="${key}"\n\nYou can also pass the session key to any command with the \`--session\` option. ex:\n$ bw list items --session ${key}\n`);
  save();
  process.exit(0);
}
if (!state.loggedIn) fail('You are not logged in.');
if (command === 'unlock') {
  const named = args[args.indexOf('--passwordenv') + 1];
  if (!named || process.env[named] !== control.account.masterPassword) fail('Invalid master password.');
  const key = randomBytes(64).toString('base64');
  state.sessionKeys.push(key);
  print(key);
  save();
  process.exit(0);
}
if (!unlocked) fail('Vault is locked.');
if (command === 'sync') {
  if (control.down) fail('Syncing failed: fetch failed');
  print('Syncing complete.');
} else if (command === 'list' && object === 'collections') {
  print(control.collections);
} else if (command === 'list' && object === 'items') {
  const collection = args[args.indexOf('--collectionid') + 1];
  print(state.items.filter((item) => item.collectionIds.includes(collection!)).map(answer));
} else if (creating) {
  if (control.down) fail('fetch failed');
  const encoded = input ?? words[2]!;
  const item = { ...JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')), id: randomUUID(), object: 'item' } as VaultItem;
  if (control.holdCreate === 'before') await hold();
  state.items.push(item);
  if (control.holdCreate === 'after') await hold();
  if (control.failAfterCreate) fail('fetch failed');
  print(answer(item));
} else {
  fail(`Invalid command: ${args.join(' ')}`);
}
save();
