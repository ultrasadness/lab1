// Rejects non-essential cookies with DuckDuckGo's autoconsent in opt-out mode (ADR 0006, #40 §5), before a snapshot.
// Only banners a rule names are handled; heuristics and cosmetic hiding are off, so an unknown banner stays.
// autoconsent calls a cookie banner's maker a CMP (consent management platform); we call it the banner's manager.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { filterCompactRules } from '@duckduckgo/autoconsent';
import type { Frame, Page } from 'playwright-core';
import type { CookieBanner } from './api.ts';

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve('@duckduckgo/autoconsent'));
const contentScript = fs.readFileSync(path.join(dist, 'autoconsent.playwright.js'), 'utf8');
const compactRules = JSON.parse(fs.readFileSync(path.join(dist, '..', 'rules', 'compact-rules.json'), 'utf8'));
export const autoconsentVersion: string = JSON.parse(fs.readFileSync(path.join(dist, '..', 'package.json'), 'utf8')).version;

const CONFIG = {
  enabled: true,
  autoAction: 'optOut',
  disabledCmps: [],
  enablePrehide: false,
  enableCosmeticRules: false,
  enableGeneratedRules: true,
  enableHeuristicDetection: false,
  heuristicMode: 'off',
  // Injected once the page has settled, so a banner is usually there already: look twice, half a second apart.
  detectRetries: 1,
  // The script already runs in the page's world, so rules evaluate their snippets inline, never through us.
  isMainWorld: true,
  visualTest: false,
  logs: { lifecycle: false, rulesteps: false, detectionsteps: false, evals: false, errors: false, messages: false, waits: false },
};

const FINISHED = new Set(['nothingDetected', 'done', 'optOutSucceeded', 'optOutFailed']);
const CLICKING = new Set(['openPopupDetected', 'runningOptOut']);
// autoconsent waits up to 5 s for a detected manager's popup, then stops without saying so.
const POPUP_WAIT_MS = 6_000;
// A page where the script never reports, such as one whose frames all refused it.
const NO_REPORT_MS = 3_000;
const LIMIT_MS = 15_000;

/** Where autoconsent's script in one frame has got to. */
interface ScriptState {
  main: boolean;
  lifecycle: string;
  since: number;
}

export async function rejectCookies(page: Page): Promise<CookieBanner | null> {
  const scripts = new Map<string, ScriptState>();
  let manager: string | null = null;
  let rejected = false;

  await page.exposeBinding('autoconsentSendMessage', async ({ frame }: { frame: Frame }, msg: unknown) => {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Record<string, unknown>;
    const main = frame === page.mainFrame();
    if (m.type === 'init') {
      const rules = { compact: filterCompactRules(compactRules, { url: frame.url(), mainFrame: main }) };
      await frame
        .evaluate((reply) => (window as unknown as { autoconsentReceiveMessage(m: unknown): Promise<void> }).autoconsentReceiveMessage(reply), {
          type: 'initResp',
          config: CONFIG,
          rules,
        })
        .catch(() => {});
    } else if (m.type === 'report' && typeof m.instanceId === 'string') {
      const lifecycle = String((m.state as { lifecycle?: unknown } | undefined)?.lifecycle);
      const known = scripts.get(m.instanceId);
      if (known?.lifecycle !== lifecycle) scripts.set(m.instanceId, { main, lifecycle, since: Date.now() });
    } else if (m.type === 'popupFound' && typeof m.cmp === 'string') {
      manager ??= m.cmp;
    } else if (m.type === 'optOutResult' && m.cmp === manager) {
      rejected = m.result === true;
    }
  });
  const inject = (frame: Frame) => frame.evaluate(contentScript).catch(() => {});
  // A banner's frame that loads while we wait gets the script too.
  page.on('framenavigated', inject);
  try {
    await Promise.all(page.frames().map(inject));

    const start = Date.now();
    const settled = () => {
      const now = Date.now();
      const all = Array.from(scripts.values());
      if (all.some((s) => CLICKING.has(s.lifecycle))) return false;
      const main = all.find((s) => s.main);
      if (!main) return now - start > NO_REPORT_MS;
      return FINISHED.has(main.lifecycle) || (main.lifecycle === 'cmpDetected' && now - main.since > POPUP_WAIT_MS);
    };
    while (!settled() && Date.now() - start < LIMIT_MS) await new Promise((r) => setTimeout(r, 100));
  } finally {
    page.off('framenavigated', inject);
  }

  return manager ? { manager, rejected } : null;
}
