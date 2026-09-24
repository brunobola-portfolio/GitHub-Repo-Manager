// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { downloadTfvcItems } = await import('../azure-service.js')

// A streamed body in chunks, optionally announcing a Content-Length.
function zipResponse(chunks, { contentLength } = {}) {
    let pulled = 0
    const body = new ReadableStream({
        pull(controller) {
            if (pulled < chunks.length) controller.enqueue(chunks[pulled++])
            else controller.close()
        },
    })
    const headers = new Headers({ 'Content-Type': 'application/zip' })
    if (contentLength != null) headers.set('Content-Length', String(contentLength))
    return new Response(body, { status: 200, headers })
}

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tfvc-dl-')) })
afterEach(() => {
    vi.unstubAllGlobals()
    rmSync(dir, { recursive: true, force: true })
})

const call = (maxBytes) => downloadTfvcItems('acme', 'web', '$/web', 'pat', undefined, {
    destPath: join(dir, 'a.zip'), maxBytes,
})

describe('downloadTfvcItems — streamed to disk under a cap', () => {
    it('writes the archive to the file and returns its size', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => zipResponse([new Uint8Array([80, 75]), new Uint8Array([3, 4, 9])])))
        const bytes = await call(1024)
        expect(bytes).toBe(5)
        expect([...readFileSync(join(dir, 'a.zip'))]).toEqual([80, 75, 3, 4, 9])
    })

    it('stops mid-stream once the cap is passed, without holding the body in memory', async () => {
        const chunk = new Uint8Array(400)
        vi.stubGlobal('fetch', vi.fn(async () => zipResponse([chunk, chunk, chunk, chunk])))
        await expect(call(1000)).rejects.toThrow(/exceeds the \d+ MB snapshot limit/)
    })

    it('refuses up front when Content-Length already says it is too big', async () => {
        const pull = vi.fn()
        vi.stubGlobal('fetch', vi.fn(async () => {
            const res = zipResponse([new Uint8Array(10)], { contentLength: 5_000_000_000 })
            pull()
            return res
        }))
        await expect(call(1024 * 1024 * 1024)).rejects.toThrow(/snapshot limit/)
    })
})
