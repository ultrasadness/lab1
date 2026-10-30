// read(url): one page in a throwaway in-memory context, before any Approval (ADR 0006).
import type { Browser, BrowserContext, Page, Response } from 'playwright-core';
import type { ReadFailureKind, ReadOutcome } from './api.ts';
import { rejectCookies } from './cookie-banners.ts';
import { redactAll } from './redact.ts';
import { takeSnapshot } from './snapshot.ts';
import { botCheckOn, hasPaymentFields } from './walls.ts';

// A common desktop size (ADR 0006).
export const VIEWPORT = { width: 1280, height: 800 };
// Every context's: no downloads, and no service worker that would outlive a page.
export const CONTEXT_OPTIONS = { acceptDownloads: false, viewport: VIEWPORT, serviceWorkers: 'block' } as const;
// Long enough for the slowest page that still loads; a page that hangs its renderer is cut off here.
const READ_LIMIT_MS = Number(process.env.READ_LIMIT_MS ?? 60_000);

const failure = (kind: ReadFailureKind, message: string): ReadOutcome => ({ ok: false, error: { kind, message } });

/** A URL a page may be loaded from: plain http or https, with no username or password. */
export function targetOf(url: unknown): URL | null {
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

      const context = await browser.newContext(CONTEXT_OPTIONS);
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

export type Loaded =
  | {
      ok: true;
      /** The last document the top frame got, so a script redirect after load counts too, until stop() is called. */
      response(): Response | null;
      stop(): void;
    }
  | { ok: false; kind: Exclude<ReadFailureKind, 'bad-url'>; message: string };

/** Loads a URL in the page's top frame and lets it settle. */
export async function loadPage(page: Page, target: URL): Promise<Loaded> {
  let response: Response | null = null;
  let download = false;
  const onResponse = (r: Response) => {
    if (!r.request().isNavigationRequest() || r.frame() !== page.mainFrame()) return;
    response = r;
    if (/^\s*attachment/i.test(r.headers()['content-disposition'] ?? '')) download = true;
  };
  const onDownload = () => (download = true);
  const stop = () => {
    page.off('response', onResponse);
    page.off('download', onDownload);
  };
  page.on('response', onResponse);
  page.on('download', onDownload);
  try {
    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (e) {
    stop();
    if (download) return { ok: false, kind: 'download', message: 'the URL is a download, and downloads are off' };
    const message = (e instanceof Error ? e.message : String(e)).split('\n')[0]!;
    return { ok: false, kind: /Timeout/i.test(message) ? 'timeout' : 'load-failed', message };
  }
  await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
  return { ok: true, response: () => response, stop };
}

async function readIn(context: BrowserContext, target: URL): Promise<ReadOutcome> {
  const page = await context.newPage();
  const loaded = await loadPage(page, target);
  if (!loaded.ok) return failure(loaded.kind, loaded.message);
  const cookieBanner = await rejectCookies(page);

  const snapshot = redactAll(await inLatestDocument(page, async () => (await page.evaluate(takeSnapshot, null)).snapshot));
  const finalUrl = page.url();
  const response = loaded.response();
  return {
    ok: true,
    page: {
      snapshot,
      finalUrl,
      finalHost: new URL(finalUrl).hostname,
      status: response?.status() ?? null,
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
