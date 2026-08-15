// SPDX-License-Identifier: Apache-2.0
/**
 * The load-bearing assertion here is the invariant: no AI provider failure may
 * answer 401.
 *
 * On the client, 401 is wired to notifySessionExpired() (src/utils/api.js) —
 * it hard-redirects to /?error=session_expired and latches a flag that
 * short-circuits every later request. So a 401 from an AI route does not read
 * as "your provider key is wrong", it reads as "you have been signed out of
 * the app". routes/ai/shared.js already picks 422 for precisely this reason
 * and says so in a comment; this mapper was the copy that still returned 401,
 * which is what dev-toolkit's routes (review-summary among them) go through.
 */
import { describe, it, expect } from 'vitest';
import { AIError, AI_ERROR_CODE } from '../../lib/ai-provider.js';
import { mapAIErrorToResponse } from '../../middleware/ai-error-mapper.js';

function fakeRes() {
    const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
    return res;
}

const mapped = (code, extra = {}) => {
    const res = fakeRes();
    const out = mapAIErrorToResponse(res, new AIError({ code, message: 'x', ...extra }));
    return { res, out };
};

describe('mapAIErrorToResponse', () => {
    it('never answers 401 for any AI provider failure', () => {
        for (const code of Object.values(AI_ERROR_CODE)) {
            const { res } = mapped(code);
            expect(res.statusCode, `${code} must not map to 401`).not.toBe(401);
        }
    });

    it('maps AUTH to 422 so the client does not read it as a dead session', () => {
        const { res } = mapped(AI_ERROR_CODE.AUTH);
        expect(res.statusCode).toBe(422);
        // ai_auth is what src/utils/errors.js aliases to INVALID_API_KEY, which
        // is the entry that renders the "update your key in Settings" CTA.
        expect(res.body.code).toBe('ai_auth');
    });

    it('agrees with routes/ai/shared.js on the status for a rejected key', async () => {
        // Two mappers, one condition. They disagreed for long enough that the
        // 422 rationale was documented in one and lost in the other.
        const shared = await import('../../routes/ai/shared.js');
        const sharedRes = fakeRes();
        shared.handleAIError(sharedRes, new AIError({ code: AI_ERROR_CODE.AUTH, message: 'Invalid API key', status: 401 }));
        const { res: mapperRes } = mapped(AI_ERROR_CODE.AUTH);
        expect(mapperRes.statusCode).toBe(sharedRes.statusCode);
    });

    it('returns null for a non-AIError so the caller keeps its own 500 path', () => {
        const res = fakeRes();
        expect(mapAIErrorToResponse(res, new Error('boom'))).toBeNull();
        expect(res.statusCode).toBeNull();
    });

    it('keeps the rest of the mapping intact', () => {
        expect(mapped(AI_ERROR_CODE.RATE_LIMITED).res.statusCode).toBe(429);
        expect(mapped(AI_ERROR_CODE.QUOTA).res.statusCode).toBe(429);
        expect(mapped(AI_ERROR_CODE.OVERLOAD).res.statusCode).toBe(503);
        expect(mapped(AI_ERROR_CODE.TIMEOUT).res.statusCode).toBe(504);
        expect(mapped(AI_ERROR_CODE.NETWORK).res.statusCode).toBe(502);
        expect(mapped(AI_ERROR_CODE.NOT_FOUND).res.statusCode).toBe(404);
        expect(mapped(AI_ERROR_CODE.INVALID_RESPONSE).res.statusCode).toBe(502);
        expect(mapped(AI_ERROR_CODE.CANCELED).res.statusCode).toBe(499);
        expect(mapped(AI_ERROR_CODE.UNKNOWN).res.statusCode).toBe(502);
    });

    it('passes Retry-After through on a rate limit', () => {
        const { res } = mapped(AI_ERROR_CODE.RATE_LIMITED, { retryAfterMs: 4200 });
        expect(res.body.retryAfterSec).toBe(5);
    });
});
