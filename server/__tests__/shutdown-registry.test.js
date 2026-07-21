// server/__tests__/shutdown-registry.test.js
//
// The registry decouples "something asked us to shut down" (signal handler,
// /api/system/shutdown route) from index.js's gracefulShutdown closure, and
// guarantees the handler can only ever fire once.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerShutdown, requestShutdown, resetShutdownForTests } from '../lib/shutdown.js';

describe('shutdown registry', () => {
    beforeEach(() => resetShutdownForTests());

    it('invokes the registered handler with the reason', () => {
        const fn = vi.fn();
        registerShutdown(fn);
        expect(requestShutdown('SIGTERM')).toBe(true);
        expect(fn).toHaveBeenCalledWith('SIGTERM');
    });
    it('is a no-op without a handler', () => {
        expect(requestShutdown('api')).toBe(false);
    });
    it('only ever fires once', () => {
        const fn = vi.fn();
        registerShutdown(fn);
        expect(requestShutdown('api')).toBe(true);
        expect(requestShutdown('SIGINT')).toBe(false);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
