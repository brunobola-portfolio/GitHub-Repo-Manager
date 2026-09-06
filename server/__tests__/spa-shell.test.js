// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolvePublicOrigin, renderShell, robotsTxt, sitemapXml, softwareApplicationJsonLd } from '../lib/spa-shell.js';

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
        expect(xml).toContain('<loc>https://repomanager.example.pt/brand</loc>');
        expect(xml).toContain('<lastmod>2026-09-06</lastmod>');
        expect(xml.startsWith('<?xml')).toBe(true);
    });
});
