import { describe, it, expect, vi, afterEach } from 'vitest'
import { copyToClipboard } from '../../src/utils/clipboard'

const originalNavigator = globalThis.navigator

afterEach(() => {
    globalThis.navigator = originalNavigator
})

describe('copyToClipboard', () => {
    it('returns false for non-string input without touching navigator', async () => {
        const writeText = vi.fn()
        globalThis.navigator = { clipboard: { writeText } }
        expect(await copyToClipboard(null)).toBe(false)
        expect(await copyToClipboard(123)).toBe(false)
        expect(writeText).not.toHaveBeenCalled()
    })

    it('returns false when navigator.clipboard is unavailable', async () => {
        globalThis.navigator = {}
        expect(await copyToClipboard('hello')).toBe(false)
    })

    it('writes the value and returns true on the happy path', async () => {
        const writeText = vi.fn(async () => undefined)
        globalThis.navigator = { clipboard: { writeText } }
        const ok = await copyToClipboard('grm_lic_abc')
        expect(ok).toBe(true)
        expect(writeText).toHaveBeenCalledWith('grm_lic_abc')
    })

    it('returns false (does not throw) when clipboard.writeText rejects', async () => {
        const writeText = vi.fn(async () => { throw new Error('NotAllowedError') })
        globalThis.navigator = { clipboard: { writeText } }
        // Should not throw — caller can fall back to a manual-copy hint.
        const ok = await copyToClipboard('some-secret')
        expect(ok).toBe(false)
    })
})
