# BYOK + Remaining Phase 0 Design

**Date:** 2026-04-19
**Author:** Bruno Silva Marques
**Status:** Design — to be implemented in phases
**Supersedes:** Phase 0 decisions in [docs/specs/2026-04-19-expert-panel-review.md](./2026-04-19-expert-panel-review.md)

---

## TL;DR

The single biggest architectural move we can make right now is **Bring-Your-Own-Key (BYOK)** for all LLM and embedding providers. Users supply their own API keys for Google Gemini, Anthropic Claude, OpenAI, OpenRouter, or a local LMStudio/Ollama endpoint. The server never holds a centralised LLM key in production (the `GEMINI_API_KEY` env var downgrades to an optional fallback for demo/self-host convenience).

This decision automatically resolves three open items from the panel:
- **"Claude Sonnet commitment"** — now a user choice, not a platform commitment.
- **"Model plurality"** — BYOK *is* model plurality, expressed directly in product.
- **Unit-economics problem for Pro tier** — LLM cost is no longer our cost. Pro/Enterprise can charge for product features (bulk, audit, SSO) with no LLM pass-through eating margin.

It also aligns cleanly with the AGPL open-core positioning: self-hosters bring their own LLM spend, and SaaS tenants are isolated tenants-of-one for LLM purposes.

Remaining Phase 0 work (event ingestion, billing, SOC 2) becomes easier because BYOK narrows what the platform is responsible for.

---

## 1. Architecture

### 1.1 Providers (implementing `AIProvider` from Task B)

Five concrete providers. All implement `{ generate, embed, generateStream }`.

| Provider | Completions | Embeddings | Stream | Notes |
|---|---|---|---|---|
| `GeminiProvider` *(exists)* | ✓ | ✓ | ✓ | Native JSON schema support; good default |
| `AnthropicProvider` *(new)* | ✓ | ✗ | ✓ | No native embeddings — must pair with another provider for embedding-based features |
| `OpenAIProvider` *(new)* | ✓ | ✓ | ✓ | JSON mode + structured outputs; text-embedding-3-small/large |
| `OpenRouterProvider` *(new)* | ✓ | via OpenAI client | ✓ | Thin wrapper over OpenAI-compatible API pointed at `https://openrouter.ai/api/v1`; lets user route to any model by name |
| `LocalProvider` *(new)* | ✓ | ✓ if model supports | ✓ | OpenAI-compatible client pointed at user's LMStudio/Ollama URL (default `http://localhost:1234/v1`) |

`OpenRouterProvider` and `LocalProvider` both reuse `OpenAIProvider`'s HTTP logic, differing only by base URL and whether an API key is required.

### 1.2 User AI configuration storage

New table `user_ai_config`:

```sql
CREATE TABLE user_ai_config (
  user_id INTEGER PRIMARY KEY,
  completion_provider TEXT,              -- 'gemini'|'anthropic'|'openai'|'openrouter'|'local'|null
  completion_model TEXT,                 -- e.g. 'gemini-2.5-flash', 'claude-sonnet-4-6', 'gpt-5-mini'
  completion_credentials_enc TEXT,       -- AES-256-GCM encrypted JSON: { apiKey, endpointUrl? }
  embedding_provider TEXT,               -- optional override; null = use completion provider if it supports embeddings
  embedding_model TEXT,
  embedding_credentials_enc TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Encryption via existing `server/lib/credential-encryption.js` (AES-256-GCM with `SESSION_SECRET` / `CREDENTIAL_ENCRYPTION_KEY`). Same pattern as Azure PAT storage.

### 1.3 Per-user provider factory

Extend `server/lib/ai-provider.js`:

```js
/**
 * Build a provider instance for a specific user + feature.
 *
 * Lookup order:
 *   1. user_ai_config row for userId — if configured, use it
 *   2. Server-wide env fallback (GEMINI_API_KEY) — for demo mode or
 *      single-tenant self-hosts that don't want per-user config
 *   3. null — caller must return "AI not configured" to user
 */
