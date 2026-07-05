// @vitest-environment node
/**
 * Tests for server/lib/logger.js:
 *  - requestLoggerMiddleware preserves an already-assigned req.id so the logged
 *    requestId equals the X-Request-Id header the client received (Task 6a).
 *  - REDACT_PATHS censors the common secret-bearing shapes (Task 6b).
 */
import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { requestLoggerMiddleware, REDACT_PATHS } from '../lib/logger.js';

function makeRes() {
    return { on: vi.fn(), get: vi.fn(() => undefined) };
}

describe('requestLoggerMiddleware — request id unification', () => {
    it('preserves an id already set upstream (matches the X-Request-Id header)', () => {
        const req = { id: 'preset-uuid-1234', headers: {}, method: 'GET', path: '/x', session: {} };
        const next = vi.fn();
        requestLoggerMiddleware(req, makeRes(), next);
        expect(req.id).toBe('preset-uuid-1234');
        expect(next).toHaveBeenCalledOnce();
    });

    it('falls back to the x-request-id header when no id was set', () => {
        const req = { headers: { 'x-request-id': 'from-header' }, method: 'GET', path: '/x', session: {} };
        requestLoggerMiddleware(req, makeRes(), vi.fn());
        expect(req.id).toBe('from-header');
    });

    it('generates an id when neither is present', () => {
        const req = { headers: {}, method: 'GET', path: '/x', session: {} };
        requestLoggerMiddleware(req, makeRes(), vi.fn());
        expect(req.id).toMatch(/^req_\d+_/);
    });

    it('attaches a child logger on req.log', () => {
        const req = { id: 'abc', headers: {}, method: 'GET', path: '/x', session: {} };
        requestLoggerMiddleware(req, makeRes(), vi.fn());
        expect(req.log).toBeTruthy();
        expect(typeof req.log.info).toBe('function');
    });
});

describe('REDACT_PATHS — secret backstop', () => {
    function logWith(obj) {
        const lines = [];
        const l = pino(
            { level: 'info', redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
            { write: (s) => lines.push(s) },
        );
        l.info(obj, 'test');
        return lines.join('');
    }

    it('censors authorization headers on req/err objects', () => {
        const out = logWith({
            req: { headers: { authorization: 'Bearer ghp_supersecret' } },
            err: { config: { headers: { authorization: 'ghp_errsecret' } } },
        });
        expect(out).not.toContain('ghp_supersecret');
        expect(out).not.toContain('ghp_errsecret');
        expect(out).toContain('[REDACTED]');
    });

    it('censors token / accessToken / pat / apiKey shapes at top level and one level deep', () => {
        const out = logWith({
            accessToken: 'gho_top',
            provider: { token: 'nested_token', apiKey: 'sk-nested', pat: 'azure_pat_value' },
        });
        expect(out).not.toContain('gho_top');
        expect(out).not.toContain('nested_token');
        expect(out).not.toContain('sk-nested');
        expect(out).not.toContain('azure_pat_value');
    });

    it('leaves non-secret fields intact', () => {
        const out = logWith({ username: 'alice', statusCode: 200 });
        expect(out).toContain('alice');
        expect(out).toContain('200');
    });
});
