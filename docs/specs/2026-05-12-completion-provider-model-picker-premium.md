# Completion Provider Model Picker — Premium Redesign

**Date:** 2026-05-12
**Status:** Draft → awaiting user review
**Scope:** Settings → AI Configuration → Completion provider model dropdown
**Files in scope:** `src/utils/providerModels.js`, `src/hooks/useProviderModels.js`, `src/components/Settings/AIConfig/ModelCombobox.jsx`, `src/utils/providerPricing.js`

---

## 1. Problem

The Completion Provider dropdown today has two issues the user surfaced:

1. **Catalogues are stale and thin.** Gemini lists only 2 models (`gemini-2.5-flash`, `gemini-2.5-pro`); OpenAI lists `gpt-4o`/`gpt-4o-mini`/`gpt-5-mini` — the GPT-5.4/5.5 family is missing; Anthropic lists `claude-opus-4-5` which is now legacy. Users on the current generation of models can't pick them without typing the id manually.
2. **The row is informationally flat.** Each row shows name, tier badge, context badge, one-line description, id, and a pricing hint at the end. It's readable, but doesn't help a user *compare* models at a glance — pricing is buried, capabilities (vision / tools / reasoning / JSON) are invisible, and there is no visual indicator of which model is the recommended default per provider.

Goal: make the picker feel premium enough that picking the right model is obvious, and refresh the catalogue against the live provider docs.

## 2. Validated model catalogue (as of 2026-05-12)

Sources: Anthropic models overview, Google Gemini API docs + pricing page, OpenAI API models page + pricing page.

### Anthropic (current)
| ID | Name | Ctx | Max out | Vision | Tools | Thinking | Cutoff | $ in | $ out |
|---|---|---|---|---|---|---|---|---|---|
| `claude-opus-4-7` | Claude Opus 4.7 | 1M | 128k | ✓ | ✓ | adaptive | Jan 2026 | $5 | $25 |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 ★ | 1M | 64k | ✓ | ✓ | ✓ | Aug 2025 | $3 | $15 |
| `claude-haiku-4-5` | Claude Haiku 4.5 | 200k | 64k | ✓ | ✓ | ✓ | Feb 2025 | $1 | $5 |

Legacy (still callable, shown in dimmed "Legacy" section): `claude-opus-4-6`, `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-opus-4-1`.

### Gemini (current)
| ID | Name | Ctx | Vision | Tools | Reasoning | $ in | $ out |
|---|---|---|---|---|---|---|---|
| `gemini-2.5-flash` | Gemini 2.5 Flash ★ | 1M | ✓ | ✓ | ✓ | $0.30 | $2.50 |
| `gemini-2.5-flash-lite` | Gemini 2.5 Flash-Lite | 1M | ✓ | ✓ | — | $0.10 | $0.40 |
| `gemini-2.5-pro` | Gemini 2.5 Pro | 2M | ✓ | ✓ | ✓ | $1.25 | $10 |

Removed (deprecated upstream): `gemini-2.0-flash`, `gemini-2.0-flash-lite`.

### OpenAI (current)
| ID | Name | Vision | Tools | Reasoning | $ in | $ out |
|---|---|---|---|---|---|---|
| `gpt-5.4-mini` | GPT-5.4 mini ★ | ✓ | ✓ | ✓ | $0.75 | $4.50 |
| `gpt-5.4-nano` | GPT-5.4 nano | ✓ | ✓ | — | $0.20 | $1.25 |
| `gpt-5.4` | GPT-5.4 | ✓ | ✓ | ✓ | $2.50 | $15 |
| `gpt-5.4-pro` | GPT-5.4 Pro | ✓ | ✓ | ✓ | $30 | $180 |
| `gpt-5.5` | GPT-5.5 | ✓ | ✓ | ✓ | $5 | $30 |
| `gpt-5.5-pro` | GPT-5.5 Pro | ✓ | ✓ | ✓ | $30 | $180 |
| `gpt-4.1` | GPT-4.1 | ✓ | ✓ | — | $2 | $8 |

Removed from v1 curated list: `gpt-4o`, `gpt-4o-mini` (superseded), `gpt-5-mini`/`gpt-5-nano` (superseded by GPT-5.4 family — still typable as custom ids).

### OpenRouter
No change to fetch source — keep live fetch from `openrouter.ai/api/v1/models`. Enrichment only: extract `architecture.input_modalities` for vision badge, infer tools from `supported_parameters`, parse pricing from `pricing.prompt`/`pricing.completion` (floats → per-million-token dollars).

