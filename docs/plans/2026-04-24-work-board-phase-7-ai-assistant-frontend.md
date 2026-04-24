# Work Board Premium UX — Phase 7: AI Assistant Frontend + Activation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the AI Assistant end-to-end — frontend for enabling/configuring (Settings), a Suggestions panel, a Conversational-edit box, a privacy/activity card, and `/ai` commands in the command palette, backed by the Phase 6 endpoints.

**Architecture:** One hook (`useWorkBoardAI`) wraps every AI API call through the existing CSRF-aware fetch pattern. One new top-level Settings sub-section `<WorkBoardAISection>` composes four cards (toggle, activity, suggestions, conversational-edit). Command palette gains an `ai` command group that invokes the hook directly. Zero new backend endpoints — Phase 6 already ships the 5 we need.

**Tech Stack:** React 19, Vitest 4 + RTL, existing hooks (`useTrackedRepos`, `useToast`), `cmdk`, lucide-react, Framer Motion.

**Spec reference:** `docs/specs/2026-04-24-work-board-premium-ux.md` §5 (AI Assistant, Layer 4).

**Depends on:** Phase 6 endpoints live at `/api/v1/work-board/ai/*`. `work_board_prefs.ai_assistant_enabled`/`ai_monthly_cap_cents` columns populated from Phase 1.

**Out of scope (Phase 7.1+ follow-ups):**
- `/ai/plan-my-day` SSE streaming (this phase uses plain-JSON responses)
- `/ai/summarize`, `/ai/suggest-reviewer`, `/ai/draft-comment`, `/ai/find-similar` endpoints (the frontend calls `/ai/interpret` for conversational edits; other command-specific endpoints can be added later without re-shipping the UI shell)
- `ai_response_locale` injection in prompts
- Token-count-based cost estimates (still a flat cent/call for MVP)

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `src/api/workBoardAI.js` | Thin fetch wrappers for `/ai/*` with CSRF | Create |
| `src/hooks/useWorkBoardAI.js` | React hook — lists suggestions, interprets prompts, applies diffs, reads activity | Create |
| `src/components/Settings/WorkBoard/ai/AIAssistantToggle.jsx` | Toggle to enable/disable + monthly cap picker | Create |
| `src/components/Settings/WorkBoard/ai/AIActivityCard.jsx` | Privacy/cost card | Create |
| `src/components/Settings/WorkBoard/ai/SuggestionsPanel.jsx` | Lists suggestions with Apply/Dismiss | Create |
| `src/components/Settings/WorkBoard/ai/ConversationalEdit.jsx` | Prompt input → preview → apply | Create |
| `src/components/Settings/WorkBoard/ai/WorkBoardAISection.jsx` | Composes the 4 cards | Create |
| `src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx` | Mount `WorkBoardAISection` at the bottom | Modify |
| `src/components/CommandPalette/aiCommands.js` | Pure builder: 2 commands ("AI: summarize", "AI: plan my day") | Create |
| `src/components/CommandPalette.jsx` | Render AI group when `ai_assistant_enabled=1` | Modify |
| `tests/api/workBoardAI.test.js` | Unit tests for API wrappers | Create |
| `tests/hooks/useWorkBoardAI.test.jsx` | Hook behaviour tests | Create |
| `tests/components/Settings/WorkBoard/ai/AIAssistantToggle.test.jsx` | Toggle tests | Create |
| `tests/components/Settings/WorkBoard/ai/AIActivityCard.test.jsx` | Activity card tests | Create |
| `tests/components/Settings/WorkBoard/ai/SuggestionsPanel.test.jsx` | Suggestions UI tests | Create |
| `tests/components/Settings/WorkBoard/ai/ConversationalEdit.test.jsx` | Conversational edit tests | Create |
| `tests/components/CommandPalette/aiCommands.test.js` | Builder tests | Create |

---

## Branching

Direct push to `main`.

---

## Task 1: API wrappers + hook

**Files:**
- Create: `src/api/workBoardAI.js`
- Create: `src/hooks/useWorkBoardAI.js`
- Create: `tests/api/workBoardAI.test.js`
- Create: `tests/hooks/useWorkBoardAI.test.jsx`

### Step 1: API wrapper test

Create `tests/api/workBoardAI.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/api', () => ({
    getCsrfToken: vi.fn(async () => 'csrf-t'),
}))

const {
    fetchSuggestions, dismissSuggestion, interpretPrompt, applyDiff, fetchActivity,
} = await import('../../src/api/workBoardAI')

beforeEach(() => { global.fetch = vi.fn() })

describe('workBoardAI client', () => {
    it('fetchSuggestions GETs /suggestions', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ suggestions: [] }) })
        await fetchSuggestions()
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/ai/suggestions')
    })

    it('dismissSuggestion POSTs with CSRF', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ dismissed: true }) })
        await dismissSuggestion('BotPrefix', 'dependabot')
        const call = global.fetch.mock.calls[0]
        expect(call[0]).toBe('/api/v1/work-board/ai/dismiss-suggestion')
        expect(call[1].headers['X-CSRF-Token']).toBe('csrf-t')
        expect(JSON.parse(call[1].body)).toEqual({ pattern_key: 'BotPrefix', repo_full_name: 'dependabot' })
    })

    it('interpretPrompt POSTs prompt and returns validity_token', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ summary: 'x', actions: [], validity_token: 't.s', skipped: 0 }),
        })
        const res = await interpretPrompt('mute all')
        expect(res.validity_token).toBe('t.s')
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ prompt: 'mute all' })
    })

    it('applyDiff POSTs the token back', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ applied: 2, operation_id: 'op' }) })
        await applyDiff('t.s')
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ validity_token: 't.s' })
    })

    it('fetchActivity GETs /activity', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ month: '2026-04', spent_cents: 0, cap_cents: 500 }) })
        const out = await fetchActivity()
        expect(out.cap_cents).toBe(500)
    })

    it('throws on non-2xx', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({ code: 'AI_COST_CAP_REACHED' }) })
        await expect(fetchSuggestions()).rejects.toThrow(/429/)
    })
})
```

