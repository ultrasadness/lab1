// The bot's side of the socket.
import http from 'node:http';
import type { Health, PageRead, ReadFailure, ReadOutcome } from './api.ts';

export class BrowserClient {
  readonly socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async health(): Promise<Health> {
    const { status, body } = await this.request('GET', '/health');
    if (status !== 200) throw new Error(`browser service health: HTTP ${status}`);
    return body as Health;
  }

  /** Reads a page in a throwaway context. A page that won't load is a failure, not an exception. */
  async read(url: string): Promise<ReadOutcome> {
    const { status, body } = await this.request('POST', '/read', { url });
    if (status === 200) return { ok: true, page: body as PageRead };
    const error = (body as { error?: ReadFailure }).error;
    if (!error) throw new Error(`browser service read: HTTP ${status}`);
    return { ok: false, error };
  }

  private request(method: string, path: string, payload?: unknown): Promise<{ status: number; body: unknown }> {
    const data = payload === undefined ? undefined : JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socketPath,
          method,
          path,
          headers: data === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
          timeout: 120_000,
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (text += chunk));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`browser service ${path}: timed out`)));
      req.on('error', reject);
      req.end(data);
    });
  }
}
