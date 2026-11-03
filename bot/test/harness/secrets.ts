// Where a Secret's value shows, for the tests of #54: outside the bot, and in everything the bot writes. A test asks by
// value and is told only where it found one, so this reads nothing else the live store's files hold.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { World } from './world.ts';

/** A value as it may be carried: as it stands, in a JSON string, in a JSON string inside another, and in a URL. */
const formsOf = (value: string) => [value, JSON.stringify(value).slice(1, -1), JSON.stringify(JSON.stringify(value)).slice(3, -3), encodeURIComponent(value)];

/** Every file under a folder, with its path. */
function filesUnder(dir: string): { path: string; bytes: Buffer }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((file) => join(dir, file))
    .filter((path) => statSync(path).isFile())
    .map((path) => ({ path, bytes: readFileSync(path) }));
}

/** Which outside services received this value: the model provider, Discord, or GitHub in any commit. */
export function whoReceived(world: World, value: string): string[] {
  const forms = formsOf(value);
  const received: string[] = [];
  if (world.model.requests.some((r) => forms.some((form) => r.raw.includes(form)))) received.push('the model provider');
  if (world.discord.bodies.some((body) => forms.some((form) => body.includes(form)))) received.push('Discord');
  const history = world.git.history();
  if (forms.some((form) => history.includes(form))) received.push('GitHub');
  return received;
}

/**
 * Everywhere this value shows outside `bw`: what `whoReceived` says, any log line, any file the bot writes on the VM, the
 * live store's and its write-ahead log among them, and any argument of a `bw` command, since a command line is open to
 * every process on the VM.
 */
export function whereItShows(world: World, value: string): string[] {
  const forms = formsOf(value);
  const seen = whoReceived(world, value);
  const logs = JSON.stringify(world.logs);
  if (forms.some((form) => logs.includes(form))) seen.push('a log line');
  if (world.bitwarden.calls.some((call) => forms.some((form) => call.args.join(' ').includes(form)))) seen.push('a command line');
  for (const { path, bytes } of [...filesUnder(world.dataDir), ...filesUnder(world.checkout)]) {
    if (forms.some((form) => bytes.includes(form))) seen.push(path);
  }
  return seen;
}
