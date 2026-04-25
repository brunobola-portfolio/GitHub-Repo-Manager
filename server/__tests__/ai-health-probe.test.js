// @vitest-environment node
/**
 * Tests for server/lib/ai-health-probe.js
 *
 * Verifies the in-memory cache behaviour, error classification, and the
 * synchronous probeAndCache path used by the Settings UI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/logger.js', () => ({
    default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const {
    getKeyHealth,
    probeAndCache,
    invalidate,
    recordState,
    getProbeStats,
    resetProbeStats,
    __TEST__,
} = await import('../lib/ai-health-probe.js');

beforeEach(() => {
    __TEST__.cache.clear();
    resetProbeStats();
});

afterEach(() => {
    __TEST__.cache.clear();
    resetProbeStats();
});

describe('ai-health-probe — getKeyHealth', () => {
    it('returns "unknown" on first call and kicks off probe in background', async () => {
        const provider = { generate: vi.fn().mockResolvedValue({ text: 'ok' }) };
        const result = getKeyHealth({ userId: 1, resolveProvider: () => Promise.resolve(provider) });
        expect(result.state).toBe('unknown');
        expect(result.checkedAt).toBeNull();

        // Wait for the in-flight probe to settle.
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        const second = getKeyHealth({ userId: 1, resolveProvider: () => Promise.resolve(provider) });
        expect(second.state).toBe('ok');
        expect(provider.generate).toHaveBeenCalledTimes(1);
    });

    it('does not re-probe within the TTL window', async () => {
        const provider = { generate: vi.fn().mockResolvedValue({ text: 'ok' }) };
        getKeyHealth({ userId: 2, resolveProvider: () => Promise.resolve(provider) });
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        getKeyHealth({ userId: 2, resolveProvider: () => Promise.resolve(provider) });
        getKeyHealth({ userId: 2, resolveProvider: () => Promise.resolve(provider) });
        expect(provider.generate).toHaveBeenCalledTimes(1);
    });

    it('classifies 401 errors as invalid', async () => {
        const err = Object.assign(new Error('unauthorized'), { status: 401 });
        const provider = { generate: vi.fn().mockRejectedValue(err) };
        getKeyHealth({ userId: 3, resolveProvider: () => Promise.resolve(provider) });
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        const result = getKeyHealth({ userId: 3, resolveProvider: () => Promise.resolve(provider) });
        expect(result.state).toBe('invalid');
    });

    it('classifies AIError code "NETWORK" as unreachable', async () => {
        const err = Object.assign(new Error('network down'), { code: 'NETWORK' });
        const provider = { generate: vi.fn().mockRejectedValue(err) };
        getKeyHealth({ userId: 4, resolveProvider: () => Promise.resolve(provider) });
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        const result = getKeyHealth({ userId: 4, resolveProvider: () => Promise.resolve(provider) });
        expect(result.state).toBe('unreachable');
    });

    it('falls back to "unknown" on transient errors that do not look like auth/network', async () => {
        const err = Object.assign(new Error('weird hiccup'), { status: 500 });
        const provider = { generate: vi.fn().mockRejectedValue(err) };
        getKeyHealth({ userId: 5, resolveProvider: () => Promise.resolve(provider) });
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        const result = getKeyHealth({ userId: 5, resolveProvider: () => Promise.resolve(provider) });
        expect(result.state).toBe('unknown');
    });

    it('returns "unknown" without probing when resolveProvider returns null', async () => {
        const result = getKeyHealth({ userId: 6, resolveProvider: () => Promise.resolve(null) });
        expect(result.state).toBe('unknown');
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        const second = getKeyHealth({ userId: 6, resolveProvider: () => Promise.resolve(null) });
        expect(second.state).toBe('unknown');
    });
});

describe('ai-health-probe — probeAndCache', () => {
    it('runs the probe synchronously and writes the cache', async () => {
        const provider = { generate: vi.fn().mockResolvedValue({ text: 'ok' }) };
        const result = await probeAndCache({ userId: 7, resolveProvider: () => Promise.resolve(provider) });
        expect(result.state).toBe('ok');
        expect(result.checkedAt).toEqual(expect.any(String));
        // Cache hit on next read.
        const cached = getKeyHealth({ userId: 7, resolveProvider: () => Promise.resolve(provider) });
        expect(cached.state).toBe('ok');
        expect(provider.generate).toHaveBeenCalledTimes(1);
    });

    it('returns "unknown" when no provider resolves', async () => {
        const result = await probeAndCache({ userId: 8, resolveProvider: () => Promise.resolve(null) });
        expect(result.state).toBe('unknown');
    });
});

describe('ai-health-probe — invalidate / recordState', () => {
    it('invalidate(userId) clears one entry', () => {
        recordState(10, 'ok');
        expect(getKeyHealth({ userId: 10, resolveProvider: () => Promise.resolve(null) }).state).toBe('ok');
        invalidate(10);
        // After invalidate the entry is gone — next read returns unknown.
        expect(getKeyHealth({ userId: 10, resolveProvider: () => Promise.resolve(null) }).state).toBe('unknown');
    });

    it('invalidate() with no arg clears all entries', () => {
        recordState(11, 'ok');
        recordState(12, 'invalid');
        invalidate();
        expect(getKeyHealth({ userId: 11, resolveProvider: () => Promise.resolve(null) }).state).toBe('unknown');
        expect(getKeyHealth({ userId: 12, resolveProvider: () => Promise.resolve(null) }).state).toBe('unknown');
    });
});

describe('ai-health-probe — outcome counters', () => {
    it('starts at zero across all states', () => {
        const stats = getProbeStats();
        expect(stats).toEqual({ ok: 0, invalid: 0, unreachable: 0, unknown: 0, total: 0, lastOutcomeAt: null });
    });

    it('bumps ok on a successful probe', async () => {
        const provider = { generate: vi.fn().mockResolvedValue({ text: 'ok' }) };
        await probeAndCache({ userId: 100, resolveProvider: () => Promise.resolve(provider) });
        const stats = getProbeStats();
        expect(stats.ok).toBe(1);
        expect(stats.total).toBe(1);
        expect(stats.lastOutcomeAt).not.toBeNull();
    });

    it('bumps invalid when the provider rejects with 401', async () => {
        const err = Object.assign(new Error('Invalid api key'), { status: 401 });
        const provider = { generate: vi.fn().mockRejectedValue(err) };
        await probeAndCache({ userId: 101, resolveProvider: () => Promise.resolve(provider) });
        const stats = getProbeStats();
        expect(stats.invalid).toBe(1);
        expect(stats.ok).toBe(0);
    });

    it('bumps unknown when there is no provider at all', async () => {
        await probeAndCache({ userId: 102, resolveProvider: () => Promise.resolve(null) });
        expect(getProbeStats().unknown).toBe(1);
    });

    it('accumulates across mixed outcomes', async () => {
        const okProvider = { generate: vi.fn().mockResolvedValue({ text: 'ok' }) };
        const errProvider = { generate: vi.fn().mockRejectedValue(Object.assign(new Error('bad'), { status: 401 })) };
        await probeAndCache({ userId: 200, resolveProvider: () => Promise.resolve(okProvider) });
        await probeAndCache({ userId: 201, resolveProvider: () => Promise.resolve(okProvider) });
        await probeAndCache({ userId: 202, resolveProvider: () => Promise.resolve(errProvider) });
        const stats = getProbeStats();
        expect(stats.total).toBe(3);
        expect(stats.ok).toBe(2);
        expect(stats.invalid).toBe(1);
    });

    it('resetProbeStats() zeroes everything', async () => {
        const provider = { generate: vi.fn().mockResolvedValue({ text: 'ok' }) };
        await probeAndCache({ userId: 300, resolveProvider: () => Promise.resolve(provider) });
        resetProbeStats();
        expect(getProbeStats()).toEqual({ ok: 0, invalid: 0, unreachable: 0, unknown: 0, total: 0, lastOutcomeAt: null });
    });
});
