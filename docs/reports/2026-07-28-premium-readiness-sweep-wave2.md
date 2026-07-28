# Premium-readiness sweep, wave 2 — 2026-07-28

Continues `2026-07-28-premium-readiness-sweep.md`. The three lenses listed
there as "never ran" were re-run and completed: premium gating/metering, the
client↔server contract sweep across all 90 `validateBody` routes, and
vaporware/docs drift.

Everything below was verified against the implementation. Where a finding was
proven by executing something — a schema parse, a production build — that is
stated. Findings already fixed are marked.

---

## 1. Fixed in this wave

**`POST /api/repos` created every repository public.** The modal sent
`private: isPrivate`; `createRepoSchema` declares `isPrivate` with
`.default(false)`; Zod strips unknown keys. So the request *validated* — no
400, no error surface — and the repo was created public while the UI said
Private. The modal defaults the toggle to Private, so this was the default
path, not an edge case. Fixed by sending the right key and making the schema
`.strict()`: on a route that decides visibility, an unrecognised key must fail
loudly rather than let a security flag fall back to its most permissive value.

**A self-declared retry bought unlimited free AI generations.** `retry` was a
plain client boolean and `POST /api/ai/generate-diagram` used it to skip both
the quota check and the increment. `{"retry":true,"failedSource":"x"}` ran a
full provider generation metered against nothing, repeatable up to the rate
limiter — roughly 2,880/day against an intended 15/month. The compensating
control the design names is the AI spend cap, and `aiSpendCapCents` is **0 on
all three tiers**. The free retry is now a server-issued, single-use credit
bound to user + repo + diagram type, and a retry never mints one.

**The Windows release pipeline was broken.** `windows-latest` rolled to a
Visual Studio 18 image node-gyp 11.5.0 cannot identify; better-sqlite3 fell
back to building from source and `npm ci` died. `release.yml` used the same
unpinned runner, so cutting a release would have failed. Both pinned to
`windows-2022`.

**connect-redis 10 and rate-limit-redis 6 are safe**, proven by new tests run
against all four versions. Two floors need raising with them: node `>=22` for
connect-redis 10 (we declare `">=20 <23"`), and `express-rate-limit >=8.6.0`
for rate-limit-redis 6 (we declare `^8.3.2`, satisfied only because it happens
to resolve to 8.6.1).

---

## 2. Metering holes still open, by money at risk

- **An aborted SSE stream records ZERO spend.** All three providers discard
  usage on abort (`ai-provider.js:619`, `providers/anthropic.js:423`,
  `providers/openai.js:482`) and the caller loops break before the generator
  returns (`ai-streaming.js:135,189`). Disconnect mid-stream: input tokens are
  billed to the operator, `ai_spend` records 0, the cap never fires. On Pro and
  Enterprise the count quotas are `Infinity`, so the spend cap is the *only*
  cost control on streaming — and it is fully evadable by disconnecting.
- **Four streaming routes never pass the abort signal**, so the provider keeps
  generating output nobody receives: `/ai/generate-commit`
  (`dev-toolkit.js:252`), `/ai/generate-pr` (`:371`), `/ai/refine` (`:495`),
  `/ai/chat-refine` (`:660`). The other four routes pass it correctly.
- **Repo Insights and Semantic Search ignore BYOK.** `ai-service.js:140,145`
  bind `semanticSearch`/`analyzeRepo` to the server-wide env key while
  `requireAI` gates on the user's provider. With a server key set, every BYOK
  user's indexing and search spends the *operator's* key. In the BYOK-only
  deployment `.env.example` recommends, they throw — and Semantic Search is
  sold on all three tiers.
- **TOCTOU on image generation** (`images.js:222-237`): check → await generate
  → increment. At ~$0.25/image against a free cap of 5/month, a burst to the
  rate limit is ~$7.50 against an intended $1.25. `guardedIncrementAIUsage`
  already exists and is used exactly once (`indexing.js:59`). The same racy
  shape is in diagrams, deep-review, pr-chat, pr-commands, prompt-studio,
  repos-security and core — images is where the money justifies going first.
