// server/__tests__/loopback.test.js
//
// isLoopbackRequest moved to server/lib/loopback.js so system routes can
// share it; auth-setup.js must keep re-exporting it for old importers.
import { describe, it, expect } from 'vitest';
import { isLoopbackRequest } from '../lib/loopback.js';

function fakeReq({ addr = '127.0.0.1', host = '127.0.0.1:3001', forwarded } = {}) {
    const headers = { host };
    if (forwarded) headers['x-forwarded-for'] = forwarded;
    return { headers, socket: { remoteAddress: addr } };
}

describe('isLoopbackRequest (lib)', () => {
    it('accepts a direct loopback request', () => {
        expect(isLoopbackRequest(fakeReq())).toBe(true);
        expect(isLoopbackRequest(fakeReq({ addr: '::1', host: 'localhost:3001' }))).toBe(true);
        expect(isLoopbackRequest(fakeReq({ addr: '::ffff:127.0.0.1' }))).toBe(true);
    });
    it('rejects proxied, non-loopback, and rebound-host requests', () => {
        expect(isLoopbackRequest(fakeReq({ forwarded: '1.2.3.4' }))).toBe(false);
        expect(isLoopbackRequest(fakeReq({ addr: '192.168.1.10' }))).toBe(false);
        expect(isLoopbackRequest(fakeReq({ host: 'evil.example.com' }))).toBe(false);
    });
    it('is still re-exported from auth-setup.js', async () => {
        const mod = await import('../routes/auth-setup.js');
        expect(mod.isLoopbackRequest).toBe(isLoopbackRequest);
    });
});
