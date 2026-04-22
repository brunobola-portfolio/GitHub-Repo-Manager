import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @sentry/react so we can flip between "not initialised" and
// "active client" without wiring up a real Sentry project.
vi.mock('@sentry/react', () => {
    const addBreadcrumb = vi.fn();
    const state = { client: null };
    return {
        addBreadcrumb,
        getClient: () => state.client,
        __setClient: (c) => { state.client = c; },
        __addBreadcrumb: addBreadcrumb,
    };
});

import * as Sentry from '@sentry/react';
import { trackBreadcrumb, mark, measure } from '@/lib/observability';

describe('trackBreadcrumb', () => {
    beforeEach(() => {
        Sentry.__addBreadcrumb.mockClear();
        // Default — Sentry inactive.
        Sentry.__setClient(null);
    });

    it('no-ops silently when Sentry is not initialised', () => {
        expect(() => trackBreadcrumb('nav', 'view:dashboard')).not.toThrow();
        expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
    });

    it('forwards to Sentry.addBreadcrumb when a client is active', () => {
        Sentry.__setClient({ name: 'fake-client' });
        trackBreadcrumb('api', '/api/repos', { status: 500 }, 'warning');
        expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
        expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
            category: 'api',
            message: '/api/repos',
            data: { status: 500 },
            level: 'warning',
        });
    });

    it('defaults level to "info" when omitted', () => {
        Sentry.__setClient({ name: 'fake-client' });
        trackBreadcrumb('mutation', 'Repo archived');
        const call = Sentry.addBreadcrumb.mock.calls[0][0];
        expect(call.level).toBe('info');
        expect(call.data).toBeUndefined();
    });

    it('swallows errors raised by Sentry.addBreadcrumb', () => {
        Sentry.__setClient({ name: 'fake-client' });
        Sentry.addBreadcrumb.mockImplementationOnce(() => {
            throw new Error('breadcrumb buffer full');
        });
        expect(() => trackBreadcrumb('nav', 'view:repos')).not.toThrow();
    });
});

describe('mark / measure', () => {
    let originalPerformance;

    beforeEach(() => {
        originalPerformance = globalThis.performance;
    });

    afterEach(() => {
        globalThis.performance = originalPerformance;
    });

    it('mark() does not throw when called in a supported environment', () => {
        expect(() => mark('test:boundary')).not.toThrow();
    });

    it('mark() silently no-ops when performance is unavailable', () => {
        // Simulate an SSR / old-browser environment where performance is
        // missing entirely. Restoring happens in afterEach.
        globalThis.performance = undefined;
        expect(() => mark('no-perf')).not.toThrow();
    });

    it('mark() silently no-ops when performance.mark is missing', () => {
        globalThis.performance = { now: () => 0 };
        expect(() => mark('no-mark-fn')).not.toThrow();
    });

    it('mark() swallows errors from performance.mark (invalid names, full buffer)', () => {
        globalThis.performance = {
            mark: vi.fn(() => { throw new Error('bad mark'); }),
        };
        expect(() => mark('oops')).not.toThrow();
        expect(globalThis.performance.mark).toHaveBeenCalledWith('oops');
    });

    it('measure() silently returns undefined when performance is unavailable', () => {
        globalThis.performance = undefined;
        expect(measure('m', 'a', 'b')).toBeUndefined();
    });

    it('measure() forwards start/end marks when supported', () => {
        const measureFn = vi.fn(() => ({ name: 'm' }));
        globalThis.performance = { measure: measureFn };
        const out = measure('m', 'a', 'b');
        expect(measureFn).toHaveBeenCalledWith('m', 'a', 'b');
        expect(out).toEqual({ name: 'm' });
    });

    it('measure() returns undefined when performance.measure throws', () => {
        globalThis.performance = {
            measure: () => { throw new Error('no such mark'); },
        };
        expect(measure('m', 'missing', 'also-missing')).toBeUndefined();
    });
});
