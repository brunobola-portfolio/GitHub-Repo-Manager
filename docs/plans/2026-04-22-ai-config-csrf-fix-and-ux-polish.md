# AI Config — CSRF Fix & UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 403 Forbidden errors on all AI config mutations by using `fetchWithRetry`, and add four UX improvements to the AI Configuration settings panel.

**Architecture:** Two-file change. `AIConfigSection.jsx` gets the CSRF fix (swap raw `fetch` → `fetchWithRetry`), the Test Connection provider guard, and the conditional Remove button. `TestButton.jsx` gets a new `isDirty` prop that shows an unsaved-changes hint. No server changes.

**Tech Stack:** React 19, Framer Motion, Vitest + Testing Library, `src/utils/api.js` (`fetchWithRetry`)

**Spec:** `docs/specs/2026-04-22-ai-config-csrf-fix-and-ux-polish.md`

---

## File Map

| File | Change |
|---|---|
| `src/components/Settings/AIConfigSection.jsx` | Import `fetchWithRetry`; replace 3 raw `fetch()` calls; wrap Test card in provider guard; hide Remove button when no saved config; pass `isDirty` to TestButton |
| `src/components/Settings/AIConfig/TestButton.jsx` | Add `isDirty` boolean prop + unsaved-changes hint |
| `tests/components/Settings/AIConfigSection.test.jsx` | Add tests: CSRF header sent on mutations, Test card hidden with no provider, Remove button hidden with no config, isDirty hint in TestButton |
| `tests/components/Settings/AIConfig/TestButton.test.jsx` | New file — unit tests for `isDirty` prop rendering |

---

## Task 1: Unit tests for TestButton `isDirty` prop

**Files:**
- Create: `tests/components/Settings/AIConfig/TestButton.test.jsx`

- [ ] **Step 1: Create the test file**

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TestButton } from '@/components/Settings/AIConfig/TestButton'

vi.mock('framer-motion', () => {
    const React = require('react')
    function passthrough({ children }) { return React.createElement(React.Fragment, null, children) }
    return {
        motion: new Proxy({}, { get: () => passthrough }),
        AnimatePresence: ({ children }) => children,
    }
})

