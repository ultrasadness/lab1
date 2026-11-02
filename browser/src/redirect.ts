// redirect(url): where a URL points, from a HEAD that follows nothing (#101). Plain code's own request, with no page
// and no browser, on the service's network like every read. It says what it is, and solves no check.
import type { ReadFailure, RedirectOutcome } from './api.ts';
import { targetOf } from './reader.ts';

const REDIRECT_LIMIT_MS = Number(process.env.REDIRECT_LIMIT_MS ?? 30_000);

const failure = (kind: ReadFailure['kind'], message: string): RedirectOutcome => ({ ok: false, error: { kind, message } });

/** A 3xx answer's address, made absolute; a Location that is no URL, or isn't plain http or https, is none. */
function addressOf(status: number, location: string | null, from: URL): string | null {
  if (status < 300 || status > 399 || !location) return null;
  try {
    return targetOf(new URL(location, from).href)?.href ?? null;
  } catch {
    return null;
  }
}

export async function redirectOf(url: unknown): Promise<RedirectOutcome> {
  const target = targetOf(url);
  if (!target) return failure('bad-url', 'redirect takes an http or https URL with no username or password');
  try {
    const response = await fetch(target, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(REDIRECT_LIMIT_MS) });
    return { ok: true, redirect: { status: response.status, location: addressOf(response.status, response.headers.get('location'), target) } };
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') return failure('timeout', `the HEAD took longer than ${REDIRECT_LIMIT_MS / 1000} s`);
    const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : '';
    return failure('load-failed', `${e instanceof Error ? e.message : String(e)}${cause}`);
  }
}