### Step 2: Run — expect FAIL

```bash
npx vitest run tests/api/workBoardAI.test.js
```

### Step 3: Implement API

Create `src/api/workBoardAI.js`:

```javascript
import { getCsrfToken } from '../utils/api'

const BASE = '/api/v1/work-board/ai'

async function assertOk(res) {
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = new Error(body.error || `Request failed: HTTP ${res.status}`)
        err.status = res.status
        err.code = body.code
        err.body = body
        throw err
    }
    return res
}

async function get(path) {
    const res = await fetch(path, { method: 'GET', credentials: 'include' })
    await assertOk(res)
    return res.json()
}

async function post(path, body) {
    const csrf = await getCsrfToken()
    const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    await assertOk(res)
    return res.json()
}

export function fetchSuggestions() {
    return get(`${BASE}/suggestions`)
}
export function dismissSuggestion(pattern_key, repo_full_name = '') {
    return post(`${BASE}/dismiss-suggestion`, { pattern_key, repo_full_name })
}
export function interpretPrompt(prompt) {
    return post(`${BASE}/interpret`, { prompt })
}
export function applyDiff(validity_token) {
    return post(`${BASE}/apply`, { validity_token })
}
export function fetchActivity() {
    return get(`${BASE}/activity`)
}
```

### Step 4: Run — expect 6/6 PASS

### Step 5: Hook test

Create `tests/hooks/useWorkBoardAI.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const mockApi = {
    fetchSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
    dismissSuggestion: vi.fn().mockResolvedValue({ dismissed: true }),
    interpretPrompt: vi.fn(),
    applyDiff: vi.fn(),
    fetchActivity: vi.fn().mockResolvedValue({ month: '2026-04', spent_cents: 0, cap_cents: 500 }),
}
vi.mock('../../src/api/workBoardAI', () => mockApi)

const { useWorkBoardAI } = await import('../../src/hooks/useWorkBoardAI')

beforeEach(() => {
    for (const k of Object.keys(mockApi)) mockApi[k].mockClear?.()
    mockApi.fetchSuggestions.mockResolvedValue({ suggestions: [] })
    mockApi.fetchActivity.mockResolvedValue({ month: '2026-04', spent_cents: 0, cap_cents: 500 })
})

describe('useWorkBoardAI', () => {
    it('loads suggestions + activity on mount', async () => {
        mockApi.fetchSuggestions.mockResolvedValue({ suggestions: [{ pattern_key: 'X', title: 't', repos: [] }] })
        const { result } = renderHook(() => useWorkBoardAI())
        await waitFor(() => expect(result.current.suggestions).toHaveLength(1))
        expect(result.current.activity.cap_cents).toBe(500)
    })

    it('treats 404 as disabled (feature flag off or user not opted-in)', async () => {
        const err = new Error('404'); err.status = 404
        mockApi.fetchSuggestions.mockRejectedValue(err)
        mockApi.fetchActivity.mockRejectedValue(err)
        const { result } = renderHook(() => useWorkBoardAI())
        await waitFor(() => expect(result.current.enabled).toBe(false))
    })

    it('treats 403 as disabled', async () => {
        const err = new Error('403'); err.status = 403
        mockApi.fetchSuggestions.mockRejectedValue(err)
        mockApi.fetchActivity.mockRejectedValue(err)
        const { result } = renderHook(() => useWorkBoardAI())
        await waitFor(() => expect(result.current.enabled).toBe(false))
    })

    it('interpret returns the diff', async () => {
        mockApi.interpretPrompt.mockResolvedValue({ summary: 's', actions: [{ repo: 'a/b', action: 'mute' }], validity_token: 't.s', skipped: 0 })
        const { result } = renderHook(() => useWorkBoardAI())
        let diff
        await act(async () => { diff = await result.current.interpret('mute') })
        expect(diff.validity_token).toBe('t.s')
    })

    it('apply executes the diff and refreshes suggestions + activity', async () => {
        mockApi.applyDiff.mockResolvedValue({ applied: 2, operation_id: 'op' })
        const { result } = renderHook(() => useWorkBoardAI())
        await waitFor(() => expect(result.current.activity).not.toBeNull())
        mockApi.fetchSuggestions.mockClear()
        mockApi.fetchActivity.mockClear()
        await act(async () => { await result.current.apply('t.s') })
        expect(mockApi.applyDiff).toHaveBeenCalledWith('t.s')
        expect(mockApi.fetchSuggestions).toHaveBeenCalled()
        expect(mockApi.fetchActivity).toHaveBeenCalled()
    })

    it('dismiss calls api + re-fetches suggestions', async () => {
        const { result } = renderHook(() => useWorkBoardAI())
        await waitFor(() => expect(result.current.activity).not.toBeNull())
        mockApi.fetchSuggestions.mockClear()
        await act(async () => { await result.current.dismiss('X', 'a/b') })
        expect(mockApi.dismissSuggestion).toHaveBeenCalledWith('X', 'a/b')
        expect(mockApi.fetchSuggestions).toHaveBeenCalled()
    })
})
```

