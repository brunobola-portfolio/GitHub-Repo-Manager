# Spec: AI Config — CSRF Fix & UX Polish

**Date:** 2026-04-22
**Scope:** `src/components/Settings/AIConfigSection.jsx`, `src/components/Settings/AIConfig/TestButton.jsx`
**Type:** Bug fix + UX polish (no API changes)

---

## Problem

The AI Configuration settings panel (`AIConfigSection`) makes three mutation requests using raw `fetch()`:

| Handler | Endpoint | Method |
|---|---|---|
| `handleSave` | `/api/user/ai-config` | POST |
| `performRemove` | `/api/user/ai-config` | DELETE |
| `handleTest` | `/api/user/ai-config/test` | POST |

The project's `fetchWithRetry` utility (`src/utils/api.js`) is the single place that injects the `X-CSRF-Token` header on mutations. Because these calls bypass it, the server's global `requireCsrfToken` middleware rejects all three with **403 Forbidden / `csrf_invalid`**. This is the visible "Invalid CSRF token" error on screen.

Additionally, four UX issues exist independently of the bug.

---

## Goals

1. Fix the 403 on all three mutation endpoints.
2. Hide the Test Connection card when no provider is configured.
3. Warn the user when they attempt to test with unsaved form changes.
4. Hide the Remove Config button when no config is saved.

---

## Out of Scope

- Server-side changes — no route or middleware modifications.
- Adding new providers or capability matrix entries.
- Refactoring other settings sections.

---

## Design

### 1. CSRF Fix — switch to `fetchWithRetry`

**File:** `src/components/Settings/AIConfigSection.jsx`

Import `fetchWithRetry` from `../../utils/api` and replace the three raw `fetch()` calls:

```js
// Before (broken)
const res = await fetch(`${API_BASE_URL}/api/user/ai-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
})

// After (fixed)
const res = await fetchWithRetry(`${API_BASE_URL}/api/user/ai-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
})
```

Same change for `performRemove` (DELETE) and `handleTest` (POST test).

`fetchWithRetry` returns the same `Response` object, so all downstream response-handling logic is unchanged.

**Why this over manual token injection:** `fetchWithRetry` also handles CSRF token rotation (auto-retry on `csrf_invalid`) and offline retry queuing. Manual injection would duplicate that logic and create a maintenance trap for future mutations.

---

### 2. Hide Test Connection Until Provider Selected

**File:** `src/components/Settings/AIConfigSection.jsx`

Wrap the Test Connection `InsightCard` in the same `AnimatePresence` + `motion.div` guard already used for the Embedding and Per-feature sections:

```jsx
<AnimatePresence>
    {form.completionProvider && (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
        >
            {/* Test Connection InsightCard */}
        </motion.div>
    )}
</AnimatePresence>
```

No new state required.

---

### 3. Warn When Testing With Unsaved Changes

**File:** `src/components/Settings/AIConfig/TestButton.jsx`

Add an `isDirty` boolean prop. When true, render an informational hint below the button:

```jsx
{isDirty && (
    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
        <Info className="w-3.5 h-3.5 shrink-0" />
        Save your changes first to test the current configuration.
    </p>
)}
```

The button remains enabled — the user may intentionally want to test the previously saved config. The hint removes the ambiguity without blocking the action.

Pass `isDirty` from `AIConfigSection`:

```jsx
<TestButton
    onTest={handleTest}
    disabled={testing}
    result={testResult}
    countdown={testCountdown}
    isDirty={isDirty}
/>
```

---

### 4. Hide Remove Config When No Saved Config

**File:** `src/components/Settings/AIConfigSection.jsx`

`form.hasCompletionKey` and `form.hasEmbeddingKey` are already in state, populated from the server response. Render the Remove button conditionally:

```jsx
{(form.hasCompletionKey || form.hasEmbeddingKey) && (
    <button onClick={handleRemove} …>
        Remove Config
    </button>
)}
```

When neither flag is true, the left side of the action bar is empty; the Save button remains on the right.

---

## Files Changed

| File | Change |
|---|---|
| `src/components/Settings/AIConfigSection.jsx` | Import `fetchWithRetry`; replace 3 fetch calls; wrap Test card in provider guard; conditionally render Remove button; pass `isDirty` to TestButton |
| `src/components/Settings/AIConfig/TestButton.jsx` | Add `isDirty` prop + unsaved-changes hint |

No server files touched.

---

## Success Criteria

- POST `/api/user/ai-config` returns 204 (not 403) when saving.
- DELETE `/api/user/ai-config` succeeds without CSRF error.
- POST `/api/user/ai-config/test` returns the provider response (not 403).
- Test Connection card is not visible when no provider is selected.
- Selecting a provider and changing a field shows the "unsaved changes" hint in TestButton.
- Remove Config button is absent when `hasCompletionKey` and `hasEmbeddingKey` are both false.
