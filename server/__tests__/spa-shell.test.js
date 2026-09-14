// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolvePublicOrigin, renderShell, robotsTxt, securityTxt, sitemapXml, softwareApplicationJsonLd, shellStatus } from '../lib/spa-shell.js';

const req = (host, protocol = 'https') => ({ protocol, get: (h) => (h.toLowerCase() === 'host' ? host : undefined) });

describe('resolvePublicOrigin', () => {
    it('prefers a real FRONTEND_URL and normalises it to an origin', () => {
        expect(resolvePublicOrigin(req('127.0.0.1:3001', 'http'), 'https://repomanager.example.pt/')).toBe('https://repomanager.example.pt');
    });
    it('falls back to the request when FRONTEND_URL is missing or malformed', () => {
        expect(resolvePublicOrigin(req('grm.local:8443'), '')).toBe('https://grm.local:8443');
        expect(resolvePublicOrigin(req('grm.local', 'http'), 'not a url')).toBe('http://grm.local');
        expect(resolvePublicOrigin(req('grm.local'), 'ftp://x')).toBe('https://grm.local');
    });
});

describe('renderShell', () => {
    const html = '<html><head><link rel="canonical" href="__PUBLIC_ORIGIN__/"><meta property="og:image" content="__PUBLIC_ORIGIN__/og-1200x630.png"></head><body></body></html>';

    it('fills every placeholder with the origin and adds one JSON-LD block inside <head>', () => {
        const out = renderShell(html, { origin: 'https://repomanager.example.pt', version: '4.24.4' });
        expect(out).not.toContain('__PUBLIC_ORIGIN__');
        expect(out).toContain('<link rel="canonical" href="https://repomanager.example.pt/">');
        expect(out).toContain('content="https://repomanager.example.pt/og-1200x630.png"');
        const blocks = out.match(/<script type="application\/ld\+json">/g);
        expect(blocks).toHaveLength(1);
        expect(out.indexOf('application/ld+json')).toBeLessThan(out.indexOf('</head>'));
        const json = JSON.parse(out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
        expect(json['@type']).toBe('SoftwareApplication');
        expect(json.softwareVersion).toBe('4.24.4');
        expect(json.url).toBe('https://repomanager.example.pt/');
        expect(json.isAccessibleForFree).toBe(true);
    });

    it('gives the pages served by path their own head instead of the homepage\'s', () => {
        // Served verbatim, /privacy declared the homepage canonical — which
        // asks a crawler to drop the policy from the index while the sitemap
        // submits it, and a shared link previewed the product pitch.
        const shell = '<head><title>App</title><meta name="description" content="app pitch" /><link rel="canonical" href="__PUBLIC_ORIGIN__/" /><meta property="og:title" content="App" /><meta property="og:description" content="app pitch" /><meta property="og:url" content="__PUBLIC_ORIGIN__/" /></head>';
        const out = renderShell(shell, { origin: 'https://x', version: '1', path: '/privacy/' });
        expect(out).toContain('<title>Privacy policy — GitHub Repo Manager</title>');
        expect(out).toContain('<link rel="canonical" href="https://x/privacy" />');
        expect(out).toContain('<meta property="og:url" content="https://x/privacy" />');
        expect(out).toContain('<meta property="og:title" content="Privacy policy — GitHub Repo Manager" />');
        expect(out).not.toContain('app pitch');
        for (const p of ['/terms', '/status']) {
            expect(renderShell(shell, { origin: 'https://x', version: '1', path: p })).toContain(`href="https://x${p}"`);
        }
    });

    it('leaves the homepage and unknown paths with the shell\'s own head', () => {
        const shell = '<head><title>App</title><link rel="canonical" href="__PUBLIC_ORIGIN__/" /></head>';
        for (const p of ['/', '/settings', '/nope']) {
            const out = renderShell(shell, { origin: 'https://x', version: '1', path: p });
            expect(out).toContain('<title>App</title>');
            expect(out).toContain('href="https://x/"');
        }
    });

    it('never lets a "<" survive inside the data block', () => {
        const json = JSON.stringify(softwareApplicationJsonLd({ origin: 'https://x', version: '1' }));
        expect(json).not.toContain('<');
        const out = renderShell('<head></head>', { origin: 'https://x', version: '1' });
        const body = out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
        expect(body).not.toMatch(/<\//);
    });
});

describe('robots and sitemap', () => {
    it('allow the app, block the API and point at the sitemap on the same origin', () => {
        const txt = robotsTxt('https://repomanager.example.pt');
        expect(txt).toContain('Allow: /');
        expect(txt).toContain('Disallow: /api/');
        expect(txt).toContain('Sitemap: https://repomanager.example.pt/sitemap.xml');
    });
    it('list the landing page and the brand guide with a lastmod', () => {
        const xml = sitemapXml('https://repomanager.example.pt', '2026-09-06');
        expect(xml).toContain('<loc>https://repomanager.example.pt/</loc>');
        expect(xml).toContain('<loc>https://repomanager.example.pt/brand/</loc>');
        // Both legal pages: the ones a cautious buyer and a regulator look for
        // without an account.
        expect(xml).toContain('<loc>https://repomanager.example.pt/privacy</loc>');
        expect(xml).toContain('<loc>https://repomanager.example.pt/terms</loc>');
        expect(xml).toContain('<lastmod>2026-09-06</lastmod>');
        expect(xml.startsWith('<?xml')).toBe(true);
    });
});

describe('the priced offer follows what the deployment can actually charge', () => {
    const offerNames = (opts) => softwareApplicationJsonLd({ origin: 'https://x', version: '1', ...opts }).offers.map((o) => o.name);

    it('advertises Free only when checkout is not configured', () => {
        // A priced Offer on an instance whose /billing/checkout answers 503 is
        // a claim a crawler repeats and a visitor tests.
        expect(offerNames({})).toEqual(['Free']);
        expect(offerNames({ stripeEnabled: false })).toEqual(['Free']);
    });

    it('adds Pro once Stripe is configured', () => {
        expect(offerNames({ stripeEnabled: true })).toEqual(['Free', 'Pro']);
    });

    it('says the metered AI runs on the user\'s own key', () => {
        const free = softwareApplicationJsonLd({ origin: 'https://x', version: '1' }).offers[0];
        expect(free.description).toMatch(/your own key/i);
    });

    it('carries the flag through renderShell', () => {
        const shell = (opts) => renderShell('<head></head>', { origin: 'https://x', version: '1', ...opts });
        expect(shell({})).not.toContain('"name":"Pro"');
        expect(shell({ stripeEnabled: true })).toContain('"name":"Pro"');
    });
});

describe('securityTxt', () => {
    it('names a contact, a policy and an expiry a year out', () => {
        const txt = securityTxt('https://repomanager.example.pt', new Date('2026-09-12T00:00:00.000Z'));
        expect(txt).toContain('Contact: https://repomanager.example.pt/security');
        expect(txt).toContain('Contact: mailto:security@bolalabs.pt');
        // RFC 9116 requires Expires; a stale file is treated as absent.
        expect(txt).toContain('Expires: 2027-09-12T00:00:00Z');
        expect(txt).toMatch(/^Policy: https:\/\/github\.com\//m);
    });
});

describe('shellStatus', () => {
    it('answers 200 for the paths people really land on outside the hash router', () => {
        // /privacy among them: a visitor deciding whether to grant GitHub
        // access must be able to reach the policy without an account, and a
        // crawler must not be told it does not exist.
        for (const p of ['/', '/index.html', '/status', '/status/', '/privacy', '/privacy/', '/terms', '/terms/', '/settings', '/pricing/']) {
            expect(shellStatus(p), p).toBe(200);
        }
    });
    it('answers 404 for anything else, so a crawler is not told the page exists', () => {
        for (const p of ['/wp-login.php', '/repos', '/settings/extra', '/definitely-not-a-page']) {
            expect(shellStatus(p), p).toBe(404);
        }
    });
});
