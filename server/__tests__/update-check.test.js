// @vitest-environment node
/**
 * Tests for server/lib/update-check.js (W1.4).
 *
 * Covers: newer / equal / older (dev build ahead of the last tagged release
 * must NOT claim an update) / a failed fetch / the UPDATE_CHECK=false
 * disabled path / and the in-memory cache (24h on success, 1h after a
 * failure) so a Settings page load doesn't hit the GitHub API every time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/logger.js', () => ({
    default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { checkForUpdate, resetUpdateCheckCacheForTests } from '../lib/update-check.js';

function jsonResponse(body, ok = true, status = 200) {
    return { ok, status, json: async () => body };
}

beforeEach(() => {
    resetUpdateCheckCacheForTests();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('checkForUpdate', () => {
    it('disabled=true skips the outbound fetch entirely', async () => {
        const fetchImpl = vi.fn();
        const result = await checkForUpdate({ currentVersion: '1.0.0', disabled: true, fetchImpl });
        expect(result).toEqual({ current: '1.0.0', disabled: true });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('newer release available -> updateAvailable: true, strips the leading v', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
            tag_name: 'v2.0.0', html_url: 'https://github.com/x/y/releases/tag/v2.0.0',
        }));
        const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });
        expect(result.latest).toBe('2.0.0');
        expect(result.updateAvailable).toBe(true);
        expect(result.releaseUrl).toBe('https://github.com/x/y/releases/tag/v2.0.0');
        expect(result.current).toBe('1.0.0');
        expect(result.checkedAt).toEqual(expect.any(String));
    });

    it('equal version -> updateAvailable: false (genuinely current)', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v1.0.0', html_url: 'https://x' }));
        const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });
        expect(result.latest).toBe('1.0.0');
        expect(result.updateAvailable).toBe(false);
    });

    it('dev build ahead of the last tagged release -> updateAvailable: false, never true', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v1.0.0', html_url: 'https://x' }));
        const result = await checkForUpdate({ currentVersion: '2.0.0-dev', fetchImpl });
        expect(result.updateAvailable).toBe(false);
    });

    it('a non-ok HTTP response is treated as a failure, not a crash', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
        const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });
        expect(result).toMatchObject({ current: '1.0.0', latest: null, updateAvailable: null, releaseUrl: null });
        expect(result.checkedAt).toEqual(expect.any(String));
    });

    it('a thrown fetch (network error / timeout) never throws to the caller', async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new Error('timeout'));
        const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });
        expect(result).toMatchObject({ current: '1.0.0', latest: null, updateAvailable: null, releaseUrl: null });
    });

    it('a malformed payload (missing tag_name) is inconclusive, not a crash', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
        const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });
        expect(result.latest).toBeNull();
        expect(result.updateAvailable).toBeNull();
    });

    it('caches a successful result for 24h — a second call inside the window does not refetch', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v1.0.0', html_url: 'https://x' }));

        const first = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });
        vi.setSystemTime(new Date('2026-01-01T23:59:00.000Z')); // +23h59m, still inside 24h TTL
        const second = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
    });

    it('re-fetches after the 24h cache expires', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v1.0.0', html_url: 'https://x' }));

        await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });
        vi.setSystemTime(new Date('2026-01-02T00:00:01.000Z')); // +24h1s, past the TTL
        await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });

        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('caches a failed check for only 1h, shorter than the success TTL', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));

        await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });
        vi.setSystemTime(new Date('2026-01-01T00:59:00.000Z')); // +59m, still inside 1h TTL
        await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        vi.setSystemTime(new Date('2026-01-01T01:00:01.000Z')); // +1h1s, past the failure TTL
        await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('resetUpdateCheckCacheForTests clears the cache immediately', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v1.0.0', html_url: 'https://x' }));
        await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });
        resetUpdateCheckCacheForTests();
        await checkForUpdate({ currentVersion: '1.0.0', fetchImpl });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});
