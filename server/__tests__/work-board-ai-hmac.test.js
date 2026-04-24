// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { signDiffToken, verifyDiffToken } from '../lib/work-board-ai-hmac.js';

beforeEach(() => {
    process.env.AI_DIFF_SIGNING_KEY = 'test-key-32-chars-minimum-for-hmac';
});

describe('signDiffToken / verifyDiffToken', () => {
    it('round-trips a valid payload', () => {
        const token = signDiffToken({ userId: 123, actions: [{ repo: 'a/b', action: 'mute' }] });
        const result = verifyDiffToken(token);
        expect(result.valid).toBe(true);
        expect(result.payload.userId).toBe(123);
        expect(result.payload.actions).toEqual([{ repo: 'a/b', action: 'mute' }]);
    });

    it('rejects token with tampered payload', () => {
        const token = signDiffToken({ userId: 123, actions: [{ repo: 'a/b', action: 'mute' }] });
        const [, sig] = token.split('.');
        const tampered = Buffer.from(JSON.stringify({ userId: 999, actions: [] })).toString('base64url') + '.' + sig;
        const result = verifyDiffToken(tampered);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('bad_signature');
    });

    it('rejects expired token', () => {
        const token = signDiffToken({ userId: 1, actions: [] }, { ttlSeconds: -10 });
        const result = verifyDiffToken(token);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('expired');
    });

    it('rejects malformed token', () => {
        expect(verifyDiffToken('not-a-token').valid).toBe(false);
        expect(verifyDiffToken('only.one.dot.sep').valid).toBe(false);
    });

    it('signs with SESSION_SECRET fallback if AI_DIFF_SIGNING_KEY missing', () => {
        delete process.env.AI_DIFF_SIGNING_KEY;
        process.env.SESSION_SECRET = 'fallback-session-secret-at-least-32-chars';
        const token = signDiffToken({ userId: 7, actions: [] });
        const result = verifyDiffToken(token);
        expect(result.valid).toBe(true);
    });
});
