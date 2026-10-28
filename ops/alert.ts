// The alert when a unit gives up (ops/systemd/assistant-alert@.service, #26): signals the check's healthchecks.io ping
// URL as failed, so the person's email goes out at once instead of after the check's grace. It sends no body: the
// email says only what the check is named.
//
//   node ops/alert.ts <check>      with the check's ping URL in $CREDENTIALS_DIRECTORY/ping
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TRIES = 3;
const TRY_TIMEOUT_MS = 10_000;

const check = process.argv[2] ?? 'bot';
const url = readFileSync(join(process.env.CREDENTIALS_DIRECTORY ?? '', 'ping'), 'utf8').trim();
for (let attempt = 1; attempt <= TRIES; attempt++) {
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/fail`, { method: 'POST', signal: AbortSignal.timeout(TRY_TIMEOUT_MS) });
    if (response.ok) {
      console.log(`Signalled the ${check} check as failed.`);
      process.exit(0);
    }
    console.error(`healthchecks.io answered ${response.status} for the ${check} check (try ${attempt} of ${TRIES})`);
  } catch (e) {
    console.error(`healthchecks.io can't be reached for the ${check} check (try ${attempt} of ${TRIES}): ${(e as Error).message}`);
  }
  if (attempt < TRIES) await new Promise((resolve) => setTimeout(resolve, 5000));
}
process.exit(1);
