// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { initSSE } from '../routes/ai-streaming.js'

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

