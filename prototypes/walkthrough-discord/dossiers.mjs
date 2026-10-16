// PROTOTYPE, throwaway: seven real Dossiers from the Featured Launches of Oct 11–14, 2026, for lab1 #33.
// Claude wrote them by hand from what the Assistant may read: the Launch and its Maker comment (Product Hunt API v2),
// the landing page, its pricing page, and the signup page (read for the Walkthrough, never filled), read on 2026-10-16.
// Registration milestones are stubs. Each claim names its sources by key; `quotes` holds what each source said.
// Source keys: L Launch · M Maker comment · S landing page · P pricing page · U signup page · I Interest scope.

export const SOURCE_NAMES = { L: 'Launch', M: 'Maker comment', S: 'landing page', P: 'pricing page', U: 'signup page', I: 'Interest scope' };
export const READ_AT = 'Oct 16, 09:40 PT';
const ph = (slug) => `https://www.producthunt.com/posts/${slug}`;

export const INTEREST = {
  agents: 'Want: AI coding agents and what runs around them: harnesses, orchestration, review, agent memory.',
  devtools: 'Want: developer tools and APIs I can use from a terminal or my Linux server.',
  models: 'Want: model access: LLM APIs, gateways and inference, especially with free credits.',
  server: 'Want: running one small server: monitoring, deploys, Docker.',
  team: "Don't want: tools that need a company or team to be useful.",
  free: 'Leans: a free plan, or open source with a hosted version, counts for more than paid-only.',
};

