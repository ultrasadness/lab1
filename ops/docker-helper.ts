// The Docker helper (ADR 0009): the only way the bot reaches Docker, since its user has no `docker` group. systemd runs
// it as root for each connection to /run/assistant-docker.sock, which only the bot's group may open
// (ops/systemd/assistant-docker.socket), with the connection as stdin. The connection's first line asks for one of
// exactly two commands, as JSON:
//
//   {"command":"run","role":…,"kind":…,"token":…,"botUrl":…}
//       starts one `pi --mode rpc` process for a role in the Pi container, through pi/pi-run, and relays the
//       connection to its stdin and its stdout to the connection;
//   {"command":"digests"}
//       reports each running container's image and digests, one JSON line each, for the ops/pins check.
//
// Either way the last line is {"assistant-docker":"exit","code":…,"stderr":…}: the command's exit code and the end of
// what it wrote to stderr. ops/run-pi.ts is the bot's side. The run token is never logged: the helper's own lines,
// which go to the journal, name only the command, role and kind.
import { spawn } from 'node:child_process';
import { Socket } from 'node:net';

/** The key of the last line, which carries the exit code. */
export const EXIT_KEY = 'assistant-docker';
/** The container `docker compose` starts from compose.yaml's `pi` service. */
const PI_CONTAINER = 'assistant-pi';
const REQUEST_LIMIT = 64 * 1024;
const REQUEST_WAIT_MS = 10_000;
/** How long Pi has to exit once the bot's side has closed its end. */
const EXIT_GRACE_MS = 10_000;
const DOCKER_TIMEOUT_MS = 30_000;
const STDERR_KEPT = 4000;

export type Request =
  | { command: 'run'; role: string; kind: string; token: string; botUrl: string }
  | { command: 'digests' };

/** The request in a first line, or why it is refused. Anything but the two commands, or an odd value, is refused. */
export function parseRequest(line: string): Request | { refused: string } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { refused: 'the request is not JSON' };
  }
  const request = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  if (request.command === 'digests' && Object.keys(request).length === 1) return { command: 'digests' };
  if (request.command !== 'run') return { refused: 'the command is neither run nor digests' };
  const fields = { role: /^[a-z][a-z-]{0,31}$/, kind: /^[a-z][a-z-]{0,47}$/, token: /^[A-Za-z0-9_-]{16,128}$/, botUrl: /^http:\/\/\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/ };
  for (const [name, pattern] of Object.entries(fields)) {
    if (typeof request[name] !== 'string' || !pattern.test(request[name])) return { refused: `run needs a valid ${name}` };
  }
  if (Object.keys(request).length !== 5) return { refused: 'run takes only role, kind, token and botUrl' };
  return request as Request;
}

const exitLine = (code: number, stderr: string) => `${JSON.stringify({ [EXIT_KEY]: 'exit', code, stderr: stderr.slice(-STDERR_KEPT) })}\n`;

/** Serves one connection, given as a socket: reads its request, runs it and writes the exit line. */
export async function serve(connection: Socket, log: (line: string) => void): Promise<void> {
  const first = await firstLine(connection);
  if ('refused' in first) {
    log(`refused: ${first.refused}`);
    connection.end(exitLine(2, `The Docker helper refused the request: ${first.refused}`));
    return;
  }
  const request = parseRequest(first.line);
  if ('refused' in request) {
    log(`refused: ${request.refused}`);
    connection.end(exitLine(2, `The Docker helper refused the request: ${request.refused}`));
    return;
  }
  if (request.command === 'digests') {
    log('digests');
    const { code, stderr } = await digests(connection);
    connection.end(exitLine(code, stderr));
    return;
  }
  log(`run role=${request.role} kind=${request.kind}`);
  const { code, stderr } = await run(request, connection, first.rest);
  log(`run role=${request.role} kind=${request.kind} exited ${code}`);
  if (connection.writable) connection.end(exitLine(code, stderr));
}

/** The connection's first line and what came after it, read within a time limit and a size limit. */
function firstLine(connection: Socket): Promise<{ line: string; rest: Buffer } | { refused: string }> {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    const done = (result: { line: string; rest: Buffer } | { refused: string }) => {
      clearTimeout(timer);
      connection.off('data', onData);
      connection.off('end', onEnd);
      connection.pause();
      resolve(result);
    };
    const timer = setTimeout(() => done({ refused: `no request came within ${REQUEST_WAIT_MS / 1000} seconds` }), REQUEST_WAIT_MS);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(0x0a);
      if (newline >= 0) return done({ line: buffer.subarray(0, newline).toString('utf8'), rest: buffer.subarray(newline + 1) });
      if (buffer.length > REQUEST_LIMIT) done({ refused: 'the request is too long' });
    };
    const onEnd = () => done({ refused: 'the connection closed before a request' });
    connection.on('data', onData);
    connection.once('end', onEnd);
  });
}

