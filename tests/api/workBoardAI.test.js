import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/api', async (importOriginal) => ({
    ...(await importOriginal()),
    getCsrfToken: vi.fn(async () => 'csrf-t'),
}))

const {
    fetchSuggestions, dismissSuggestion, interpretPrompt, applyDiff, fetchActivity,
} = await import('../../src/api/workBoardAI')

beforeEach(() => { global.fetch = vi.fn() })

describe('workBoardAI client', () => {
    it('fetchSuggestions GETs /suggestions', async () => {
        global.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ suggestions: [] }) })
        await fetchSuggestions()
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/ai/suggestions')
    })

    it('dismissSuggestion POSTs with CSRF', async () => {
        global.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ dismissed: true }) })
        await dismissSuggestion('BotPrefix', 'dependabot')
        const call = global.fetch.mock.calls[0]
        expect(call[0]).toBe('/api/v1/work-board/ai/dismiss-suggestion')
        expect(call[1].headers['X-CSRF-Token']).toBe('csrf-t')
        expect(JSON.parse(call[1].body)).toEqual({ pattern_key: 'BotPrefix', repo_full_name: 'dependabot' })
    })

    it('interpretPrompt POSTs prompt and returns validity_token', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            headers: { get: () => 'application/json' }, json: async () => ({ summary: 'x', actions: [], validity_token: 't.s', skipped: 0 }),
        })
        const res = await interpretPrompt('mute all')
        expect(res.validity_token).toBe('t.s')
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ prompt: 'mute all' })
    })

    it('applyDiff POSTs the token back', async () => {
        global.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ applied: 2, operation_id: 'op' }) })
        await applyDiff('t.s')
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ validity_token: 't.s' })
    })

    it('fetchActivity GETs /activity', async () => {
        global.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ month: '2026-04', spent_cents: 0, cap_cents: 500 }) })
        const out = await fetchActivity()
        expect(out.cap_cents).toBe(500)
    })

    it('throws on non-2xx', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({ code: 'AI_COST_CAP_REACHED' }) })
        await expect(fetchSuggestions()).rejects.toThrow(/429/)
    })
})
