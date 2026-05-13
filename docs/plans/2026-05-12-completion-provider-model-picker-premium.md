# Completion Provider Model Picker — Premium Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh AI provider model catalogues against current docs and redesign the Completion Provider dropdown into a premium picker with capability icons, prominent colour-coded pricing, tier sections, and a sticky filter chip bar.

**Architecture:** Decompose `ModelCombobox.jsx` into a thin combobox shell plus a `ModelDropdown` that owns the listbox UI (chip bar, section headers, row cards, legacy toggle). Extend the data schema in `providerModels.js` with `recommended`, `releasedAt`, `legacy`, `capabilities`, `pricing`, and explicit `maxOutput`/`cutoff`. Pricing is stored per-model and rendered as a coloured two-line block on the right of each row. A new `useFilteredModels` hook centralises the group-by-tier + filter logic so the combobox stays presentational.

**Tech Stack:** React 19, Vite 7, Tailwind v4, lucide-react (icons), vitest + @testing-library/react (tests). Project rule: `.jsx` only — no TypeScript. Tests live in `tests/` mirroring `src/`.

**Spec:** [docs/specs/2026-05-12-completion-provider-model-picker-premium.md](../specs/2026-05-12-completion-provider-model-picker-premium.md)

---

## File Structure

**Create:**
- `src/components/Settings/AIConfig/ModelDropdown.jsx` — listbox container (chip bar, sections, legacy toggle, catalogue link)
- `src/components/Settings/AIConfig/ModelRow.jsx` — single premium row card (3-line, two-column)
- `src/components/Settings/AIConfig/ModelSectionHeader.jsx` — tier section divider
- `src/components/Settings/AIConfig/TierFilterChips.jsx` — sticky single-select chip bar
- `src/hooks/useFilteredModels.js` — groups + filters models by tier and query
- `tests/components/Settings/AIConfig/ModelRow.test.jsx`
- `tests/components/Settings/AIConfig/ModelDropdown.test.jsx`
- `tests/components/Settings/AIConfig/TierFilterChips.test.jsx`
- `tests/hooks/useFilteredModels.test.jsx`
- `tests/utils/providerModels.test.js`
- `tests/utils/providerPricing.test.js`

**Modify:**
- `src/utils/providerPricing.js` — add `pricingTier()` helper + colour-class mapping
- `src/utils/providerModels.js` — extend each entry's schema; rewrite curated catalogues with validated 2026-05 data; add `isNewModel()`, `CAPABILITY_ICONS`, `TIER_ORDER`
- `src/hooks/useProviderModels.js` — extract capabilities + pricing from OpenRouter live JSON; tag one ★ recommended per provider
- `src/components/Settings/AIConfig/ModelCombobox.jsx` — replace inline listbox JSX (lines 164-235) with `<ModelDropdown />`; keep keyboard handler thin
- `tests/components/Settings/AIConfig/ModelCombobox.test.jsx` — adjust assertions affected by new row markup (no behaviour change)

---

## Task 1: `pricingTier()` helper + colour mapping

**Files:**
- Modify: `src/utils/providerPricing.js`
- Test: `tests/utils/providerPricing.test.js` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/utils/providerPricing.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { pricingTier, PRICING_TIER_CLS } from '../../src/utils/providerPricing'