### Step 6: Run — expect FAIL

### Step 7: Implement hook

Create `src/hooks/useWorkBoardAI.js`:

```javascript
import { useCallback, useEffect, useState } from 'react'
import * as api from '../api/workBoardAI'

export function useWorkBoardAI() {
    const [suggestions, setSuggestions] = useState([])
    const [activity, setActivity] = useState(null)
    const [enabled, setEnabled] = useState(true)   // assume on until API says otherwise
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState(null)

    const reload = useCallback(async () => {
        setIsLoading(true)
        setError(null)
        try {
            const [s, a] = await Promise.all([api.fetchSuggestions(), api.fetchActivity()])
            setSuggestions(s.suggestions ?? [])
            setActivity(a)
            setEnabled(true)
        } catch (e) {
            if (e.status === 403 || e.status === 404) {
                setEnabled(false)
                setSuggestions([])
                setActivity(null)
            } else {
                setError(e)
            }
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => { reload() }, [reload])

    const dismiss = useCallback(async (pattern_key, repo_full_name = '') => {
        await api.dismissSuggestion(pattern_key, repo_full_name)
        await reload()
    }, [reload])

    const interpret = useCallback((prompt) => {
        return api.interpretPrompt(prompt)
    }, [])

    const apply = useCallback(async (validity_token) => {
        const result = await api.applyDiff(validity_token)
        await reload()
        return result
    }, [reload])

    return {
        suggestions, activity, enabled, isLoading, error,
        interpret, apply, dismiss, reload,
    }
}
```

### Step 8: Run — expect 6/6 PASS

### Step 9: Commit + push

```bash
git add src/api/workBoardAI.js src/hooks/useWorkBoardAI.js tests/api/workBoardAI.test.js tests/hooks/useWorkBoardAI.test.jsx
git commit -m "feat(work-board): AI Assistant API wrappers + useWorkBoardAI hook"
git push origin main
```

---

## Task 2: AIAssistantToggle

**Files:**
- Create: `src/components/Settings/WorkBoard/ai/AIAssistantToggle.jsx`
- Create: `tests/components/Settings/WorkBoard/ai/AIAssistantToggle.test.jsx`

### Scene

Card with a switch ("Enable AI Assistant") and a cap selector (`$1 / $5 / $20 / Unlimited` maps to `100 / 500 / 2000 / 0` cents). Both wired through the existing `useTrackedRepos` hook's `updatePrefs`.