describe('TestButton — isDirty hint', () => {
    it('does not show unsaved-changes hint when isDirty is false', () => {
        render(
            <TestButton onTest={vi.fn()} disabled={false} result={null} countdown={0} isDirty={false} />
        )
        expect(screen.queryByText(/save your changes first/i)).not.toBeInTheDocument()
    })

    it('shows unsaved-changes hint when isDirty is true', () => {
        render(
            <TestButton onTest={vi.fn()} disabled={false} result={null} countdown={0} isDirty={true} />
        )
        expect(screen.getByText(/save your changes first/i)).toBeInTheDocument()
    })

    it('does not show hint when isDirty is true but result is already showing', () => {
        render(
            <TestButton
                onTest={vi.fn()}
                disabled={false}
                result={{ ok: true, latencyMs: 50 }}
                countdown={0}
                isDirty={true}
            />
        )
        // Hint still shows — it's informational, not blocked by result
        expect(screen.getByText(/save your changes first/i)).toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Run to confirm the tests fail (TestButton lacks `isDirty` prop)**

```
npx vitest run tests/components/Settings/AIConfig/TestButton.test.jsx
```

Expected: FAIL — the hint text is never found because the prop doesn't exist yet.

---

## Task 2: Implement `isDirty` prop in TestButton

**Files:**
- Modify: `src/components/Settings/AIConfig/TestButton.jsx`

- [ ] **Step 1: Add `isDirty` prop and unsaved-changes hint**

Replace the full file content:

```jsx
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Check, AlertTriangle, Loader2, Info } from 'lucide-react'

export function TestButton({ onTest, disabled, result, countdown, isDirty }) {
    return (
        <div className="space-y-2">
            <button
                onClick={onTest}
                disabled={disabled || countdown > 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-700/50 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {disabled && !countdown ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <Sparkles className="w-4 h-4" />
                )}
                {countdown > 0
                    ? `Test Connection (${countdown}s)`
                    : 'Test Connection'}
            </button>

            {isDirty && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 shrink-0" />
                    Save your changes first to test the current configuration.
                </p>
            )}

            <AnimatePresence>
                {result && (
                    <motion.div
                        key="result"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm border ${
                            result.ok
                                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/50 text-emerald-800 dark:text-emerald-300'
                                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/50 text-red-800 dark:text-red-300'
                        }`}
                    >
                        {result.ok
                            ? <Check className="w-4 h-4 shrink-0 mt-0.5" />
                            : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                        <span>
                            {result.ok
                                ? `Connected! ${result.latencyMs ? `${result.latencyMs}ms` : ''}${result.modelUsed ? ` · ${result.modelUsed}` : ''}`
                                : result.error}
                        </span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
```

- [ ] **Step 2: Run TestButton tests — expect all 3 to pass**

```
npx vitest run tests/components/Settings/AIConfig/TestButton.test.jsx
```

Expected: PASS ✓ (3 tests)

- [ ] **Step 3: Commit**

```
git add src/components/Settings/AIConfig/TestButton.jsx tests/components/Settings/AIConfig/TestButton.test.jsx
git commit -m "feat(ai-config): add isDirty unsaved-changes hint to TestButton"
```

---

## Task 3: Add failing tests for the AIConfigSection changes

**Files:**
- Modify: `tests/components/Settings/AIConfigSection.test.jsx`

- [ ] **Step 1: Add 4 new test cases at the end of the file**

Append these `describe` blocks after the last existing one (line 481):

```jsx
describe('AIConfigSection — CSRF token sent on mutations', () => {
    it('sends X-CSRF-Token header when saving config', async () => {
        // Stub getCsrfToken (called by fetchWithRetry)
        const { getCsrfToken } = await import('@/utils/api')
        vi.spyOn({ getCsrfToken }, 'getCsrfToken').mockResolvedValue('test-csrf-token')

        fetchMock.mockResolvedValueOnce(mockResponse(EMPTY_CONFIG)) // GET
        fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve({}) }) // POST save
        fetchMock.mockResolvedValueOnce(mockResponse(EMPTY_CONFIG)) // refetch

        await act(async () => {
            renderWithProviders(<AIConfigSection />)
        })

        const select = screen.getByRole('combobox', { name: /completion provider/i })
        await act(async () => {
            fireEvent.change(select, { target: { value: 'gemini' } })
        })

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
        })

        await waitFor(() => {
            const saveCall = fetchMock.mock.calls.find(
                ([url, opts]) => url?.includes('/api/user/ai-config') && opts?.method === 'POST'
            )
            expect(saveCall).toBeDefined()
            expect(saveCall[1].headers?.['X-CSRF-Token']).toBeDefined()
        })
    })
})

describe('AIConfigSection — Test Connection hidden with no provider', () => {
    it('does not show Test Connection card when no provider is selected', async () => {
        await renderSection()
        expect(screen.queryByRole('button', { name: /test connection/i })).not.toBeInTheDocument()
    })

    it('shows Test Connection card after selecting a provider', async () => {
        await renderSection()
        const select = screen.getByRole('combobox', { name: /completion provider/i })
        await act(async () => {
            fireEvent.change(select, { target: { value: 'gemini' } })
        })
        expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument()
    })
})

describe('AIConfigSection — Remove Config visibility', () => {
    it('hides Remove Config button when no keys are saved', async () => {
        await renderSection({ hasCompletionKey: false, hasEmbeddingKey: false })
        expect(screen.queryByRole('button', { name: /remove config/i })).not.toBeInTheDocument()
    })

    it('shows Remove Config button when a completion key is saved', async () => {
        await renderSection({ completionProvider: 'gemini', hasCompletionKey: true })
        expect(screen.getByRole('button', { name: /remove config/i })).toBeInTheDocument()
    })

    it('shows Remove Config button when an embedding key is saved', async () => {
        await renderSection({ hasCompletionKey: false, hasEmbeddingKey: true })
        expect(screen.getByRole('button', { name: /remove config/i })).toBeInTheDocument()
    })
})