- **Per-route output caps are dead parameters.** No provider reads a top-level
  `maxTokens`/`maxOutputTokens`. `suggest-name-description.js:210` intends 200
  and is uncapped; `core.js:311` intends 80 and gets 2048; `core.js:379`
  intends 200; `repos-security.js:249` intends 300.
- **`GET /config/ai-status?probe=1` has no `requireAuth`** (`core.js:88`) and
  bypasses the 5-minute cache, so an anonymous caller drives a fresh
  `provider.generate()` per request against the operator's key.
- **The `requireScope('ai')` parity gate walks only the ai router**
  (`ai-key-scope-enforcement.test.js:241`), so three routes outside the barrel
  are invisible to it. Fail-closed today, but the gate passes vacuously — widen
  it to the whole `v1Routes` tree.

**Verified clean:** no tier-wall bypass; no `/api` vs `/api/v1` asymmetry (the
same router object is mounted at both prefixes, so the chains are identical by
construction); no client-side-only gating; tier downgrade is re-evaluated per
request, not cached in the session. `migration.js:245-248` — a single guarded
`UPDATE … WHERE quota_charged = 0` inside a transaction — is the model to copy.

---

## 3. Contract drift — three more always-broken routes

Each proven by running the real client payload through the real schema.

- **`POST /repos/:owner/:repo/branches` 400s on every call.** Client sends
  `{branch, sha}` (`useRepoDetail.js:64`); schema is `.strict()` on
  `{name, from}` (`validators.js:976`). Deeper than a rename: the UI collects a
  base **SHA** and the server has no SHA input at all — it resolves the SHA
  itself from `from`, a branch *name*. The "Base SHA" field cannot work as
  designed.
- **`POST /import/check-duplicates` from CreateRepoModal, broken both ways.**
  Sends `{names, org}` against `{repos, targetOwner}`; and the handler returns
  `duplicates` as an object keyed by repo name while the client reads
  `.length`, so fixing the request alone leaves the indicator permanently
  reporting "available". The endpoint's two other callers are correct.
- **`POST /ai/generate-commit` 400s for any repo with no description.**
  `repo_context.description` is `.optional()` but not nullable; GitHub returns
  `null` when unset. Metered path.

At scale: `/ai/refine` and `/ai/chat-refine` cap `original_diff` at 20 000
while `/ai/generate-commit` allows 60 000 and the clients send the full joined
diff; bulk ops cap `repos` at 100 while select-all is uncapped;
`PUT /topics` unions AI-suggested topics stored raw from the model against a
`^[a-z0-9-]+$` schema.

Correction worth making: the comment at `validators.js:1141` claims
`express.json()` still yields `{}` for a bodyless POST. That is **false** on
express 5.2.1 — `req.body` is `undefined`, verified against a real booted app.
Only a dead code path depends on it today.

---

## 4. Vaporware

- **The licence panel shows a seat limit that does not exist and that every
  paying customer will appear to violate.** `LicensePlanSection.jsx:180`
  renders "Seats — {used} of {seats}" and turns red above 90%. `seatsUsed`
  counts every account on the instance (`license.js:96-110`); `seats` comes
  from the licence JWT, which `stripe-webhooks.js:196` mints as
  `parseInt(metadata?.seats) || 1` while `billing.js:124` sets no `seats` key —
  so **every Stripe licence is minted with seats: 1**. Nothing enforces it
  anywhere. A 4-person self-hosted Pro team sees "4 of 1 used" in red while
  every pricing surface says "Unlimited team members".
- **The landing page sells Pro with "priority support"**
  (`PricingPreview.jsx:27`) — Enterprise-only per the README matrix,
  PricingPage, FeatureComparison and the billing docs.
  `pricing-feature-parity.test.js:451` bans this exact phrase, but only inside
  `proUpsellArray()`, so this surface escapes it. It is the first pricing
  surface a prospect sees.
