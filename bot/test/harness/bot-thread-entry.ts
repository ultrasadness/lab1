// The start of the bot's thread (`bot-thread.ts`): the real bot, on a clock that moves with the test's, answering what
// the test asks.
import { parentPort, workerData } from 'node:worker_threads';
import { startAssistant, type Assistant } from '../../src/assistant.ts';
import type { BotThreadData, FromBot, ToBot } from './bot-thread.ts';
import { FakeClock } from './fake-clock.ts';

const { config, credentialsDir, now, clockMoves, migrations, logPort } = workerData as BotThreadData;
const clock = new FakeClock(now);
const moves = new Int32Array(clockMoves);
const toTest = (message: FromBot) => parentPort!.postMessage(message);

const take = (assistant: Assistant, message: ToBot): void => {
  if (message.kind === 'clock') {
    try {
      clock.advanceTo(message.when);
    } finally {
      Atomics.add(moves, 0, 1);
      Atomics.notify(moves, 0);
    }
    return;
  }
  assistant[message.kind]().then(
    () => toTest({ kind: 'answer', id: message.id }),
    (error: unknown) => toTest({ kind: 'answer', id: message.id, error }),
  );
};

startAssistant({ config, credentialsDir, clock, migrations, log: (entry) => logPort.postMessage(entry) }).then(
  (assistant) => {
    parentPort!.on('message', (message: ToBot) => take(assistant, message));
    toTest({ kind: 'started' });
  },
  (error: unknown) => toTest({ kind: 'start-failed', error }),
);
