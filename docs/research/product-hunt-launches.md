# Reading each day's Product Hunt Launches

Research for ticket #2 on the map (#1). Question: how can the Miner get each day's Launches, with enough detail to write a Dossier?

Researched 2026-10-13 (UTC). Every claim cites a source from [Sources](#sources); `[S4]` means source S4. A claim marked *(observed)* comes from a single look at a live page or feed on 2026-10-13, not from documentation. Nothing here used a Product Hunt account, a token or an authenticated request, so none of the API behaviour below has been tested by us.

## Answer in brief

- **Route: Product Hunt API v2 (GraphQL), read-only, with a developer token.** It is the only route the Terms allow for automated reading. It is free for personal, non-commercial use [S1][S6-332]. The budget is 6,250 complexity points per 15 minutes [S2], which is likely enough for one run over a day's featured Launches. Getting the token is a one-time step for the person: they need a Product Hunt account (reportedly a verified one) and must create an app in the API dashboard [S1][S6-343].
- **The API covers most of a Dossier**: name, tagline, description, topics, `featuredAt`/`scheduledAt`, `dailyRank`, votes, comment bodies, a website redirect link and extra `productLinks` [S4].
- **It does not cover three things:**
  1. **Promo codes.** Product Hunt has a promo field (text, code, expiry) but only the website shows it [S7-promo] *(observed)*.
  2. **Who wrote a comment.** Since March 2023 the API redacts other users, so it can't tell which comments are Maker comments [S4-user][S6-286][S6-284][S6-342].
  3. **A Product identity.** The public API has no Product object [S4].
- **The website has all three, but the Terms forbid crawling or scraping it**, "through use of manual or automated means" [S8]. The Atom feed is offered publicly [S7-rss] but is thin: a rolling list of the 50 most recently featured Launches, with no comments, rank, topics or promo *(observed)* [S11].
- **Day boundary:** every Launch goes live at 12:01 AM Pacific on its scheduled date [S7-guide], and leaderboards run on Pacific time [S10]. A day's set is fixed from 12:01 AM, and its rank is final when the Pacific day ends [S12-md][S7-potd].
- **Re-Launches:** Product Hunt itself requires six months between Launches of the same Product, or of anything on the same root domain [S7-relaunch]. It groups all Launches of a Product under `/products/{slug}` [S10].
- **Volume (secondary source):** about 150 Launches a day on weekdays, of which 44–46 are featured. A Sunday sample had 620 Launches, of which 27 were featured [S13]. The soft threshold should scale on the **featured** count.

## 1. Access routes

### 1a. Product Hunt API v2 (GraphQL): the recommended route

| Fact | Source |
|---|---|
| Endpoint `https://api.producthunt.com/v2/api/graphql`. "Currently the API is only accessible with a provided access_token." | [S1] |
| **Token kinds:** (1) OAuth user token, via the authorization-code flow (PKCE for public clients, S256 only); (2) client-only token, via `grant_type=client_credentials`, giving `public` scope and no user context; (3) **developer token**: "does not expire, linked to your account", taken from the API dashboard and meant for "a few scripts". | [S1][S3] |
| **Scopes:** `public` (default; all apps are read-only), `private`, `write`. Write access is partial and by request only. The Miner needs `public` only. | [S1] |
| **Rate limits (per application):** GraphQL has 6,250 complexity points per 15 minutes, with complexity "calculated based on the fields requested"; other `/v2/*` endpoints allow 450 requests per 15 minutes. Over the limit the API returns `429`, and the headers `X-Rate-Limit-Limit/-Remaining/-Reset` report the state. "We may on occasion adjust the rate limit." | [S2] |
| **Terms of API use:** "The Product Hunt API must not be used for commercial purposes. If you would like to use it for your business, please contact us." Attribution is requested (a link back, and the logo is appreciated). Product Hunt reserves the right to rate-limit apps that don't follow "fair-use". | [S1] |
| Product Hunt staff on the API tracker (2025-09-22): "there is no cost to using the API. You are welcome to use it for non-commercial purposes!" | [S6-332] |
| The schema supports introspection, per staff (2025-12-17). | [S6-341] |
| **Getting credentials is currently friction.** Users reported in 2026-04 and 2026-09 that `/v2/oauth/applications` redirects to the homepage. A user reported on 2026-10-12 that "your account just needs to be verified" (one report, unconfirmed by staff). The help center still points to a `/v1/...` "My Apps" link, which users report returns 404. | [S6-343][S7-api] |
| **Reliability:** API calls were intermittently blocked by Cloudflare challenges (`403`, "Just a moment...") in July 2025, September 2025, January 2026 and February 2026. Staff fixed each one after it was reported on GitHub. | [S6-329] |

The Miner is a single person's assistant reading public data, so it fits "non-commercial" as Product Hunt words it. It does not resell or republish the data. The person still has to create the token; the Assistant must not sign up for them (see Surfaced).

### 1b. Public Atom feed: a fallback, not enough on its own

- Product Hunt's help center links `https://www.producthunt.com/feed` as its RSS feed [S7-rss] (article dated 2022-06-08).
- *(observed, 2026-10-13 02:45 UTC)* [S11] The feed is Atom and held exactly 50 entries. They spanned the current Pacific day (Oct 12) and the previous one: the 17 Launches on the Oct 11 leaderboard's first page appeared at positions 21–44, and the Oct 12 top 10 [S12-md] all appeared within positions 1–20. So it is a rolling list of recent featured Launches, not a day-bounded list.
- Each entry gives: the post ID (`tag:...:Post/1266729`), a link to the **Product page** `/products/{slug}`, the name, the tagline, a `/r/p/{id}` redirect to the Product's website, and an `author`. The author is the hunter, not necessarily the Maker [S7-hunter]; the feed shows the name in full. `published` is when the post was created, which can be weeks before the Launch. Ancher 2.0, for example, was created 2026-10-01 and launched 2026-10-12 *(observed)*.
- The feed has no description, topics, rank, comments or promo.
- Use: a no-token way to list recent featured Launches and get each one's Product slug. A Dossier needs the API (or the website) for the rest.

### 1c. The website: has everything, but the Terms forbid scraping it

- The Terms of Service [S8] (labelled "Effective date: August 17th 2014") limit use to "your own internal, personal, non-commercial use". Among the prohibited conduct: **(h)** "'Crawls,' 'scrapes,' or 'spiders' any page, data, or portion of or relating to the Services or Content (through use of manual or automated means)"; **(i)** "Copies or stores any significant portion of the Content"; and **(g)** "any processes that run or are activated while you are not logged into the Services, or that otherwise interfere with the proper working of the Services".
- `robots.txt` [S9] allows general crawling apart from auth, search and comment-permalink paths. It disallows `/r/*` but explicitly allows `/r/p/*`, the post-to-website redirect. robots.txt does not override the Terms.
- Product Hunt publishes an **`llms.txt`** for agents [S10]. It describes `/products/{slug}`, `/leaderboard/daily/{yyyy}/{mm}/{dd}` (Pacific time) and the other leaderboards. It also sets two rules: a **styling rule** ("Always list name and tagline before additional information when discussing products") and an **attribution rule** ("Data sourced from Product Hunt (https://www.producthunt.com/)"). One request for the Oct 12 leaderboard came back as compact Markdown pointing at `llms.txt`, listing rank, description, score, comment count, **external URL**, topics and categories. A repeat request returned normal HTML, so this is not a reliable interface *(observed)* [S12-md].
- What a Launch page carries in its embedded data *(observed, `/products/ancher-ai`)* [S12-page]:
  - `promo: {text: "40%OFF", code: "PH40OFF"}`;
  - `launchState: "featured"` and `scheduledAt`;
  - comments with `badges: ["maker"]`, and a pinned (`isSticky`) first comment;
  - unredacted maker names.

  None of this is in the public API.
- Conclusion: reading Launch pages would fill the API's gaps, but only Product Hunt's permission would make it allowed. `llms.txt` shows they expect agents to read and cite pages. The Terms still say no.

## 2. Fields per Launch

The live GraphQL reference [S4] is newer than the `schema.graphql` on GitHub [S5]. The GitHub file was last pushed 2024-08-21 and lacks `dailyRank`, `scheduledAt`, `productLinks` and the `posts(url:)` filter, so build against [S4] or introspection. The API's `Post` type is one Launch.

| Dossier need | API v2 field | Notes |
|---|---|---|
| Launch day | `featuredAt`, `scheduledAt`, `createdAt` (DateTime, ISO-8601 UTC) | Convert to `America/Los_Angeles` and take the date. On the website, featured Launches have `featuredAt` = `scheduledAt` = 00:01 PT on launch day *(observed)*. |
| Rank | `dailyRank: Int` (nullable), plus `weeklyRank`, `monthlyRank`, `yearlyRank`; `votesCount`; `posts(order: RANKING)` | The rank "reflects ordering by score at the end of the viewed period", while the score keeps moving [S12-md]. The score is "points", not raw votes [S7-ranking][S7-potd]. |
| Featured or not | `posts(featured: Boolean)` filter, `featuredAt` | The homepage is curated. Unfeatured Launches only appear under `/all` [S7-homepage][S7-notfeatured]. |
| Topics | `topics` connection (`Topic.name`, `slug`) | A Launch has at most three topics [S7-guide]. |
| Tagline / description | `tagline: String!`, `description: String` (plain text) | Tagline ≤ 60 characters, description ≤ 260 [S7-guide]. Product Hunt staff may edit either [S7-content]. |
| Product's website | `website: String!`, "URL that redirects to the Post's website"; `productLinks: [ProductLink{type, url}]`, "Additional product links" | `website` is a Product Hunt redirect, not the bare URL [S6-327] (unanswered). Resolving it means following one redirect (`/r/p/*` is allowed by robots [S9]). We could not see what `productLinks.type` values exist. |
| Maker comment | `comments(first, last, order: NEWEST\|VOTES_COUNT)` returning `Comment{body, createdAt, parentId, user, userId, votesCount, url}` | No maker badge, no sticky flag. `user` is redacted ("Most fields are only available for the currently-accessing user, otherwise they are redacted") [S4-user]. Users report `id: "0"`, `name: "[REDACTED]"`, and `isMaker: false` even for real makers [S6-286][S6-284][S6-342]. `Post.makers` is redacted the same way. **Heuristic:** Product Hunt tells makers to post "a genuine first comment ... This is your Maker comment" [S7-guide], so take the oldest top-level comment (`parentId == null`) around the Launch time. This is untested. |
| Deal / promo / coupon | **none** | The posting flow has a promo field (code plus expiry date) [S7-promo]. It is only visible on the website (`Post.promo{text, code}`) *(observed)*. In the API the only routes are the description and comment bodies, where makers often repeat the offer; the Launch guide tells makers to "consider a discount just for Product Hunt visitors" [S7-guide]. |
| Open vs waitlisted (prior) | none directly | Featured Launches exclude "Waitlisted products (unless immediate access is provided)" [S7-featuring]. "Products that only offer an email sign-up are not eligible for the homepage" [S7-unreleased]. So featured Launches lean open, but the Dossier still has to check the Product's site. |
| Product identity | **none** (no `Product` type in [S4]) | Only via the feed's `/products/{slug}` link [S11], the website, or our own key (see §3). |

Two query notes. `posts(postedAfter:)` **defaults to one month ago** [S4-posts], so history lookups must pass an explicit early date. Also, every featured Launch of a day shares the same `featuredAt`, so `order: FEATURED_AT` pages unstably, with duplicates and gaps [S6-285]. Use `RANKING` and dedupe by `id`.

Sketch of the daily query, **untested** (field names from [S4]):

```graphql
query Day($after: DateTime!, $before: DateTime!, $cursor: String) {
  posts(featured: true, postedAfter: $after, postedBefore: $before,
        order: RANKING, first: 20, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name tagline description slug url website
      productLinks { type url }
      featuredAt scheduledAt createdAt dailyRank votesCount commentsCount
      topics(first: 3) { nodes { name slug } }
      comments(last: 5) { nodes { body createdAt parentId } }
    }
  }
}
```

Two things are unverified. First, which timestamp `postedAfter`/`postedBefore` filter on: `createdAt` can predate the Launch by weeks *(observed in the feed)*, so query a wider window and filter client-side on `featuredAt`/`scheduledAt` in Pacific time. Second, the maximum `first:` page size.

## 3. When a day is final, and recognising a re-Launch

**Day boundary**

- "Every launch goes live at 12:01 AM Pacific on its scheduled date" [S7-guide] (updated 2026-10-07). Leaderboards "operate in the Pacific timezone" [S10].
- Scheduling is at most 30 days ahead. A scheduled Launch "will not be indexed on the site" and can't be upvoted until its time [S7-schedule], so tomorrow's Launches can't be read early.
- Product of the Day goes to "the product with the highest number of points from its launch day, compared to all other products launched that same day" [S7-potd]. Daily rank is fixed at the end of the period; the score shown keeps changing [S12-md].
- Featuring is decided before a Launch is visible: "By the time a product is visible on Product Hunt, we've thoroughly evaluated it multiple times ... our featuring decisions are final" [S7-featuring]. Staff may still reschedule Launches [S7-featuring][S7-hunts].

So:

- **The set** of a day's Launches is known from 00:01 PT.
- **Ranks** are final after 23:59 PT.
- **Comments** keep arriving for days [S7-guide].
- Pacific time is UTC−7 under daylight saving and UTC−8 otherwise, and DST ends on 2026-11-01. Schedule the Miner in `America/Los_Angeles`, not at a fixed UTC hour.

**Re-Launch**

- Product Hunt's rule is that makers "wait at least six months between posts for the same product or from the same company", with a significant update. Earlier relaunches need a reviewed request. "Products that share the same root domain must adhere to a six-month submission gap" [S7-relaunch] (updated 2026-07-07).
- Products relaunch often; Loom has launched 15 times [S7-guide]. In the 2026-10-12 feed, 5 of 50 names carried a version suffix: "Ancher 2.0", "ngram 2.0", "Kudos 3.0", "OpenScreen 2", "Bearconnect 2.0" *(observed)* [S11].
- "Launches from the same product are grouped into the same product page" at `/products/{slug}` [S10]. The feed links each Launch to that page, so "Ancher 2.0" links to `/products/ancher-ai` [S11].
- Workable keys for "already seen this Product" in the Personal database:
  1. the **root domain** of the resolved website, which matches both the glossary ("one per website or company") and Product Hunt's own domain rule;
  2. the **Product slug** from the feed.
- For Products launched before the Assistant existed, `posts(url: "<website>", postedAfter: <old date>)` [S4-posts] can look up earlier Launches. This is untested.

## 4. Typical Launch counts per day

Product Hunt doesn't publish daily counts. The figures below come from **hunted.space**, a third-party tracker built on the Product Hunt API that labels its numbers "Data by Product Hunt". They are **secondary** [S13], fetched 2026-10-13:

| Pacific date | Total Launches | Featured | Unfeatured |
|---|---|---|---|
| Wed 2026-10-07 | 154 | 44 | 110 |
| Thu 2026-10-08 | 151 | 46 | 105 |
| Sun 2026-10-11 | 620 | 27 | 593 |

The Sunday spike in unfeatured Launches is unexplained. First-party corroboration is only partial:

- the 2026-10-11 leaderboard's first page shows ranks 1–17 and says more pages follow *(observed)* [S12-lb];
- Product Hunt says it sorts "through thousands of submissions every day" [S7-guide];
- one person can schedule at most 2 hunts a day [S7-hunts].

Implication: the featured set (roughly 25–50 a day) is the natural input to the soft threshold. Unfeatured Launches (roughly 100–600 a day) are mostly what the homepage filters out: waitlists, email-only signups, lists, templates and services [S7-featuring][S7-notfeatured]. They could be Skipped in bulk or ignored.

## Not verified

- That a developer token can be created today, and what account verification it needs [S6-343].
- The exact redaction of `Comment.user`/`userId` today. The docs and the 2023–2025 reports agree it is redacted, but the details are unconfirmed.
- Which timestamp `postedAfter`/`postedBefore` use; the maximum page size; the complexity cost of the sketch query (measure with `X-Rate-Limit-Remaining`).
- That API `Post.id` equals the feed's `Post/{id}`. It is very likely: the feed and the website share IDs *(observed)*.
- The `productLinks.type` values, and whether any of them is the bare website.
- Whether featuring ever changes after 00:01 PT.
- Why the leaderboard served Markdown once [S12-md].
- When the Terms were last revised. The page only shows the 2014 effective date.

## Surfaced

1. **Ask Product Hunt for permission to read Launch pages?** Promo codes and reliable Maker comments exist only on the website, and the Terms forbid scraping it. An email to hello@producthunt.com (the contact the API docs give) could ask whether a personal, once-a-day reader is allowed. Otherwise Dossiers fall back to coupon text in descriptions and comments, plus a Handoff link to the Launch page.
2. **Getting the developer token is a person-only step:** a Product Hunt account, possibly verified, then creating an app in the dashboard. This fits the `wizard` skill and the secrets story under "Running on the VM". The Hard limits already forbid public posting, so the token should stay `public`-scope and read-only.
3. **Miner timing:** run right after 00:01 PT for fresh Launches, while early-bird offers are live, or after the Pacific day closes for final ranks? Either way it is scheduled in `America/Los_Angeles`.
4. **Judge unfeatured Launches at all?** They are about 2–3× the featured volume on the sampled weekdays and about 22× on the sampled Sunday, and they are mostly what Product Hunt declines to feature. One option is a bulk Skip per day ("unfeatured, not judged") instead of a per-Launch Skip.
5. **Attribution in Dossiers:** the API docs ask for a link back, and `llms.txt` asks for "Data sourced from Product Hunt" with name and tagline first. This may shape the Dossier format and its citations.
6. **Glossary:** "Maker comment" and "featured" are now load-bearing for the Miner. Consider adding them to `CONTEXT.md`, via `domain-modeling`.

## Sources

Fetched 2026-10-13 unless noted. Dates in brackets are the source's own "updated" or creation dates.

- **S1** API v2 docs, home: https://api.producthunt.com/v2/docs (undated)
- **S2** API v2 docs, rate limits: https://api.producthunt.com/v2/docs/rate_limits/headers (undated)
- **S3** API v2 docs, client-only token: https://api.producthunt.com/v2/docs/oauth_client_only_authentication/oauth_token_ask_for_client_level_token (undated)
- **S4** Live GraphQL reference (linked from S1): Post https://api-v2-docs.producthunt.com/object/post/ · posts query https://api-v2-docs.producthunt.com/query/posts/ (**S4-posts**) · Comment https://api-v2-docs.producthunt.com/object/comment/ · User https://api-v2-docs.producthunt.com/object/user/ (**S4-user**) · ProductLink https://api-v2-docs.producthunt.com/object/productlink/ · PostsOrder https://api-v2-docs.producthunt.com/enum/postsorder/ (undated)
- **S5** `schema.graphql` in https://github.com/producthunt/producthunt-api (repo last pushed 2024-08-21; stale relative to S4)
- **S6** Issues on the official API tracker https://github.com/producthunt/producthunt-api/issues, which the help center names as the support channel [S7-api]. The staff answers come from a former PH engineer (#286), a GitHub user listing Product Hunt as employer (maciesielka), and a user who changed PH's Cloudflare rules (andrewgordstewart):
  - **S6-284** issue 284, "Booleans that rely on redacted are misleading" [2023-03-12]
  - **S6-285** issue 285, "order: FEATURED_AT is not deterministic" [2023-03-12]
  - **S6-286** issue 286, "Redacted Field in GQL Response"; staff reply 2023-03-14
  - **S6-327** issue 327, "What is the field to fetch the actual product url?" [2025-06-27, unanswered]
  - **S6-329** issue 329, "GraphQL endpoint locked down" [2025-07-14 → 2026-02-15]
  - **S6-332** issue 332, "API Pricing for Non-Commercial Purposes"; staff reply 2025-09-22
  - **S6-341** issue 341, field discovery and introspection; staff 2025-12-17
  - **S6-342** issue 342, "Trying to fetch another maker data" [2025-12-23]
  - **S6-343** issue 343, "Product Hunt API page" [2026-03-09 → 2026-10-12]
- **S7** Help center (https://help.producthunt.com/en/):
  - **S7-promo** "How to add a promo code" [2025-02-21] https://help.producthunt.com/en/articles/4916443-how-to-add-a-promo-code
  - **S7-relaunch** "Can I relaunch my product?" [2026-07-07] https://help.producthunt.com/en/articles/484934-can-i-relaunch-my-product
  - **S7-ranking** "How is the homepage ranked?" [2025-02-21] https://help.producthunt.com/en/articles/484938-how-is-the-homepage-ranked
  - **S7-homepage** "How do things end up on the homepage?" [2025-02-21] https://help.producthunt.com/en/articles/484923-how-do-things-end-up-on-the-homepage
  - **S7-featuring** "Product Hunt featuring guidelines" [2026-03-10] https://help.producthunt.com/en/articles/9883485-product-hunt-featuring-guidelines
  - **S7-potd** "Product of the Day/Week/Month" [2025-07-10] https://help.producthunt.com/en/articles/11751186-product-of-the-day-week-month
  - **S7-rss** "Does Product Hunt have an RSS feed?" [2022-06-08] https://help.producthunt.com/en/articles/484970-does-product-hunt-have-an-rss-feed
  - **S7-api** "Does Product Hunt have an API?" [2025-07-28] https://help.producthunt.com/en/articles/484971-does-product-hunt-have-an-api
  - **S7-schedule** "How to schedule a post" [2026-02-02] https://help.producthunt.com/en/articles/2724119-how-to-schedule-a-post
  - **S7-guide** "Launch guide" [2026-10-07] https://help.producthunt.com/en/articles/17350772-launch-guide
  - **S7-hunts** "Daily hunt limits" [2026-04-03] https://help.producthunt.com/en/articles/14440291-daily-hunt-limits
  - **S7-hunter** "Hunter vs makers" [2025-02-10] https://help.producthunt.com/en/articles/10082986-hunter-vs-makers-and-how-to-change-them
  - **S7-notfeatured** "Why is my post not on the homepage?" [2025-07-28] https://help.producthunt.com/en/articles/484926-why-is-my-post-not-on-the-homepage
  - **S7-unreleased** "Can I submit an unreleased product?" [2025-02-10] https://help.producthunt.com/en/articles/484932-can-i-submit-an-unreleased-product
  - **S7-content** "Why did my post content change?" [2025-03-06] https://help.producthunt.com/en/articles/8858588-why-did-my-post-content-change
- **S8** Terms of Service: https://www.producthunt.com/legal#terms (reached via `/tos`, which the help center links; page shows "Effective date: August 17th 2014")
- **S9** https://www.producthunt.com/robots.txt
- **S10** https://www.producthunt.com/llms.txt (undated)
- **S11** Atom feed https://www.producthunt.com/feed (snapshot 2026-10-13 02:45 UTC; feed `updated` 2026-10-12T00:01:00-07:00)
- **S12** Single unauthenticated page views, 2026-10-13, used to learn page structure, not as a route:
  - **S12-page** https://www.producthunt.com/products/ancher-ai
  - **S12-lb** https://www.producthunt.com/leaderboard/daily/2026/10/11
  - **S12-md** https://www.producthunt.com/leaderboard/daily/2026/10/12 (served once as Markdown)
- **S13** *Secondary:* hunted.space daily overviews https://hunted.space/overview/2026/October/7, /8, /11 (third-party tracker built on the Product Hunt API)
