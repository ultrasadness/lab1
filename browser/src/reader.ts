// read(url): one page in a throwaway in-memory context, before any Approval (ADR 0006).
import type { Browser, BrowserContext, Page, Response } from 'playwright-core';
import type { ReadFailureKind, ReadOutcome } from './api.ts';
import { rejectCookies } from './cookie-banners.ts';
import { redactAll } from './redact.ts';
import { takeSnapshot } from './snapshot.ts';
import { botCheckOn, hasPaymentFields } from './walls.ts';

// A common desktop size (ADR 0006).
export const VIEWPORT = { width: 1280, height: 800 };
// Long enough for the slowest page that still loads; a page that hangs its renderer is cut off here.
const READ_LIMIT_MS = Number(process.env.READ_LIMIT_MS ?? 60_000);

const failure = (kind: ReadFailureKind, message: string): ReadOutcome => ({ ok: false, error: { kind, message } });

function targetOf(url: unknown): URL | null {
  if (typeof url !== 'string' || url.length > 8192) return null;
  try {
    const target = new URL(url);
    return (target.protocol === 'https:' || target.protocol === 'http:') && !target.username && !target.password ? target : null;
  } catch {
    return null;
  }
}

export function createReader(browser: Browser) {
  return {
    async read(url: unknown): Promise<ReadOutcome> {
      const target = targetOf(url);
      if (!target) return failure('bad-url', 'read takes an http or https URL with no username or password');

      const context = await browser.newContext({ acceptDownloads: false, viewport: VIEWPORT, serviceWorkers: 'block' });
      // The answer comes at the limit whatever the read is waiting on; closing the context then ends the rest of it.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tooLong = new Promise<ReadOutcome>((resolve) => {
        timer = setTimeout(() => resolve(failure('timeout', `the read took longer than ${READ_LIMIT_MS / 1000} s`)), READ_LIMIT_MS);
      });
      try {
        return await Promise.race([readIn(context, target), tooLong]);
      } finally {
        clearTimeout(timer);
        await context.close();
      }
    },
  };
}

async function readIn(context: BrowserContext, target: URL): Promise<ReadOutcome> {
  const page = await context.newPage();
  // The last document the top frame got, so a script redirect after load counts too.
  let response: Response | null = null;
  let download = false;
  page.on('response', (r) => {
    if (!r.request().isNavigationRequest() || r.frame() !== page.mainFrame()) return;
    response = r;
    if (/^\s*attachment/i.test(r.headers()['content-disposition'] ?? '')) download = true;
  });
  page.on('download', () => (download = true));
  try {
    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (e) {
    if (download) return failure('download', 'the URL is a download, and downloads are off');
    const message = (e instanceof Error ? e.message : String(e)).split('\n')[0]!;
    return failure(/Timeout/i.test(message) ? 'timeout' : 'load-failed', message);
  }
  await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
  const cookieBanner = await rejectCookies(page);

  const snapshot = redactAll(await inLatestDocument(page, () => page.evaluate(takeSnapshot)));
  const finalUrl = page.url();
  return {
    ok: true,
    page: {
      snapshot,
      finalUrl,
      finalHost: new URL(finalUrl).hostname,
      status: (response as Response | null)?.status() ?? null,
      paymentFields: await hasPaymentFields(page),
      botCheck: await botCheckOn(page, response),
      cookieBanner,
    },
  };
}

/** Runs fn again on the page's next document when a navigation, such as a late script redirect, replaces it meanwhile. */
async function inLatestDocument<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await fn();
    } catch (e) {
      if (tries === 3 || !String(e).includes('Execution context was destroyed')) throw e;
      await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    }
  }
}
