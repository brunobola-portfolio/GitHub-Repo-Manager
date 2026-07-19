// @vitest-environment node
/**
 * W1.1 — HOST bind address support (server/config.js).
 *
 * config.js reads process.env once at import time (dotenv + a frozen
 * config object), so each scenario needs a fresh module instance —
 * vi.resetModules() + a dynamic re-import, mirroring the pattern used for
 * other env-driven modules (see server/__tests__/email.test.js).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ENV_KEYS = ['HOST', 'PORT', 'NODE_ENV', 'SESSION_SECRET', 'API_KEY_SECRET'];
let envSnapshot;

beforeEach(() => {
    envSnapshot = { ...process.env };
    // A valid baseline so config parsing never fails on unrelated fields.
    process.env.SESSION_SECRET = 'a'.repeat(40);
    process.env.NODE_ENV = 'test';
    vi.resetModules();
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (envSnapshot[k] !== undefined) process.env[k] = envSnapshot[k];
        else delete process.env[k];
    }
    vi.resetModules();
});

describe('config.host', () => {
    it('is undefined when HOST is unset — preserves binding all interfaces', async () => {
        delete process.env.HOST;
        const { config } = await import('../config.js');
        expect(config.host).toBeUndefined();
    });

    it('is undefined when HOST is an empty string', async () => {
        process.env.HOST = '';
        const { config } = await import('../config.js');
        expect(config.host).toBeUndefined();
    });

    it('reads HOST=127.0.0.1 through unchanged', async () => {
        process.env.HOST = '127.0.0.1';
        const { config } = await import('../config.js');
        expect(config.host).toBe('127.0.0.1');
    });

    it('reads an arbitrary bind address (e.g. 0.0.0.0) through unchanged', async () => {
        process.env.HOST = '0.0.0.0';
        const { config } = await import('../config.js');
        expect(config.host).toBe('0.0.0.0');
    });
});
