// A fake healthchecks.io: each check's ping URL, as hc-ping.com serves it. Tests read when each check was pinged, on
// the test's clock, as the check's history on healthchecks.io shows it, and can have it refuse pings or drop them.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Clock } from '../../src/clock.ts';

export class FakeHealthchecks {
  /** Each success ping, by check, with when it came on the test's clock. */
  readonly pings: { check: string; at: string }[] = [];

  #server: http.Server;
  #clock: Clock;
  #failures: ('refuse' | 'drop')[] = [];

  private constructor(clock: Clock) {
    this.#clock = clock;
    this.#server = http.createServer((req, res) => {
      // A ping URL is the check's own uuid. A ping answers "OK", and one to a uuid that names no check 404.
      const match = (req.url ?? '').match(/^\/([a-z]+)-uuid$/);
      req.resume();
      const failure = this.#failures.shift();
      if (failure === 'drop') {
        req.socket.destroy();
        return;
      }
      if (failure === 'refuse') {
        res.writeHead(503).end('service unavailable');
        return;
      }
      if (!match) {
        res.writeHead(404).end('not found');
        return;
      }
      this.pings.push({ check: match[1]!, at: this.#clock.now().toISOString() });
      res.writeHead(200).end('OK');
    });
  }

  static async start(clock: Clock): Promise<FakeHealthchecks> {
    const healthchecks = new FakeHealthchecks(clock);
    await new Promise<void>((resolve) => healthchecks.#server.listen(0, '127.0.0.1', resolve));
    return healthchecks;
  }

  /** The ping URL of the check named `check`, which ops/token places as `healthchecks-ping-<check>`. */
  pingUrl(check: string): string {
    return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}/${check}-uuid`;
  }

  /** The next pings fail, in order: answered 503, or their connection dropped with no answer. */
  failNext(...failures: ('refuse' | 'drop')[]): void {
    this.#failures.push(...failures);
  }

  /** When the check named `check` was pinged, oldest first. */
  pingsOf(check: string): string[] {
    return this.pings.filter((p) => p.check === check).map((p) => p.at);
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }
}