### Local
Open-ended (no change).

## 3. Data model

Extend each `COMPLETION_MODELS` entry in `src/utils/providerModels.js`:

```js
{
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    tier: 'balanced',
    description: 'Best balance of speed and intelligence — default',
    context: '1M',
    maxOutput: '64K',           // NEW
    cutoff: 'Aug 2025',         // NEW (informational only — not surfaced in v1)
    recommended: true,          // NEW — exactly one per provider
    releasedAt: '2026-02-20',   // NEW — drives NEW badge if <60d old
    legacy: false,              // NEW — separates current from legacy section
    capabilities: ['vision', 'tools', 'reasoning'], // NEW
    pricing: { input: 3, output: 15 }, // NEW — explicit per-million dollars
}
```

`capabilities` is one of: `'vision'`, `'tools'`, `'json'`, `'reasoning'`. (Four icons max — matches the user's clarified scope.)

Pricing is now stored explicitly per model rather than read from the separate `providerPricing.js` map for static entries. `providerPricing.js` stays for the OpenRouter-live path (its `formatPricing` helper is reused).

## 4. Visual design

### 4.1 The premium row card

```
┌─────────────────────────────────────────────────────────────────────┐
│ ★ Claude Sonnet 4.6   [BALANCED] [1M ctx] [RECOMMENDED]            │
│ Best balance of speed and intelligence — default       $3.00 in    │
│ claude-sonnet-4-6   🖼 🛠 ⚡                          $15.00 out   │
└─────────────────────────────────────────────────────────────────────┘
```

Three-line layout, two columns where the right column is reserved for the pricing block.

**Left column (flex-1, min-w-0):**
- Line 1: `★` glyph if `recommended` (indigo-500), model name (font-medium), tier badge (existing colour), context badge (slate), optional `RECOMMENDED` or `NEW` pill
- Line 2: description, truncated to one line
- Line 3: model id in `font-mono text-[11px] text-slate-400`, then a `·` separator, then capability icons (16px lucide icons in `text-slate-500`, each with `title=`/`aria-label=` for tooltip)

**Right column (w-24, shrink-0, text-right):**
- Two stacked rows: `$X.XX in` and `$X.XX out`
- Whole block coloured by output price tier via `pricingTier(pricing)` (uses `pricing.output` only — output dominates cost in practice and is monotonic with input across the tested catalogues), returning `'cheap' | 'mid' | 'premium'`:
  - `cheap` (output ≤ $5/M): `text-emerald-600 dark:text-emerald-300`
  - `mid` ($5 < output ≤ $30): `text-slate-600 dark:text-slate-300`
  - `premium` (output > $30): `text-rose-500 dark:text-rose-300`
- Font: `text-xs font-medium tabular-nums`

**Selected state:** indigo ring around the row + check icon between left and right columns. No change to existing keyboard nav.

### 4.2 Section grouping

Within the dropdown, models render grouped by tier in this order:
1. ★ Recommended (the single recommended item per provider — shown first when applicable)
2. Fast
3. Balanced
4. Smart
5. Reasoning
6. Open
7. Legacy (dimmed section, opt-in via "Show legacy" toggle)

Sections with zero items are omitted. Each section header is a non-interactive divider:

```
─── FAST ──────────────────────────
```

`text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-3 py-1.5 border-t border-slate-100 dark:border-slate-800`. First section has no top border.

For very small catalogues (e.g. Anthropic = 3 items), the result is one section per tier and feels natural. For OpenRouter's 300+ items, this is the main UX win.

### 4.3 Filter chip bar (sticky)

Above the scroll area, a chip bar:

```
[All] [Fast] [Smart] [Reasoning] [Open]                    7 models
```

- Single-select chips with `aria-pressed`
- Clicking a chip narrows the visible rows to that tier
- Empty result → "No models in this tier — clear filter"
- The count on the right reflects the currently filtered set
- Position: `sticky top-0` with same backdrop blur as the existing footer link

### 4.4 NEW badge logic

`isNewModel(releasedAt)` returns true if `releasedAt` is within 60 days of today (date comparison only, no timezone math). Rendered as a small amber pill next to the name. Curated entries only — the OpenRouter live path doesn't set `releasedAt`.

### 4.5 Legacy toggle

A footer row above the catalogue link:

```
[ ⌃ Show 4 legacy models ]
```

Hidden by default. Clicking expands the Legacy section. Persists only within the open dropdown — closing the dropdown resets it.

## 5. Component decomposition

`ModelCombobox.jsx` is already ~250 lines and would become unwieldy. Split into:

- `ModelCombobox.jsx` — the existing combobox shell (input + open/close + keyboard nav), now thinner
- `ModelDropdown.jsx` (NEW) — renders the open listbox: chip bar, sections, rows, legacy toggle, footer link
- `ModelRow.jsx` (NEW) — single row card (three-line layout)
- `ModelSectionHeader.jsx` (NEW) — divider with tier label
- `TierFilterChips.jsx` (NEW) — the sticky chip bar
- `useFilteredModels.js` (NEW hook) — groups + filters by tier and query; returns `{ sections, totalCount, filteredCount }`

`useProviderModels.js` is extended to map the new fields from the OpenRouter JSON response. The static curated lists in `providerModels.js` are rewritten to the new schema.

`pricingTier()` and `formatPricing()` move/copy into `providerPricing.js` so both static and live paths share them.

## 6. Keyboard accessibility

- ArrowDown/Up skips section headers (only stops on row buttons) — same as today, just need the new section-header DOM not to be focusable
- Chip bar is reachable via Tab when the dropdown is open, before the first row
- Enter on a chip toggles the filter; Esc collapses dropdown (existing behaviour preserved)
- Screen readers announce section header as a `role="presentation"` element with `aria-label` so it's not announced as an interactive option
- Each row keeps `role="option"` + `aria-selected`

## 7. Error states / edge cases

- **No models match query + chip filter:** show the "No match. Enter to use custom id." hint already in the empty state, plus a "Clear filter" link if a chip is active
- **OpenRouter fetch fails:** falls back to the curated 4-item list (existing behaviour) — chip bar still works on those 4
- **Capability data missing:** simply render fewer icons (don't render a placeholder)
- **Pricing missing for a custom-typed id:** right column is empty (no "—" filler — silence is cleaner)

## 8. Testing

Unit tests (in `tests/components/Settings/AIConfig/`):
- `ModelCombobox.test.jsx` (existing): keep current keyboard / select-from-list / custom id coverage
- `ModelRow.test.jsx` (NEW): renders name, tier badge, context, capability icons, pricing block; pricing tier colour helper boundary values
- `ModelDropdown.test.jsx` (NEW): renders sections in correct order; legacy hidden by default; chip filter narrows visible items; "No match" empty state
- `TierFilterChips.test.jsx` (NEW): single-select behaviour, aria-pressed, "All" resets
- `tests/utils/providerModels.test.js` (NEW): `isNewModel` boundaries (59/60/61 days), `pricingTier` boundaries ($1.00 / $25.00 / $25.01)

No new E2E test — existing `e2e/settings-api-key.spec.js` exercises the picker flow well enough.

## 9. Out of scope (deferred)

These were considered and explicitly cut to keep the slice tight:

- **Speed (tokens/s) indicator** — no reliable source per model, would be hand-curated and rot fast
- **Use-case tags** ("code", "vision", "agents") — overlaps with the description; not worth the visual weight
- **Live fetch for Gemini/OpenAI/Anthropic** — these endpoints require the user's API key; would re-architect provider integration and isn't necessary for the picker (live OpenRouter already proves the pattern is available if needed later)
- **Knowledge-cutoff display in row** — stored in data but only used in hover tooltip on the name (low-priority), not in v1 chrome
- **Per-feature override picker** in `PerFeatureOverrideSection.jsx` — also uses `ModelCombobox`, will inherit the redesign for free, no separate work

## 10. Acceptance criteria

- Gemini dropdown shows 3 current models (Flash ★, Flash-Lite, Pro), 0 legacy, none deprecated
- Anthropic dropdown shows 3 current (Sonnet 4.6 ★, Opus 4.7, Haiku 4.5), 4 legacy hidden behind toggle
- OpenAI dropdown shows ≥7 current models, with `gpt-5.4-mini` marked recommended; gpt-4o/4o-mini removed
- OpenRouter dropdown continues to fetch live; rows now show capability icons and pricing block when the upstream JSON has the data
- Every current model has explicit `pricing.input` / `pricing.output` set
- Pricing block in the row uses tabular-nums and is colour-coded by tier
- Filter chips are reachable by keyboard, single-select, with `aria-pressed`
- Section headers render only for tiers that have ≥1 visible item
- Legacy section is hidden until the toggle is clicked
- Existing keyboard nav (ArrowDown/Up, Enter, Esc), free-typing custom ids, and "Browse full catalogue" link continue to work
- All new unit tests pass; `ModelCombobox.test.jsx` still passes unchanged