- **AI-generated SECURITY.md invents commitments.**
  `community-health-fix.js:117` asks for "supported versions … expected
  response time" from nothing but a repo name and an email, so the model
  fabricates a support policy and an SLA — published under the user's name via
  `commitOrOpenPR`, whose default mode is `direct`. None of the five prompts in
  `PROMPT_TEMPLATES` carries an anti-invention rule, while the sibling
  `grounded-prompts.js` exists for exactly this and is exemplary.
- **`migration_assist` is a 25/month cap that is enforced, sold nowhere and
  shown nowhere.** Enforced at `ai/migration.js:360,410`; absent from all five
  pricing surfaces and from the usage panel; missing from `FEATURE_LABELS`, so
  the user is told "AI limit reached (25/25)" while the pricing page promises
  1,000 AI queries.
- **"Repo Advisor" names two different features, and the flag caveat is false
  for the one users see.** The floating assistant is backed by `/api/ai/chat`,
  which is NOT behind `WORK_BOARD_AI_ENABLED`; README:276 says it is, which
  scares self-hosters away from a feature that works out of the box. Inversely,
  `PricingPage.jsx:108` claims every Repo Advisor call counts against the
  monthly total — false for `/work-board/ai/interpret`, which keeps its own
  ledger and bypasses both mandated metering paths.
- **"Enable stats caching" does nothing when switched off.** `useOrgs.js:137`
  sends `x-cache-ttl: '0'`; `stats.js:31` does `parseInt(...) || 5` and `0` is
  falsy, so disabling yields the default 5-minute cache. The slider works; the
  switch is a no-op.
- **"20+ bulk operations"** (`FeaturesSection.jsx:60`) against 9 real
  multi-select actions plus 3 Work Board ones.
- **Displayed prices are hardcoded** (`PricingPage.jsx:54`) and
  `/billing/config` returns booleans only, so an operator whose Stripe price is
  not $19/mo ships a page advertising one number and a checkout charging
  another, with no gate to catch it.

**Verified clean, and worth knowing how:** mock data does **not** leak to
production — proven by running a real production build and grepping the output,
not by reading the guards. Every advertised tier is genuinely purchasable, with
Enterprise as an honest Contact Sales rather than a fake self-serve path. All
17 documented env vars resolve to real code, every README npm script exists,
and `docs:linkcheck` reports 0 broken links across 216 files. The Security
Posture prompt is the strongest in the codebase.

---

## 5. A CI reliability problem worth its own look

Intermittent **module-collection** failures: the file fails to import, zero
tests fail, the run goes red. Observed four times today — `pr-deep-review`,
`ai-pr-review-store`, `dashboard-aggregator` locally, and
`work-board-routes.test.js` on CI, where it reddened a PR that changed only two
YAML strings. Every one passes in isolation.

Two things make it worse than it needs to be:

- The shards run `--reporter=blob`, so **a failing shard's log shows nothing
  useful** — the failure is only readable from the merge job or by downloading
  the artifact. That is a debuggability regression from the sharding change and
  cost real time today.
- It is indistinguishable from a genuine failure without re-running, which is
  exactly the property that trains people to re-run reflexively.

---

## Suggested order

1. Streaming spend: record partial usage on abort, and pass the signal in the
   four routes that do not — this is the only cost control on Pro/Enterprise
   streaming and it is currently evadable.
2. The seat counter — it is visible to every paying customer today and says
   they are in violation of a limit that does not exist.
3. `guardedIncrementAIUsage` on image generation, then the other racy callsites.
4. The three always-broken routes in §3, extending the contract gate as you go.
5. The BYOK/operator-key split in `ai-service.js`.
6. The pricing and README corrections in §4 — cheap, and they are honesty
   claims the project already test-enforces elsewhere.
7. The collection flake in §5, and make a failing shard print something.
