// The pages a Dossier reads (#19, #40 §1): the landing page its Launch's website redirect leads to, the pricing page
// if the landing page links to one, and the signup page it links to. Plain code picks the links from the landing
// page's read; no model does, and nothing beyond these three is read.
import type { Link, PageRead } from '../browser.ts';
import { onRootDomain } from '../root-domain.ts';

const PRICING_TEXT = /\b(?:pricing|plans?|prices)\b/i;
const PRICING_PATH = /\/(?:pricing|plans|prices)(?:[/.?#]|$)/i;

// Ways a landing page names its signup link, the likeliest first; signing in comes last, since a sign-in page often
// creates the account too.
const SIGNUP: { in: 'text' | 'path'; pattern: RegExp }[] = [
  { in: 'text', pattern: /\bsign[\s-]?up\b/i },
  { in: 'text', pattern: /\b(?:get started|start (?:for )?free|try (?:it )?(?:for )?free|create (?:an |your )?account|register)\b/i },
  { in: 'text', pattern: /\b(?:join (?:the )?waitlist|(?:request|get) (?:early )?access)\b/i },
  { in: 'path', pattern: /\/(?:sign-?up|register|join|get-started|waitlist)(?:[/.?#]|$)/i },
  { in: 'text', pattern: /\b(?:log[\s-]?in|sign[\s-]?in)\b/i },
];

/** Random-looking strings are redacted in a read's links, which breaks the link. */
const usable = (link: Link) => !link.href.includes('[random]') && /^https?:\/\//.test(link.href);

const parsed = (href: string) => {
  try {
    return new URL(href);
  } catch {
    return undefined;
  }
};
export const hostOf = (href: string) => parsed(href)?.hostname ?? '';
export const pathOf = (href: string) => parsed(href)?.pathname ?? '';

const samePage = (a: string, b: string) => a.replace(/[#?].*$/, '').replace(/\/$/, '') === b.replace(/[#?].*$/, '').replace(/\/$/, '');

/** The pricing page the landing page links to, on the Product's own domain, if it links to one. */
export function pricingLink(landing: PageRead, rootDomain: string): string | undefined {
  return landing.snapshot.links.find(
    (l) =>
      usable(l) &&
      onRootDomain(hostOf(l.href), rootDomain) &&
      !samePage(l.href, landing.finalUrl) &&
      (PRICING_TEXT.test(l.text) || PRICING_PATH.test(pathOf(l.href))),
  )?.href;
}

/** The signup page the landing page links to, preferring one on the Product's own domain, if it links to one. */
export function signupLink(landing: PageRead, rootDomain: string): string | undefined {
  const candidates = landing.snapshot.links.filter(
    (l) => usable(l) && !onRootDomain(hostOf(l.href), 'producthunt.com') && !samePage(l.href, landing.finalUrl),
  );
  for (const way of SIGNUP) {
    const matching = candidates.filter((l) => way.pattern.test(way.in === 'path' ? pathOf(l.href) : l.text));
    const found = matching.find((l) => onRootDomain(hostOf(l.href), rootDomain)) ?? matching[0];
    if (found) return found.href;
  }
  return undefined;
}

/** Discord counts link URLs in its 4,000 characters, so a cited URL longer than this is cited by its site alone. */
const CITED_URL_MAX = 200;

/**
 * The link a Dossier cites for a page: where the read ended, without its query or fragment, which can carry tokens.
 * A path with a random-looking part, which the read's redacted URL shows, is cited by its site alone.
 */
export function citedUrl(page: PageRead): string {
  const exact = parsed(page.finalUrl);
  if (!exact) return `https://${page.finalHost}/`;
  const url = parsed(page.snapshot.url)?.pathname === exact.pathname ? `${exact.origin}${exact.pathname}` : `${exact.origin}/`;
  return url.length > CITED_URL_MAX ? `${exact.origin}/` : url;
}