export async function createProviderForUser(userId, featureKey = null) { ... }
```

Embedding dispatch: if the user's completion provider is `anthropic` (no native embeddings), the factory checks `embedding_provider` and falls back to that. If neither is configured for embeddings, embedding-requiring features return a friendly "configure an embedding provider" error.

### 1.4 Middleware

`server/middleware/auth.js` currently attaches `req.aiProvider = aiService.provider` (server-wide). Replace with per-request lookup:

```js
// New: look up user's provider, cache on req
req.getAIProvider = async (featureKey) => {
  if (!req._aiProviderCache) req._aiProviderCache = new Map()
  const key = featureKey || 'default'
  if (req._aiProviderCache.has(key)) return req._aiProviderCache.get(key)
  const provider = await createProviderForUser(req.session?.userId, featureKey)
  req._aiProviderCache.set(key, provider)
  return provider
}

// Legacy back-compat: attempt to populate req.aiProvider with the user's
// default provider for call-sites that haven't migrated yet.
req.aiProvider = await createProviderForUser(req.session?.userId).catch(() => null)
req.genAI = req.aiProvider?.rawSDK // if the user's provider is Gemini, legacy still works
```

### 1.5 requireAI middleware

Update `createRequireAI` factory to reject when the user has no provider configured AND no server fallback. Return 400 with `code: 'AI_NOT_CONFIGURED'` + `configureUrl: '/settings#ai'`.

Error message: "AI features require a provider API key. Configure one in Settings → AI Configuration."

### 1.6 Frontend UI

New Settings panel: `Settings → AI Configuration`.

Sections:
- **Completion Provider**: Select (Gemini / Anthropic / OpenAI / OpenRouter / Local). Key input (or URL for Local). Model override. Test Connection button.
- **Embedding Provider** (optional, only shown if completion provider lacks native embeddings, OR when user opts to override): same inputs.
- **Current cost estimate** *(v2, not now)*: $/1M input, $/1M output, rough monthly estimate based on usage.

On save: POST `/api/user/ai-config` with plaintext key → server encrypts → DB.
On test: POST `/api/user/ai-config/test` → server makes a cheap completion (≤10 tokens) → returns success/error.
On read: GET `/api/user/ai-config` → returns config WITHOUT the key (only: provider, model, hasKey: true/false, updatedAt).

### 1.7 Mock mode

Unchanged. `MOCK_MODE=true` bypasses all AI calls with deterministic fake data. BYOK is orthogonal to demo/mock functionality.

### 1.8 Cost model implications

| Tier | What user pays | Notes |
|---|---|---|
| **Free** | $0 to us + user's own LLM bill | App is open-source; LLM keys are user-owned |
| **Pro** | $X to us (product features: bulk, advanced UI, priority support) + user's own LLM bill | Clean margin, no pass-through |
| **Enterprise** | $XX to us (SSO, audit logs, SOC 2 attestation, SLA) + user's own LLM bill | Plus optional managed deployment |

The existing `PricingPage.jsx` copy needs a small update: "AI features require your own provider key — we never meter LLM tokens." This is a trust signal.

### 1.9 Migration from server-wide key

For existing self-hosters with `GEMINI_API_KEY` set:
- Server falls back to that key when a user has no `user_ai_config` row.
- First login after upgrade shows a banner: "AI features are now BYOK. Add your own key in Settings for metered usage, or continue using the server's shared key."
- No forced migration — server fallback stays as long as `GEMINI_API_KEY` is set.

---

## 2. How BYOK interacts with remaining Phase 0 items

### 2.1 Event ingestion pipeline (panel item E)

Unchanged by BYOK. Webhooks, event tables, background workers are not LLM-dependent. The Work Board / DORA / Tech Debt features that consume this data use the user's configured provider when they need AI summaries.

Decomposition recommendation (for a future sub-project):
- **E1**: Expand webhook handler for `pull_request`, `issues`, `deployment_status`, `review_requested`, `assigned` events. 4 new tables. BullMQ queue for async processing.
- **E2**: Aggregation queries for DORA metrics, PR review load, stale PRs.
- **E3**: First consumer — Cross-Repo Work Board (Phase 1.1 from panel).

### 2.2 Billing self-serve (panel item F)

Code-side: I can build upgrade flow UI, checkout redirect, subscription status display, webhook handler for `subscription.created/cancelled/updated`.

User-side (blocks me): needs a Stripe account, product/price IDs created in Stripe dashboard, publishable + secret + webhook signing keys.

Proposed deliverable split:
- **F1** (I build): `src/api/billing.js` + `server/routes/billing.js` + `stripe_customers`/`stripe_subscriptions` tables + `PricingPage.jsx` with "Upgrade to Pro" buttons that call `/billing/checkout-session` → redirect to Stripe Checkout → return via webhook. Everything gated on env-var presence; absent env = Pro features remain behind "contact sales" button as today.
- **F2** (you do): create Stripe products, set env vars, test end-to-end.

### 2.3 SOC 2 Type II (panel item G)

Code-side: audit logging hardening, data retention policy enforcement, access control review, incident response tooling.

Process-side (you drive): auditor selection, gap assessment, 9-12 month evidence collection, policy documents.

What I can build in code:
- **G1**: Stronger audit trail — every AI key rotation, every bulk action, every migration job logged to immutable audit log (append-only table, no updates/deletes allowed via a DB trigger).
- **G2**: Data retention policy — `user_ai_config.completion_credentials_enc` age-out when unused for N days, with user email 30 days before purge.
- **G3**: Incident response — a "nuke my data" endpoint that wipes the current user's AI config + migration history + audit tail older than required retention.
- **G4**: Encryption verification — startup check that `CREDENTIAL_ENCRYPTION_KEY` is strong, `SESSION_SECRET` is set in prod, TLS is forced in prod deployments.

G1-G4 are code tasks. Full SOC 2 attestation is a 12-month process that only you can drive.

---

## 3. Implementation phases (BYOK-first)

Sequencing chosen so each phase is shippable and validated independently.

### Phase Z.1 — Provider implementations + user config storage (backend only)

**Deliverables:**
- `server/lib/providers/anthropic.js`, `openai.js`, `openrouter.js`, `local.js` (all implementing `AIProvider`).
- `server/db/migrations/` or equivalent — new `user_ai_config` table.
- `server/lib/user-ai-config.js` — CRUD wrapper with encryption.
- `createProviderForUser(userId, featureKey)` in `ai-provider.js`.
- Server routes: `GET/POST/DELETE /api/user/ai-config`, `POST /api/user/ai-config/test`.
- Tests for each provider (mock HTTP calls), encryption round-trip, route handlers.

**Out of scope for this phase:** UI, middleware switch, per-feature routing.

### Phase Z.2 — Middleware switch + frontend UI

**Deliverables:**
- `server/middleware/auth.js` switched to per-user provider lookup. `req.aiProvider` and `req.getAIProvider(feature)` both available.
- `requireAI` returns AI_NOT_CONFIGURED with configure link when neither user config nor server fallback exists.
- `src/components/Settings/AIConfigSection.jsx` — provider picker, key input, model override, Test button.
- Settings page wiring.
- Banner on first login post-upgrade: "AI features are now BYOK — add your key".
- E2E test: user adds Anthropic key → AI chat uses Claude.

### Phase Z.3 — Polish

**Deliverables:**
- Per-feature model override (users can set `PLAN_MODEL=gpt-5` vs default).
- Cost estimate display on Settings page (input/output $/1M, approximate monthly based on current usage).
- Pricing page copy update ("we never meter LLM tokens").
- Documentation in `docs/` for each provider setup.

### Phase Z.4 — Migration path from server-wide key

**Deliverables:**
- Login-time detection: if user has no config AND server has `GEMINI_API_KEY`, show banner once.
- Settings UI shows "Using server's shared key (fallback)" state.
- Admin setting to disable server fallback in multi-tenant deployments.

### Phase E — Event ingestion pipeline (after BYOK)

As described in 2.1. Decomposable into E1/E2/E3.

### Phase F — Billing self-serve scaffold

F1 (code) as described in 2.2. F2 is user-driven Stripe account setup.

### Phase G — SOC 2 code hardening

G1-G4 as described in 2.3. Full audit is a 12-month business process.

---

## 4. Provider compatibility matrix (user-facing)

Shown on the AI Configuration page so users can pick intelligently:

| Feature | Gemini | Anthropic | OpenAI | OpenRouter | Local |
|---|---|---|---|---|---|
| AI Chat | ✓ | ✓ | ✓ | ✓ | ✓ (needs chat model) |
| Repo analysis | ✓ | ✓ | ✓ | ✓ | ✓ |
| README enhance | ✓ | ✓ | ✓ | ✓ | ✓ |
| PR review | ✓ | ✓ (best per Greptile) | ✓ | ✓ | ✓ (depends on local model) |
| Migration description | ✓ | ✓ | ✓ | ✓ | ✓ |
| Migration size strategy | ✓ | ✓ | ✓ | ✓ | ✓ |
| Semantic search / repo indexing | ✓ | ✗ (needs embedding provider) | ✓ | depends | ✓ if local model supports embeddings |
| Batch indexing | ✓ | ✗ | ✓ | depends | ✓ |
| AI Issue-to-PR planner *(future)* | ✓ | ✓ | ✓ | ✓ | ✓ |
| Agentic execution *(future, Tier 2)* | ✗ (per AI/ML expert: flaky tool-use under load) | ✓ (best) | ✓ | ✓ routed to Claude | depends |

Users with Anthropic-only must also configure an embedding provider to use semantic search / batch indexing.

---

## 5. Trust and security

- **Keys encrypted at rest** via existing AES-256-GCM vault; same pattern as Azure PAT storage.
- **Keys never logged** — PII redaction in logs confirmed.
- **Keys never returned in API responses** — `GET /api/user/ai-config` returns `{ provider, model, hasKey: bool, updatedAt }`, no plaintext.
- **Transport encryption** — TLS enforced in prod (Helmet is already configured).
- **Zero-knowledge option** *(Phase Z.3)* — users can opt to store their key in browser localStorage instead of our DB. We'll pass the key in a per-request header. Useful for paranoid users; default remains server-side because it enables things like background batch indexing that need the key without user present.
- **Key rotation UI** — trivial once CRUD exists; rotate = update.
- **Audit log** — any key set/rotate/delete logged to the audit table.

---

## 6. What this session will deliver

Given scope, this session will deliver **Phase Z.1 + Z.2** — the BYOK foundation end-to-end (providers + storage + middleware + UI). Each phase validated with spec + code quality review before committing.

Follow-on sessions (not this one):
- **Z.3 + Z.4** — polish, per-feature routing, migration banner
- **E1–E3** — event ingestion pipeline (biggest remaining block for Phase 1 features)
- **F1** — Stripe scaffold (F2 is your account setup)
- **G1–G4** — SOC 2 code hardening

Explicit acknowledgement: Phase 1 features from the expert panel (Cross-Repo Work Board, Dependency Risk Aggregation) will likely require Phase E to ship with real data. BYOK + E together unlock the entire AI-backed half of the roadmap.

---

## 7. Open decisions that *remain* open

After BYOK resolves decisions 1 (Claude commitment) and 4 (model plurality) from the panel, these remain:

1. **SOC 2 commitment** — start 12-month audit now, or defer Enterprise revenue by a year? Business decision, unchanged by BYOK.
2. **When to flip from server fallback to no fallback** — at what point does the app stop bundling a demo-mode `GEMINI_API_KEY` and require BYOK? Recommend: never force it; keep as optional.
3. **Stripe product setup** — what's the exact tier price, feature matrix, and trial policy? Blocks Phase F2.

Everything else from the panel is now an engineering sequencing question, not a commitment question.