export const PRODUCTS = [
  {
    key: 'edgee', name: 'Edgee Mod for Claude Code', tagline: 'Use any model inside Claude Code, keep your Claude plan', domain: 'edgee.ai',
    state: 'open', walkthrough: true,
    launches: [{ day: '2026-10-11', label: 'Sun Oct 11', name: 'Edgee Mod for Claude Code', slug: 'edgee-mod-for-claude-code', fit: 8, rank: 11, of: 27 }],
    src: {
      L: ph('edgee-mod-for-claude-code'), M: `${ph('edgee-mod-for-claude-code')}?comment=5931262`,
      S: 'https://www.edgee.ai/claude-mod', P: 'https://www.edgee.ai/pricing', U: 'https://www.edgee.ai/login',
    },
    gist: { text: 'A Claude Code mod that switches your session to any of 200+ models, keeping the conversation.', src: ['L', 'M'] },
    register: { text: 'Sign up with email, Google or GitHub at `edgee.ai/login`. The Mod comes with the Edgee CLI (`edgee launch claude`) and needs Claude Code 2.1.287 or newer.', src: ['U', 'S'] },
    what: { text: 'Runs inside Claude Code and switches the session to any of 200+ models in one keystroke, keeping the conversation. It shows live what compression and routing save.', src: ['L', 'M'] },
    use: { text: 'Fits *coding agents and what runs around them* and *model access: gateways*: a way to try other models without leaving Claude Code.', src: ['I'], interest: ['agents', 'models'] },
    note: { text: 'Free for one developer. Models Edgee supplies are prepaid credits at provider prices plus a 5% top-up fee; your own keys carry no commission.', src: ['P'] },
    offers: [],
    quotes: {
      L: 'Keep your Claude plan, switch your session to any of 200+ models in one keystroke, and see live what compression and routing save you. Same conversation, same context. Two commands to install.',
      M: "It uses Claude Code's new mods system, so it runs inside Claude Code itself … Getting started takes two commands: curl -fsSL https://edgee.ai/install.sh | bash, then edgee launch claude.",
      S: 'No separate Mod installation. Start with the latest Edgee CLI and a supported Claude Code version. … Use Claude Code 2.1.287 or newer.',
      P: 'Free · For solo developers · $0 · 1 developer … Usage billing: 5% credit top-up fee · 0% BYOK commission · Prepaid credits. … On Free, adding $100 in credits costs $105 before tax.',
      U: 'Get started with Edgee · Sign in or create a new account · Continue with Google · Continue with GitHub · Or continue with email',
    },
    history: [
      ['Oct 11, 07:05 PT', 'Walkthrough v1 approved · `you+edgee@gmail.com`'],
      ['Oct 11, 07:06 PT', 'submitted (Continue, after the email code)'],
      ['Oct 11, 07:06 PT', '**registered**'],
    ],
    tag: 'registered', status: 'registered · ✓ approved 07:05 · ✓ submitted 07:06 · ✓ code filled by reference',
  },
  {
    key: 'codemind', name: 'Codemind', tagline: 'Delegate coding. Get back code that works.', domain: 'codemindhq.dev',
    state: 'open', walkthrough: true,
    launches: [{ day: '2026-10-12', label: 'Mon Oct 12', name: 'Codemind', slug: 'codemind-2', fit: 8, rank: 19, of: 19 }],
    src: {
      L: ph('codemind-2'), M: `${ph('codemind-2')}?comment=5932129`,
      S: 'https://codemindhq.dev/', P: 'https://codemindhq.dev/pricing/', U: 'https://app.codemindhq.dev/',
    },
    gist: { text: 'A build service your coding agent calls over MCP: it returns tested code, and only a passing build is charged.', src: ['L', 'M'] },
    register: { text: 'Sign in with an emailed link or Google at `app.codemindhq.dev`; signing in creates the account. No card.', src: ['U', 'P'] },
    what: { text: 'A build service your coding agent calls over MCP: it writes the code for one task, tests it against your acceptance criteria and returns the files. A failed build is never charged.', src: ['L', 'M'] },
    use: { text: 'Fits *coding agents and what runs around them*: routine tasks handed off from Claude Code or OpenCode. Free plan.', src: ['I', 'P'], interest: ['agents', 'free'] },
    note: { text: "Paid top-ups aren't open yet; a verified build will cost $0.10 once they are.", src: ['P'] },
    offers: [
      { what: '100 verified builds free in your first month, then 50 a month', needs: ['no card', 'no code', 'first month only'], src: ['S', 'P'] },
    ],
    quotes: {
      L: 'Your coding agent hands Codemind a task over MCP. It writes the code, tests it against your criteria and returns the files. $0.10 per verified build, failed builds free, free allowance to start.',
      M: 'You are billed only for a build that comes back verified. A failed build is free.',
      S: 'Sign up yourself, or paste our setup prompt into your coding agent and let it guide you. No card. 100 verified builds in your first month …',
      P: 'Free · $0 · no card · 100 verified builds in your first month, then 50 every month. Up to 2 builds at once and 20 an hour. … Not yet billable: paid top-ups are coming soon.',
      U: 'Sign in to Codemind · New here? Signing in creates your account. · Email me a link · or · Continue with Google',
    },
    history: [
      ['Oct 12, 06:40 PT', 'Walkthrough v1 approved · `you+codemind@gmail.com`'],
      ['Oct 12, 06:41 PT', 'submitted (Email me a link)'],
      ['Oct 12, 06:41 PT', 'sign-in link opened by plain code'],
      ['Oct 12, 06:41 PT', '**registered**'],
    ],
    tag: 'registered', status: 'registered · ✓ approved 06:40 · ✓ submitted 06:41 · ✓ sign-in link opened',
  },
  {
    key: 'xiryn', name: 'Xiryn', tagline: 'The open-source personal agent that runs on your computer', domain: 'xiryn.com',
    state: 'no account', walkthrough: false,
    launches: [{ day: '2026-10-13', label: 'Tue Oct 13', name: 'Xiryn', slug: 'xiryn', fit: 8, rank: 21, of: 29 }],
    src: { L: ph('xiryn'), M: `${ph('xiryn')}?comment=5941516`, S: 'https://xiryn.com/' },
    gist: { text: 'An open-source personal agent that works on its own Linux desktop in Docker, on your computer.', src: ['L', 'S'] },
    register: { text: 'Nothing to register: one command installs it on Mac, Windows or Linux with about 4 GB free. It needs a key for one model provider, or a local model. MIT licensed.', src: ['S', 'M'] },
    what: { text: 'A personal agent on your own computer. Each agent works on its own Linux desktop in Docker, browsing, researching, coding and filling forms; you control it from Telegram. Data stays on your disk.', src: ['L', 'M'] },
    use: { text: 'Fits *tools I can use from my Linux server* and *Docker*, and is open source; a point of comparison for this Assistant.', src: ['I'], interest: ['devtools', 'server', 'free'] },
    note: null,
    offers: [],
    quotes: {
      L: 'Each agent gets its own Linux desktop in Docker, so it browses, researches, codes and fills forms in the background without touching your screen. No account, no telemetry: your data stays on your disk.',
      M: "Control from anywhere — message your agents on Telegram … Setup is one command … It's MIT licensed and free — you only pay your model provider, or nothing with a local model.",
      S: 'Get Xiryn. One command. About five minutes. You need a Mac, Windows or Linux computer with about 4 GB free, and a key for one model provider.',
    },
    history: [],
    tag: 'no account', status: null,
  },
  {
    key: 'inferock', name: 'Inferock', tagline: 'Serverless inference, with credits back for failed calls.', domain: 'inferock.ai',
    state: 'open', walkthrough: true,
    launches: [{ day: '2026-10-14', label: 'Wed Oct 14', name: 'Inferock', slug: 'inferock', fit: 9, rank: 2, of: 48 }],
    src: {
      L: ph('inferock'), M: `${ph('inferock')}?comment=5947108`,
      S: 'https://inferock.ai/', P: 'https://inferock.ai/pricing/', U: 'https://inferock.ai/app/signup',
    },
    gist: { text: 'Free call measurement on your own LLM keys, and prepaid inference with credits back for failed calls.', src: ['L', 'P'] },
    register: { text: 'Sign up with an email address at `inferock.ai/app/signup`, then choose Watch or Serve.', src: ['U'] },
    what: { text: '**Watch** records each LLM call’s quality, latency and cost on your own OpenAI, Anthropic or Gemini keys, free. **Serve** is prepaid pay-per-token inference through Inferock, with a 10% fee on supplier cost.', src: ['L', 'M', 'P'] },
    use: { text: 'Fits *model access: gateways and inference, especially with free credits*, and Watch is free.', src: ['I', 'P'], interest: ['models', 'free'] },
    note: { text: "Serve's models and terms are confirmed during onboarding; the rates on the pricing page are only an example.", src: ['S', 'P'] },
    offers: [
      { what: 'Signup credit for Serve, a one-time gift if recorded for your account', needs: ['no card', 'no code', 'amount not stated', 'within the monthly cap'], src: ['L', 'P'] },
      { what: 'Credits back on failed calls, spent on Serve', needs: ['enrolling in the credit program, with your provider keys connected', 'capped at $1,000 a month', 'expire after 12 months'], src: ['M', 'P'], yours: true },
    ],
    quotes: {
      L: 'Get free signup credits to use all available models on Inferock. Bring your own keys: run your OpenAI, Claude or Gemini accounts, see where calls fail and what they cost, and get credits back on eligible failed calls.',
      M: 'Inferock Watch: bring your own OpenAI, Anthropic or Gemini keys. Free. … Enroll in the credit program and objectively broken calls accrue credits you can spend on Serve. … credits are non-cash, expire after 12 months, and are capped at $1,000 in the wallet and $1,000 applied per month.',
      S: 'Inferock Serve · Models and service terms are confirmed during onboarding. · Prepay through Inferock. No provider API key is required.',
      P: 'Signup credit, if recorded for your account, is a one-time gift … No card, provider connection, paid tier or minimum spend is required to receive it. … 10% total service fee on actual supplier cost for every account. … An example of how Inferock Serve rates are shown. It is not an offer.',
      U: 'Create your Inferock account · 1 Account · 2 Product · 3 Setup · Email address · Use an email address you can check now. · Continue',
    },
    history: [
      ['Oct 14, 08:12 PT', 'Walkthrough v1 approved · `you+inferock@gmail.com`'],
      ['Oct 14, 08:13 PT', 'submitted (Continue, on step 3)'],
      ['Oct 14, 08:13 PT', 'verification link opened by plain code'],
      ['Oct 14, 08:14 PT', '**registered**'],
    ],
    tag: 'registered', status: 'registered · ✓ approved 08:12 · ✓ submitted 08:13 · ✓ verified 08:13',
  },
  {
    key: 'tiden', name: 'Tiden', tagline: 'Intent verification for coding agents', domain: 'tiden.ai',
    state: 'open', walkthrough: true,
    launches: [{ day: '2026-10-14', label: 'Wed Oct 14', name: 'Tiden', slug: 'tiden', fit: 7, rank: 6, of: 48 }],
    src: {
      L: ph('tiden'), M: `${ph('tiden')}?comment=5949236`,
      S: 'https://tiden.ai/', P: 'https://tiden.ai/pricing', U: 'https://app.tiden.ai/signup',
    },
    gist: { text: 'Checks that a coding agent built what you asked, against versioned specs; for teams, from $49 a month after a trial.', src: ['L', 'P'] },
    register: { text: "Sign up with name, email and password at `app.tiden.ai/signup` for a 14-day free trial; billing starts on day 15 if you keep the plan. The site doesn't say whether the trial asks for a card.", src: ['U', 'P'] },
    what: { text: 'Keeps what you asked your coding agent for as versioned specs beside the code, and checks each change against them with tests run in your environment; no model grades the diff. Works beside Claude Code, Cursor, Codex and Copilot.', src: ['L', 'S'] },
    use: { text: 'Fits *coding agents: review*, but leans toward *Don’t want: tools that need a team*: it is built for engineering teams, from $49 a month after the trial.', src: ['I', 'S', 'P'], interest: ['agents', 'team'] },
    note: null,
    offers: [],
    quotes: {
      L: 'Tiden keeps your intent as requirements that branch and merge like code, and checks every change against that record. The verdict comes from tests run in your environment; no model grades the diff. … Works beside Claude Code, Cursor, Codex and Copilot.',
      M: 'Tiden is a continuous verification system for agentic coding …',
      S: 'For engineering teams shipping agent-written code every day.',
      P: 'Starter · For one product · $49 per month · 14-day free trial … Is there a free trial? Yes, 14 days on Starter and Team. Billing starts on day 15 if you keep your plan.',
      U: 'Create your account · Get started with Tiden · Name · Email · Password · Sign up',
    },
    history: [
      ['Oct 14, 08:20 PT', 'Walkthrough v1 approved · `you+tiden@gmail.com`'],
      ['Oct 14, 08:21 PT', 'card fields on page 2: **abandoned**, nothing pressed'],
    ],
    tag: 'abandoned', status: 'abandoned · ✓ approved 08:20 · ✗ card fields on page 2, nothing pressed',
  },
  {
    key: 'hindsight', name: 'Hindsight', tagline: 'Open source memory for AI agents to learn from experience', domain: 'vectorize.io',
    state: 'open', walkthrough: true,
    launches: [{ day: '2026-10-14', label: 'Wed Oct 14', name: 'Hindsight 1.0 + Memlake', slug: 'hindsight-1-0-memlake', fit: 7, rank: 26, of: 48 }],
    src: {
      L: ph('hindsight-1-0-memlake'), M: `${ph('hindsight-1-0-memlake')}?comment=5946727`,
      S: 'https://vectorize.io/', P: 'https://vectorize.io/pricing', U: 'https://ui.hindsight.vectorize.io/signup',
    },
    gist: { text: 'Open-source memory for AI agents, self-hosted free or on Hindsight Cloud.', src: ['L', 'P'] },
    register: { text: 'Sign up for Hindsight Cloud with email and password, or GitHub, at `ui.hindsight.vectorize.io/signup`. Or self-host it free with one Docker command.', src: ['U', 'P'] },
    what: { text: 'Memory for AI agents that learns from experience: retain, recall and reflect APIs, with an MCP server built in. Version 1.0 came with Memlake, a storage engine for Enterprise.', src: ['L', 'M', 'P'] },
    use: { text: 'Fits *agent memory*, and is open source with a hosted version.', src: ['I'], interest: ['agents', 'free'] },
    note: { text: 'Cloud is billed on token usage, with no monthly fee.', src: ['P'] },
    offers: [
      { what: 'Free credits to start on Hindsight Cloud', needs: ['amount not stated', 'card not stated'], src: ['L', 'U'] },
    ],
    quotes: {
      L: "Hindsight is open-source memory that lets AI agents learn from experience … Today it's 1.0 … We're also launching Hindsight Memlake … Self-host it free, start on Hindsight Cloud with free credits, or run it in your own cloud with Enterprise.",
      M: 'When we launched Hindsight here … Hindsight is now 1.0. … Memlake comes with Hindsight Enterprise … Try Hindsight open source (MIT, runs on Postgres) or on Hindsight Cloud with free credits.',
      S: 'Agent Memory That Learns',
      P: 'Self-hosted · Free · Run Hindsight 1.0 on your own infrastructure with a single Docker command. MIT licensed … Retain, Recall, and Reflect APIs · MCP server built in … Hindsight Cloud · Pay as you go · Billed on token usage — no fixed monthly fee, no seat pricing.',
      U: 'Pay As You Go · Start with free credits — only pay for what you use … Sign up with GitHub · or sign up with email · First name · Last name · Email · Password · Confirm password',
    },
    history: [],
    tag: 'Walkthrough', status: 'waiting for your Approval in #needs-you',
  },
  {
    key: 'acyclic', name: 'Acyclic', tagline: 'Rapid agent swarms for any agentic workflow', domain: 'acyclic.dev',
    state: 'open', walkthrough: true,
    launches: [{ day: '2026-10-14', label: 'Wed Oct 14', name: 'Acyclic', slug: 'acyclic', fit: 7, rank: 30, of: 48 }],
    src: { L: ph('acyclic'), M: `${ph('acyclic')}?comment=5935833`, S: 'https://acyclic.dev/', U: 'https://acyclic.dev/auth?redirect=/dashboard' },
    gist: { text: 'Splits one coding-agent task across many agents in forked workspaces, and merges the result.', src: ['L', 'S'] },
    register: { text: 'Sign-in only with Google or GitHub at `acyclic.dev/auth`, so a Handoff with the Signup mailbox’s Google account. Teams already running agents in volume are onboarded by request.', src: ['U', 'S'] },
    what: { text: 'Splits one coding-agent task across many agents, each in its own fork of the workspace, and merges the results into one patch or pull request. Start it from the CLI, the dashboard or a coding agent over MCP; bring your own model keys.', src: ['L', 'S'] },
    use: { text: 'Fits *coding agents: orchestration*. No plan or price is shown.', src: ['I', 'S'], interest: ['agents'] },
    note: null,
    offers: [],
    quotes: {
      L: 'Hand Acyclic a task from the CLI, the dashboard, or a coding agent over MCP. It splits the work across many agents, each in its own instant fork of the workspace, and merges the results … Bring your own model keys.',
      M: 'Start one from the CLI, the dashboard, or a coding agent over MCP, using your own model keys.',
      S: "They work in parallel, then merge into one patch or pull request. … We're onboarding teams gradually, starting with those that already run agents in volume.",
      U: 'Sign in to Acyclic · Run agent swarms and manage your account. · Continue with Google · Continue with GitHub',
    },
    history: [
      ['Oct 14, 08:30 PT', 'Walkthrough v1 approved · Handoff with the Signup mailbox’s Google account'],
      ['Oct 14, 19:02 PT', 'you tapped Done · **handed off**'],
    ],
    tag: 'handed off', status: 'handed off · ✓ approved 08:30 · ✓ you tapped Done 19:02',
  },
];

// The stub re-Launch the control panel can add to Hindsight (its root domain, vectorize.io, already has a Dossier).
export const RELAUNCH = {
  product: 'hindsight',
  launch: { day: '2026-11-04', label: 'Wed Nov 4', name: 'Hindsight Memlake on Cloud', slug: 'hindsight-memlake-on-cloud', fit: 8, rank: 5, of: 31, stub: true },
  offer: { what: '30 days of Memlake on Hindsight Cloud', needs: ['no card', 'until Dec 4'], src: ['L2'] },
  quote: 'Memlake is now on Hindsight Cloud: try it free for 30 days, no card, until Dec 4. (Stub: no such Launch exists.)',
};
export const withRelaunch = (p) => (p.key !== RELAUNCH.product || p.launches.length > 1 ? p : {
  ...p,
  launches: [...p.launches, RELAUNCH.launch],
  offers: [...p.offers, RELAUNCH.offer],
  src: { ...p.src, L2: `https://www.producthunt.com/posts/${RELAUNCH.launch.slug}` },
  quotes: { ...p.quotes, L2: RELAUNCH.quote },
});