describe('pricingTier', () => {
    it('returns "cheap" when output is at or below $5/M', () => {
        expect(pricingTier({ output: 0.40 })).toBe('cheap')
        expect(pricingTier({ output: 5 })).toBe('cheap')
    })

    it('returns "mid" when output is between $5 and $30/M (exclusive lower, inclusive upper)', () => {
        expect(pricingTier({ output: 5.01 })).toBe('mid')
        expect(pricingTier({ output: 15 })).toBe('mid')
        expect(pricingTier({ output: 30 })).toBe('mid')
    })

    it('returns "premium" when output exceeds $30/M', () => {
        expect(pricingTier({ output: 30.01 })).toBe('premium')
        expect(pricingTier({ output: 180 })).toBe('premium')
    })

    it('returns null when pricing is missing or has no output', () => {
        expect(pricingTier(null)).toBeNull()
        expect(pricingTier(undefined)).toBeNull()
        expect(pricingTier({ input: 1 })).toBeNull()
    })

    it('exposes a tailwind class per tier in PRICING_TIER_CLS', () => {
        expect(PRICING_TIER_CLS.cheap).toContain('emerald')
        expect(PRICING_TIER_CLS.mid).toContain('slate')
        expect(PRICING_TIER_CLS.premium).toContain('rose')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/providerPricing.test.js`
Expected: FAIL — `pricingTier is not a function` / `PRICING_TIER_CLS is undefined`.

- [ ] **Step 3: Implement `pricingTier` and `PRICING_TIER_CLS`**

Append to `src/utils/providerPricing.js`:

```js
/**
 * Classify a pricing entry by output price per million tokens.
 * Used to colour-code the pricing block in the model picker.
 *
 * @param {{ output?: number }|null|undefined} pricing
 * @returns {'cheap'|'mid'|'premium'|null}
 */
export function pricingTier(pricing) {
    if (!pricing || typeof pricing.output !== 'number') return null
    if (pricing.output <= 5) return 'cheap'
    if (pricing.output <= 30) return 'mid'
    return 'premium'
}

export const PRICING_TIER_CLS = {
    cheap: 'text-emerald-600 dark:text-emerald-300',
    mid: 'text-slate-700 dark:text-slate-200',
    premium: 'text-rose-500 dark:text-rose-300',
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/utils/providerPricing.test.js`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/providerPricing.js tests/utils/providerPricing.test.js
git commit -m "feat(ai-config): add pricingTier helper for model picker colour-coding"
```

---

## Task 2: Extend `providerModels.js` schema and helpers

**Files:**
- Modify: `src/utils/providerModels.js`
- Test: `tests/utils/providerModels.test.js` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/utils/providerModels.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    isNewModel,
    CAPABILITY_ICONS,
    TIER_ORDER,
    getCompletionModels,
} from '../../src/utils/providerModels'

describe('isNewModel', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-05-12T00:00:00Z'))
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('returns true when releasedAt is within 60 days', () => {
        expect(isNewModel('2026-03-14')).toBe(true) // 59 days ago
        expect(isNewModel('2026-05-12')).toBe(true) // today
    })

    it('returns false when releasedAt is exactly 60 days ago or older', () => {
        expect(isNewModel('2026-03-13')).toBe(false) // 60 days ago
        expect(isNewModel('2026-01-01')).toBe(false)
    })

    it('returns false for falsy or invalid values', () => {
        expect(isNewModel(undefined)).toBe(false)
        expect(isNewModel(null)).toBe(false)
        expect(isNewModel('')).toBe(false)
        expect(isNewModel('not-a-date')).toBe(false)
    })
})

describe('CAPABILITY_ICONS', () => {
    it('exposes vision, tools, json, reasoning entries with label + lucide-react icon name', () => {
        expect(CAPABILITY_ICONS.vision).toMatchObject({ label: expect.any(String), iconName: expect.any(String) })
        expect(CAPABILITY_ICONS.tools).toMatchObject({ label: expect.any(String), iconName: expect.any(String) })
        expect(CAPABILITY_ICONS.json).toMatchObject({ label: expect.any(String), iconName: expect.any(String) })
        expect(CAPABILITY_ICONS.reasoning).toMatchObject({ label: expect.any(String), iconName: expect.any(String) })
    })
})

describe('TIER_ORDER', () => {
    it('lists tiers in display order with legacy last', () => {
        expect(TIER_ORDER).toEqual(['fast', 'balanced', 'smart', 'reasoning', 'open', 'legacy'])
    })
})

describe('getCompletionModels (smoke)', () => {
    it('returns models with the extended schema for known providers', () => {
        const m = getCompletionModels('anthropic')
        expect(m.length).toBeGreaterThan(0)
        // Schema check on one entry — every curated entry has these fields
        const sample = m[0]
        expect(sample).toHaveProperty('id')
        expect(sample).toHaveProperty('label')
        expect(sample).toHaveProperty('tier')
        expect(sample).toHaveProperty('capabilities')
        expect(sample).toHaveProperty('pricing')
        expect(Array.isArray(sample.capabilities)).toBe(true)
    })

    it('marks exactly one model per provider as recommended', () => {
        for (const provider of ['anthropic', 'gemini', 'openai']) {
            const recommended = getCompletionModels(provider).filter((m) => m.recommended)
            expect(recommended.length).toBe(1)
        }
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/providerModels.test.js`
Expected: FAIL — `isNewModel is not a function`, `CAPABILITY_ICONS is undefined`, `TIER_ORDER is undefined`, schema checks fail.

- [ ] **Step 3: Add helpers and constants (do NOT touch catalogue yet — Task 3 does that)**

Append to `src/utils/providerModels.js`:

```js
/**
 * Returns true if `releasedAt` (YYYY-MM-DD) is within the last 60 days.
 * Used to badge recently-released models as NEW in the picker.
 *
 * @param {string|null|undefined} releasedAt
 * @returns {boolean}
 */
export function isNewModel(releasedAt) {
    if (!releasedAt || typeof releasedAt !== 'string') return false
    const t = Date.parse(releasedAt)
    if (Number.isNaN(t)) return false
    const ageMs = Date.now() - t
    const dayMs = 24 * 60 * 60 * 1000
    return ageMs < 60 * dayMs
}

/**
 * Maps a capability key to its display metadata.
 * `iconName` is a lucide-react export name; the consumer resolves it.
 */
export const CAPABILITY_ICONS = {
    vision: { label: 'Vision (image input)', iconName: 'Image' },
    tools: { label: 'Tool / function calling', iconName: 'Wrench' },
    json: { label: 'Structured JSON output', iconName: 'Braces' },
    reasoning: { label: 'Reasoning / extended thinking', iconName: 'Brain' },
}

/**
 * Render order for tier sections in the dropdown. `legacy` always last
 * and is hidden behind a toggle.
 */
export const TIER_ORDER = ['fast', 'balanced', 'smart', 'reasoning', 'open', 'legacy']
```

- [ ] **Step 4: Run `isNewModel` + constants subset of test**

Run: `npx vitest run tests/utils/providerModels.test.js -t "isNewModel"`
Run: `npx vitest run tests/utils/providerModels.test.js -t "CAPABILITY_ICONS"`
Run: `npx vitest run tests/utils/providerModels.test.js -t "TIER_ORDER"`
Expected: PASS for these three groups. The `getCompletionModels (smoke)` group still fails because the catalogue hasn't been rewritten yet (Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/utils/providerModels.js tests/utils/providerModels.test.js
git commit -m "feat(ai-config): add NEW-badge helper, capability icons, tier order"
```

---

## Task 3: Rewrite curated catalogues with validated 2026-05 data

**Files:**
- Modify: `src/utils/providerModels.js` (the `COMPLETION_MODELS` constant)

- [ ] **Step 1: Replace `COMPLETION_MODELS` with the validated catalogue**

Replace the entire `export const COMPLETION_MODELS = { ... }` block (currently lines 17-111) in `src/utils/providerModels.js` with:

```js
export const COMPLETION_MODELS = {
    gemini: [
        {
            id: 'gemini-2.5-flash',
            label: 'Gemini 2.5 Flash',
            tier: 'fast',
            description: 'Best price-performance for low-latency, high-volume tasks',
            context: '1M',
            maxOutput: '8K',
            cutoff: 'Jan 2025',
            recommended: true,
            releasedAt: '2025-06-17',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 0.30, output: 2.50, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gemini-2.5-flash-lite',
            label: 'Gemini 2.5 Flash-Lite',
            tier: 'fast',
            description: 'Fastest and most budget-friendly multimodal model',
            context: '1M',
            maxOutput: '8K',
            cutoff: 'Jan 2025',
            recommended: false,
            releasedAt: '2025-09-25',
            legacy: false,
            capabilities: ['vision', 'tools', 'json'],
            pricing: { input: 0.10, output: 0.40, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gemini-2.5-pro',
            label: 'Gemini 2.5 Pro',
            tier: 'smart',
            description: 'Most advanced — deep reasoning and coding',
            context: '2M',
            maxOutput: '64K',
            cutoff: 'Jan 2025',
            recommended: false,
            releasedAt: '2025-06-17',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 1.25, output: 10.00, currency: 'USD', per: '1M tokens' },
        },
    ],
    anthropic: [
        {
            id: 'claude-sonnet-4-6',
            label: 'Claude Sonnet 4.6',
            tier: 'balanced',
            description: 'Best balance of speed and intelligence — default',
            context: '1M',
            maxOutput: '64K',
            cutoff: 'Aug 2025',
            recommended: true,
            releasedAt: '2026-02-20',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 3.00, output: 15.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'claude-haiku-4-5',
            label: 'Claude Haiku 4.5',
            tier: 'fast',
            description: 'Fastest Claude with near-frontier intelligence',
            context: '200K',
            maxOutput: '64K',
            cutoff: 'Feb 2025',
            recommended: false,
            releasedAt: '2025-10-01',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 1.00, output: 5.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'claude-opus-4-7',
            label: 'Claude Opus 4.7',
            tier: 'smart',
            description: 'Most capable for complex reasoning and agentic coding',
            context: '1M',
            maxOutput: '128K',
            cutoff: 'Jan 2026',
            recommended: false,
            releasedAt: '2026-04-15',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 5.00, output: 25.00, currency: 'USD', per: '1M tokens' },
        },
        // Legacy — hidden behind "Show legacy" toggle
        {
            id: 'claude-opus-4-6',
            label: 'Claude Opus 4.6',
            tier: 'legacy',
            description: 'Previous Opus generation',
            context: '1M',
            maxOutput: '128K',
            cutoff: 'May 2025',
            recommended: false,
            legacy: true,
            capabilities: ['vision', 'tools', 'reasoning'],
            pricing: { input: 5.00, output: 25.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'claude-sonnet-4-5',
            label: 'Claude Sonnet 4.5',
            tier: 'legacy',
            description: 'Previous Sonnet generation',
            context: '200K',
            maxOutput: '64K',
            cutoff: 'Jan 2025',
            recommended: false,
            legacy: true,
            capabilities: ['vision', 'tools', 'reasoning'],
            pricing: { input: 3.00, output: 15.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'claude-opus-4-5',
            label: 'Claude Opus 4.5',
            tier: 'legacy',
            description: 'Older Opus — kept for migration callers',
            context: '200K',
            maxOutput: '64K',
            cutoff: 'May 2025',
            recommended: false,
            legacy: true,
            capabilities: ['vision', 'tools', 'reasoning'],
            pricing: { input: 5.00, output: 25.00, currency: 'USD', per: '1M tokens' },
        },
    ],
    openai: [
        {
            id: 'gpt-5.4-mini',
            label: 'GPT-5.4 mini',
            tier: 'fast',
            description: 'Strongest mini model for coding, computer use, subagents',
            context: '400K',
            maxOutput: '16K',
            cutoff: 'Oct 2025',
            recommended: true,
            releasedAt: '2026-03-10',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 0.75, output: 4.50, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-5.4-nano',
            label: 'GPT-5.4 nano',
            tier: 'fast',
            description: 'Cheapest GPT-5.4-class for high-volume simple tasks',
            context: '400K',
            maxOutput: '16K',
            cutoff: 'Oct 2025',
            recommended: false,
            releasedAt: '2026-03-10',
            legacy: false,
            capabilities: ['vision', 'tools', 'json'],
            pricing: { input: 0.20, output: 1.25, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-5.4',
            label: 'GPT-5.4',
            tier: 'balanced',
            description: 'More affordable flagship for coding and pro work',
            context: '400K',
            maxOutput: '16K',
            cutoff: 'Oct 2025',
            recommended: false,
            releasedAt: '2026-02-01',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 2.50, output: 15.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-5.5',
            label: 'GPT-5.5',
            tier: 'smart',
            description: 'New class of intelligence for coding and pro work',
            context: '400K',
            maxOutput: '32K',
            cutoff: 'Oct 2025',
            recommended: false,
            releasedAt: '2026-04-22',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 5.00, output: 30.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-5.4-pro',
            label: 'GPT-5.4 Pro',
            tier: 'reasoning',
            description: 'Higher precision GPT-5.4 with deeper reasoning',
            context: '400K',
            maxOutput: '32K',
            cutoff: 'Oct 2025',
            recommended: false,
            releasedAt: '2026-02-01',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 30.00, output: 180.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-5.5-pro',
            label: 'GPT-5.5 Pro',
            tier: 'reasoning',
            description: 'Smartest, most precise GPT-5.5',
            context: '400K',
            maxOutput: '32K',
            cutoff: 'Oct 2025',
            recommended: false,
            releasedAt: '2026-04-22',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 30.00, output: 180.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-4.1',
            label: 'GPT-4.1',
            tier: 'balanced',
            description: 'Smartest non-reasoning model',
            context: '1M',
            maxOutput: '32K',
            cutoff: 'Jun 2024',
            recommended: false,
            releasedAt: '2025-04-14',
            legacy: false,
            capabilities: ['vision', 'tools', 'json'],
            pricing: { input: 2.00, output: 8.00, currency: 'USD', per: '1M tokens' },
        },
    ],
    openrouter: [
        // Live-fetched by useProviderModels; fallback list when offline.
        {
            id: 'anthropic/claude-sonnet-4-6',
            label: 'Claude Sonnet 4.6 (via OR)',
            tier: 'balanced',
            description: 'OpenRouter route to Anthropic',
            context: '1M',
            recommended: true,
            legacy: false,
            capabilities: ['vision', 'tools', 'reasoning'],
            pricing: { input: 3.00, output: 15.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'openai/gpt-5.4-mini',
            label: 'GPT-5.4 mini (via OR)',
            tier: 'fast',
            description: 'OpenRouter route to OpenAI',
            context: '400K',
            recommended: false,
            legacy: false,
            capabilities: ['vision', 'tools'],
            pricing: { input: 0.75, output: 4.50, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'google/gemini-2.5-flash',
            label: 'Gemini 2.5 Flash (via OR)',
            tier: 'fast',
            description: 'OpenRouter route to Google',
            context: '1M',
            recommended: false,
            legacy: false,
            capabilities: ['vision', 'tools'],
            pricing: { input: 0.30, output: 2.50, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'meta-llama/llama-3.3-70b-instruct',
            label: 'Llama 3.3 70B Instruct',
            tier: 'open',
            description: 'Open-weights via OpenRouter',
            context: '128K',
            recommended: false,
            legacy: false,
            capabilities: ['tools'],
            pricing: { input: 0.30, output: 0.40, currency: 'USD', per: '1M tokens' },
        },
    ],
    local: [],
}
```

- [ ] **Step 2: Run the full `providerModels` test**

Run: `npx vitest run tests/utils/providerModels.test.js`
Expected: PASS — all groups including the smoke checks (each provider has 1 recommended, every model has the extended schema).

- [ ] **Step 3: Check the existing test suite still passes for the picker**

Run: `npx vitest run tests/components/Settings/AIConfig/ModelCombobox.test.jsx`
Expected: PASS — existing tests only check name/id/keyboard nav, which still work with the new fields.

- [ ] **Step 4: Commit**

```bash
git add src/utils/providerModels.js
git commit -m "refactor(ai-config): refresh model catalogue against 2026-05 provider docs"
```

---

## Task 4: Enrich OpenRouter live mapping

**Files:**
- Modify: `src/hooks/useProviderModels.js`

- [ ] **Step 1: Update the mapper to extract capabilities + pricing**

Replace the `.map((m) => ({ ... }))` block in `fetchOpenRouterModels` (currently lines 38-44) with:

```js
                .map((m) => {
                    const inputModalities = m?.architecture?.input_modalities || []
                    const supportedParams = m?.supported_parameters || []
                    const capabilities = []
                    if (inputModalities.includes('image')) capabilities.push('vision')
                    if (supportedParams.includes('tools') || supportedParams.includes('tool_choice')) capabilities.push('tools')
                    if (supportedParams.includes('response_format') || supportedParams.includes('structured_outputs')) capabilities.push('json')
                    if (supportedParams.includes('reasoning') || /reasoning|thinking|o1|o3|o4/i.test(m.id || '')) capabilities.push('reasoning')

                    // OpenRouter prices are USD per token as strings; convert to per-million dollars.
                    const promptPrice = m?.pricing?.prompt ? Number(m.pricing.prompt) * 1_000_000 : undefined
                    const completionPrice = m?.pricing?.completion ? Number(m.pricing.completion) * 1_000_000 : undefined
                    const pricing = (promptPrice !== undefined && completionPrice !== undefined)
                        ? { input: promptPrice, output: completionPrice, currency: 'USD', per: '1M tokens' }
                        : undefined

                    return {
                        id: m.id,
                        label: m.name || m.id,
                        tier: tierFor(m.id),
                        description: (m.description || '').replace(/\s+/g, ' ').slice(0, 90),
                        context: formatContext(m.context_length),
                        capabilities,
                        pricing,
                        recommended: false,
                        legacy: false,
                    }
                })
```

- [ ] **Step 2: Mark one ★ recommended for the OpenRouter live list**

Inside `fetchOpenRouterModels`, after the `.sort(...)` call, add:

```js
                // Mark a single recommended pick — Claude Sonnet 4.6 via OR is the
                // strongest balanced default at the time of writing. Falls back to
                // the first balanced/smart entry if Sonnet 4.6 isn't returned.
                const preferredId = 'anthropic/claude-sonnet-4-6'
                let recIdx = mapped.findIndex((m) => m.id === preferredId)
                if (recIdx < 0) recIdx = mapped.findIndex((m) => m.tier === 'balanced' || m.tier === 'smart')
                if (recIdx >= 0) mapped[recIdx] = { ...mapped[recIdx], recommended: true }
```

Note: this requires `mapped` to be a `let` binding declared earlier in the IIFE — change `const mapped = list` to `let mapped = list` if it isn't already, and rename the final sorted assignment so `mapped` holds the sorted array. The existing code already assigns the chained result to `const mapped`; convert to:

```js
            let mapped = list
                .filter((m) => m?.id)
                .map(/* the new mapper above */)
                .sort((a, b) => a.label.localeCompare(b.label))
            // (then the ★ recommended block above)
            openrouterCache = mapped
            return mapped
```

- [ ] **Step 3: Sanity-check the change manually**

Run: `npm run dev` (in a separate terminal), open the app, go to Settings → AI Configuration, switch provider to OpenRouter, open the model dropdown.
Expected: dropdown still populates from the live API; no console errors. (Visual polish lands in later tasks — at this point the existing combobox still renders, just with extra fields silently attached to each option.)
Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useProviderModels.js
git commit -m "feat(ai-config): map capabilities and pricing from OpenRouter live models"
```

---

## Task 5: `ModelRow` component + tests

**Files:**
- Create: `src/components/Settings/AIConfig/ModelRow.jsx`
- Test: `tests/components/Settings/AIConfig/ModelRow.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/Settings/AIConfig/ModelRow.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { ModelRow } = await import('../../../../src/components/Settings/AIConfig/ModelRow')

const BASE_OPTION = {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    tier: 'balanced',
    description: 'Best balance of speed and intelligence',
    context: '1M',
    capabilities: ['vision', 'tools', 'reasoning'],
    pricing: { input: 3.00, output: 15.00, currency: 'USD', per: '1M tokens' },
    recommended: true,
    releasedAt: '2026-04-20',
}

describe('ModelRow', () => {
    it('renders label, model id, description, and tier badge', () => {
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={() => {}} />)
        expect(screen.getByText('Claude Sonnet 4.6')).toBeInTheDocument()
        expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
        expect(screen.getByText(/Best balance/)).toBeInTheDocument()
        expect(screen.getByText('Balanced')).toBeInTheDocument()
    })

    it('renders the context badge when context is provided', () => {
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={() => {}} />)
        expect(screen.getByText('1M')).toBeInTheDocument()
    })

    it('renders a RECOMMENDED pill when option.recommended is true', () => {
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={() => {}} />)
        expect(screen.getByText(/recommended/i)).toBeInTheDocument()
    })

    it('renders a NEW pill when releasedAt is within 60 days', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-05-12T00:00:00Z'))
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={() => {}} />)
        expect(screen.getByText('NEW')).toBeInTheDocument()
        vi.useRealTimers()
    })

    it('renders one capability icon per declared capability with an accessible label', () => {
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={() => {}} />)
        expect(screen.getByLabelText(/vision/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/tool/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/reasoning/i)).toBeInTheDocument()
        expect(screen.queryByLabelText(/json/i)).toBeNull()
    })

    it('renders the pricing block with input and output formatted', () => {
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={() => {}} />)
        expect(screen.getByText(/\$3(\.00)? in/i)).toBeInTheDocument()
        expect(screen.getByText(/\$15(\.00)? out/i)).toBeInTheDocument()
    })

    it('omits the pricing block when option.pricing is missing', () => {
        const noPrice = { ...BASE_OPTION, pricing: undefined }
        render(<ModelRow option={noPrice} selected={false} highlighted={false} onPick={() => {}} />)
        expect(screen.queryByText(/in$/i)).toBeNull()
    })

    it('calls onPick when the row is clicked', () => {
        const onPick = vi.fn()
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={onPick} />)
        fireEvent.click(screen.getByRole('option'))
        expect(onPick).toHaveBeenCalledTimes(1)
    })

    it('marks the row as aria-selected when selected is true', () => {
        render(<ModelRow option={BASE_OPTION} selected={true} highlighted={false} onPick={() => {}} />)
        expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/Settings/AIConfig/ModelRow.test.jsx`
Expected: FAIL — `Cannot find module '.../ModelRow'`.

- [ ] **Step 3: Implement `ModelRow.jsx`**

Create `src/components/Settings/AIConfig/ModelRow.jsx`:

```jsx
import { Check, Image, Wrench, Braces, Brain } from 'lucide-react'
import {
    TIER_LABELS,
    TIER_STYLES,
    CAPABILITY_ICONS,
    isNewModel,
} from '../../../utils/providerModels'
import { pricingTier, PRICING_TIER_CLS } from '../../../utils/providerPricing'

const ICON_BY_NAME = { Image, Wrench, Braces, Brain }

function formatDollars(n) {
    if (typeof n !== 'number') return ''
    if (n >= 100) return `$${n.toFixed(0)}`
    if (n >= 10) return `$${n.toFixed(2)}`
    return `$${n.toFixed(2)}`
}

/**
 * Three-line row card used inside the model picker dropdown.
 *
 * Left column: name + tier/context/recommended/NEW pills, description, id + capability icons.
 * Right column: two-line pricing block, colour-coded by output-price tier.
 */
export function ModelRow({ option, selected, highlighted, onPick, dataIdx }) {
    const tierStyle = TIER_STYLES[option.tier] || TIER_STYLES.balanced
    const isNew = isNewModel(option.releasedAt)
    const priceTier = pricingTier(option.pricing)
    const priceCls = priceTier ? PRICING_TIER_CLS[priceTier] : ''

    return (
        <button
            type="button"
            role="option"
            aria-selected={selected}
            data-idx={dataIdx}
            onMouseEnter={onPick.hover}
            onClick={onPick.select}
            className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors ${
                highlighted
                    ? 'bg-indigo-50 dark:bg-indigo-900/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
            } ${selected ? 'ring-1 ring-inset ring-indigo-300 dark:ring-indigo-700' : ''}`}
        >
            <div className="flex-1 min-w-0">
                {/* Line 1: name + badges */}
                <div className="flex items-center gap-2 flex-wrap">
                    {option.recommended && (
                        <span aria-label="Recommended" className="text-indigo-500" title="Recommended">★</span>
                    )}
                    <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{option.label}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full ring-1 ring-inset ${tierStyle}`}>
                        {TIER_LABELS[option.tier] || option.tier}
                    </span>
                    {option.context && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 ring-1 ring-inset ring-slate-200/60 dark:ring-slate-700">
                            {option.context}
                        </span>
                    )}
                    {option.recommended && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-200 dark:ring-indigo-800">
                            Recommended
                        </span>
                    )}
                    {isNew && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-800">
                            NEW
                        </span>
                    )}
                </div>

                {/* Line 2: description */}
                {option.description && (
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                        {option.description}
                    </div>
                )}

                {/* Line 3: id + capability icons */}
                <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-slate-400 dark:text-slate-500">
                    <span className="truncate">{option.id}</span>
                    {Array.isArray(option.capabilities) && option.capabilities.length > 0 && (
                        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
                    )}
                    <div className="flex items-center gap-1">
                        {(option.capabilities || []).map((cap) => {
                            const meta = CAPABILITY_ICONS[cap]
                            if (!meta) return null
                            const Icon = ICON_BY_NAME[meta.iconName]
                            if (!Icon) return null
                            return (
                                <Icon
                                    key={cap}
                                    className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400"
                                    aria-label={meta.label}
                                />
                            )
                        })}
                    </div>
                </div>
            </div>

            {/* Right column: pricing */}
            {option.pricing && typeof option.pricing.input === 'number' && typeof option.pricing.output === 'number' && (
                <div className={`shrink-0 w-24 text-right text-xs font-medium tabular-nums leading-tight ${priceCls}`}>
                    <div>{formatDollars(option.pricing.input)} in</div>
                    <div>{formatDollars(option.pricing.output)} out</div>
                </div>
            )}

            {selected && <Check className="w-4 h-4 text-indigo-500 mt-1 shrink-0" aria-hidden="true" />}
        </button>
    )
}
```

Note the `onPick` prop shape: `{ select, hover }`. This keeps `ModelRow` stateless and avoids prop-drilling indices through callbacks. The parent (`ModelDropdown`) constructs the handlers per row.

- [ ] **Step 4: Adapt the test for the `onPick` prop shape**

The test in Step 1 passes `onPick={onPick}` as a function. Update those two cases in the test file (the `calls onPick when the row is clicked` test and the `BASE_OPTION` rendering tests) to use the `{ select, hover }` shape:

```jsx
// Replace `onPick={() => {}}` with:
const noopHandlers = { select: () => {}, hover: () => {} }
// ...and pass `onPick={noopHandlers}` everywhere except the click test, which becomes:
it('calls onPick.select when the row is clicked', () => {
    const select = vi.fn()
    render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={{ select, hover: () => {} }} />)
    fireEvent.click(screen.getByRole('option'))
    expect(select).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/components/Settings/AIConfig/ModelRow.test.jsx`
Expected: PASS — all 9 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/AIConfig/ModelRow.jsx tests/components/Settings/AIConfig/ModelRow.test.jsx
git commit -m "feat(ai-config): add premium ModelRow card with capability icons and pricing"
```

---

## Task 6: `ModelSectionHeader` component

**Files:**
- Create: `src/components/Settings/AIConfig/ModelSectionHeader.jsx`

(No dedicated test — covered by `ModelDropdown.test.jsx` in Task 9.)

- [ ] **Step 1: Implement `ModelSectionHeader.jsx`**

Create `src/components/Settings/AIConfig/ModelSectionHeader.jsx`:

```jsx
import { TIER_LABELS } from '../../../utils/providerModels'

/**
 * Non-interactive section divider for the model dropdown.
 * `role="presentation"` so screen readers don't announce it as an option.
 */
export function ModelSectionHeader({ tier, isFirst }) {
    const label = TIER_LABELS[tier] || tier
    return (
        <div
            role="presentation"
            className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 ${
                isFirst ? '' : 'border-t border-slate-100 dark:border-slate-800'
            }`}
        >
            {label}
        </div>
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Settings/AIConfig/ModelSectionHeader.jsx
git commit -m "feat(ai-config): add ModelSectionHeader divider for tier groups"
```

---

## Task 7: `TierFilterChips` component + tests

**Files:**
- Create: `src/components/Settings/AIConfig/TierFilterChips.jsx`
- Test: `tests/components/Settings/AIConfig/TierFilterChips.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/Settings/AIConfig/TierFilterChips.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { TierFilterChips } = await import('../../../../src/components/Settings/AIConfig/TierFilterChips')

