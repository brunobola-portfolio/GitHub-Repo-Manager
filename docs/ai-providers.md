# AI Provider Guide

GitHub Repo Manager supports multiple AI providers via BYOK (Bring Your Own Key).
Each user configures their own keys in **Settings → AI Configuration**; keys are stored
encrypted with AES-256-GCM and are never exposed in API responses.

The server itself may have a Gemini fallback key for demo / self-host mode
(`GEMINI_API_KEY` env var). Per-user config always takes precedence.

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