/** Runs Pi for one run, relaying the connection, and resolves with its exit code and the end of its stderr. */
function run(request: Extract<Request, { command: 'run' }>, connection: Socket, rest: Buffer): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    // The run's values reach the container by name from this process's environment, never on a command line.
    const child = spawn(
      'docker',
      ['exec', '-i', '-e', 'ASSISTANT_ROLE', '-e', 'ASSISTANT_RUN_KIND', '-e', 'ASSISTANT_RUN_TOKEN', '-e', 'ASSISTANT_BOT_URL', PI_CONTAINER, 'pi-run'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          ...(process.env.DOCKER_CONFIG ? { DOCKER_CONFIG: process.env.DOCKER_CONFIG } : {}),
          ASSISTANT_ROLE: request.role,
          ASSISTANT_RUN_KIND: request.kind,
          ASSISTANT_RUN_TOKEN: request.token,
          ASSISTANT_BOT_URL: request.botUrl,
        },
      },
    );
    let stderr = '';
    let killer: NodeJS.Timeout | undefined;
    let exited = false;
    let lineOpen = false;
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_KEPT);
    });
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk: Buffer) => {
      lineOpen = chunk[chunk.length - 1] !== 0x0a;
    });
    child.stdout.pipe(connection, { end: false });
    if (rest.length > 0) child.stdin.write(rest);
    connection.pipe(child.stdin);
    // Once the bot's side closes, Pi gets the end of its stdin, which asks it to shut down; one that doesn't is killed.
    const closed = () => {
      if (exited) return;
      child.stdin.end();
      killer ??= setTimeout(() => child.kill('SIGKILL'), EXIT_GRACE_MS);
    };
    connection.once('end', closed);
    connection.once('close', closed);
    connection.on('error', () => {});
    connection.resume();
    child.once('error', (e) => {
      stderr += `\nthe docker client could not start: ${e.message}`;
    });
    child.once('close', (code, signal) => {
      exited = true;
      clearTimeout(killer);
      connection.unpipe(child.stdin);
      // The exit line starts a line of its own, even after output that didn't end one.
      if (lineOpen && connection.writable) connection.write('\n');
      resolve({ code: code ?? (signal === 'SIGKILL' ? 137 : 1), stderr });
    });
  });
}

/** Writes one line per running container: its name, image, image id and repo digests. */
async function digests(connection: Socket): Promise<{ code: number; stderr: string }> {
  const ps = await docker(['ps', '-q', '--no-trunc']);
  if (ps.code !== 0) return ps;
  const ids = ps.stdout.split('\n').filter(Boolean);
  if (ids.length === 0) return { code: 0, stderr: '' };
  const containers = await docker(['inspect', '--type', 'container', '--format', '{{json .Name}}\t{{json .Config.Image}}\t{{json .Image}}', ...ids]);
  if (containers.code !== 0) return containers;
  const rows = containers.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t').map((field) => JSON.parse(field) as string));
  const images = await docker(['image', 'inspect', '--format', '{{json .Id}}\t{{json .RepoDigests}}', ...new Set(rows.map((row) => row[2]!))]);
  if (images.code !== 0) return images;
  const repoDigests = new Map(
    images.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, digests] = line.split('\t');
        return [JSON.parse(id!) as string, (JSON.parse(digests!) as string[] | null) ?? []];
      }),
  );
  for (const [name, image, imageId] of rows) {
    connection.write(`${JSON.stringify({ container: name!.replace(/^\//, ''), image, imageId, repoDigests: repoDigests.get(imageId!) ?? [] })}\n`);
  }
  return { code: 0, stderr: '' };
}

function docker(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: DOCKER_TIMEOUT_MS, killSignal: 'SIGKILL' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.once('error', (e) => (stderr += e.message));
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

if (import.meta.main) {
  // The connection is stdin: one socket for both ways, half-open so the bot's end of input still lets Pi's output out.
  const connection = new Socket({ fd: 0, readable: true, writable: true, allowHalfOpen: true });
  await serve(connection, (line) => console.error(line));
}