### Step 1: Failing test

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHook = {
    prefs: { ai_assistant_enabled: 0, ai_monthly_cap_cents: 500 },
    updatePrefs: vi.fn().mockResolvedValue({}),
}
vi.mock('../../../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const { AIAssistantToggle } = await import('../../../../../src/components/Settings/WorkBoard/ai/AIAssistantToggle')

beforeEach(() => {
    mockHook.updatePrefs.mockClear()
    mockHook.prefs = { ai_assistant_enabled: 0, ai_monthly_cap_cents: 500 }
})

describe('AIAssistantToggle', () => {
    it('renders as off when ai_assistant_enabled=0', () => {
        render(<AIAssistantToggle />)
        const toggle = screen.getByRole('switch', { name: /enable ai assistant/i })
        expect(toggle.getAttribute('aria-checked')).toBe('false')
    })

    it('clicking toggle calls updatePrefs with ai_assistant_enabled=1', async () => {
        render(<AIAssistantToggle />)
        fireEvent.click(screen.getByRole('switch', { name: /enable ai assistant/i }))
        await waitFor(() => expect(mockHook.updatePrefs).toHaveBeenCalledWith({ ai_assistant_enabled: 1 }))
    })

    it('shows the cap selector with current value', () => {
        mockHook.prefs = { ai_assistant_enabled: 1, ai_monthly_cap_cents: 500 }
        render(<AIAssistantToggle />)
        const select = screen.getByLabelText(/monthly cap/i)
        expect(select.value).toBe('500')
    })

    it('changing cap calls updatePrefs with ai_monthly_cap_cents', async () => {
        mockHook.prefs = { ai_assistant_enabled: 1, ai_monthly_cap_cents: 500 }
        render(<AIAssistantToggle />)
        fireEvent.change(screen.getByLabelText(/monthly cap/i), { target: { value: '2000' } })
        await waitFor(() => expect(mockHook.updatePrefs).toHaveBeenCalledWith({ ai_monthly_cap_cents: 2000 }))
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

```jsx
import { Sparkles } from 'lucide-react'
import { InsightCard } from '../../../ui/InsightCard'
import { useTrackedRepos } from '../../../../hooks/useTrackedRepos'

const CAP_OPTIONS = [
    { cents: 100,  label: '$1/month' },
    { cents: 500,  label: '$5/month' },
    { cents: 2000, label: '$20/month' },
    { cents: 0,    label: 'Unlimited' },
]

export function AIAssistantToggle() {
    const { prefs, updatePrefs } = useTrackedRepos()
    const enabled = prefs?.ai_assistant_enabled === 1
    const cap = prefs?.ai_monthly_cap_cents ?? 500

    return (
        <InsightCard tone="ai" hover={false}>
            <div className="space-y-3">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">AI Assistant</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Natural-language commands and smart suggestions. Opt-in; uses your BYOK provider.
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label="Enable AI Assistant"
                        onClick={() => updatePrefs({ ai_assistant_enabled: enabled ? 0 : 1 })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            enabled ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'
                        }`}
                    >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                            enabled ? 'translate-x-5' : 'translate-x-0.5'
                        }`} />
                    </button>
                </div>

                {enabled && (
                    <div className="flex items-center justify-between pt-3 border-t border-slate-200/60 dark:border-slate-700/40">
                        <label htmlFor="ai-cap" className="text-sm text-slate-700 dark:text-slate-300">
                            Monthly cap
                        </label>
                        <select
                            id="ai-cap"
                            value={cap}
                            onChange={(e) => updatePrefs({ ai_monthly_cap_cents: Number(e.target.value) })}
                            className="px-2 py-1 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                            {CAP_OPTIONS.map(o => (
                                <option key={o.cents} value={o.cents}>{o.label}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>
        </InsightCard>
    )
}
```

### Step 4: Run — expect 4/4 PASS

### Step 5: Commit + push

```bash
git add src/components/Settings/WorkBoard/ai/AIAssistantToggle.jsx tests/components/Settings/WorkBoard/ai/AIAssistantToggle.test.jsx
git commit -m "feat(work-board): AI Assistant toggle + monthly cap selector"
git push origin main
```

---

## Task 3: AIActivityCard

**Files:**
- Create: `src/components/Settings/WorkBoard/ai/AIActivityCard.jsx`
- Create: `tests/components/Settings/WorkBoard/ai/AIActivityCard.test.jsx`

### Step 1: Failing test

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AIActivityCard } from '../../../../../src/components/Settings/WorkBoard/ai/AIActivityCard'

describe('AIActivityCard', () => {
    it('renders nothing when activity is null (disabled)', () => {
        const { container } = render(<AIActivityCard activity={null} />)
        expect(container.firstChild).toBeNull()
    })

    it('shows month, spent, cap', () => {
        render(<AIActivityCard activity={{ month: '2026-04', spent_cents: 125, cap_cents: 500 }} />)
        expect(screen.getByText(/2026-04/)).toBeInTheDocument()
        expect(screen.getByText(/\$1\.25/)).toBeInTheDocument()
        expect(screen.getByText(/\$5\.00/)).toBeInTheDocument()
    })

    it('shows "unlimited" when cap is 0', () => {
        render(<AIActivityCard activity={{ month: '2026-04', spent_cents: 125, cap_cents: 0 }} />)
        expect(screen.getByText(/unlimited/i)).toBeInTheDocument()
    })

    it('shows progress bar percent', () => {
        const { container } = render(<AIActivityCard activity={{ month: '2026-04', spent_cents: 300, cap_cents: 500 }} />)
        const bar = container.querySelector('[data-testid="ai-progress-bar"]')
        expect(bar).toBeTruthy()
        expect(bar.style.width).toBe('60%')
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

```jsx
import { InsightCard } from '../../../ui/InsightCard'
import { BarChart3 } from 'lucide-react'

function centsToUsd(c) {
    return `$${(c / 100).toFixed(2)}`
}

export function AIActivityCard({ activity }) {
    if (!activity) return null
    const unlimited = activity.cap_cents === 0
    const pct = unlimited
        ? 0
        : Math.min(100, Math.round((activity.spent_cents / Math.max(1, activity.cap_cents)) * 100))

    return (
        <InsightCard tone="default" hover={false}>
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-slate-500" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">AI activity</p>
                    <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{activity.month}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Spent <strong className="text-slate-800 dark:text-slate-200">{centsToUsd(activity.spent_cents)}</strong>
                    {' '}of{' '}
                    {unlimited
                        ? <strong className="text-slate-800 dark:text-slate-200">unlimited</strong>
                        : <strong className="text-slate-800 dark:text-slate-200">{centsToUsd(activity.cap_cents)}</strong>}
                    {' '}this month.
                </p>
                {!unlimited && (
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                            data-testid="ai-progress-bar"
                            className="h-full bg-indigo-500 transition-all"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                )}
            </div>
        </InsightCard>
    )
}
```

### Step 4: Run — expect 4/4 PASS

### Step 5: Commit + push

```bash
git add src/components/Settings/WorkBoard/ai/AIActivityCard.jsx tests/components/Settings/WorkBoard/ai/AIActivityCard.test.jsx
git commit -m "feat(work-board): AI activity card with spend + cap progress"
git push origin main
```

---

## Task 4: SuggestionsPanel

**Files:**
- Create: `src/components/Settings/WorkBoard/ai/SuggestionsPanel.jsx`
- Create: `tests/components/Settings/WorkBoard/ai/SuggestionsPanel.test.jsx`

### Step 1: Failing test

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SuggestionsPanel } from '../../../../../src/components/Settings/WorkBoard/ai/SuggestionsPanel'

const baseSuggestion = {
    pattern_key: 'BotPrefix',
    dismiss_key: 'dependabot',
    title: 'Always mute dependabot-* repositories',
    description: 'You muted 3 of those.',
    repos: ['o/a', 'o/b', 'o/c'],
    confidence: 0.85,
}

describe('SuggestionsPanel', () => {
    it('renders nothing when suggestions is empty', () => {
        const { container } = render(<SuggestionsPanel suggestions={[]} onApply={() => {}} onDismiss={() => {}} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders each suggestion with title and description', () => {
        render(<SuggestionsPanel suggestions={[baseSuggestion]} onApply={() => {}} onDismiss={() => {}} />)
        expect(screen.getByText(/always mute dependabot/i)).toBeInTheDocument()
        expect(screen.getByText(/you muted 3/i)).toBeInTheDocument()
    })

    it('Apply button calls onApply(suggestion)', () => {
        const onApply = vi.fn()
        render(<SuggestionsPanel suggestions={[baseSuggestion]} onApply={onApply} onDismiss={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /apply/i }))
        expect(onApply).toHaveBeenCalledWith(baseSuggestion)
    })

    it('Dismiss button calls onDismiss(pattern_key, dismiss_key)', () => {
        const onDismiss = vi.fn()
        render(<SuggestionsPanel suggestions={[baseSuggestion]} onApply={() => {}} onDismiss={onDismiss} />)
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
        expect(onDismiss).toHaveBeenCalledWith('BotPrefix', 'dependabot')
    })

    it('Dismiss falls back to first repo when no dismiss_key on suggestion', () => {
        const onDismiss = vi.fn()
        const s = { ...baseSuggestion, dismiss_key: undefined }
        render(<SuggestionsPanel suggestions={[s]} onApply={() => {}} onDismiss={onDismiss} />)
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
        expect(onDismiss).toHaveBeenCalledWith('BotPrefix', 'o/a')
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

```jsx
import { Sparkles, Check, X } from 'lucide-react'
import { InsightCard } from '../../../ui/InsightCard'

export function SuggestionsPanel({ suggestions, onApply, onDismiss }) {
    if (!suggestions || suggestions.length === 0) return null

    return (
        <InsightCard tone="ai" hover={false}>
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Suggestions</p>
                </div>
                <div className="space-y-2">
                    {suggestions.map(s => {
                        const dismissKey = s.dismiss_key ?? s.repos?.[0] ?? ''
                        return (
                            <div
                                key={`${s.pattern_key}-${dismissKey}`}
                                className="rounded-xl border border-slate-200/60 dark:border-slate-700/40 p-3 space-y-2"
                            >
                                <div>
                                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{s.title}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{s.description}</p>
                                </div>
                                {s.repos?.length > 0 && (
                                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                                        {s.repos.slice(0, 3).join(', ')}{s.repos.length > 3 ? ` +${s.repos.length - 3} more` : ''}
                                    </p>
                                )}
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onApply(s)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
                                    >
                                        <Check className="w-3 h-3" /> Apply
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onDismiss(s.pattern_key, dismissKey)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                    >
                                        <X className="w-3 h-3" /> Dismiss
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </InsightCard>
    )
}
```

### Step 4: Run — expect 5/5 PASS

### Step 5: Commit + push

```bash
git add src/components/Settings/WorkBoard/ai/SuggestionsPanel.jsx tests/components/Settings/WorkBoard/ai/SuggestionsPanel.test.jsx
git commit -m "feat(work-board): AI SuggestionsPanel with Apply/Dismiss"
git push origin main
```

---

## Task 5: ConversationalEdit

**Files:**
- Create: `src/components/Settings/WorkBoard/ai/ConversationalEdit.jsx`
- Create: `tests/components/Settings/WorkBoard/ai/ConversationalEdit.test.jsx`

### Scene

Text input → button "Preview" → calls `onInterpret(prompt)` → shows diff summary + action count → Apply calls `onApply(validity_token)`.

Two states: editing (prompt input visible) and previewing (diff shown, Apply + Edit buttons). Spinner while awaiting server.

### Step 1: Failing test

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConversationalEdit } from '../../../../../src/components/Settings/WorkBoard/ai/ConversationalEdit'

describe('ConversationalEdit', () => {
    it('renders a textarea + Preview button', () => {
        render(<ConversationalEdit onInterpret={vi.fn()} onApply={vi.fn()} />)
        expect(screen.getByPlaceholderText(/describe what you want/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument()
    })

    it('Preview calls onInterpret with the prompt', async () => {
        const onInterpret = vi.fn().mockResolvedValue({ summary: 's', actions: [], validity_token: 't.s' })
        render(<ConversationalEdit onInterpret={onInterpret} onApply={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText(/describe what you want/i), { target: { value: 'mute all' } })
        fireEvent.click(screen.getByRole('button', { name: /preview/i }))
        await waitFor(() => expect(onInterpret).toHaveBeenCalledWith('mute all'))
    })

    it('after preview succeeds, shows diff summary + Apply button', async () => {
        const onInterpret = vi.fn().mockResolvedValue({ summary: 'Will mute 2', actions: [{ repo: 'a/b', action: 'mute' }, { repo: 'c/d', action: 'mute' }], validity_token: 't.s', skipped: 0 })
        render(<ConversationalEdit onInterpret={onInterpret} onApply={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText(/describe what you want/i), { target: { value: 'mute' } })
        fireEvent.click(screen.getByRole('button', { name: /preview/i }))
        expect(await screen.findByText(/will mute 2/i)).toBeInTheDocument()
        expect(screen.getByText(/2 actions/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument()
    })

    it('Apply calls onApply with validity_token', async () => {
        const onInterpret = vi.fn().mockResolvedValue({ summary: 's', actions: [{ repo: 'a/b', action: 'mute' }], validity_token: 't.s', skipped: 0 })
        const onApply = vi.fn().mockResolvedValue({ applied: 1, operation_id: 'op' })
        render(<ConversationalEdit onInterpret={onInterpret} onApply={onApply} />)
        fireEvent.change(screen.getByPlaceholderText(/describe what you want/i), { target: { value: 'mute' } })
        fireEvent.click(screen.getByRole('button', { name: /preview/i }))
        await screen.findByText(/1 action/i)
        fireEvent.click(screen.getByRole('button', { name: /apply/i }))
        await waitFor(() => expect(onApply).toHaveBeenCalledWith('t.s'))
    })

    it('Edit button returns to editing state', async () => {
        const onInterpret = vi.fn().mockResolvedValue({ summary: 's', actions: [], validity_token: 't.s', skipped: 0 })
        render(<ConversationalEdit onInterpret={onInterpret} onApply={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText(/describe what you want/i), { target: { value: 'xxx' } })
        fireEvent.click(screen.getByRole('button', { name: /preview/i }))
        await screen.findByRole('button', { name: /edit/i })
        fireEvent.click(screen.getByRole('button', { name: /edit/i }))
        expect(screen.getByPlaceholderText(/describe what you want/i)).toBeInTheDocument()
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Implement

```jsx
import { useState } from 'react'
import { InsightCard } from '../../../ui/InsightCard'
import { MessageSquare, Loader2, Check, Pencil } from 'lucide-react'

export function ConversationalEdit({ onInterpret, onApply }) {
    const [prompt, setPrompt] = useState('')
    const [diff, setDiff] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const handlePreview = async () => {
        setError(null)
        setLoading(true)
        try {
            const result = await onInterpret(prompt.trim())
            setDiff(result)
        } catch (e) {
            setError(e.message || 'Preview failed')
        } finally {
            setLoading(false)
        }
    }

    const handleApply = async () => {
        if (!diff?.validity_token) return
        setLoading(true)
        try {
            await onApply(diff.validity_token)
            setDiff(null)
            setPrompt('')
        } catch (e) {
            setError(e.message || 'Apply failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <InsightCard tone="default" hover={false}>
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-slate-500" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">AI-assisted edit</p>
                </div>

                {!diff && (
                    <>
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Describe what you want — e.g. mute all forks, keep only tesla org"
                            rows={2}
                            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                        />
                        <button
                            type="button"
                            onClick={handlePreview}
                            disabled={loading || prompt.trim().length < 3}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                            Preview
                        </button>
                    </>
                )}

                {diff && (
                    <div className="space-y-2">
                        <p className="text-sm text-slate-700 dark:text-slate-300">{diff.summary}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {diff.actions.length} {diff.actions.length === 1 ? 'action' : 'actions'}
                            {diff.skipped > 0 ? ` · ${diff.skipped} skipped (no access)` : ''}
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleApply}
                                disabled={loading || diff.actions.length === 0}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors"
                            >
                                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Apply
                            </button>
                            <button
                                type="button"
                                onClick={() => setDiff(null)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                            >
                                <Pencil className="w-3 h-3" /> Edit
                            </button>
                        </div>
                    </div>
                )}

                {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
            </div>
        </InsightCard>
    )
}
```

### Step 4: Run — expect 5/5 PASS

### Step 5: Commit + push

```bash
git add src/components/Settings/WorkBoard/ai/ConversationalEdit.jsx tests/components/Settings/WorkBoard/ai/ConversationalEdit.test.jsx
git commit -m "feat(work-board): AI ConversationalEdit (preview → apply)"
git push origin main
```

---

## Task 6: Compose WorkBoardAISection + mount

**Files:**
- Create: `src/components/Settings/WorkBoard/ai/WorkBoardAISection.jsx`
- Modify: `src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx`

### Scene

The composition renders:
- Always: `AIAssistantToggle`
- Only when `enabled=true`: `AIActivityCard` + `SuggestionsPanel` + `ConversationalEdit`

Uses `useWorkBoardAI` for the latter three. Wires `onApply`/`onDismiss` through the hook + shows toasts.

### Step 1: Implement

Create `src/components/Settings/WorkBoard/ai/WorkBoardAISection.jsx`:

```jsx
import { useWorkBoardAI } from '../../../../hooks/useWorkBoardAI'
import { useTrackedRepos } from '../../../../hooks/useTrackedRepos'
import { useToast } from '../../../../hooks/useToast'
import { AIAssistantToggle } from './AIAssistantToggle'
import { AIActivityCard } from './AIActivityCard'
import { SuggestionsPanel } from './SuggestionsPanel'
import { ConversationalEdit } from './ConversationalEdit'

export function WorkBoardAISection() {
    const ai = useWorkBoardAI()
    const { prefs, bulkUpdate, undo } = useTrackedRepos()
    const { toast } = useToast()

    const aiEnabled = prefs?.ai_assistant_enabled === 1 && ai.enabled

    const handleApplySuggestion = async (s) => {
        // MVP: apply as bulkUpdate mute of all repos in the suggestion (works for both BotPrefix and StaleNoActivity)
        try {
            const result = await bulkUpdate(s.repos, 'mute')
            if (result?.operation_id) {
                toast.success(`Applied: ${result.updated} repos muted`, {
                    action: 'Undo',
                    onAction: async () => {
                        await undo(result.operation_id)
                        toast.success('Reverted')
                    },
                })
            }
            await ai.reload()
        } catch (e) {
            toast.error(`Apply failed: ${e.message}`)
        }
    }

    const handleDismissSuggestion = async (pattern_key, dismissKey) => {
        try {
            await ai.dismiss(pattern_key, dismissKey)
            toast.success('Suggestion dismissed')
        } catch (e) {
            toast.error(`Dismiss failed: ${e.message}`)
        }
    }

    const handleApplyDiff = async (validity_token) => {
        try {
            const result = await ai.apply(validity_token)
            if (result.operation_id) {
                toast.success(`Applied: ${result.applied} actions`, {
                    action: 'Undo',
                    onAction: async () => {
                        await undo(result.operation_id)
                        toast.success('Reverted')
                    },
                })
            }
            return result
        } catch (e) {
            toast.error(`Apply failed: ${e.message}`)
            throw e
        }
    }

    return (
        <div className="space-y-3">
            <AIAssistantToggle />
            {aiEnabled && (
                <>
                    <AIActivityCard activity={ai.activity} />
                    <SuggestionsPanel
                        suggestions={ai.suggestions}
                        onApply={handleApplySuggestion}
                        onDismiss={handleDismissSuggestion}
                    />
                    <ConversationalEdit
                        onInterpret={ai.interpret}
                        onApply={handleApplyDiff}
                    />
                </>
            )}
        </div>
    )
}
```

### Step 2: Mount in WorkBoardSettingsSection

Open `src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx`. Near the other card imports, add:

```javascript
import { WorkBoardAISection } from './ai/WorkBoardAISection'
```

In the render tree, insert `<WorkBoardAISection />` just before `<DangerZoneCard ... />` (so AI sits below webhook panel, above danger):

```jsx
<WebhookConnectPanel tier={tier} />
<WorkBoardAISection />
<DangerZoneCard onResetDiscovery={handleResetDiscovery} onClearAll={handleClearAll} />
```

### Step 3: Run full frontend regression

```bash
npx vitest run tests/
```

Expected: all pass.

### Step 4: Build

```bash
npm run build
```

### Step 5: Commit + push

```bash
git add src/components/Settings/WorkBoard/ai/WorkBoardAISection.jsx src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx
git commit -m "feat(work-board): compose WorkBoardAISection in Settings"
git push origin main
```

---

## Task 7: AI commands in CommandPalette

**Files:**
- Create: `src/components/CommandPalette/aiCommands.js`
- Create: `tests/components/CommandPalette/aiCommands.test.js`
- Modify: `src/components/CommandPalette.jsx`

### Scene

Add one `/ai` command for Phase 7 — "AI: Interpret edit" — which, when selected, opens the Settings modal on the Work Board tab (so the user can type the prompt in the dedicated `ConversationalEdit` UI). Expanding to per-command endpoints (plan-my-day, summarize) is deferred — this keeps the palette focused on discovery + routing.

### Step 1: Builder test

```javascript
import { describe, it, expect } from 'vitest'
import { buildAICommands } from '../../../src/components/CommandPalette/aiCommands'

describe('buildAICommands', () => {
    it('returns empty when AI not enabled', () => {
        expect(buildAICommands({ enabled: false })).toEqual([])
    })

    it('returns at least one AI command when enabled', () => {
        const items = buildAICommands({ enabled: true })
        expect(items.length).toBeGreaterThan(0)
        expect(items[0]).toMatchObject({ actionType: expect.any(String), label: expect.any(String) })
    })

    it('each item has a unique id', () => {
        const items = buildAICommands({ enabled: true })
        const ids = new Set(items.map(i => i.id))
        expect(ids.size).toBe(items.length)
    })
})
```

### Step 2: Run — expect FAIL

### Step 3: Builder

Create `src/components/CommandPalette/aiCommands.js`:

```javascript
/**
 * AI commands for the palette. Gated on the AI Assistant being enabled
 * (checked at the call site via useTrackedRepos().prefs.ai_assistant_enabled).
 */

const AI_COMMANDS = [
    {
        id: 'ai-cmd-open-edit',
        label: 'AI: Open conversational edit',
        searchValue: 'ai open edit conversational',
        actionType: 'ai-open-settings',
        icon: 'Sparkles',
    },
]

export function buildAICommands({ enabled }) {
    if (!enabled) return []
    return AI_COMMANDS
}
```

### Step 4: Run — expect 3/3 PASS

### Step 5: Wire into CommandPalette.jsx

At the top of `src/components/CommandPalette.jsx` (alongside other builders added in Phase 5):

```javascript
import { buildAICommands } from './CommandPalette/aiCommands'
```

Inside the component body, after `trackedHook` / `trackedRepoCommands`:

```javascript
const aiCommands = buildAICommands({ enabled: trackedHook.prefs?.ai_assistant_enabled === 1 })
```

Extend `runWorkBoardCommand` to handle the new action type. Add inside the switch:

```javascript
case 'ai-open-settings':
    window.dispatchEvent(new CustomEvent('app:open-settings', { detail: { tab: 'work-board' } }));
    break;
```

Render a new `<Command.Group>` right after the existing "Tracked Repositories" group:

```jsx
{aiCommands.length > 0 && (
    <Command.Group heading="AI Assistant" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
        {aiCommands.map((item) => {
            const Icon = WORK_BOARD_CMD_ICONS[item.icon] ?? null
            return (
                <Command.Item
                    key={item.id}
                    value={item.searchValue}
                    onSelect={() => { runWorkBoardCommand(item); onClose() }}
                    className={ITEM_CLASSES}
                >
                    {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />}
                    {item.label}
                </Command.Item>
            )
        })}
    </Command.Group>
)}
```

Add `Sparkles` to the `WORK_BOARD_CMD_ICONS` map from Phase 5:

```javascript
const WORK_BOARD_CMD_ICONS = {
    Pin, PinOff, Bell, BellOff, X, RefreshCw, RotateCw, Eraser, Sparkles,
}
```

(`Sparkles` is already imported in this file since Phase 1 — verify.)

Hook up the `app:open-settings` event listener in `src/App.jsx` (if not already): right after the `useWorkBoard:*` event listeners (grep for `workboard:refresh-all` to find the location):

```jsx
useEffect(() => {
    const handler = (ev) => {
        openModalWithData('showSettings', { initialTab: ev.detail?.tab ?? 'general' })
    }
    window.addEventListener('app:open-settings', handler)
    return () => window.removeEventListener('app:open-settings', handler)
}, [openModalWithData])
```

If the listener already exists (added by an earlier phase), skip this step.

### Step 6: Run full regression

```bash
npx vitest run tests/
```

### Step 7: Commit + push

```bash
git add src/components/CommandPalette.jsx src/components/CommandPalette/aiCommands.js src/App.jsx tests/components/CommandPalette/aiCommands.test.js
git commit -m "feat(work-board): AI commands group in palette"
git push origin main
```

---

## Task 8: Regression + docs

**Files:**
- Modify: `docs/architecture/work-board-tracking.md`

### Step 1: Full regression

```bash
npx vitest run
```

Capture total.

### Step 2: Build

```bash
npm run build
```

### Step 3: Append Phase 7 section

Append to `docs/architecture/work-board-tracking.md`:

```markdown
## Phase 7 AI Assistant Frontend (shipped)

Completes the AI Assistant end-to-end. Frontend consumes the Phase 6
backend via `useWorkBoardAI` and a fresh `src/api/workBoardAI.js` client.

### Settings → Work Board → AI Assistant

Composed at `src/components/Settings/WorkBoard/ai/WorkBoardAISection.jsx`:

- **AIAssistantToggle** — on/off + monthly cap selector (`$1 / $5 / $20 / Unlimited`). Writes through `useTrackedRepos().updatePrefs`.
- **AIActivityCard** — current-month spend + cap + progress bar. Hidden when AI is disabled.
- **SuggestionsPanel** — lists `computeSuggestions()` results with Apply / Dismiss. Apply mutes the suggested repos via `bulkUpdate` with undo toast. Dismiss writes to `work_board_ai_dismissed`.
- **ConversationalEdit** — textarea → "Preview" calls `/ai/interpret` → renders diff summary + action count → "Apply" calls `/ai/apply` with the HMAC validity token. Every mutation surfaces an undo toast.

### Command palette

New "AI Assistant" group (one command in MVP: "AI: Open conversational edit") — gated on `ai_assistant_enabled=1`. Selecting routes the user to Settings → Work Board via the `app:open-settings` event.

### Hook contract

```javascript
const {
    suggestions,   // from /ai/suggestions
    activity,      // from /ai/activity
    enabled,       // false on 403/404 from backend
    isLoading,
    error,
    interpret,     // (prompt) → { summary, actions, validity_token, skipped }
    apply,         // (validity_token) → { applied, operation_id }
    dismiss,       // (pattern_key, repo_full_name_or_key) → void
    reload,        // re-fetch suggestions + activity
} = useWorkBoardAI()
```

### Defer list (Phase 7.1+)

- `/ai/plan-my-day` with SSE streaming
- Per-command palette endpoints: summarize, suggest-reviewer, draft-comment, find-similar
- Token-count-based cost estimates (still flat cent/call)
- i18n via `ai_response_locale`
- Dry-run onboarding (3 free preview calls before full enable)
```

### Step 4: Commit + push

```bash
git add docs/architecture/work-board-tracking.md
git commit -m "docs(work-board): Phase 7 AI frontend overview"
git push origin main
```

Report total test count, build status, commit SHAs.

---

## Self-review checklist

- [ ] Every new component has a test file.
- [ ] `useWorkBoardAI` treats 403/404 as `enabled=false` (graceful, not error).
- [ ] All mutations show undo toasts.
- [ ] WorkBoardAISection renders only the toggle when `enabled=false` — dashboard/suggestions/edit don't leak.
- [ ] Monthly cap 0 is rendered as "Unlimited" in `AIActivityCard`.
- [ ] Command palette AI group hidden when `ai_assistant_enabled=0`.
- [ ] No new backend endpoints shipped — Phase 6 covered everything needed.

## What's NOT in Phase 7

- `/ai/plan-my-day` SSE streaming + its palette command
- Dedicated endpoints for reviewer suggestion / draft comment / find similar
- i18n locale in prompts
- Dry-run onboarding (future UX polish)
