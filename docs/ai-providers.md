# AI Provider Guide

GitHub Repo Manager supports multiple AI providers via BYOK (Bring Your Own Key).
Each user configures their own keys in **Settings → AI Configuration**; keys are stored
encrypted with AES-256-GCM and are never exposed in API responses.

The server itself may have a Gemini fallback key for demo / self-host mode
(`GEMINI_API_KEY` env var). Per-user config always takes precedence.

---

## Server-wide configuration (env)

Per-user BYOK above is the primary path. For the **server fallback** (used by
users without their own config) the assistant is provider-neutral — pick the
provider with `AI_PROVIDER` and set its key. See `.env.example` for the full,
commented list. Key variables:

| Env var | Purpose | Default |
|---|---|---|
| `AI_PROVIDER` | Server fallback provider: `gemini` \| `anthropic` \| `openai` \| `openrouter` \| `local` | `gemini` |
| `<PROVIDER>_API_KEY` / `<PROVIDER>_MODEL` | Key + model for the chosen provider (e.g. `ANTHROPIC_API_KEY`, `OPENAI_MODEL`) | — |
| `AI_MODEL_<FEATURE>` | Per-feature model override (e.g. `AI_MODEL_REVIEW`) | provider default |
| `AI_REQUIRE_USER_CONFIG` | `true` ⇒ disable the server fallback; every user must BYOK | off |
| `AI_MAX_OUTPUT_TOKENS` | Per-call output-token cap (OWASP LLM10) | `2048` (256–8192) |
| `AI_SPEND_CAP_CENTS` | Monthly per-user AI spend cap, US cents | `0` = unlimited |
| `AI_RETRY_BASE_DELAY_MS` | Backoff base for transient provider errors | `400` |
| `WORK_BOARD_AI_ENABLED` | Work Board AI endpoints (off unless exactly `true`) | off |
| `ALLOW_LOCAL_AI_ENDPOINTS` | Allow loopback/private BYOK endpoints (with `local` provider) | off (SSRF-blocked) |
| `CREDENTIAL_ENCRYPTION_KEY` | AES-256-GCM key for BYOK creds at rest (required in prod) | falls back to `SESSION_SECRET` (dev only) |

> Example — run the whole server on Anthropic: `AI_PROVIDER=anthropic`,
> `ANTHROPIC_API_KEY=sk-ant-…`. Cap cost: `AI_SPEND_CAP_CENTS=500` ($5/user/mo).

---

## Gemini (Google)

**Provider key:** `gemini`

**How to get an API key:**
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Create a new API key (free tier available).

**Recommended models:**
- Completion: `gemini-2.5-flash` (default), `gemini-2.5-pro` (higher quality)
- Embedding: `gemini-embedding-001` (default)

**Limitations:** None — supports both completion and embeddings natively.

**Example POST body:**
```json
{
  "completionProvider": "gemini",
  "completionModel": "gemini-2.5-flash",
  "completionApiKey": "AIza...",
  "embeddingProvider": "gemini",
  "embeddingModel": "gemini-embedding-001",
  "embeddingApiKey": "AIza..."
}
```

---

## Anthropic (Claude)

**Provider key:** `anthropic`

