import { describe, it, expect, beforeEach } from 'vitest'
import { writeQuery } from '@/utils/urlQuery'

// The app routes by hash. Rebuilding the URL as pathname + query dropped it,
// moving the user off the repo they were in.
describe('writeQuery', () => {
    beforeEach(() => { window.history.replaceState(null, '', '/?commit=abc#/repo/acme/api/commits') })

    it('removes a param and keeps the hash route', () => {
        const params = new URLSearchParams(window.location.search)
        params.delete('commit')
        writeQuery(params)
        expect(window.location.search).toBe('')
        expect(window.location.hash).toBe('#/repo/acme/api/commits')
    })

    it('pushes a new entry with state when asked', () => {
        const before = window.history.length
        writeQuery(new URLSearchParams('commit=def'), { push: true, state: { commitSha: 'def' } })
        expect(window.history.length).toBe(before + 1)
        expect(window.history.state).toEqual({ commitSha: 'def' })
        expect(window.location.hash).toBe('#/repo/acme/api/commits')
    })
})