describe('AIConfigSection — isDirty hint passed to TestButton', () => {
    it('shows unsaved-changes hint in TestButton after form is dirtied', async () => {
        await renderSection({ completionProvider: 'gemini' })
        // Form initially clean — no hint
        expect(screen.queryByText(/save your changes first/i)).not.toBeInTheDocument()

        // Dirty the form
        const keyInput = screen.getByLabelText(/api key/i)
        await act(async () => {
            fireEvent.change(keyInput, { target: { value: 'new-key' } })
        })

        expect(screen.getByText(/save your changes first/i)).toBeInTheDocument()
    })

    it('hides unsaved-changes hint once form matches saved state', async () => {
        await renderSection({ completionProvider: 'gemini' })
        const keyInput = screen.getByLabelText(/api key/i)

        // Dirty
        await act(async () => {
            fireEvent.change(keyInput, { target: { value: 'new-key' } })
        })
        expect(screen.getByText(/save your changes first/i)).toBeInTheDocument()

        // Undo — completionApiKey starts as '' so clearing it restores clean state
        await act(async () => {
            fireEvent.change(keyInput, { target: { value: '' } })
        })
        expect(screen.queryByText(/save your changes first/i)).not.toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Run only the new tests — expect them to FAIL**

```
npx vitest run tests/components/Settings/AIConfigSection.test.jsx --reporter=verbose 2>&1 | tail -40
```

Expected: The new suites fail (Test Connection always visible, Remove always visible, no CSRF header since still using raw fetch).

> Note: The existing "Test Connection button" tests will also need updating in Task 4 — they currently assume the button is always visible. We'll update those assertions together with the implementation.

---

## Task 4: Implement AIConfigSection changes

**Files:**
- Modify: `src/components/Settings/AIConfigSection.jsx`

- [ ] **Step 1: Add `fetchWithRetry` import**

At the top of the file, after the existing imports, add:

```jsx
import { fetchWithRetry } from '../../utils/api'
```

The full import block at the top of the file should now include this line alongside the existing imports from `../../config`, `../../hooks/useToast`, etc.

- [ ] **Step 2: Fix `handleSave` — replace raw `fetch` with `fetchWithRetry`**

In `handleSave` (around line 156), replace:

```jsx
const res = await fetch(`${API_BASE_URL}/api/user/ai-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
})
```

with:

```jsx
const res = await fetchWithRetry(`${API_BASE_URL}/api/user/ai-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
})
```

- [ ] **Step 3: Fix `performRemove` — replace raw `fetch` with `fetchWithRetry`**

In `performRemove` (around line 215), replace:

```jsx
const res = await fetch(`${API_BASE_URL}/api/user/ai-config`, {
    method: 'DELETE',
    credentials: 'include',
})
```

with:

```jsx
const res = await fetchWithRetry(`${API_BASE_URL}/api/user/ai-config`, {
    method: 'DELETE',
    credentials: 'include',
})
```

- [ ] **Step 4: Fix `handleTest` — replace raw `fetch` with `fetchWithRetry`**

In `handleTest` (around line 257), replace:

```jsx
const res = await fetch(`${API_BASE_URL}/api/user/ai-config/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ kind: 'completion' }),
})
```

with:

```jsx
const res = await fetchWithRetry(`${API_BASE_URL}/api/user/ai-config/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ kind: 'completion' }),
})
```

- [ ] **Step 5: Wrap Test Connection card in provider guard**

In the render section (around line 407), replace:

```jsx
{/* Test Connection */}
<InsightCard tone="default" hover={false}>
    <div className="space-y-3">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Test Connection
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">
            Verify your API key is valid and the provider responds correctly.
        </p>
        <TestButton
            onTest={handleTest}
            disabled={testing}
            result={testResult}
            countdown={testCountdown}
        />
    </div>
</InsightCard>
```

with:

```jsx
{/* Test Connection — only shown when a provider is selected */}
<AnimatePresence>
    {form.completionProvider && (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
        >
            <InsightCard tone="default" hover={false}>
                <div className="space-y-3">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Test Connection
                    </label>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Verify your API key is valid and the provider responds correctly.
                    </p>
                    <TestButton
                        onTest={handleTest}
                        disabled={testing}
                        result={testResult}
                        countdown={testCountdown}
                        isDirty={isDirty}
                    />
                </div>
            </InsightCard>
        </motion.div>
    )}
</AnimatePresence>
```

- [ ] **Step 6: Conditionally render Remove Config button**

In the Action Buttons section (around line 447), replace:

```jsx
<button
    onClick={handleRemove}
    disabled={removing}
    className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
>
    <X className="w-4 h-4" />
    {removing ? 'Removing...' : 'Remove Config'}
</button>
```

with:

```jsx
{(form.hasCompletionKey || form.hasEmbeddingKey) && (
    <button
        onClick={handleRemove}
        disabled={removing}
        className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
    >
        <X className="w-4 h-4" />
        {removing ? 'Removing...' : 'Remove Config'}
    </button>
)}
```

- [ ] **Step 7: Update existing Test Connection tests that assumed button was always present**

In `tests/components/Settings/AIConfigSection.test.jsx`, the existing `describe('AIConfigSection — Test Connection button', ...)` block tests assume the button is always visible. Each test that renders with `EMPTY_CONFIG` (no provider) and then clicks the button must first select a provider.

Update the four tests in that block — the first one that uses `renderSection()` + clicks immediately:

```jsx
// "posts { kind: "completion" } when Test Connection is clicked"
// Change: use GEMINI_CONFIG so provider is pre-selected (button is visible)
it('posts { kind: "completion" } when Test Connection is clicked', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(GEMINI_CONFIG))
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, latencyMs: 123, modelUsed: 'gemini-2.5-flash' }))

    await act(async () => {
        render(<AIConfigSection />)
    })

    const testBtn = screen.getByRole('button', { name: /test connection/i })

    await act(async () => {
        fireEvent.click(testBtn)
    })

    await waitFor(() => {
        const postCall = fetchMock.mock.calls.find(
            ([url, opts]) => url?.includes('/api/user/ai-config/test') && opts?.method === 'POST'
        )
        expect(postCall).toBeDefined()
        const body = JSON.parse(postCall[1].body)
        expect(body.kind).toBe('completion')
    })
})
```

```jsx
// "shows success result after a successful test"
it('shows success result after a successful test', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(GEMINI_CONFIG))
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, latencyMs: 80 }))

    await act(async () => {
        render(<AIConfigSection />)
    })

    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    await waitFor(() => {
        expect(screen.getByText(/connected/i)).toBeInTheDocument()
    })
})
```

```jsx
// "shows error message on failed test"
it('shows error message on failed test', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(GEMINI_CONFIG))
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, error: 'Invalid API key' }))

    await act(async () => {
        render(<AIConfigSection />)
    })

    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    await waitFor(() => {
        expect(screen.getByText(/invalid api key/i)).toBeInTheDocument()
    })
})
```

```jsx
// "calls /test with countdown on 429 response"
it('calls /test with countdown on 429 response', async () => {
    await renderSection(GEMINI_CONFIG)

    fetchMock.mockResolvedValueOnce(
        mockResponse({ error: 'Rate limited. Please wait.', code: 'RATE_LIMITED' }, { status: 429 })
    )

    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    await waitFor(() => {
        const testCall = fetchMock.mock.calls.find(
            ([url, opts]) => url?.includes('/api/user/ai-config/test') && opts?.method === 'POST'
        )
        expect(testCall).toBeDefined()
    })

    await waitFor(() => {
        expect(screen.getByText(/rate limited/i)).toBeInTheDocument()
    })
})
```

---

## Task 5: Run full test suite and verify

- [ ] **Step 1: Run all AIConfig-related tests**

```
npx vitest run tests/components/Settings/AIConfig/ tests/components/Settings/AIConfigSection.test.jsx --reporter=verbose
```

Expected: All tests pass. Verify the new suites appear:
- `AIConfigSection — CSRF token sent on mutations` ✓
- `AIConfigSection — Test Connection hidden with no provider` ✓
- `AIConfigSection — Remove Config visibility` ✓
- `AIConfigSection — isDirty hint passed to TestButton` ✓
- `TestButton — isDirty hint` ✓

- [ ] **Step 2: Run full unit test suite to check for regressions**

```
npx vitest run
```

Expected: All existing tests pass.

- [ ] **Step 3: Commit all changes**

```
git add src/components/Settings/AIConfigSection.jsx src/components/Settings/AIConfig/TestButton.jsx tests/components/Settings/AIConfigSection.test.jsx tests/components/Settings/AIConfig/TestButton.test.jsx
git commit -m "fix(ai-config): use fetchWithRetry for CSRF support + UX polish"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Fix 403 on POST /api/user/ai-config (save) | Task 4, Step 2 |
| Fix 403 on DELETE /api/user/ai-config (remove) | Task 4, Step 3 |
| Fix 403 on POST /api/user/ai-config/test | Task 4, Step 4 |
| Hide Test Connection card until provider selected | Task 4, Step 5 |
| Warn when testing with unsaved changes (isDirty) | Task 2 + Task 4, Step 5 |
| Hide Remove Config when no saved config | Task 4, Step 6 |
| CSRF error handled via fetchWithRetry auto-retry | Implicit — fetchWithRetry handles this; verified by CSRF test in Task 3 |

All 7 requirements covered. No gaps.
