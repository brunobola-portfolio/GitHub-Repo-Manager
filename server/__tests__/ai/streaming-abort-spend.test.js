// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A stream the client abandons still costs the operator real money.
 *
 * The provider has already paid for every input token the moment the request
 * lands, and for every output token generated before the socket died. Both
 * layers of the streaming path used to throw that number away on abort:
 * the providers returned `{ usage: null }` whenever `signal.aborted`, and the
 * SSE helpers `break` out of the loop on disconnect, which abandons the
 * generator before it can hand its usage back. `recordAISpend` no-ops on a
 * null cost, so an aborted stream recorded ZERO — and on Pro/Enterprise, where
 * the count quotas are Infinity, the spend cap is the only cost control there
 * is. Disconnecting made it free.
 *
 * These tests pin the whole chain: what the provider measured, what the helper
 * carries out of an aborted stream, and that the money lands in `ai_spend`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// shared.js pulls in the world; keep the chain light and deterministic.
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }));
vi.mock('../../db.js', () => ({ default: {} }));
vi.mock('../../middleware/auth.js', () => ({ createRequireAI: () => (req, res, next) => next() }));
vi.mock('../../ai-service.js', () => ({ aiService: {}, sanitizeForPrompt: (s) => s }));

const auditLog = vi.hoisted(() => vi.fn());
vi.mock('../../lib/audit.js', () => ({ auditLog }));

const recordAISpend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/ai-spend-cap.js', () => ({
    checkAISpendCap: () => ({ allowed: true, capCents: 0, spentCents: 0 }),
    recordAISpend,
}));

import { initSSE, streamToSSEWithUsage, streamReplyDeltasToSSE } from '../../routes/ai-streaming.js';
import { recordStreamCompletion } from '../../routes/ai/shared.js';
import { AnthropicProvider } from '../../lib/providers/anthropic.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeRes(onWrite) {
    const writes = [];
    return {
        writes,
        writeHead: vi.fn(),
        write: vi.fn((data) => { writes.push(data); onWrite?.(writes.length); return true; }),
        end: vi.fn(),
    };
}

function makeReq() {
    return Object.assign(new EventEmitter(), { url: '/sse' });
}

function encodeSSE(lines) {
    return new TextEncoder().encode(lines.join('\n') + '\n');
}

/**
 * A generator shaped like the real providers: input tokens are known from the
 * first event, output tokens accumulate, and a single socket read delivers a
 * BATCH of SSE events that are all yielded before the loop rechecks the
 * signal. That batching is what makes the bug reachable — a disconnect landing
 * mid-batch is still followed by at least one more yield, which is exactly
 * where the helper used to bail out and drop the generator.
 */
async function* meteredStream(signal) {
    let inputTokens = null;
    let outputTokens = 0;
    const batches = [
        [{ input: 900 }, { text: 'The ' }, { text: 'repo ' }],
        [{ text: 'looks ' }, { text: 'fine.' }],
    ];
    for (const batch of batches) {
        if (signal.aborted) break;
        for (const ev of batch) {
            if (ev.input != null) { inputTokens = ev.input; continue; }
            outputTokens += 1;
            yield ev.text;
        }
    }
    return {
        usage: { inputTokens, outputTokens },
        costUSD: (inputTokens * 3 + outputTokens * 15) / 1_000_000,
        partial: signal.aborted,
    };
}

beforeEach(() => {
    auditLog.mockClear();
    recordAISpend.mockClear();
});

// ---------------------------------------------------------------------------
// Layer 1 — the provider
// ---------------------------------------------------------------------------

describe('AnthropicProvider.generateStream() — usage survives an abort', () => {
    function providerWithBatch(provider) {
        let readCount = 0;
        const reader = {
            read: vi.fn(async () => {
                readCount++;
                if (readCount === 1) {
                    return {
                        done: false,
                        value: encodeSSE([
                            'data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 1200, output_tokens: 1 } } }),
                            'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }),
                            'data: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 40 } }),
                        ]),
                    };
                }
                return { done: true, value: undefined };
            }),
            releaseLock: vi.fn(),
        };
        provider._postStream = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { getReader: () => reader } });
        return reader;
    }

    it('reports the tokens it already measured when the client disconnects mid-stream', async () => {
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test1234', model: 'claude-3-sonnet' });
        providerWithBatch(provider);
        const controller = new AbortController();

        const iter = provider.generateStream({ prompt: 'x', signal: controller.signal });
        const first = await iter.next();
        expect(first.value).toBe('hi');

        // Client vanishes. Anthropic already billed 1200 input tokens at the
        // request, and 40 output tokens were generated before the socket died.
        controller.abort();

        const final = await iter.next();
        expect(final.done).toBe(true);
        expect(final.value.usage).toEqual({ inputTokens: 1200, outputTokens: 40 });
        expect(final.value.costUSD).toBeGreaterThan(0);
    });

    it('marks an aborted stream partial so the audit trail can tell it from a complete one', async () => {
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test1234', model: 'claude-3-sonnet' });
        providerWithBatch(provider);
        const controller = new AbortController();

        const iter = provider.generateStream({ prompt: 'x', signal: controller.signal });
        await iter.next();
        controller.abort();
        const final = await iter.next();

        expect(final.value.partial).toBe(true);
    });

    it('does not mark a stream partial when it drained normally', async () => {
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test1234', model: 'claude-3-sonnet' });
        providerWithBatch(provider);

        const iter = provider.generateStream({ prompt: 'x' });
        await iter.next();
        const final = await iter.next();

        expect(final.value.usage).toEqual({ inputTokens: 1200, outputTokens: 40 });
        expect(final.value.partial).toBeFalsy();
    });

    it('still reports null usage when an aborted stream measured nothing at all', async () => {
        // No message_start, no message_delta: there is no honest number to
        // record, and inventing one would be worse than recording none.
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test1234', model: 'claude-3-sonnet' });
        let readCount = 0;
        const reader = {
            read: vi.fn(async () => {
                readCount++;
                if (readCount === 1) {
                    return {
                        done: false,
                        value: encodeSSE([
                            'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } }),
                        ]),
                    };
                }
                return { done: true, value: undefined };
            }),
            releaseLock: vi.fn(),
        };
        provider._postStream = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { getReader: () => reader } });
        const controller = new AbortController();

        const iter = provider.generateStream({ prompt: 'x', signal: controller.signal });
        await iter.next();
        controller.abort();
        const final = await iter.next();

        expect(final.value.usage).toBeNull();
        expect(final.value.costUSD).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Layer 2 — the SSE helpers
