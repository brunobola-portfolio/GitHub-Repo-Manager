# Repo Advisor — Phase 1 (Identity & Neutrality) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the in-app AI assistant to **Repo Advisor** across all user-facing surfaces and make the backend genuinely provider-neutral (honor `AI_PROVIDER` server-wide), so the product stops mis-branding itself as "Gemini".

**Architecture:** Backend already has a `PROVIDER_REGISTRY` (gemini/anthropic/openai/openrouter/local) used by the per-user BYOK path; the server-wide default path (`createProvider()` + `ai-service.js`) is the only thing still hardcoded to Gemini. We route the default through the same registry, then sweep user-facing strings to provider-neutral copy and the "Repo Advisor" name.

**Tech Stack:** Node.js/Express + better-sqlite3 backend; React 19 + Vite + Tailwind v4 + Framer Motion frontend; Vitest for unit tests.

**Spec:** `docs/specs/2026-06-21-repo-advisor-initiative.md` (Phase 1).

## Global Constraints

- `.jsx` files only — NO TypeScript.
- Tailwind utility classes + opt-in `ds-*` design-system classes only; NO global CSS.
- Conventional Commits (`type(scope): description`), subject < 72 chars, NO `Co-Authored-By` lines.
- Frontend unit tests in `tests/` mirroring `src/`; backend tests in `server/__tests__/`. Never place test files in `src/` or `server/`.
- Run unit tests with `npx vitest run <path>`.
- Keep `GEMINI_*` env vars working for back-compat (additive neutrality, not a breaking rename).
- Out of scope (do NOT touch): DB column `ai_assistant_enabled`, app-events in `appEvents.js`, storage key `grm-ai-assistant-messages`.

---

### Task 1: Provider-neutral default path (honor `AI_PROVIDER`)

Route the server-wide default provider through `PROVIDER_REGISTRY` so `AI_PROVIDER=anthropic|openai|openrouter|local` works, not just `gemini`.

**Files:**
- Modify: `server/lib/ai-provider.js` (`createProvider()` ~line 608-641; `PROVIDER_REGISTRY` ~652-673)
- Test: `server/__tests__/ai-provider-create.test.js` (create)

**Interfaces:**
- Consumes: existing `PROVIDER_REGISTRY` entries `{ create(opts), supportsEmbeddings }`; existing `getGeminiModelDefaults()`.
- Produces: `createProvider(featureKey)` that resolves any registered provider from `process.env.AI_PROVIDER`, reading `<PROVIDER>_API_KEY` and `<PROVIDER>_MODEL` (falling back to Gemini defaults for gemini). Throws an error listing ALL registered providers for an unknown value.

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Avoid constructing real SDK clients during the test.
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }));

const ORIG = { ...process.env };
let createProvider;
beforeEach(async () => { ({ createProvider } = await import('../lib/ai-provider.js')); });
afterEach(() => { process.env = { ...ORIG }; vi.resetModules(); });

