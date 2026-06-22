// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildAIAuditMeta } from '../lib/ai-audit.js';

describe('buildAIAuditMeta', () => {
    it('captures feature, model, token counts, cost (cents) and message length', () => {
        const meta = buildAIAuditMeta({
            feature: 'chat',
            model: 'gemini-2.5-flash',
            usage: { inputTokens: 1200, outputTokens: 340 },
            costUSD: 0.0123,
            messageLength: 42,
        });
        expect(meta).toEqual({
            feature: 'chat',
            model: 'gemini-2.5-flash',
            inputTokens: 1200,
            outputTokens: 340,
            costCents: 1,
            messageLength: 42,
        });
    });

    it('omits missing/null fields gracefully', () => {
        const meta = buildAIAuditMeta({ feature: 'chat', model: '', usage: null, costUSD: null, messageLength: 10 });
        expect(meta).toEqual({ feature: 'chat', messageLength: 10 });
    });

    it('never records prompt/reply/content (PII-safe by construction)', () => {
        const meta = buildAIAuditMeta({
            feature: 'chat',
            model: 'm',
            usage: { inputTokens: 1, outputTokens: 1 },
            costUSD: 0,
            messageLength: 5,
            // hostile extra fields must be ignored:
            prompt: 'secret', reply: 'secret', text: 'secret',
        });
        expect(Object.keys(meta)).not.toContain('prompt');
        expect(Object.keys(meta)).not.toContain('reply');
        expect(Object.keys(meta)).not.toContain('text');
    });

    it('rounds and clamps cost to non-negative cents', () => {
        expect(buildAIAuditMeta({ costUSD: 0.005 }).costCents).toBe(1);
        expect(buildAIAuditMeta({ costUSD: -1 }).costCents).toBe(0);
    });
});