// ---------------------------------------------------------------------------

describe('streamToSSEWithUsage — carries usage out of an aborted stream', () => {
    it('surfaces the usage the provider measured before the client disconnected', async () => {
        const req = makeReq();
        // The socket dies as we push the first chunk into it.
        const res = makeRes((n) => { if (n === 1) req.emit('close'); });
        const sse = initSSE(res, req);

        const result = await streamToSSEWithUsage(meteredStream(sse.signal), sse);

        expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 2 });
        expect(result.costUSD).toBeGreaterThan(0);
    });

    it('still stops writing to the dead socket', async () => {
        const req = makeReq();
        const res = makeRes((n) => { if (n === 1) req.emit('close'); });
        const sse = initSSE(res, req);

        const result = await streamToSSEWithUsage(meteredStream(sse.signal), sse);

        expect(res.writes).toHaveLength(1);
        expect(result.text).toBe('The ');
    });
});

describe('streamReplyDeltasToSSE — carries usage out of an aborted stream', () => {
    it('surfaces the usage the provider measured before the client disconnected', async () => {
        const req = makeReq();
        const res = makeRes((n) => { if (n === 1) req.emit('close'); });
        const sse = initSSE(res, req);

        // The chat envelope streams as raw JSON; the extractor pulls the reply.
        async function* envelope(signal) {
            let outputTokens = 0;
            const batches = [['{"reply":"He', 'llo'], [' there","actions":[]}']];
            for (const batch of batches) {
                if (signal.aborted) break;
                for (const piece of batch) { outputTokens += 1; yield piece; }
            }
            return { usage: { inputTokens: 700, outputTokens }, costUSD: 0.0031, partial: signal.aborted };
        }

        const result = await streamReplyDeltasToSSE(
            envelope(sse.signal),
            sse,
            (raw) => (raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/)?.[1] ?? ''),
        );

        expect(result.usage).toEqual({ inputTokens: 700, outputTokens: 2 });
        expect(result.costUSD).toBe(0.0031);
    });
});

// ---------------------------------------------------------------------------
// Layer 3 — the money
// ---------------------------------------------------------------------------

describe('an abandoned stream is billed', () => {
    it('records non-zero spend for a stream the client walked away from', async () => {
        const req = makeReq();
        const res = makeRes((n) => { if (n === 1) req.emit('close'); });
        const sse = initSSE(res, req);

        const { usage, costUSD } = await streamToSSEWithUsage(meteredStream(sse.signal), sse);

        recordStreamCompletion(
            { session: { userId: 7 }, aiProvider: { source: 'server' } },
            { feature: 'review_summary', model: 'claude-3-sonnet', usage, costUSD },
        );

        expect(recordAISpend).toHaveBeenCalledTimes(1);
        const [userId, recorded] = recordAISpend.mock.calls[0];
        expect(userId).toBe(7);
        expect(recorded).toBeGreaterThan(0);
    });

    it('writes the measured tokens into the audit entry, not zeros', async () => {
        const req = makeReq();
        const res = makeRes((n) => { if (n === 1) req.emit('close'); });
        const sse = initSSE(res, req);

        const { usage, costUSD } = await streamToSSEWithUsage(meteredStream(sse.signal), sse);

        recordStreamCompletion(
            { session: { userId: 7 }, aiProvider: { source: 'server' } },
            { feature: 'review_summary', model: 'claude-3-sonnet', usage, costUSD },
        );

        const meta = auditLog.mock.calls[0][4];
        expect(meta.inputTokens).toBe(900);
        expect(meta.outputTokens).toBe(2);
    });
});
