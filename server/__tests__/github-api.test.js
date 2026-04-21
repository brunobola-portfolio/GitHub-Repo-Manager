// @vitest-environment node
/**
 * github-api.js — retries, Retry-After honouring, and circuit breaker.
 *
 * These tests pin the resilience contract around the shared GitHub API
 * wrapper: production code depends on it never hammering a degraded
 * upstream, always backing off exponentially on 5xx / network errors,
 * respecting 429 Retry-After, and short-circuiting via a module-scope
 * breaker after repeated failures.
 *
 * We mock `globalThis.fetch` so no real HTTP happens, and we drive the
 * wrapper's internal setTimeout-based backoff with vitest fake timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { githubApi, resetCircuitBreaker } from '../lib/github-api.js';

const TOKEN = 'test-token-123';

/**
 * Build a mock Response-like object the wrapper treats as a real
 * fetch Response. We need:
 *   - .status, .ok
 *   - .headers.get(name)
 *   - .json() that resolves to the body
 */
function mockResponse({ status = 200, body = {}, headers = {} } = {}) {
    const lowerHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
        lowerHeaders[k.toLowerCase()] = v;
    }
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: {
            get: (name) => {
                const v = lowerHeaders[name.toLowerCase()];
                return v === undefined ? null : v;
            }
        },
        json: async () => body
    };
}

let fetchMock;

beforeEach(() => {
    resetCircuitBreaker();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('githubApi — happy path', () => {
    it('returns 200 data without retries', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: { ok: true } }));
        const { data } = await githubApi('/user', TOKEN);
        expect(data).toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('githubApi — 5xx retries with exponential backoff', () => {
    it('retries 3 times on persistent 500 then throws', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        fetchMock.mockResolvedValue(mockResponse({ status: 500, body: { message: 'boom' } }));

        const promise = githubApi('/user', TOKEN);
        // Swallow the expected rejection so Node doesn't flag it as unhandled
        // while we're advancing timers.
        const assertion = expect(promise).rejects.toMatchObject({ status: 500 });

        // Advance past the worst-case cumulative backoff:
        //   attempt 1 delay ~480 ms, attempt 2 ~960 ms, attempt 3 ~1920 ms
        //   (1.2x the 400/800/1600 base). 10 s is more than enough.
        await vi.advanceTimersByTimeAsync(10_000);

        await assertion;
        // 1 initial + 3 retries = 4 total
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('recovers: 500 then 200 returns the 200 body after one retry', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        fetchMock
            .mockResolvedValueOnce(mockResponse({ status: 500, body: { message: 'transient' } }))
            .mockResolvedValueOnce(mockResponse({ status: 200, body: { recovered: true } }));

        const promise = githubApi('/user', TOKEN);
        await vi.advanceTimersByTimeAsync(2_000);
        const { data } = await promise;

        expect(data).toEqual({ recovered: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('githubApi — Retry-After honouring', () => {
    it('429 with Retry-After: 2 waits 2 s then retries once', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        fetchMock
            .mockResolvedValueOnce(mockResponse({
                status: 429,
                body: { message: 'rate limited' },
                headers: { 'Retry-After': '2' }
            }))
            .mockResolvedValueOnce(mockResponse({ status: 200, body: { ok: true } }));

        const promise = githubApi('/user', TOKEN);
        await vi.advanceTimersByTimeAsync(2_500);
        const { data } = await promise;

        expect(data).toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('githubApi — 4xx client errors are deterministic', () => {
    it('404 throws immediately with .status=404 and does not retry', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse({ status: 404, body: { message: 'Not Found' } }));

        await expect(githubApi('/repos/x/y', TOKEN)).rejects.toMatchObject({ status: 404 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('githubApi — circuit breaker', () => {
    it('opens after 5 consecutive 500s; 6th call fails fast without calling fetch', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        // Every fetch returns 500. Each githubApi call will retry
        // internally 3 times (4 fetches total) before it records a
        // failure. 5 consecutive failed calls = 5 recorded failures ->
        // breaker trips. The 6th call must short-circuit.
        fetchMock.mockResolvedValue(mockResponse({ status: 500, body: { message: 'boom' } }));

        for (let i = 0; i < 5; i++) {
            const p = githubApi('/user', TOKEN);
            const assertion = expect(p).rejects.toMatchObject({ status: 500 });
            await vi.advanceTimersByTimeAsync(10_000);
            await assertion;
        }

        const fetchCallsBefore = fetchMock.mock.calls.length;

        // 6th call: breaker is OPEN -> short-circuit.
        await expect(githubApi('/user', TOKEN)).rejects.toMatchObject({
            status: 503,
            code: 'github_circuit_open'
        });

        // No new fetch attempt was made.
        expect(fetchMock.mock.calls.length).toBe(fetchCallsBefore);
    });

    it('after 30 s the breaker enters HALF_OPEN and allows a probe fetch', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        fetchMock.mockResolvedValue(mockResponse({ status: 500, body: { message: 'boom' } }));

        // Trip the breaker.
        for (let i = 0; i < 5; i++) {
            const p = githubApi('/user', TOKEN);
            const assertion = expect(p).rejects.toMatchObject({ status: 500 });
            await vi.advanceTimersByTimeAsync(10_000);
            await assertion;
        }

        // Confirm breaker is OPEN.
        await expect(githubApi('/user', TOKEN)).rejects.toMatchObject({ code: 'github_circuit_open' });

        // Advance past the open window. Now switch fetch to return 200
        // so the HALF_OPEN probe succeeds and the breaker closes.
        await vi.advanceTimersByTimeAsync(30_001);
        fetchMock.mockReset();
        fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: { recovered: true } }));

        const { data } = await githubApi('/user', TOKEN);
        expect(data).toEqual({ recovered: true });
        // Exactly one probe fetch happened.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('githubApi — network errors are retryable', () => {
    it('fetch throwing ETIMEDOUT is retried with backoff', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const netErr = new Error('connect ETIMEDOUT 140.82.121.6:443');
        netErr.code = 'ETIMEDOUT';

        fetchMock
            .mockRejectedValueOnce(netErr)
            .mockResolvedValueOnce(mockResponse({ status: 200, body: { ok: true } }));

        const promise = githubApi('/user', TOKEN);
        await vi.advanceTimersByTimeAsync(2_000);
        const { data } = await promise;

        expect(data).toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
