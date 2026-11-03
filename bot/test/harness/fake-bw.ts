// A fake `bw`: one process per command, as the real CLI is, with the Password vault's state in a folder the test reads
// (`fake-bitwarden.ts`). It answers as @bitwarden/cli 2026.10.0 was seen to on 2026-11-03: run with no account, it printed
// `status` as JSON on stdout, and its errors ("You are not logged in.") on stderr with exit code 1, and its help says
// `create` takes the encoded item on stdin. Its source (`build/bw.js`) gave the rest: a list prints a JSON array, a created
// item prints as JSON with its id and password, `unlock --raw` prints only the session key, and without
// --nointeraction a locked vault asks for the password.
//
// No real account has run through it, so `login`, `unlock`, `sync`, `list collections`, `create item` and `list items`
// rest on that source alone. #54 closes only after a trial of them on the real account, at its landing, whose script is
// on #54: its result replaces this paragraph.
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

const session = state.sessionKeys.at(-1);
const unlocked = session !== undefined && process.env.BW_SESSION === session;

if (command === 'status') {
  print({ serverUrl: null, lastSync: null, status: !state.loggedIn ? 'unauthenticated' : unlocked ? 'unlocked' : 'locked' });
  save();
  process.exit(0);
}
if (!args.includes('--nointeraction')) fail('The real bw would ask at the terminal here, and wait.');
if (command === 'login') {
  if (control.down) fail('fetch failed');
  const { clientId, clientSecret } = control.account;
  if (process.env.BW_CLIENTID !== clientId || process.env.BW_CLIENTSECRET !== clientSecret) fail('client_id or client_secret is incorrect. Try again.');
  state.loggedIn = true;
  print('You are logged in!');
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
  print(state.items.filter((item) => item.collectionIds.includes(collection!)));
} else if (creating) {
  if (control.down) fail('fetch failed');
  const encoded = input ?? words[2]!;
  const item = { ...JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')), id: randomUUID(), object: 'item' } as VaultItem;
  if (control.holdCreate === 'before') await hold();
  state.items.push(item);
  if (control.holdCreate === 'after') await hold();
  if (control.failAfterCreate) fail('fetch failed');
  print(item);
} else {
  fail(`Invalid command: ${args.join(' ')}`);
}
save();
