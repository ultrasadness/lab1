// The bot's side of the Docker helper (ops/docker-helper.ts), and config/assistant.json's `pi.command` on the VM. The
// bot starts it for each run with the run's settings in its environment (bot/src/pi-runs.ts). It asks the helper for
// that run, relays its own stdin and stdout over the helper's socket, writes the end of the run's stderr to its own,
// and exits with the run's exit code, so the bot sees Pi as if it had started it itself.
import { connect } from 'node:net';
import { EXIT_KEY } from './docker-helper.ts';

const socketPath = process.env.ASSISTANT_DOCKER_SOCKET ?? '/run/assistant-docker.sock';
const CONNECT_WAIT_MS = 10_000;

const fail = (message: string): never => {
  process.stderr.write(`run-pi: ${message}\n`);
  process.exit(1);
};

const request = {
  command: 'run',
  role: process.env.ASSISTANT_ROLE ?? fail('ASSISTANT_ROLE is not set'),
  kind: process.env.ASSISTANT_RUN_KIND ?? fail('ASSISTANT_RUN_KIND is not set'),
  token: process.env.ASSISTANT_RUN_TOKEN ?? fail('ASSISTANT_RUN_TOKEN is not set'),
  botUrl: process.env.ASSISTANT_BOT_URL ?? fail('ASSISTANT_BOT_URL is not set'),
};

const socket = connect(socketPath);
const connecting = setTimeout(() => fail(`the Docker helper at ${socketPath} did not answer within ${CONNECT_WAIT_MS / 1000} seconds`), CONNECT_WAIT_MS);
socket.once('error', (e) => fail(`the Docker helper at ${socketPath} can't be reached: ${e.message}`));
socket.once('connect', () => {
  clearTimeout(connecting);
  socket.write(`${JSON.stringify(request)}\n`);
  process.stdin.pipe(socket);
});

// Pi's records are JSON lines; the helper's exit line comes last, and goes no further.
let pending = Buffer.alloc(0);
let exit: { code: number; stderr: string } | undefined;
socket.on('data', (chunk: Buffer) => {
  pending = Buffer.concat([pending, chunk]);
  let newline: number;
  while (!exit && (newline = pending.indexOf(0x0a)) >= 0) {
    const line = pending.subarray(0, newline + 1);
    pending = pending.subarray(newline + 1);
    if (line.toString('utf8').startsWith(`{"${EXIT_KEY}":`)) {
      exit = JSON.parse(line.toString('utf8')) as { code: number; stderr: string };
    } else {
      process.stdout.write(line);
    }
  }
});
socket.once('close', () => {
  if (!exit) return fail('the Docker helper closed the connection without the run exit code');
  if (pending.length > 0) process.stdout.write(pending);
  if (exit.stderr) process.stderr.write(exit.stderr.endsWith('\n') ? exit.stderr : `${exit.stderr}\n`);
  process.stdout.end(() => process.exit(exit!.code));
});

// Stopping the run closes the connection, and the helper then ends Pi's stdin.
process.once('SIGTERM', () => {
  socket.destroy();
  process.exit(143);
});
