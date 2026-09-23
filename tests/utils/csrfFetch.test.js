import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { csrfFetch, _resetCsrfTokenForTests } from '../../src/utils/api'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

let tokens
let calls
beforeEach(() => {
    _resetCsrfTokenForTests()
    tokens = ['t1', 't2']
    calls = []
})
afterEach(() => vi.unstubAllGlobals())

function stub(respond) {
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        if (url === '/api/auth/csrf-token') return json({ token: tokens.shift() })
        calls.push({ url, init })
        return respond(calls.length)
    }))
}

describe('csrfFetch', () => {
    it('passes a GET through untouched', async () => {
        stub(() => json({}))
        await csrfFetch('/api/ai/presets', { credentials: 'include' })
        expect(calls[0].init).toEqual({ credentials: 'include' })
    })

    it('adds the token to a same-origin mutation that has none', async () => {
        stub(() => json({}))
        await csrfFetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 't1' })
    })

    it('sends a rotated token once more with a fresh one, and returns the second answer', async () => {
        stub((n) => (n === 1 ? json({ code: 'csrf_invalid' }, 403) : json({ ok: true })))
        const res = await csrfFetch('/api/ai/chat', { method: 'POST', headers: { 'X-CSRF-Token': 'stale' } })
        expect(await res.json()).toEqual({ ok: true })
        expect(calls.map((c) => c.init.headers['X-CSRF-Token'])).toEqual(['stale', 't1'])
    })

    it('leaves any other 403 to the caller, unread', async () => {
        stub(() => json({ code: 'TIER_REQUIRED_PRO' }, 403))
        const res = await csrfFetch('/api/ai/chat', { method: 'POST' })
        expect(calls).toHaveLength(1)
        expect(res.bodyUsed).toBe(false)
        expect((await res.json()).code).toBe('TIER_REQUIRED_PRO')
    })

    it('never sends the token to another origin', async () => {
        stub(() => json({}))
        await csrfFetch('https://api.github.com/repos/a/b', { method: 'POST', headers: {} })
        expect(calls[0].init.headers['X-CSRF-Token']).toBeUndefined()
    })
})
