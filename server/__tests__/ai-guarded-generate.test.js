// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Keep shared.js's import chain light + deterministic.
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }));
vi.mock('../db.js', () => ({ default: {} }));
vi.mock('../middleware/auth.js', () => ({ createRequireAI: () => (req, res, next) => next() }));
vi.mock('../ai-service.js', () => ({ aiService: {}, sanitizeForPrompt: (s) => s }));
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }));

// Control the spend-cap decision without a DB.
const spend = vi.hoisted(() => ({ result: { allowed: true, capCents: 0, spentCents: 0 } }));
vi.mock('../lib/ai-spend-cap.js', () => ({
    checkAISpendCap: () => spend.result,
    recordAISpend: vi.fn(),
}));

import { guardedGenerate } from '../routes/ai/shared.js';

function fakeReq(generateImpl) {
    return {
        session: { userId: 1 },
        aiProvider: { model: 'test-model', generate: vi.fn(generateImpl) },
    };
}

beforeEach(() => { spend.result = { allowed: true, capCents: 0, spentCents: 0 }; });

describe('guardedGenerate', () => {
    it('injects the output-token cap and returns the provider result', async () => {
        const req = fakeReq(async () => ({ text: 'ok', usage: { inputTokens: 10, outputTokens: 5 }, costUSD: 0.01 }));
        const res = await guardedGenerate(req, { prompt: 'hi' }, { feature: 'chat' });
        expect(res.text).toBe('ok');
        const passedOpts = req.aiProvider.generate.mock.calls[0][0];
        expect(passedOpts.generationConfig.maxOutputTokens).toBeGreaterThan(0);
    });

    it('throws AI_SPEND_CAP_REACHED and never calls the provider when over the cap', async () => {
        spend.result = { allowed: false, capCents: 500, spentCents: 500 };
        const req = fakeReq(async () => ({ text: 'should not run' }));
        await expect(
            guardedGenerate(req, { prompt: 'hi' }, { feature: 'chat' }),
        ).rejects.toMatchObject({ code: 'AI_SPEND_CAP_REACHED', spendInfo: { capCents: 500, spentCents: 500 } });
        expect(req.aiProvider.generate).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// A route that asks for a small budget means it: "summarise in 80 tokens" is a
// cost and latency decision, not a hint. The global AI_MAX_OUTPUT_TOKENS is a
// CEILING — it must clamp a route that asks for too much, never inflate one
// that asks for little. Overwriting instead of clamping made four routes'
// declared budgets dead parameters, each silently generating up to the 2048
// default.
// ---------------------------------------------------------------------------
describe('guardedGenerate — per-route output budget', () => {
    it('honours a route budget below the global ceiling', async () => {
        const req = fakeReq(async () => ({ text: 'ok' }));
        await guardedGenerate(req, { prompt: 'hi', generationConfig: { maxOutputTokens: 80 } }, { feature: 'chat' });
        expect(req.aiProvider.generate.mock.calls[0][0].generationConfig.maxOutputTokens).toBe(80);
    });

    it('clamps a route budget above the global ceiling', async () => {
        const req = fakeReq(async () => ({ text: 'ok' }));
        await guardedGenerate(req, { prompt: 'hi', generationConfig: { maxOutputTokens: 999999 } }, { feature: 'chat' });
        const used = req.aiProvider.generate.mock.calls[0][0].generationConfig.maxOutputTokens;
        expect(used).toBeLessThanOrEqual(8192);
        expect(used).toBeLessThan(999999);
    });

    it('falls back to the global ceiling when a route declares no budget', async () => {
        const req = fakeReq(async () => ({ text: 'ok' }));
        await guardedGenerate(req, { prompt: 'hi' }, { feature: 'chat' });
        expect(req.aiProvider.generate.mock.calls[0][0].generationConfig.maxOutputTokens).toBe(2048);
    });

    it('ignores a non-positive route budget rather than disabling the cap', async () => {
        const req = fakeReq(async () => ({ text: 'ok' }));
        await guardedGenerate(req, { prompt: 'hi', generationConfig: { maxOutputTokens: 0 } }, { feature: 'chat' });
        expect(req.aiProvider.generate.mock.calls[0][0].generationConfig.maxOutputTokens).toBe(2048);
    });
});
