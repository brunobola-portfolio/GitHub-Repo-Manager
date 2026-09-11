// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scrubEvent, browserDsn, sentryTunnelHandler, reportException } from '../lib/monitoring.js';
import { renderShell } from '../lib/spa-shell.js';

const DSN = 'https://abc123@o42.ingest.de.sentry.io/4507';

function mockRes() {
    const res = { statusCode: 200, body: undefined, ended: false };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.end = () => { res.ended = true; return res; };
    return res;
}

const envelope = (dsn) => Buffer.from(`${JSON.stringify({ dsn, sent_at: '2026-09-11T00:00:00Z' })}\n{"type":"event"}\n{}`);

describe('scrubEvent', () => {
    it('removes credentials, cookies and bodies before an event leaves the server', () => {
        const event = scrubEvent({
            request: {
                url: 'https://grm.example/api/auth/callback?code=secret-code&state=xyz&page=2',
                query_string: 'code=secret-code&page=2',
                cookies: { sid: 'session' },
                data: { token: 'ghp_x' },
                headers: { Authorization: 'Bearer grm_live_x', Cookie: 'sid=1', 'X-CSRF-Token': 't', 'User-Agent': 'ua' },
            },
            breadcrumbs: [{ data: { url: '/x?access_token=abc' } }],
        });
        expect(event.request.url).toBe('https://grm.example/api/auth/callback?code=[Filtered]&state=[Filtered]&page=2');
        expect(event.request.query_string).toBe('code=[Filtered]&page=2');
        expect(event.request.cookies).toBeUndefined();
        expect(event.request.data).toBeUndefined();
        expect(event.request.headers.Authorization).toBe('[Filtered]');
        expect(event.request.headers.Cookie).toBe('[Filtered]');
        expect(event.request.headers['X-CSRF-Token']).toBe('[Filtered]');
        expect(event.request.headers['User-Agent']).toBe('ua');
        expect(event.breadcrumbs[0].data.url).toBe('/x?access_token=[Filtered]');
    });
});

describe('browser DSN and tunnel', () => {
    const saved = process.env.SENTRY_BROWSER_DSN;
    beforeEach(() => { process.env.SENTRY_BROWSER_DSN = DSN; });
    afterEach(() => {
        if (saved === undefined) delete process.env.SENTRY_BROWSER_DSN; else process.env.SENTRY_BROWSER_DSN = saved;
        vi.unstubAllGlobals();
    });

    it('parses host and project from SENTRY_BROWSER_DSN and rejects malformed values', () => {
        expect(browserDsn()).toEqual({ dsn: DSN, host: 'o42.ingest.de.sentry.io', projectId: '4507' });
        process.env.SENTRY_BROWSER_DSN = 'https://o42.ingest.sentry.io/4507';
        expect(browserDsn()).toBeNull();
        process.env.SENTRY_BROWSER_DSN = 'not a dsn';
        expect(browserDsn()).toBeNull();
    });

    it('forwards an envelope for the configured project to its envelope endpoint', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
        vi.stubGlobal('fetch', fetchMock);
        const res = mockRes();
        await sentryTunnelHandler({ body: envelope(DSN) }, res);
        expect(res.statusCode).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('https://o42.ingest.de.sentry.io/api/4507/envelope/');
    });

    it('refuses to relay envelopes for any other host or project', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        for (const other of ['https://abc@evil.example/4507', 'https://abc123@o42.ingest.de.sentry.io/9999']) {
            const res = mockRes();
            await sentryTunnelHandler({ body: envelope(other) }, res);
            expect(res.statusCode).toBe(400);
        }
        const res = mockRes();
        await sentryTunnelHandler({ body: Buffer.from('not json\n{}') }, res);
        expect(res.statusCode).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is a 404 when the deployment has no browser DSN', async () => {
        delete process.env.SENTRY_BROWSER_DSN;
        const res = mockRes();
        await sentryTunnelHandler({ body: envelope(DSN) }, res);
        expect(res.statusCode).toBe(404);
    });

    it('delivers the DSN to the page as an escaped meta tag, and nothing when unset', () => {
        const withDsn = renderShell('<head></head>', { origin: 'https://x', version: '1', sentryDsn: DSN });
        expect(withDsn).toContain(`<meta name="grm-sentry-dsn" content="${DSN}">`);
        const hostile = renderShell('<head></head>', { origin: 'https://x', version: '1', sentryDsn: '"><script>x</script>' });
        expect(hostile).not.toContain('<script>x');
        expect(renderShell('<head></head>', { origin: 'https://x', version: '1' })).not.toContain('grm-sentry-dsn');
    });
});

describe('reportException', () => {
    it('is a no-op without Sentry and never throws on odd input', () => {
        expect(() => reportException(null)).not.toThrow();
        expect(() => reportException(Object.assign(new Error('x'), { status: 404 }))).not.toThrow();
        expect(() => reportException(new Error('boom'), { extra: { a: 1 } })).not.toThrow();
    });
});
