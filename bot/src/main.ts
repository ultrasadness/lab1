// Starts the bot as a service: `node bot/src/main.ts`, with the config at $ASSISTANT_CONFIG (default
// config/assistant.json) and the tokens in $CREDENTIALS_DIRECTORY, as systemd's LoadCredential= hands them over.
import { startAssistant } from './assistant.ts';
import { systemClock } from './clock.ts';
import { loadConfig } from './config.ts';

const credentialsDir = process.env.CREDENTIALS_DIRECTORY;
if (!credentialsDir) {
  console.error('CREDENTIALS_DIRECTORY is not set: start the bot through its systemd unit, which hands over the tokens.');
  process.exit(1);
}

const config = loadConfig(process.env.ASSISTANT_CONFIG ?? new URL('../../config/assistant.json', import.meta.url).pathname);
const assistant = await startAssistant({ config, credentialsDir, clock: systemClock });

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void assistant.stop().then(() => process.exit(0));
  });
}
