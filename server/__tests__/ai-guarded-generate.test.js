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
