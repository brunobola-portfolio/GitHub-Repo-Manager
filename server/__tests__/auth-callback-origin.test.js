// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { prepare: () => ({ get: () => undefined, run: () => {}, all: () => [] }) } }));
vi.mock('../lib/audit.js', () => ({ auditLog: () => {} }));

const { resolveCallbackOrigin } = await import('../routes/auth.js');

const ORIG = { ...process.env };
afterEach(() => { process.env = { ...ORIG }; });

function req(host, protocol = 'https') {
    return { protocol, get: (h) => (h.toLowerCase() === 'host' ? host : undefined) };
}

describe('resolveCallbackOrigin', () => {
    it('uses FRONTEND_URL when it names the same host the request arrived on', () => {
        process.env.FRONTEND_URL = 'https://repomanager.example.pt';
        expect(resolveCallbackOrigin(req('repomanager.example.pt', 'http'))).toBe('https://repomanager.example.pt');
    });

    it('uses an https FRONTEND_URL when the proxy handed Node its own loopback host', () => {
        process.env.FRONTEND_URL = 'https://repomanager.example.pt';
        expect(resolveCallbackOrigin(req('127.0.0.1:3001'))).toBe('https://repomanager.example.pt');
        expect(resolveCallbackOrigin(req('localhost:3001', 'http'))).toBe('https://repomanager.example.pt');
        expect(resolveCallbackOrigin(req('[::1]:3001'))).toBe('https://repomanager.example.pt');
    });

    it('keeps the request origin in dev, where FRONTEND_URL is the Vite server on another port', () => {
        process.env.FRONTEND_URL = 'http://localhost:5173';
        expect(resolveCallbackOrigin(req('localhost:3001', 'http'))).toBe('http://localhost:3001');
    });

    it('keeps the request origin for a genuinely different public host', () => {
        process.env.FRONTEND_URL = 'https://one.example.pt';
        expect(resolveCallbackOrigin(req('two.example.pt'))).toBe('https://two.example.pt');
    });

    it('falls back to the request origin without FRONTEND_URL', () => {
        delete process.env.FRONTEND_URL;
        expect(resolveCallbackOrigin(req('repomanager.example.pt'))).toBe('https://repomanager.example.pt');
    });
});
