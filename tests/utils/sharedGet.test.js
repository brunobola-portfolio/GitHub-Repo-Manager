import { describe, it, expect, vi, beforeEach } from 'vitest'

const apiCall = vi.fn()
vi.mock('../../src/utils/api', async (io) => ({ ...(await io()), apiCall: (...a) => apiCall(...a) }))

const { sharedApiGet, _resetSharedGetsForTests } = await import('../../src/utils/sharedGet')

beforeEach(() => {
    apiCall.mockReset()
    _resetSharedGetsForTests()
})

describe('sharedApiGet', () => {
    it('gives callers of the same URL the request already in flight', async () => {
        let resolve
        apiCall.mockReturnValue(new Promise((r) => { resolve = r }))
        const a = sharedApiGet('/api/v1/work-board/my-reviews?limit=50')
        const b = sharedApiGet('/api/v1/work-board/my-reviews?limit=50')
        resolve({ data: [1, 2] })
        expect(await a).toEqual({ data: [1, 2] })
        expect(await b).toEqual({ data: [1, 2] })
        expect(apiCall).toHaveBeenCalledTimes(1)
        expect(apiCall).toHaveBeenCalledWith('/api/v1/work-board/my-reviews?limit=50', {}, { maxRetries: 0 })
    })

    it('never reuses a result once it has landed', async () => {
        apiCall.mockResolvedValue({ data: [] })
        await sharedApiGet('/x')
        await sharedApiGet('/x')
        expect(apiCall).toHaveBeenCalledTimes(2)
    })

    it('lets the next caller retry after a failure', async () => {
        apiCall.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce({ data: [3] })
        await expect(sharedApiGet('/x')).rejects.toThrow('503')
        expect(await sharedApiGet('/x')).toEqual({ data: [3] })
    })

    it('keeps different URLs apart', async () => {
        apiCall.mockResolvedValue({ data: [] })
        await Promise.all([sharedApiGet('/a'), sharedApiGet('/b')])
        expect(apiCall).toHaveBeenCalledTimes(2)
    })
})
