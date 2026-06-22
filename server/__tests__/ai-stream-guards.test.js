// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Keep shared.js's import chain light + deterministic.
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }));
vi.mock('../db.js', () => ({ default: {} }));
vi.mock('../middleware/auth.js', () => ({ createRequireAI: () => (req, res, next) => next() }));
vi.mock('../ai-service.js', () => ({ aiService: {}, sanitizeForPrompt: (s) => s }));

const auditLog = vi.hoisted(() => vi.fn());
vi.mock('../lib/audit.js', () => ({ auditLog }));

const recordAISpend = vi.hoisted(() => vi.fn());
const spend = vi.hoisted(() => ({ result: { allowed: true, capCents: 0, spentCents: 0 } }));
vi.mock('../lib/ai-spend-cap.js', () => ({
    checkAISpendCap: () => spend.result,
    recordAISpend,
}));

import { denyIfSpendCapReached, recordStreamCompletion } from '../routes/ai/shared.js';

function fakeRes() {
    return {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
}

beforeEach(() => {
    spend.result = { allowed: true, capCents: 0, spentCents: 0 };
    auditLog.mockClear();
    recordAISpend.mockClear();
});

describe('denyIfSpendCapReached', () => {
    it('returns false and sends no response when under the cap', () => {
        const res = fakeRes();
        const denied = denyIfSpendCapReached({ session: { userId: 1 } }, res);
        expect(denied).toBe(false);
        expect(res.statusCode).toBeNull();
        expect(res.body).toBeNull();
    });

    it('returns true and sends a 429 AI_SPEND_CAP_REACHED envelope when over the cap', () => {
        spend.result = { allowed: false, capCents: 500, spentCents: 500 };
        const res = fakeRes();
        const denied = denyIfSpendCapReached({ session: { userId: 1 } }, res);
        expect(denied).toBe(true);
        expect(res.statusCode).toBe(429);
        expect(res.body).toMatchObject({
            code: 'AI_SPEND_CAP_REACHED',
            spent_cents: 500,
            cap_cents: 500,
        });
    });
});

describe('recordStreamCompletion', () => {
    it('records spend and audits with PII-safe usage merged into extra meta', () => {
        const req = { session: { userId: 7 } };
        recordStreamCompletion(req, {
            feature: 'chat_refine',
            model: 'gemini-2.5-flash',
            usage: { inputTokens: 100, outputTokens: 40 },
            costUSD: 0.003,
            extraMeta: { content_type: 'commit', streamed: true },
        });

        expect(recordAISpend).toHaveBeenCalledWith(7, 0.003);
        expect(auditLog).toHaveBeenCalledTimes(1);
        const [, action, resource, , meta] = auditLog.mock.calls[0];
        expect(action).toBe('ai.chat_refine');
        expect(resource).toBe('ai');
        // route-specific meta preserved, PII-safe cost/token fields added
        expect(meta).toMatchObject({
            content_type: 'commit',
            streamed: true,
            feature: 'chat_refine',
            model: 'gemini-2.5-flash',
            inputTokens: 100,
            outputTokens: 40,
        });
        // never logs prompt/reply content
        expect(meta).not.toHaveProperty('prompt');
        expect(meta).not.toHaveProperty('message');
    });

    it('honors an explicit audit action name', () => {
        recordStreamCompletion({ session: { userId: 1 } }, {
            feature: 'commit',
            action: 'ai_generate_commit',
            usage: null,
            costUSD: null,
        });
        const [, action] = auditLog.mock.calls[0];
        expect(action).toBe('ai_generate_commit');
    });

    it('still records (no-op spend) and audits feature+model when usage is null', () => {
        recordStreamCompletion({ session: { userId: 9 } }, {
            feature: 'review_summary',
            model: 'claude-sonnet-4-6',
            usage: null,
            costUSD: null,
        });
        expect(recordAISpend).toHaveBeenCalledWith(9, null);
        const [, , , , meta] = auditLog.mock.calls[0];
        expect(meta).toMatchObject({ feature: 'review_summary', model: 'claude-sonnet-4-6' });
        expect(meta).not.toHaveProperty('inputTokens');
    });
});
