// @vitest-environment node
/**
 * An Azure 401 (expired token, revoked PAT) is not this app's session ending.
 * The client signs out on any 401, which threw away the migration wizard while
 * the GitHub session was fine, so Azure auth failures answer 422.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db.js', () => ({ default: { prepare: () => ({ get: () => null, all: () => [], run: () => ({}) }) } }))

const { azureStatus } = await import('../routes/azure/_shared.js')

describe('azureStatus', () => {
    it('turns an upstream 401 into 422', () => {
        expect(azureStatus({ status: 401 })).toBe(422)
    })
    it('passes every other status through, with a fallback', () => {
        expect(azureStatus({ status: 403 })).toBe(403)
        expect(azureStatus({ status: 404 })).toBe(404)
        expect(azureStatus({}, 400)).toBe(400)
        expect(azureStatus(undefined)).toBe(500)
    })
})
