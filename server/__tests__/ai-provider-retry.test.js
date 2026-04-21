// @vitest-environment node
/**
 * Tests for providerGenerateWithRetry (server/routes/ai/shared.js).
 *
 * Covers the expanded retry policy:
 *  - Retries on OVERLOAD, TIMEOUT, RATE_LIMITED, NETWORK
 *  - Does NOT retry on AUTH, QUOTA, NOT_FOUND, INVALID_RESPONSE, CANCELED
 *  - Honours Retry-After (via AIError.retryAfterMs), capped at 60 s
 *  - Exponential backoff (400 → 800 → 1600 ms) with ±20% jitter
 *  - 3 retries total (4 attempts)
 *
 * We use vi.useFakeTimers({ shouldAdvanceTime: true }) so the sleep()
 * inside the wrapper advances as we pump vi.advanceTimersByTimeAsync.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIError, AI_ERROR_CODE } from '../lib/ai-provider.js';
import { providerGenerateWithRetry } from '../routes/ai/shared.js';

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(generateImpl) {
    return { generate: vi.fn(generateImpl) };
}

/**
 * Drive the fake timers forward until a promise either resolves or rejects.
 * Uses small ticks to let microtasks interleave with setTimeout scheduling.
 */
async function runUntilSettled(promise, { maxMs = 120_000, tickMs = 25 } = {}) {
    let settled = false;
    let result, error;
    promise.then(
        (r) => { settled = true; result = r; },
        (e) => { settled = true; error = e; },
    );
    let elapsed = 0;
    while (!settled && elapsed < maxMs) {
        await vi.advanceTimersByTimeAsync(tickMs);
        elapsed += tickMs;
    }
    if (!settled) throw new Error(`promise did not settle within ${maxMs}ms`);
    if (error) throw error;
    return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('providerGenerateWithRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    // -----------------------------------------------------------------------
    // 1. 429 with Retry-After: 1 → waits, retries once, succeeds.
    // -----------------------------------------------------------------------
    it('429 with Retry-After waits and retries once', async () => {
        let calls = 0;
        const provider = makeProvider(async () => {
            calls += 1;
            if (calls === 1) {
                throw new AIError({
                    code: AI_ERROR_CODE.RATE_LIMITED,
                    message: 'slow down',
                    status: 429,
                    retryAfterMs: 1000,
                });
            }
            return { text: 'ok' };
        });

        const p = providerGenerateWithRetry(provider, { prompt: 'x' });
        const result = await runUntilSettled(p);

        expect(result).toEqual({ text: 'ok' });
        expect(provider.generate).toHaveBeenCalledTimes(2);
    });

    // -----------------------------------------------------------------------
    // 2. Network error 3× → exhausts retries, throws.
    // -----------------------------------------------------------------------
    it('network error three times exhausts retries and throws', async () => {
        const netErr = new TypeError('fetch failed');
        const provider = makeProvider(async () => { throw netErr; });

        const p = providerGenerateWithRetry(provider, { prompt: 'x' });

        await expect(runUntilSettled(p)).rejects.toMatchObject({
            code: AI_ERROR_CODE.NETWORK,
        });
        // Default retries = 3 → 4 total attempts
        expect(provider.generate).toHaveBeenCalledTimes(4);
    });

    // -----------------------------------------------------------------------
    // 3. 504 → retryable like 503/529.
    // -----------------------------------------------------------------------
    it('504 is retryable (same class as 503/529)', async () => {
        let calls = 0;
        const provider = makeProvider(async () => {
            calls += 1;
            if (calls === 1) {
                // Raw SDK-shape error: status 504, no AIError. The wrapper
                // must normalise it via toAIError → OVERLOAD.
                throw Object.assign(new Error('gateway timeout'), { status: 504 });
            }
            return { text: 'recovered' };
        });

        const p = providerGenerateWithRetry(provider, { prompt: 'x' });
        const result = await runUntilSettled(p);

        expect(result).toEqual({ text: 'recovered' });
        expect(provider.generate).toHaveBeenCalledTimes(2);
    });

    // -----------------------------------------------------------------------
    // 4. 401 AUTH → no retry, throws immediately.
    // -----------------------------------------------------------------------
    it('401 AUTH does NOT retry', async () => {
        const provider = makeProvider(async () => {
            throw new AIError({ code: AI_ERROR_CODE.AUTH, message: 'bad key', status: 401 });
        });

        const p = providerGenerateWithRetry(provider, { prompt: 'x' });

        await expect(runUntilSettled(p)).rejects.toMatchObject({
            code: AI_ERROR_CODE.AUTH,
        });
        expect(provider.generate).toHaveBeenCalledTimes(1);
    });

    // -----------------------------------------------------------------------
    // 5. 403 QUOTA → no retry, throws immediately.
    // -----------------------------------------------------------------------
    it('403 QUOTA does NOT retry', async () => {
        const provider = makeProvider(async () => {
            throw new AIError({
                code: AI_ERROR_CODE.QUOTA,
                message: 'over quota',
                status: 403,
            });
        });

        const p = providerGenerateWithRetry(provider, { prompt: 'x' });

        await expect(runUntilSettled(p)).rejects.toMatchObject({
            code: AI_ERROR_CODE.QUOTA,
        });
        expect(provider.generate).toHaveBeenCalledTimes(1);
    });

    // -----------------------------------------------------------------------
    // 6. Transient then success on attempt 2.
    // -----------------------------------------------------------------------
    it('transient failure then success on retry attempt 2', async () => {
        let calls = 0;
        const provider = makeProvider(async () => {
            calls += 1;
            if (calls === 1) {
                throw new AIError({ code: AI_ERROR_CODE.OVERLOAD, status: 503 });
            }
            return { text: 'second-try' };
        });

        const p = providerGenerateWithRetry(provider, { prompt: 'x' });
        const result = await runUntilSettled(p);

        expect(result).toEqual({ text: 'second-try' });
        expect(provider.generate).toHaveBeenCalledTimes(2);
    });

    // -----------------------------------------------------------------------
    // 7. NOT_FOUND → no retry (safety net — spec says non-retryable).
    // -----------------------------------------------------------------------
    it('NOT_FOUND does NOT retry', async () => {
        const provider = makeProvider(async () => {
            throw new AIError({ code: AI_ERROR_CODE.NOT_FOUND, status: 404 });
        });

        const p = providerGenerateWithRetry(provider, { prompt: 'x' });

        await expect(runUntilSettled(p)).rejects.toMatchObject({
            code: AI_ERROR_CODE.NOT_FOUND,
        });
        expect(provider.generate).toHaveBeenCalledTimes(1);
    });

    // -----------------------------------------------------------------------
    // 8. INVALID_RESPONSE → no retry.
    // -----------------------------------------------------------------------
    it('INVALID_RESPONSE does NOT retry', async () => {
        const provider = makeProvider(async () => {
            throw new AIError({ code: AI_ERROR_CODE.INVALID_RESPONSE });
        });

        const p = providerGenerateWithRetry(provider, { prompt: 'x' });

        await expect(runUntilSettled(p)).rejects.toMatchObject({
            code: AI_ERROR_CODE.INVALID_RESPONSE,
        });
        expect(provider.generate).toHaveBeenCalledTimes(1);
    });

    // -----------------------------------------------------------------------
    // 9. Retry-After clamped to 60s.
    // -----------------------------------------------------------------------
    it('Retry-After is clamped to 60 seconds', async () => {
        let calls = 0;
        const provider = makeProvider(async () => {
            calls += 1;
            if (calls === 1) {
                throw new AIError({
                    code: AI_ERROR_CODE.RATE_LIMITED,
                    retryAfterMs: 10 * 60 * 1000, // 10 minutes; must clamp to 60s
                    status: 429,
                });
            }
            return { text: 'ok' };
        });

        const p = providerGenerateWithRetry(provider, { prompt: 'x' });

        // 61s should be enough if the clamp works; 120s leaves headroom.
        const result = await runUntilSettled(p, { maxMs: 120_000 });
        expect(result).toEqual({ text: 'ok' });
        expect(provider.generate).toHaveBeenCalledTimes(2);
    });

    // -----------------------------------------------------------------------
    // 10. TIMEOUT error retries.
    // -----------------------------------------------------------------------
    it('TIMEOUT is retryable', async () => {
        let calls = 0;
        const provider = makeProvider(async () => {
            calls += 1;
            if (calls < 2) {
                throw new AIError({ code: AI_ERROR_CODE.TIMEOUT, status: 408 });
            }
            return { text: 'done' };
        });

        const p = providerGenerateWithRetry(provider, { prompt: 'x' });
        const result = await runUntilSettled(p);

        expect(result).toEqual({ text: 'done' });
        expect(provider.generate).toHaveBeenCalledTimes(2);
    });
});
