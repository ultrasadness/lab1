// The walls a read can see on load (#10): card fields, and a bot check or interstitial.
// The functions evaluated in a page carry their own copies of shown(), as in snapshot.ts.
import type { Frame, Page, Response } from 'playwright-core';
import type { BotCheck } from './api.ts';

// A bot check shows as a frame from its vendor's host, or as the vendor's widget element.
const BOT_CHECKS: { vendor: BotCheck; hosts: string[]; marker: string | null }[] = [
  { vendor: 'Turnstile', hosts: ['challenges.cloudflare.com'], marker: '.cf-turnstile' },
  { vendor: 'reCAPTCHA', hosts: ['google.com', 'recaptcha.net'], marker: '.g-recaptcha:not([data-size=invisible])' },
  { vendor: 'hCaptcha', hosts: ['hcaptcha.com'], marker: '.h-captcha:not([data-size=invisible])' },
  { vendor: 'DataDome', hosts: ['captcha-delivery.com'], marker: null },
  { vendor: 'HUMAN', hosts: ['px-cloud.net', 'px-cdn.net', 'perimeterx.net'], marker: '#px-captcha' },
  { vendor: 'Arkose', hosts: ['arkoselabs.com', 'funcaptcha.com'], marker: null },
  { vendor: 'AWS WAF', hosts: ['awswaf.com'], marker: null },
];
// reCAPTCHA's frames come from google.com, so only its challenge frames count, and never an invisible one.
const isBotCheckFrame = (check: (typeof BOT_CHECKS)[number], url: string) =>
  onHost(hostOf(url), check.hosts) && (check.vendor !== 'reCAPTCHA' || (url.includes('/recaptcha/') && !url.includes('size=invisible')));

// Card fields inside these hosts' frames count whatever their autocomplete says.
const PAYMENT_HOSTS = [
  'stripe.com',
  'braintreegateway.com',
  'braintree-api.com',
  'paypal.com',
  'adyen.com',
  'checkout.com',
  'squareup.com',
  'squarecdn.com',
  'recurly.com',
  'chargebee.com',
  'paddle.com',
  'lemonsqueezy.com',
  'mollie.com',
  'klarna.com',
  'authorize.net',
  'worldpay.com',
  'cybersource.com',
  'fastspring.com',
  'razorpay.com',
];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
const onHost = (host: string, hosts: string[]) => hosts.some((h) => host === h || host.endsWith(`.${h}`));

/** Whether a frame and every frame around it are shown: payment scripts load hidden 0×0 frames everywhere. */
async function frameShown(frame: Frame): Promise<boolean> {
  for (let f: Frame | null = frame; f?.parentFrame(); f = f.parentFrame()) {
    const owner = await f.frameElement().catch(() => null);
    if (!(await owner?.isVisible().catch(() => false))) return false;
  }
  return true;
}

export async function hasPaymentFields(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    // A provider's own page, such as its sign-up, needs card fields like any other.
    const fromProvider = frame !== page.mainFrame() && onHost(hostOf(frame.url()), PAYMENT_HOSTS);
    const found = await frame
      .evaluate((anyField) => {
        const shown = (el: Element) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && el.checkVisibility({ visibilityProperty: true });
        };
        return Array.from(document.querySelectorAll('input, select, textarea')).some(
          (el) =>
            !(el instanceof HTMLInputElement && el.type === 'hidden') &&
            shown(el) &&
            (anyField || (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/).some((token) => token.startsWith('cc-'))),
        );
      }, fromProvider)
      .catch(() => false);
    if (found && (await frameShown(frame))) return true;
  }
  return false;
}

export async function botCheckOn(page: Page, response: Response | null): Promise<BotCheck | null> {
  const cloudflare: BotCheck = 'Cloudflare challenge';
  if ((await response?.headerValue('cf-mitigated').catch(() => null)) === 'challenge') return cloudflare;

  const seen = await page
    .evaluate((checks) => {
      if (['Just a moment...', 'Attention Required! | Cloudflare'].includes(document.title.trim())) return { interstitial: true, frames: [], markers: [] };
      if (document.querySelector('#challenge-stage, #challenge-form, #cf-challenge-running')) return { interstitial: true, frames: [], markers: [] };
      const shown = (el: Element) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && el.checkVisibility({ visibilityProperty: true });
      };
      function* walk(root: Document | ShadowRoot): Generator<Element> {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          yield el;
          if (el.shadowRoot) yield* walk(el.shadowRoot);
        }
      }
      const all = Array.from(walk(document)).filter(shown);
      return {
        interstitial: false,
        // Frame sources as the page wrote them: a frame that failed to load still shows where it was meant to come from.
        frames: all.filter((el): el is HTMLIFrameElement => el instanceof HTMLIFrameElement && !!el.src).map((el) => el.src),
        markers: checks.filter((c) => c.marker && all.some((el) => el.matches(c.marker!))).map((c) => c.vendor),
      };
    }, BOT_CHECKS)
    .catch(() => ({ interstitial: false, frames: [] as string[], markers: [] as string[] }));
  if (seen.interstitial) return cloudflare;

  for (const check of BOT_CHECKS) {
    if (seen.markers.includes(check.vendor) || seen.frames.some((url) => isBotCheckFrame(check, url))) return check.vendor;
  }
  // A widget in a closed shadow root is still one of the page's frames.
  for (const frame of page.frames()) {
    const check = BOT_CHECKS.find((c) => isBotCheckFrame(c, frame.url()));
    if (check && (await frameShown(frame))) return check.vendor;
  }
  return null;
}