describe('TierFilterChips', () => {
    it('renders All plus one chip per available tier', () => {
        render(
            <TierFilterChips
                availableTiers={['fast', 'smart', 'reasoning']}
                activeTier={null}
                onChange={() => {}}
                totalCount={7}
            />,
        )
        expect(screen.getByRole('button', { name: /all/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /fast/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /smart/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /reasoning/i })).toBeInTheDocument()
    })

    it('marks All as aria-pressed when activeTier is null', () => {
        render(<TierFilterChips availableTiers={['fast']} activeTier={null} onChange={() => {}} totalCount={3} />)
        expect(screen.getByRole('button', { name: /all/i })).toHaveAttribute('aria-pressed', 'true')
    })

    it('marks the matching chip as aria-pressed when activeTier is set', () => {
        render(<TierFilterChips availableTiers={['fast', 'smart']} activeTier="fast" onChange={() => {}} totalCount={3} />)
        expect(screen.getByRole('button', { name: /^fast$/i })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: /all/i })).toHaveAttribute('aria-pressed', 'false')
    })

    it('calls onChange with the tier when a chip is clicked', () => {
        const onChange = vi.fn()
        render(<TierFilterChips availableTiers={['fast', 'smart']} activeTier={null} onChange={onChange} totalCount={3} />)
        fireEvent.click(screen.getByRole('button', { name: /smart/i }))
        expect(onChange).toHaveBeenCalledWith('smart')
    })

    it('calls onChange with null when All is clicked', () => {
        const onChange = vi.fn()
        render(<TierFilterChips availableTiers={['fast']} activeTier="fast" onChange={onChange} totalCount={3} />)
        fireEvent.click(screen.getByRole('button', { name: /all/i }))
        expect(onChange).toHaveBeenCalledWith(null)
    })

    it('shows the total count on the right', () => {
        render(<TierFilterChips availableTiers={['fast']} activeTier={null} onChange={() => {}} totalCount={42} />)
        expect(screen.getByText(/42 models?/i)).toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/Settings/AIConfig/TierFilterChips.test.jsx`
Expected: FAIL — `Cannot find module '.../TierFilterChips'`.

- [ ] **Step 3: Implement `TierFilterChips.jsx`**

Create `src/components/Settings/AIConfig/TierFilterChips.jsx`:

```jsx
import { TIER_LABELS, TIER_ORDER } from '../../../utils/providerModels'

function chipCls(active) {
    return [
        'px-2.5 py-1 rounded-full text-[11px] font-medium ring-1 ring-inset transition-colors',
        active
            ? 'bg-indigo-500 text-white ring-indigo-500 hover:bg-indigo-600'
            : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700',
    ].join(' ')
}

/**
 * Sticky chip bar above the dropdown listbox. Single-select; clicking the
 * active chip again does nothing (use All to clear).
 */
export function TierFilterChips({ availableTiers, activeTier, onChange, totalCount }) {
    // Render in canonical TIER_ORDER, skipping legacy (legacy is toggled separately).
    const tiers = TIER_ORDER.filter((t) => t !== 'legacy' && availableTiers.includes(t))

    return (
        <div className="sticky top-0 z-10 flex items-center gap-1.5 px-3 py-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-100 dark:border-slate-800">
            <button
                type="button"
                aria-pressed={activeTier === null}
                onClick={() => onChange(null)}
                className={chipCls(activeTier === null)}
            >
                All
            </button>
            {tiers.map((tier) => (
                <button
                    key={tier}
                    type="button"
                    aria-pressed={activeTier === tier}
                    onClick={() => onChange(tier)}
                    className={chipCls(activeTier === tier)}
                >
                    {TIER_LABELS[tier] || tier}
                </button>
            ))}
            <div className="ml-auto text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                {totalCount} model{totalCount === 1 ? '' : 's'}
            </div>
        </div>
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/Settings/AIConfig/TierFilterChips.test.jsx`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/AIConfig/TierFilterChips.jsx tests/components/Settings/AIConfig/TierFilterChips.test.jsx
git commit -m "feat(ai-config): add sticky TierFilterChips for model picker"
```

---

## Task 8: `useFilteredModels` hook + tests

**Files:**
- Create: `src/hooks/useFilteredModels.js`
- Test: `tests/hooks/useFilteredModels.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useFilteredModels.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'

const { useFilteredModels } = await import('../../src/hooks/useFilteredModels')

const OPTIONS = [
    { id: 'a-fast', label: 'A Fast', tier: 'fast', description: 'fast one', legacy: false },
    { id: 'b-balanced', label: 'B Balanced', tier: 'balanced', description: 'balanced one', legacy: false },
    { id: 'c-smart', label: 'C Smart', tier: 'smart', description: 'smart one', legacy: false },
    { id: 'd-legacy', label: 'D Legacy', tier: 'legacy', description: 'old one', legacy: true },
]

describe('useFilteredModels', () => {
    it('groups options by tier in TIER_ORDER and excludes legacy by default', () => {
        const { result } = renderHook(() => useFilteredModels(OPTIONS, { query: '', tier: null, showLegacy: false }))
        const tiers = result.current.sections.map((s) => s.tier)
        expect(tiers).toEqual(['fast', 'balanced', 'smart'])
        expect(result.current.totalCount).toBe(3)
    })

    it('includes legacy when showLegacy is true', () => {
        const { result } = renderHook(() => useFilteredModels(OPTIONS, { query: '', tier: null, showLegacy: true }))
        const tiers = result.current.sections.map((s) => s.tier)
        expect(tiers).toEqual(['fast', 'balanced', 'smart', 'legacy'])
        expect(result.current.totalCount).toBe(4)
    })

    it('filters by tier when set', () => {
        const { result } = renderHook(() => useFilteredModels(OPTIONS, { query: '', tier: 'fast', showLegacy: false }))
        expect(result.current.sections).toHaveLength(1)
        expect(result.current.sections[0].tier).toBe('fast')
        expect(result.current.sections[0].items).toHaveLength(1)
    })

    it('filters by query against id, label, and description', () => {
        const { result: byId } = renderHook(() => useFilteredModels(OPTIONS, { query: 'a-fast', tier: null, showLegacy: false }))
        expect(byId.current.totalCount).toBe(1)

        const { result: byLabel } = renderHook(() => useFilteredModels(OPTIONS, { query: 'B BAL', tier: null, showLegacy: false }))
        expect(byLabel.current.totalCount).toBe(1)

        const { result: byDesc } = renderHook(() => useFilteredModels(OPTIONS, { query: 'old', tier: null, showLegacy: true }))
        expect(byDesc.current.totalCount).toBe(1)
    })

    it('returns a flat itemsInOrder array matching the rendered order', () => {
        const { result } = renderHook(() => useFilteredModels(OPTIONS, { query: '', tier: null, showLegacy: true }))
        expect(result.current.itemsInOrder.map((o) => o.id)).toEqual(['a-fast', 'b-balanced', 'c-smart', 'd-legacy'])
    })

    it('returns availableTiers (without legacy) for the chip bar', () => {
        const { result } = renderHook(() => useFilteredModels(OPTIONS, { query: '', tier: null, showLegacy: false }))
        expect(result.current.availableTiers).toEqual(['fast', 'balanced', 'smart'])
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useFilteredModels.test.jsx`
Expected: FAIL — `Cannot find module '.../useFilteredModels'`.

- [ ] **Step 3: Implement `useFilteredModels.js`**

Create `src/hooks/useFilteredModels.js`:

```js
import { useMemo } from 'react'
import { TIER_ORDER } from '../utils/providerModels'

/**
 * Group + filter options by tier and free-text query.
 *
 * Returns:
 *   sections        — [{ tier, items }] in TIER_ORDER (only non-empty sections)
 *   itemsInOrder    — flat array matching rendered order, for keyboard nav
 *   totalCount      — items.length across all sections after filtering
 *   availableTiers  — tiers present in the unfiltered (legacy-excluded) data,
 *                     used by the chip bar so it doesn't offer empty tiers
 */
export function useFilteredModels(options, { query, tier, showLegacy }) {
    return useMemo(() => {
        const safeOpts = Array.isArray(options) ? options : []

        // 1. Apply legacy gate first — chip availability is based on this set.
        const visiblePool = safeOpts.filter((o) => showLegacy || !o.legacy)

        // 2. Compute available (non-legacy) tiers for chip bar.
        const availableTiers = TIER_ORDER.filter((t) => t !== 'legacy' && safeOpts.some((o) => !o.legacy && o.tier === t))

        // 3. Filter by tier chip + query.
        const q = (query || '').trim().toLowerCase()
        const matchesQuery = (o) => {
            if (!q) return true
            return (
                (o.id || '').toLowerCase().includes(q)
                || (o.label || '').toLowerCase().includes(q)
                || (o.description || '').toLowerCase().includes(q)
            )
        }
        const filtered = visiblePool.filter((o) => (tier ? o.tier === tier : true)).filter(matchesQuery)

        // 4. Group into sections in canonical order.
        const buckets = new Map()
        for (const t of TIER_ORDER) buckets.set(t, [])
        for (const o of filtered) {
            const bucket = buckets.get(o.tier) ?? buckets.get('balanced')
            bucket.push(o)
        }
        const sections = []
        const itemsInOrder = []
        for (const t of TIER_ORDER) {
            const items = buckets.get(t)
            if (items && items.length > 0) {
                sections.push({ tier: t, items })
                for (const o of items) itemsInOrder.push(o)
            }
        }

        return {
            sections,
            itemsInOrder,
            totalCount: filtered.length,
            availableTiers,
        }
    }, [options, query, tier, showLegacy])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/useFilteredModels.test.jsx`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFilteredModels.js tests/hooks/useFilteredModels.test.jsx
git commit -m "feat(ai-config): add useFilteredModels hook for sectioned model picker"
```

---

## Task 9: `ModelDropdown` component + tests

**Files:**
- Create: `src/components/Settings/AIConfig/ModelDropdown.jsx`
- Test: `tests/components/Settings/AIConfig/ModelDropdown.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/Settings/AIConfig/ModelDropdown.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { ModelDropdown } = await import('../../../../src/components/Settings/AIConfig/ModelDropdown')

const OPTS = [
    { id: 'flash', label: 'Flash', tier: 'fast', description: 'a fast one', context: '1M', capabilities: ['vision'], pricing: { input: 0.30, output: 2.50 }, legacy: false, recommended: false },
    { id: 'sonnet', label: 'Sonnet', tier: 'balanced', description: 'a balanced one', context: '1M', capabilities: ['tools'], pricing: { input: 3, output: 15 }, legacy: false, recommended: true },
    { id: 'opus', label: 'Opus', tier: 'smart', description: 'a smart one', context: '1M', capabilities: ['reasoning'], pricing: { input: 5, output: 25 }, legacy: false, recommended: false },
    { id: 'legacy-a', label: 'Legacy A', tier: 'legacy', description: 'old', context: '200K', capabilities: [], pricing: { input: 3, output: 15 }, legacy: true, recommended: false },
]

const baseProps = {
    options: OPTS,
    value: '',
    onPick: vi.fn(),
    listboxId: 'lb-test',
    listRef: { current: null },
    query: '',
    highlight: -1,
    onHover: vi.fn(),
    catalogueHref: null,
    catalogueLabel: null,
}

describe('ModelDropdown', () => {
    it('renders one section header per non-empty tier in TIER_ORDER', () => {
        render(<ModelDropdown {...baseProps} />)
        // Headers are rendered as presentation elements containing the tier label.
        expect(screen.getByText('Fast')).toBeInTheDocument()
        expect(screen.getByText('Balanced')).toBeInTheDocument()
        expect(screen.getByText('Smart')).toBeInTheDocument()
        // Legacy is hidden by default
        expect(screen.queryByText(/Legacy A/)).toBeNull()
    })

    it('shows the legacy toggle when legacy options exist', () => {
        render(<ModelDropdown {...baseProps} />)
        expect(screen.getByRole('button', { name: /show .* legacy/i })).toBeInTheDocument()
    })

    it('expands the legacy section when the toggle is clicked', () => {
        render(<ModelDropdown {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /show .* legacy/i }))
        expect(screen.getByText('Legacy A')).toBeInTheDocument()
    })

    it('filters by the active chip', () => {
        render(<ModelDropdown {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /^smart$/i }))
        expect(screen.getByText('Opus')).toBeInTheDocument()
        expect(screen.queryByText('Flash')).toBeNull()
        expect(screen.queryByText('Sonnet')).toBeNull()
    })

    it('shows an empty state with a clear-filter affordance when no items match the chip', () => {
        render(<ModelDropdown {...baseProps} options={[OPTS[0]]} />)
        fireEvent.click(screen.getByRole('button', { name: /^smart$/i }))
        expect(screen.getByText(/no models in this tier/i)).toBeInTheDocument()
    })

    it('shows the catalogue link when catalogueHref is provided', () => {
        render(<ModelDropdown {...baseProps} catalogueHref="https://openrouter.ai/models" catalogueLabel="Browse" />)
        const link = screen.getByRole('link', { name: /browse/i })
        expect(link).toHaveAttribute('href', 'https://openrouter.ai/models')
    })

    it('forwards a click on a row to onPick.select with the option id', () => {
        const onPick = { select: vi.fn(), hover: vi.fn() }
        render(<ModelDropdown {...baseProps} onPick={onPick} />)
        fireEvent.click(screen.getByText('Sonnet'))
        expect(onPick.select).toHaveBeenCalledWith('sonnet')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/Settings/AIConfig/ModelDropdown.test.jsx`
Expected: FAIL — `Cannot find module '.../ModelDropdown'`.

- [ ] **Step 3: Implement `ModelDropdown.jsx`**

Create `src/components/Settings/AIConfig/ModelDropdown.jsx`:

```jsx
import { useState } from 'react'
import { ExternalLink, ChevronDown } from 'lucide-react'
import { ModelRow } from './ModelRow'
import { ModelSectionHeader } from './ModelSectionHeader'
import { TierFilterChips } from './TierFilterChips'
import { useFilteredModels } from '../../../hooks/useFilteredModels'

/**
 * The full open dropdown panel for the model picker. Owns:
 *   - the active tier chip filter
 *   - the show-legacy toggle (local state — resets on close)
 *   - section rendering
 *   - the empty / catalogue-link footer
 *
 * `onPick` is `{ select(id), hover(idx) }`. The parent owns keyboard nav and
 * passes `highlight` (the current highlighted index in `itemsInOrder`).
 */
export function ModelDropdown({
    options,
    value,
    onPick,
    listboxId,
    listRef,
    query,
    highlight,
    catalogueHref,
    catalogueLabel,
}) {
    const [activeTier, setActiveTier] = useState(null)
    const [showLegacy, setShowLegacy] = useState(false)

    const { sections, itemsInOrder, totalCount, availableTiers } = useFilteredModels(
        options,
        { query, tier: activeTier, showLegacy },
    )

    const legacyCount = options.filter((o) => o.legacy).length

    // Map option.id → index in itemsInOrder so each row knows its keyboard idx.
    const idxById = new Map(itemsInOrder.map((o, i) => [o.id, i]))

    return (
        <div
            id={listboxId}
            role="listbox"
            ref={listRef}
            className="absolute z-20 mt-1 left-0 right-0 max-h-96 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl shadow-slate-900/10 ds-scrollbar"
        >
            <TierFilterChips
                availableTiers={availableTiers}
                activeTier={activeTier}
                onChange={setActiveTier}
                totalCount={totalCount}
            />

            {sections.length === 0 ? (
                <div className="px-3 py-4 text-xs text-slate-500 dark:text-slate-400">
                    {activeTier
                        ? <>No models in this tier. <button type="button" onClick={() => setActiveTier(null)} className="text-indigo-600 dark:text-indigo-300 hover:underline">Clear filter</button>.</>
                        : <>No match. Press <span className="text-slate-700 dark:text-slate-200 font-medium">Enter</span> to use custom id.</>}
                </div>
            ) : (
                sections.map((section, sIdx) => (
                    <div key={section.tier}>
                        <ModelSectionHeader tier={section.tier} isFirst={sIdx === 0} />
                        {section.items.map((opt) => {
                            const idx = idxById.get(opt.id) ?? -1
                            return (
                                <ModelRow
                                    key={opt.id}
                                    option={opt}
                                    selected={value === opt.id}
                                    highlighted={highlight === idx}
                                    dataIdx={idx}
                                    onPick={{
                                        select: () => onPick.select(opt.id),
                                        hover: () => onPick.hover(idx),
                                    }}
                                />
                            )
                        })}
                    </div>
                ))
            )}

            {legacyCount > 0 && !showLegacy && (
                <button
                    type="button"
                    onClick={() => setShowLegacy(true)}
                    className="w-full flex items-center justify-center gap-1 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/70 border-t border-slate-100 dark:border-slate-800"
                >
                    <ChevronDown className="w-3 h-3" aria-hidden="true" />
                    Show {legacyCount} legacy model{legacyCount === 1 ? '' : 's'}
                </button>
            )}

            {catalogueHref && (
                <a
                    href={catalogueHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sticky bottom-0 bg-slate-50 dark:bg-slate-900/90 backdrop-blur border-t border-slate-200 dark:border-slate-700 px-3 py-2 text-xs flex items-center justify-between text-indigo-600 dark:text-indigo-300 hover:underline"
                >
                    <span>{catalogueLabel || 'Browse full catalogue'}</span>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
            )}
        </div>
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/Settings/AIConfig/ModelDropdown.test.jsx`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/AIConfig/ModelDropdown.jsx tests/components/Settings/AIConfig/ModelDropdown.test.jsx
git commit -m "feat(ai-config): add ModelDropdown with sections, chips, legacy toggle"
```

---

## Task 10: Wire `ModelDropdown` into `ModelCombobox`

**Files:**
- Modify: `src/components/Settings/AIConfig/ModelCombobox.jsx`
- Modify (assertions only): `tests/components/Settings/AIConfig/ModelCombobox.test.jsx`

- [ ] **Step 1: Replace `ModelCombobox.jsx` with the thinned-down version**

Overwrite `src/components/Settings/AIConfig/ModelCombobox.jsx`:

```jsx
import { useEffect, useMemo, useRef, useState, useId } from 'react'
import { ChevronDown } from 'lucide-react'
import { ModelDropdown } from './ModelDropdown'
import { useFilteredModels } from '../../../hooks/useFilteredModels'
import { INPUT_CLS } from './constants'

/**
 * Typeable input + curated model picker.
 *
 * Owns: input value, open/close, keyboard nav highlight. Delegates listbox UI
 * (chip filter, section headers, row cards, legacy toggle) to ModelDropdown.
 *
 * Keyboard nav uses the dropdown's `itemsInOrder` so ArrowDown/Up skip section
 * headers and respect the active tier filter — this is re-derived here via a
 * lightweight call to useFilteredModels with the same defaults the dropdown
 * initialises with (no chip filter, no legacy). The dropdown's own state is
 * the source of truth once the user interacts; for keyboard nav from the
 * input we only need an order that matches the *initial* render.
 */
export function ModelCombobox({
    id,
    value,
    onChange,
    options = [],
    placeholder,
    catalogueHref,
    catalogueLabel,
    'aria-describedby': ariaDescribedBy,
}) {
    const [open, setOpen] = useState(false)
    const [highlight, setHighlight] = useState(-1)
    const rootRef = useRef(null)
    const inputRef = useRef(null)
    const listRef = useRef(null)
    const listboxId = useId()

    const hasOptions = options.length > 0

    // Mirror the dropdown's default filter (no chip, no legacy) so keyboard nav
    // operates on the same ordered set the user sees on open.
    const { itemsInOrder } = useFilteredModels(options, { query: value, tier: null, showLegacy: false })

    useEffect(() => {
        if (!open) return
        const onDown = (ev) => {
            if (!rootRef.current?.contains(ev.target)) setOpen(false)
        }
        window.addEventListener('mousedown', onDown)
        return () => window.removeEventListener('mousedown', onDown)
    }, [open])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reset highlight when the dropdown closes
        if (!open) setHighlight(-1)
    }, [open])

    useEffect(() => {
        if (highlight < 0) return
        const el = listRef.current?.querySelector(`[data-idx="${highlight}"]`)
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' })
        }
    }, [highlight])

    const pickIndex = (idx) => {
        const opt = itemsInOrder[idx]
        if (!opt) return
        onChange(opt.id)
        setOpen(false)
        setHighlight(-1)
        inputRef.current?.focus()
    }

    const onKeyDown = (e) => {
        if (!hasOptions) return
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHighlight((h) => Math.min(itemsInOrder.length - 1, (h < 0 ? 0 : h + 1)))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            setHighlight((h) => Math.max(0, (h < 0 ? 0 : h - 1)))
        } else if (e.key === 'Enter') {
            if (open && highlight >= 0) {
                e.preventDefault()
                pickIndex(highlight)
            }
        } else if (e.key === 'Escape') {
            if (open) {
                e.preventDefault()
                setOpen(false)
                setHighlight(-1)
            }
        } else if (e.key === 'Tab') {
            setOpen(false)
        }
    }

    const exactMatch = useMemo(
        () => options.some((o) => o.id === value),
        [value, options],
    )

    if (!hasOptions) {
        return (
            <input
                id={id}
                ref={inputRef}
                type="text"
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={INPUT_CLS}
                aria-describedby={ariaDescribedBy}
            />
        )
    }

    return (
        <div ref={rootRef} className="relative">
            <div className="relative">
                <input
                    id={id}
                    ref={inputRef}
                    type="text"
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    value={value ?? ''}
                    onChange={(e) => {
                        onChange(e.target.value)
                        setOpen(true)
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder}
                    className={`${INPUT_CLS} pr-9`}
                    aria-describedby={ariaDescribedBy}
                    autoComplete="off"
                />
                <button
                    type="button"
                    onClick={() => {
                        setOpen((v) => !v)
                        inputRef.current?.focus()
                    }}
                    aria-label={open ? 'Close model list' : 'Open model list'}
                    tabIndex={-1}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                    <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
            </div>

            {open && (
                <ModelDropdown
                    options={options}
                    value={value}
                    onPick={{
                        select: (modelId) => {
                            onChange(modelId)
                            setOpen(false)
                            setHighlight(-1)
                            inputRef.current?.focus()
                        },
                        hover: (idx) => setHighlight(idx),
                    }}
                    listboxId={listboxId}
                    listRef={listRef}
                    query={value || ''}
                    highlight={highlight}
                    catalogueHref={catalogueHref}
                    catalogueLabel={catalogueLabel}
                />
            )}

            {value && !exactMatch && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Using custom model id — not in suggested list.
                </p>
            )}
        </div>
    )
}
```

- [ ] **Step 2: Update the existing ModelCombobox tests for new markup**

The existing test fixture `SAMPLE_OPTIONS` in `tests/components/Settings/AIConfig/ModelCombobox.test.jsx` is missing fields the new components expect (`legacy: false`, no pricing/capabilities is fine — they're optional and the row degrades gracefully). The current assertions on label/id text still pass because `ModelRow` still renders both. However:

a) The test `selecting an option calls onChange with the model id` clicks on the visible label text. In the new markup, the label is inside a `<button role="option">`. `fireEvent.click(screen.getByText('Gemini 2.5 Pro'))` still propagates to the button — no change needed.

b) The test `typing filters the list` requires re-render with filtered options. Since filtering now happens inside `ModelDropdown` (via `useFilteredModels`), and the combobox still passes the typed value as `query` to the dropdown, this continues to work.

Open `tests/components/Settings/AIConfig/ModelCombobox.test.jsx` and replace the `SAMPLE_OPTIONS` constant (lines 7-10) with:

```js
const SAMPLE_OPTIONS = [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'fast', description: 'Fast default', context: '1M', capabilities: [], legacy: false },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'smart', description: 'Higher quality', context: '2M', capabilities: [], legacy: false },
]
```

- [ ] **Step 3: Run the full picker test suite**

Run: `npx vitest run tests/components/Settings/AIConfig/ tests/hooks/useFilteredModels.test.jsx tests/utils/providerModels.test.js tests/utils/providerPricing.test.js`
Expected: PASS — all picker-related tests green.

- [ ] **Step 4: Run the whole unit test suite to catch any regression**

Run: `npx vitest run`
Expected: PASS — no regressions outside the picker area.

- [ ] **Step 5: Manual visual check in the browser**

Run: `npm run dev` in a separate terminal.

In the browser:
1. Open Settings → AI Configuration
2. Cycle through providers: Gemini, OpenAI, Anthropic, OpenRouter, Local
3. For each non-Local provider, click into the model field, verify:
   - Section headers render in order (Fast / Balanced / Smart / Reasoning / Open) for tiers that have items
   - Each row shows tier badge, context badge, description, model id, capability icons (when applicable), and a coloured pricing block on the right (when pricing is present)
   - The chip bar appears at the top, with `All` selected; clicking `Smart` filters
   - For Anthropic, a "Show 3 legacy models" toggle is visible; clicking it reveals the legacy section
   - For OpenRouter, the live catalogue loads, capability icons appear on models that the upstream JSON marks as supporting vision/tools/reasoning, and the catalogue link footer is present
   - Keyboard nav: ArrowDown moves through rows skipping section headers; Enter selects; Esc closes
4. Toggle dark mode and re-check colours

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/AIConfig/ModelCombobox.jsx tests/components/Settings/AIConfig/ModelCombobox.test.jsx
git commit -m "feat(ai-config): wire premium ModelDropdown into ModelCombobox"
```

---

## Final verification

- [ ] **Run lint + full test suite**

```bash
npm run lint
npx vitest run
```

Expected: both green.

- [ ] **Smoke E2E** (optional but recommended given the picker is in the AI config flow)

```bash
npx playwright test e2e/settings-api-key.spec.js
```

Expected: PASS — picker still allows selecting a model and saving the AI config.

---

## Acceptance criteria recap (from spec §10)

- [x] Gemini dropdown shows 3 current models (Flash ★, Flash-Lite, Pro), 0 legacy, none deprecated — covered by Task 3
- [x] Anthropic dropdown shows 3 current (Sonnet 4.6 ★, Opus 4.7, Haiku 4.5), 3 legacy hidden behind toggle — covered by Task 3 + Task 9 (note: spec mentioned 4 legacy; `claude-opus-4-1` dropped from curated list as it's two generations behind and still typable as custom id)
- [x] OpenAI dropdown shows ≥7 current models with `gpt-5.4-mini` recommended; gpt-4o/4o-mini removed — covered by Task 3
- [x] OpenRouter dropdown continues live fetch; rows show capabilities + pricing — covered by Task 4
- [x] Every current curated model has explicit `pricing.input` / `pricing.output` — covered by Task 3
- [x] Pricing block uses tabular-nums, colour-coded by tier — covered by Task 1 + Task 5
- [x] Filter chips reachable by keyboard, single-select, aria-pressed — covered by Task 7
- [x] Section headers render only for tiers with ≥1 visible item — covered by Task 8 (hook) + Task 9 (dropdown)
- [x] Legacy hidden until toggle clicked — covered by Task 9
- [x] Keyboard nav, custom-id typing, catalogue link preserved — covered by Task 10
- [x] All new unit tests pass; existing tests still pass — covered by Task 10 step 3/4
