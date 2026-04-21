// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { assertSafeExternalUrl, isInternalUrl } from '../lib/url-validator.js';

describe('assertSafeExternalUrl', () => {
    describe('accepts', () => {
        it('public https URL', () => {
            expect(() => assertSafeExternalUrl('https://github.com/org/repo')).not.toThrow();
        });

        it('public https URL with .git suffix', () => {
            expect(() => assertSafeExternalUrl('https://github.com/org/repo.git')).not.toThrow();
        });

        it('public https URL with port', () => {
            expect(() => assertSafeExternalUrl('https://gitlab.example.com:8443/a/b')).not.toThrow();
        });

        it('returns a URL instance', () => {
            const u = assertSafeExternalUrl('https://github.com/org/repo');
            expect(u).toBeInstanceOf(URL);
            expect(u.hostname).toBe('github.com');
        });

        it('allows http when allowHttp=true and host is public', () => {
            expect(() => assertSafeExternalUrl('http://example.com/x', { allowHttp: true })).not.toThrow();
        });
    });

    describe('rejects', () => {
        it('http scheme by default', () => {
            expect(() => assertSafeExternalUrl('http://example.com/x')).toThrow(/ssrf_guard/);
        });

        it('file:// scheme', () => {
            expect(() => assertSafeExternalUrl('file:///etc/passwd')).toThrow(/ssrf_guard/);
        });

        it('git:// scheme (not in default allowlist)', () => {
            expect(() => assertSafeExternalUrl('git://github.com/org/repo')).toThrow(/ssrf_guard/);
        });

        it('localhost hostname', () => {
            expect(() => assertSafeExternalUrl('http://localhost:3001/admin')).toThrow(/ssrf_guard/);
            expect(() => assertSafeExternalUrl('https://localhost/')).toThrow(/ssrf_guard/);
        });

        it('127.0.0.1 loopback', () => {
            expect(() => assertSafeExternalUrl('http://127.0.0.1/')).toThrow(/ssrf_guard/);
            expect(() => assertSafeExternalUrl('https://127.0.0.1:3001/')).toThrow(/ssrf_guard/);
        });

        it('127.x.x.x loopback range', () => {
            expect(() => assertSafeExternalUrl('https://127.5.5.5/')).toThrow(/loopback/);
        });

        it('169.254.169.254 AWS IMDS metadata', () => {
            expect(() => assertSafeExternalUrl('http://169.254.169.254/metadata')).toThrow(/ssrf_guard/);
        });

        it('10.0.0.0/8 rfc1918', () => {
            expect(() => assertSafeExternalUrl('https://10.0.0.5/')).toThrow(/rfc1918/);
            expect(() => assertSafeExternalUrl('https://10.255.255.255/')).toThrow(/rfc1918/);
        });

        it('172.16.0.0/12 rfc1918', () => {
            expect(() => assertSafeExternalUrl('https://172.16.0.1/')).toThrow(/rfc1918/);
            expect(() => assertSafeExternalUrl('https://172.31.255.255/')).toThrow(/rfc1918/);
        });

        it('allows 172.15 and 172.32 (outside rfc1918)', () => {
            expect(() => assertSafeExternalUrl('https://172.15.0.1/')).not.toThrow();
            expect(() => assertSafeExternalUrl('https://172.32.0.1/')).not.toThrow();
        });

        it('192.168.0.0/16 rfc1918', () => {
            expect(() => assertSafeExternalUrl('https://192.168.1.1/')).toThrow(/rfc1918/);
        });

        it('0.0.0.0 unspecified', () => {
            expect(() => assertSafeExternalUrl('http://0.0.0.0/')).toThrow(/ssrf_guard/);
        });

        it('embedded credentials', () => {
            expect(() => assertSafeExternalUrl('https://user:pass@evil.com/')).toThrow(/credentials/);
        });

        it('embedded username only', () => {
            expect(() => assertSafeExternalUrl('https://user@evil.com/')).toThrow(/credentials/);
        });

        it('IPv6 loopback literal', () => {
            expect(() => assertSafeExternalUrl('https://[::1]/')).toThrow(/ssrf_guard/);
        });

        it('IPv6 link-local', () => {
            expect(() => assertSafeExternalUrl('https://[fe80::1]/')).toThrow(/link-local/);
        });

        it('IPv6 unique-local', () => {
            expect(() => assertSafeExternalUrl('https://[fc00::1]/')).toThrow(/unique-local/);
        });

        it('IPv4-mapped IPv6 pointing at loopback', () => {
            expect(() => assertSafeExternalUrl('https://[::ffff:127.0.0.1]/')).toThrow(/private range/);
        });

        it('mDNS .local suffix', () => {
            expect(() => assertSafeExternalUrl('https://some-box.local/')).toThrow(/ssrf_guard/);
        });

        it('non-string input', () => {
            expect(() => assertSafeExternalUrl(null)).toThrow(/non-empty string/);
            expect(() => assertSafeExternalUrl(undefined)).toThrow(/non-empty string/);
            expect(() => assertSafeExternalUrl(42)).toThrow(/non-empty string/);
        });

        it('unparseable url', () => {
            expect(() => assertSafeExternalUrl('not a url')).toThrow(/invalid url/);
            expect(() => assertSafeExternalUrl('https://')).toThrow();
        });
    });
});

describe('isInternalUrl (existing helper, kept for backward compat)', () => {
    it('still flags localhost', () => {
        expect(isInternalUrl('https://localhost/')).toBe(true);
    });
    it('still allows public https', () => {
        expect(isInternalUrl('https://github.com/')).toBe(false);
    });
});
