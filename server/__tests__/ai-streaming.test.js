// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { initSSE, streamToSSEWithUsage } from '../routes/ai-streaming.js'

function makeRes() {
    const writes = []
    return {
        writes,
        ended: false,
        writeHead: vi.fn(),
        write: vi.fn((data) => { writes.push(data); return true }),
        end: vi.fn(function () { this.ended = true }),
    }
}

function makeReq() {
    const ee = new EventEmitter()
    return Object.assign(ee, { url: '/sse' })
}

describe('initSSE', () => {
    it('writes SSE headers on init', () => {
        const res = makeRes()
        initSSE(res)
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
        }))
    })

    it('sendChunk emits a data event with the text payload', () => {
        const res = makeRes()
        const sse = initSSE(res)
        sse.sendChunk('hello')
        expect(res.writes[0]).toBe(`data: ${JSON.stringify({ text: 'hello' })}\n\n`)
    })

    it('sendDone writes the done envelope and ends the response', () => {
        const res = makeRes()
        const sse = initSSE(res)
        sse.sendDone('full text')
        expect(res.writes[0]).toBe(`data: ${JSON.stringify({ done: true, full: 'full text' })}\n\n`)
        expect(res.end).toHaveBeenCalled()
    })

    it('sendError writes the error envelope and ends the response', () => {
        const res = makeRes()
        const sse = initSSE(res)
        sse.sendError('boom')
        expect(res.writes[0]).toBe(`data: ${JSON.stringify({ error: true, message: 'boom' })}\n\n`)
        expect(res.end).toHaveBeenCalled()
    })

    it('client disconnect flips isAborted and aborts the signal', () => {
        const res = makeRes()
        const req = makeReq()
        const sse = initSSE(res, req)
        expect(sse.isAborted).toBe(false)
        expect(sse.signal.aborted).toBe(false)
        req.emit('close')
        expect(sse.isAborted).toBe(true)
        expect(sse.signal.aborted).toBe(true)
    })

    it('after disconnect, sendChunk is a no-op (no further writes)', () => {
        const res = makeRes()
        const req = makeReq()
        const sse = initSSE(res, req)
        sse.sendChunk('first')
        req.emit('close')
        sse.sendChunk('second')
        expect(res.writes.length).toBe(1)
    })

    it('socket-write failure also aborts the signal', () => {
        const res = makeRes()
        res.write = vi.fn(() => { throw new Error('socket gone') })
        const sse = initSSE(res)
        sse.sendChunk('x')
        expect(sse.isAborted).toBe(true)
        expect(sse.signal.aborted).toBe(true)
    })
})

describe('streamToSSEWithUsage', () => {
    it('accumulates text, streams each chunk, and surfaces the generator return value', async () => {
        const res = makeRes()
        const sse = initSSE(res)
        async function* gen() {
            yield 'Hello'
            yield ' world'
            return { usage: { inputTokens: 10, outputTokens: 5 }, costUSD: 0.002 }
        }
        const result = await streamToSSEWithUsage(gen(), sse)
        expect(result.text).toBe('Hello world')
        expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
        expect(result.costUSD).toBe(0.002)
        expect(res.writes).toEqual([
            `data: ${JSON.stringify({ text: 'Hello' })}\n\n`,
            `data: ${JSON.stringify({ text: ' world' })}\n\n`,
        ])
    })

    it('returns null usage/costUSD for a stream that does not return metadata', async () => {
        const res = makeRes()
        const sse = initSSE(res)
        async function* gen() { yield 'a'; yield 'b' }
        const result = await streamToSSEWithUsage(gen(), sse)
        expect(result.text).toBe('ab')
        expect(result.usage).toBeNull()
        expect(result.costUSD).toBeNull()
    })

    it('skips empty chunks (does not send empty data events)', async () => {
        const res = makeRes()
        const sse = initSSE(res)
        async function* gen() { yield 'a'; yield ''; yield 'b' }
        const result = await streamToSSEWithUsage(gen(), sse)
        expect(result.text).toBe('ab')
        expect(res.writes.length).toBe(2)
    })

    it('stops accumulating once the client disconnects mid-stream', async () => {
        const res = makeRes()
        const req = makeReq()
        const sse = initSSE(res, req)
        async function* gen() {
            yield 'first'
            req.emit('close')
            yield 'second'
            return { usage: null, costUSD: null }
        }
        const result = await streamToSSEWithUsage(gen(), sse)
        expect(result.text).toBe('first')
        expect(res.writes.length).toBe(1)
    })

    it('runs the generator cleanup (return) when it breaks early on abort', async () => {
        const res = makeRes()
        const req = makeReq()
        const sse = initSSE(res, req)
        const cleanup = vi.fn()
        async function* gen() {
            try {
                yield 'first'
                req.emit('close')
                yield 'second'
            } finally {
                cleanup()
            }
        }
        await streamToSSEWithUsage(gen(), sse)
        expect(cleanup).toHaveBeenCalled()
    })
})