describe('createProvider honors AI_PROVIDER', () => {
  it('returns a provider for a registered non-gemini provider', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(() => createProvider('CHAT')).not.toThrow();
    expect(createProvider('CHAT')).toBeTruthy();
  });

  it('throws listing all registered providers for an unknown value', () => {
    process.env.AI_PROVIDER = 'nope';
    expect(() => createProvider()).toThrow(/anthropic/i);
    expect(() => createProvider()).toThrow(/openai/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/ai-provider-create.test.js`
Expected: FAIL — current `createProvider()` throws `Supported providers: gemini` for `openai`, and the unknown-provider message names only `gemini`.

- [ ] **Step 3: Implement registry-driven resolution**

Replace the body of `createProvider(featureKey)` so that after computing `providerName`:
- If `providerName` is not a key in `PROVIDER_REGISTRY`, throw `[AI] Unknown AI_PROVIDER "<name>". Supported providers: <Object.keys(PROVIDER_REGISTRY).join(', ')>.`
- Read key/model generically: `const KEY = providerName.toUpperCase(); const apiKey = process.env[`${KEY}_API_KEY`]; const model = process.env[`${KEY}_MODEL`];`
- Preserve current Gemini behavior: for `gemini`, fall back to `getGeminiModelDefaults()` for base/embedding model when env unset, and keep the production-missing-key throw + non-prod warn+return-null.
- Apply the existing per-feature override (`AI_MODEL_<FEATURE>`) on top of the resolved base model.
- Return `PROVIDER_REGISTRY[providerName].create({ apiKey, model, embeddingModel })`.

Keep `PROVIDER_REGISTRY` defined ABOVE `createProvider` (move the registry block up if needed so it's in scope).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/ai-provider-create.test.js`
Expected: PASS (both cases).

- [ ] **Step 5: Run the existing AI provider/server suites for regressions**

Run: `npx vitest run server/__tests__/ai-provider.test.js server/__tests__/import-service-lfs.test.js`
Expected: PASS (no regressions in existing provider tests).

- [ ] **Step 6: Commit**

```bash
git add server/lib/ai-provider.js server/__tests__/ai-provider-create.test.js
git commit -m "feat(ai): honor AI_PROVIDER server-wide via provider registry"
```

---

### Task 2: `ai-service.js` initializes the configured provider

Make the singleton AI service honor the configured provider instead of hardcoding `new GeminiProvider(...)`.

**Files:**
- Modify: `server/ai-service.js` (`initialize()` ~line 61-88)
- Test: `server/__tests__/ai-service-init.test.js` (create)

**Interfaces:**
- Consumes: `createProvider()` from Task 1.
- Produces: `aiService.initialize(apiKey?, modelName?)` that, when `AI_PROVIDER` is non-gemini, builds that provider; for gemini it keeps the current apiKey/model path so existing callers (`index.js` passing `config.geminiApiKey`) are unaffected.

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }));
const ORIG = { ...process.env };
afterEach(() => { process.env = { ...ORIG }; vi.resetModules(); });

describe('aiService.initialize honors AI_PROVIDER', () => {
  it('builds a non-gemini provider when AI_PROVIDER is set', async () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    const { aiService } = await import('../ai-service.js');
    aiService.initialize();
    expect(aiService.provider).toBeTruthy();
  });
});
```

(Confirm the exact export name of the singleton in `server/ai-service.js`; adjust `aiService` import accordingly.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/ai-service-init.test.js`
Expected: FAIL — current `initialize()` returns early without an apiKey arg and always builds `GeminiProvider`.

- [ ] **Step 3: Implement**

In `initialize()`: if `process.env.AI_PROVIDER` is set and not `gemini`, set `this.provider = createProvider()` and log the provider name; otherwise keep the existing Gemini path (using the passed `apiKey`/`modelName`). Import `createProvider` from `./lib/ai-provider.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/ai-service-init.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/ai-service.js server/__tests__/ai-service-init.test.js
git commit -m "feat(ai): ai-service initializes the configured provider"
```

---

### Task 3: Provider-neutral user-facing error/guidance strings

Replace hardcoded "Gemini" in user-facing error/guidance copy with the active provider's display name (or neutral wording).

**Files:**
- Modify: `server/routes/ai/shared.js` (error messages ~lines 44, 56, 74)
- Modify: `src/components/AIAssistant.jsx` (`talking to Gemini` ~233; `needs a Gemini API key` ~530)
- Modify: `src/components/AI/AINotConfiguredBanner.jsx` (~84, 103); `src/api/ai.js` (~234); `src/utils/errors.js` (~122)
- Test: `server/__tests__/ai-shared-errors.test.js` (create) for the backend strings

**Interfaces:**
- Consumes: provider label map at `server/lib/ai-error-format.js:21` (`GeminiProvider: 'Gemini'`) — use the active provider's label; default to a neutral `'the AI provider'` when unknown.