**How to get an API key:**
1. Sign up at [console.anthropic.com](https://console.anthropic.com/).
2. Go to **API Keys** and create a new key.

**Recommended models:**
- `claude-sonnet-4-6` (default, best balance)
- `claude-opus-4-5` (highest quality, slower)
- `claude-haiku-4-5` (fastest, cheapest)

**Limitations:**
- **No native embeddings.** If you configure Anthropic as your completion provider,
  you must also configure a separate embedding provider (Gemini or OpenAI) for
  semantic search and similar-repo features.
- Error codes: 529 = overloaded (maps to `OVERLOAD`).

**Example POST body:**
```json
{
  "completionProvider": "anthropic",
  "completionModel": "claude-sonnet-4-6",
  "completionApiKey": "sk-ant-...",
  "embeddingProvider": "openai",
  "embeddingModel": "text-embedding-3-small",
  "embeddingApiKey": "sk-..."
}
```

---

## OpenAI

**Provider key:** `openai`

**How to get an API key:**
1. Sign up at [platform.openai.com](https://platform.openai.com/).
2. Go to **API Keys** and create a new secret key.

**Recommended models:**
- Completion: `gpt-4o-mini` (default), `gpt-4o`, `o3-mini`
- Embedding: `text-embedding-3-small` (default), `text-embedding-3-large`

**Limitations:** None — supports both completion and embeddings natively.

**Example POST body:**
```json
{
  "completionProvider": "openai",
  "completionModel": "gpt-4o-mini",
  "completionApiKey": "sk-...",
  "embeddingProvider": "openai",
  "embeddingModel": "text-embedding-3-small",
  "embeddingApiKey": "sk-..."
}
```

You may use the same key for both `completionApiKey` and `embeddingApiKey`.

---

## OpenRouter

**Provider key:** `openrouter`

Routes requests to 200+ models from a single key: Claude, GPT, Llama, Mistral, etc.

**How to get an API key:**
1. Sign up at [openrouter.ai](https://openrouter.ai/).
2. Go to **Keys** and create a new key.
3. Add credits (pay-as-you-go).

**Recommended models:**
- `anthropic/claude-sonnet-4-6` (default)
- `openai/gpt-4o-mini`
- `meta-llama/llama-3.3-70b-instruct`

**Limitations:**
- **No native embeddings.** Configure a separate embedding provider.
- Model availability changes; check [openrouter.ai/models](https://openrouter.ai/models).

**Example POST body:**
```json
{
  "completionProvider": "openrouter",
  "completionModel": "anthropic/claude-sonnet-4-6",
  "completionApiKey": "sk-or-...",
  "embeddingProvider": "openai",
  "embeddingApiKey": "sk-..."
}
```

---

## Local (LMStudio / Ollama / llama.cpp)

**Provider key:** `local`

Runs entirely on your machine — no data leaves your network.

**How to set up:**

*LMStudio:*
1. Download [LMStudio](https://lmstudio.ai/).
2. Load a model (e.g. `Llama 3.3 70B Q4`).
3. Start the local server (default port 1234).

*Ollama:*
1. Install [Ollama](https://ollama.ai/).
2. Run `ollama pull llama3.3` then `ollama serve`.
3. Use endpoint `http://localhost:11434/v1`.

**Limitations:**
- Embeddings only work if the loaded model exposes an embedding endpoint.
  Many chat models do not — use a separate embedding provider if needed.
- No API key required; the `apiKey` field is ignored by most local servers.

**Example POST body:**
```json
{
  "completionProvider": "local",
  "completionModel": "llama-3.3-70b",
  "completionEndpointUrl": "http://localhost:1234/v1"
}
```

For Ollama with embedding support:
```json
{
  "completionProvider": "local",
  "completionModel": "llama3.3",
  "completionEndpointUrl": "http://localhost:11434/v1",
  "embeddingProvider": "local",
  "embeddingModel": "nomic-embed-text",
  "embeddingEndpointUrl": "http://localhost:11434/v1"
}
```

---

## Clearing Credentials

To remove stored API keys without changing other settings, send `null` for the key field:

```json
{
  "completionApiKey": null
}
```

To wipe all configuration: `DELETE /api/user/ai-config`

---

## Testing Your Configuration

```http
POST /api/user/ai-config/test
Content-Type: application/json

{ "kind": "completion" }
```

Response on success:
```json
{ "ok": true, "latencyMs": 320, "modelUsed": "claude-sonnet-4-6", "response": "ok" }
```

Rate limited to 1 call per 10 seconds per user.

---

## Per-feature Model Overrides

Power users can assign different models to specific features while keeping a
single provider and API key. This is useful for cost-quality trade-offs —
e.g. Gemini Flash for chat (cheap, fast) and Claude Sonnet for PR review
(higher quality).

**API field:** `featureOverrides` — a JSON object where keys are UPPER_SNAKE
feature identifiers and values are model name strings.

```json
{
  "featureOverrides": {
    "CHAT": "gemini-2.5-flash",
    "PR_REVIEW": "claude-sonnet-4-6",
    "WORK_BOARD_SUMMARY": "gpt-4o-mini",
    "EMBED": "text-embedding-3-large"
  }
}
```

**Supported feature keys:**

| Key                     | Feature                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `CHAT`                  | AI Chat                                                                 |
| `PR_REVIEW`             | PR Review                                                               |
| `MIGRATION_DESCRIPTION` | Migration Description                                                   |
| `MIGRATION_SIZE`        | Migration Size Strategy                                                 |
| `README_ANALYSIS`       | README Analysis                                                         |
| `WORK_BOARD_SUMMARY`    | Cross-Repo Work Board AI summary (headline + bullets + urgency score)   |
| `EMBED`                 | Embeddings                                                              |

The Work Board summary is tuned conservatively (strict JSON schema, "never
invent" clause, tolerant JSON extractor). Small, cheap models such as
`gpt-4o-mini`, `gemini-2.5-flash`, or local `qwen2.5:7b` produce acceptable
output; larger models (Claude Sonnet, GPT-4o) lift bullet quality at a modest
cost premium. The endpoint is rate-limited to 1 call / 5 min / user with a
5-minute response cache, so runaway spend is not a concern.

When a key is not present in `featureOverrides`, the primary `completionModel`
(or `embeddingModel`) is used as the fallback.

**In the Settings UI:** Expand the "Per-feature model overrides (optional)"
section below Embedding Provider. Each feature row has a free-text model input
and a "Reset" button.

---

## Cost Estimation

The Settings UI shows indicative pricing next to each model name input. Prices
are sourced from public provider documentation and last updated 2026-04-19.
They are informational only — this application never meters LLM tokens; you
pay your AI provider directly.

| Model                    | Input ($/1M) | Output ($/1M) |
| ------------------------ | ------------ | ------------- |
| `gemini-2.5-flash`       | $0.30        | $2.50         |
| `gemini-2.5-pro`         | $1.25        | $5.00         |
| `claude-sonnet-4-6`      | $3.00        | $15.00        |
| `claude-opus-4-5`        | $15.00       | $75.00        |
| `gpt-4o-mini`            | $0.15        | $0.60         |
| `gpt-4o`                 | $2.50        | $10.00        |
| `text-embedding-3-small` | $0.02        | —             |
| `text-embedding-3-large` | $0.13        | —             |
| `gemini-embedding-001`   | $0.15        | —             |

Prices use prefix matching — `gemini-2.5-flash-latest` resolves to the
`gemini-2.5-flash` entry. Unknown models display "Pricing unknown — check
provider docs".

---

## Multi-tenant Deployment

In multi-tenant deployments you may want every user to bring their own key
rather than sharing server credentials. Set:

```env
AI_REQUIRE_USER_CONFIG=true
```

When this variable is `true`:

- `createProviderForUser` skips the `GEMINI_API_KEY` server fallback even when
  that env var is set.
- Users with no configured `user_ai_config` row will receive `null` from the
  provider factory — AI features will be unavailable for them.
- The `serverFallbackAvailable` field returned by `GET /api/user/ai-config`
  will be `false` (because the fallback is disabled), so the "using server's
  shared key" banner is suppressed.

This is useful for:

- SaaS / hosted deployments where you don't want to subsidise AI API costs.
- Compliance environments where every AI call must be traceable to a specific
  user's own account.
