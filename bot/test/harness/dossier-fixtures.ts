// Real Products from the Featured Launches of Oct 12–14, as the #33 prototype read them on 2026-10-16: where each
// Launch's website redirect leads, the pages there, and the Dossier a model might record from them. Tests serve a
// Product's pages on the fake browser and script its Dossier on the fake model.
import { emailForm, type FakeBrowser, type FakePage } from './fake-browser.ts';
import { websiteOf } from './fake-product-hunt.ts';
import type { FakeModelProvider, ScriptedDossier } from './fake-model.ts';

export interface FixtureProduct {
  postId: string;
  /** Where the Launch's website redirect leads. */
  landing: FakePage;
  pricing?: FakePage;
  signup?: FakePage;
  dossier: ScriptedDossier;
}

const link = (text: string, href: string) => ({ text, href });

export const CODEMIND: FixtureProduct = {
  postId: '1273823',
  landing: {
    url: 'https://codemindhq.dev/',
    title: 'Codemind · Delegate coding. Get back code that works.',
    text: 'Sign up yourself, or paste our setup prompt into your coding agent and let it guide you. No card. 100 verified builds in your first month.',
    links: [link('Docs', 'https://codemindhq.dev/docs/'), link('Pricing', 'https://codemindhq.dev/pricing/'), link('Get started', 'https://app.codemindhq.dev/')],
  },
  pricing: {
    url: 'https://codemindhq.dev/pricing/',
    title: 'Pricing · Codemind',
    text: 'Free · $0 · no card · 100 verified builds in your first month, then 50 every month. Not yet billable: paid top-ups are coming soon.',
  },
  signup: {
    url: 'https://app.codemindhq.dev/',
    title: 'Sign in to Codemind',
    text: 'Sign in to Codemind · New here? Signing in creates your account. · Email me a link · or · Continue with Google',
    forms: [emailForm('Email me a link')],
  },
  dossier: {
    state: 'open',
    register: {
      text: 'Sign in with an emailed link or Google at app.codemindhq.dev; signing in creates the account. No card.',
      sources: ['signup-page', 'pricing-page'],
    },
    whatItIs: {
      text: 'A build service your coding agent calls over MCP: it writes the code for one task, tests it against your acceptance criteria and returns the files. A failed build is never charged.',
      sources: ['launch', 'maker-comment'],
    },
    forYou: {
      text: 'Fits coding agents and what runs around them: routine tasks handed off from Claude Code or OpenCode. Free plan.',
      sources: ['interest-scope', 'pricing-page'],
    },
    offers: [
      {
        what: '100 verified builds free in your first month, then 50 a month',
        code: null,
        card: 'not needed',
        deadline: 'first month',
        cap: null,
        condition: null,
        sources: ['landing-page', 'pricing-page'],
      },
    ],
    note: { text: "Paid top-ups aren't open yet; a verified build will cost $0.10 once they are.", sources: ['pricing-page'] },
    rulesApplied: [],
  },
};

export const XIRYN: FixtureProduct = {
  postId: '1277481',
  landing: {
    url: 'https://xiryn.com/',
    title: 'Xiryn · The open-source personal agent',
    text: 'Get Xiryn. One command. About five minutes. You need a Mac, Windows or Linux computer with about 4 GB free, and a key for one model provider. No account, no telemetry.',
    links: [link('GitHub', 'https://github.com/xiryn/xiryn'), link('Install', 'https://xiryn.com/#install')],
  },
  dossier: {
    state: 'no-account',
    register: {
      text: 'Nothing to register: one command installs it on Mac, Windows or Linux with about 4 GB free. It needs a key for one model provider, or a local model.',
      sources: ['landing-page', 'maker-comment'],
    },
    whatItIs: {
      text: 'A personal agent on your own computer. Each agent works on its own Linux desktop in Docker, browsing, researching, coding and filling forms; you control it from Telegram.',
      sources: ['launch', 'maker-comment'],
    },
    forYou: { text: 'Fits tools you can use from your Linux server and Docker, and is open source.', sources: ['interest-scope'] },
    offers: [],
    note: null,
    rulesApplied: [],
  },
};

export const ACYCLIC: FixtureProduct = {
  postId: '1275267',
  landing: {
    url: 'https://acyclic.dev/',
    title: 'Acyclic · Rapid agent swarms',
    text: 'Split one coding-agent task across many agents, each in its own fork of the workspace, and merge the results into one patch.',
    links: [link('Sign in', 'https://acyclic.dev/auth')],
  },
  signup: {
    url: 'https://acyclic.dev/auth',
    title: 'Sign in · Acyclic',
    text: 'Welcome to Acyclic · Continue with Google · Continue with GitHub',
    links: [link('Continue with Google', 'https://accounts.google.com/o/oauth2/auth'), link('Continue with GitHub', 'https://github.com/login/oauth/authorize')],
  },
  dossier: {
    state: 'open',
    register: {
      text: 'Sign-in only with Google or GitHub at acyclic.dev/auth, so a Handoff with the Signup mailbox Google account.',
      sources: ['signup-page'],
    },
    whatItIs: {
      text: 'Splits one coding-agent task across many agents, each in its own fork of the workspace, and merges the results into one patch.',
      sources: ['launch', 'landing-page'],
    },
    forYou: { text: 'Fits coding agents: orchestration. No plan or price is shown.', sources: ['interest-scope', 'landing-page'] },
    offers: [],
    note: null,
    rulesApplied: [],
  },
};

/** Serves the Product's pages, and has the model record its Dossier. */
export function serveProduct(world: { browser: FakeBrowser; model: FakeModelProvider }, product: FixtureProduct): void {
  world.browser.redirect(websiteOf(product.postId), product.landing.url);
  for (const page of [product.landing, product.pricing, product.signup]) if (page) world.browser.page(page);
  const scripted = world.model.dossier;
  world.model.dossier = (run) => (run.postIds.includes(product.postId) ? product.dossier : scripted(run));
}