- [ ] **Step 1: Write the failing test (backend)**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('AI error strings are provider-neutral', () => {
  it('shared.js has no hardcoded "Gemini" in user-facing messages', () => {
    const src = readFileSync(new URL('../routes/ai/shared.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/Gemini/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/ai-shared-errors.test.js`
Expected: FAIL — `shared.js` currently contains "Gemini" in 3 messages.

- [ ] **Step 3: Implement neutral copy**

In `shared.js`, change the three messages to reference the provider generically, e.g. `"Invalid or expired API key for the configured AI provider. Check your provider key."`, `"API quota exceeded for the configured AI provider. Try again later."`, `"The AI provider is under heavy load right now. Give it a moment and try again."` In the frontend files, change "talking to Gemini" → "talking to the AI provider", and the not-configured copy to neutral wording that points to the provider picker in Settings → AI (keep mentioning a key is required, drop "Gemini"). Where the active provider is known at runtime, prefer interpolating its display name.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/ai-shared-errors.test.js`
Expected: PASS.

- [ ] **Step 5: Update any frontend tests asserting the old strings, then run them**

Run: `npx vitest run tests/components/AIAssistant.test.jsx` (and any AINotConfiguredBanner test). Update assertions to the new neutral copy.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/ai/shared.js src/components/AIAssistant.jsx src/components/AI/AINotConfiguredBanner.jsx src/api/ai.js src/utils/errors.js server/__tests__/ai-shared-errors.test.js tests/
git commit -m "feat(ai): make AI error and not-configured copy provider-neutral"
```

---

### Task 4: Rename the assistant to "Repo Advisor" (user-facing)

Replace the user-facing assistant name everywhere it shows, and rename the primary component file. Internal identifiers stay (see Global Constraints).

**Files (rename map — apply each occurrence):**
- `src/components/AIAssistant.jsx` → rename file to `src/components/RepoAdvisor.jsx`; update its default/named export and ALL importers (grep `from './components/AIAssistant'` / `AIAssistant`). Header `"Gemini Assistant"` (~331) → `"Repo Advisor"`; welcome message (~35) → "Hi! I'm Repo Advisor. Ask me to open the migration wizard, create a repo, or help you manage your projects."; FAB label & aria (~280, 292, 306) → "Repo Advisor".
- `src/components/AIAssistantPasteCard.jsx` → rename to `src/components/RepoAdvisorPasteCard.jsx`; update importers.
- `src/components/Settings/WorkBoard/ai/AIAssistantToggle.jsx` (~26, 35) heading/aria "AI Assistant" → "Repo Advisor".
- `src/components/Settings/WorkBoard/WorkBoardSummary.jsx` (~60), `WorkBoardSettingsSection.jsx` (~139): "AI Assistant" → "Repo Advisor".
- `src/components/CommandPalette.jsx` (~640) group heading; `src/components/MobileQuickActionsFab.jsx` (~19) label → "Repo Advisor".
- `src/components/Pricing/PricingPage.jsx` (~20, 97), `Pricing/FeatureComparison.jsx` (~39), `Landing/PricingPreview.jsx` (~9, 16), `Landing/FeaturesSection.jsx` (~9, drop "powered by Gemini" → "powered by your configured AI provider"), `Roadmap/RoadmapPage.jsx` (~18): "AI Assistant" → "Repo Advisor".
- `src/App.jsx` (~903) error-boundary fallback label.
- Test: update `tests/` specs asserting "AI Assistant"/"Gemini Assistant"; add `tests/components/RepoAdvisor.test.jsx` smoke check on the header text.

**Interfaces:**
- Consumes: nothing new.
- Produces: component exported as `RepoAdvisor` (from `src/components/RepoAdvisor.jsx`); the parity/pricing copy uses "Repo Advisor".

- [ ] **Step 1: Write the failing test**

```jsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RepoAdvisor } from '../../src/components/RepoAdvisor.jsx';

describe('RepoAdvisor', () => {
  it('renders the Repo Advisor name in the panel header', () => {
    render(<RepoAdvisor forceOpen />); // use whatever prop/state opens the panel; or render and open
    expect(screen.getByText('Repo Advisor')).toBeInTheDocument();
    expect(screen.queryByText(/Gemini Assistant/)).not.toBeInTheDocument();
  });
});
```

(Adjust the open mechanism to match the component; if opening requires an event, dispatch `APP_EVENTS.AI_ASSISTANT_OPEN` via the existing test utilities.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/RepoAdvisor.test.jsx`
Expected: FAIL — file `RepoAdvisor.jsx` does not exist yet / header still says "Gemini Assistant".

- [ ] **Step 3: Rename file + export, update importers, apply the rename map**

`git mv src/components/AIAssistant.jsx src/components/RepoAdvisor.jsx` and `git mv src/components/AIAssistantPasteCard.jsx src/components/RepoAdvisorPasteCard.jsx`. Rename the exports to `RepoAdvisor` / `RepoAdvisorPasteCard`. Update every importer (grep for the old names). Apply each string in the rename map above.

- [ ] **Step 4: Run the test + a broad grep gate**

Run: `npx vitest run tests/components/RepoAdvisor.test.jsx`
Expected: PASS.
Run gate: `rg -n "Gemini Assistant|from './AIAssistant'|components/AIAssistant" src/` → expect no matches.

- [ ] **Step 5: Run the full frontend test suite for import/regression breakage**

Run: `npx vitest run`
Expected: PASS (fix any test still importing the old path or asserting old copy).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ai): rename assistant to Repo Advisor across the UI"
```

---

### Task 5: Docs/README + final neutrality sweep

Update prose to "Repo Advisor" and the provider-neutral positioning; lock it with a grep gate.

**Files:**
- Modify: `README.md`, `docs/ARTICLE.md`, `docs/ai-providers.md`, `docs/architecture/*.md`, `docs/api/API.md`, `AGENTS.md`, `.env.example` (assistant-name + "AI Assistant" headings → "Repo Advisor"; keep provider lists accurate). Leave historical `docs/specs/*` and `docs/plans/*` untouched.

- [ ] **Step 1: Sweep docs**

Replace user-facing "AI Assistant" feature name and "Gemini Assistant" with "Repo Advisor" in the files above; keep factual provider mentions (e.g. "bring your own Gemini/Anthropic/OpenAI key") as-is. Update the README feature matrix row to "Repo Advisor (conversational)".

- [ ] **Step 2: Final grep gate**

Run: `rg -n "Gemini Assistant" -- . ':!docs/specs' ':!docs/plans'`
Expected: no matches.

- [ ] **Step 3: Lint + full test run**

Run: `npx eslint . --max-warnings 0` then `npx vitest run`
Expected: clean + green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(ai): rename AI Assistant to Repo Advisor in docs and README"
```

---

## Self-Review

**Spec coverage (Phase 1):**
- 1A Rename to Repo Advisor → Tasks 4 (UI) + 5 (docs). ✓
- 1B Provider-neutral strings → Task 3. ✓
- 1C Honor `AI_PROVIDER` server-wide → Tasks 1 (`createProvider`) + 2 (`ai-service`). ✓
- Phase 1 scope boundary (internal identifiers untouched) → Global Constraints + Task 4 file map. ✓

**Placeholder scan:** No "TBD"/"handle edge cases". Test code and concrete string maps provided. Line numbers are approximate (prefixed `~`) and must be confirmed against the file at edit time — the search strings are exact. ✓

**Type consistency:** `createProvider(featureKey)` signature reused across Tasks 1-2; component export `RepoAdvisor` used consistently in Task 4 test + importers. ✓

**Risk notes:** Task 4 is broad; the grep gates in Steps 4-5 are the safety net against missed occurrences. Keep `GEMINI_*` env back-compat (Task 1 falls back to Gemini defaults only for the gemini branch).
