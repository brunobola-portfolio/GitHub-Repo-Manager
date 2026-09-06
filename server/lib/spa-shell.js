// SPDX-License-Identifier: Apache-2.0
/**
 * The app shell (dist/index.html) is one static file built in CI, yet the
 * social and search tags in its <head> need the origin the deployment is
 * actually served from: canonical, og:url and the social card must name
 * repomanager.bolalabs.pt on that box and a self-hoster's own host on theirs.
 * The build leaves `__PUBLIC_ORIGIN__` in those spots; this module fills it
 * per request and adds the structured-data block, robots.txt and the
 * single-URL sitemap a single-page app needs.
 *
 * The JSON-LD block is injected here rather than written into index.html on
 * purpose: tests/build/csp-inline-script.test.js keeps the source shell free
 * of inline <script> bodies. A `type="application/ld+json"` block is data the
 * browser never executes, so script-src 'self' does not apply to it.
 */

const PLACEHOLDER = /__PUBLIC_ORIGIN__/g;

/**
 * The origin to advertise: the operator's FRONTEND_URL when it is a real
 * http(s) URL, otherwise the request's own scheme and host.
 */
export function resolvePublicOrigin(req, frontendUrl) {
    if (frontendUrl) {
        try {
            const url = new URL(frontendUrl);
            if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
        } catch {
            // Malformed: fall through to the request origin.
        }
    }
    const host = req?.get?.('host') || 'localhost';
    const protocol = req?.protocol || 'http';
    return `${protocol}://${host}`;
}

export function softwareApplicationJsonLd({ origin, version }) {
    return {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'GitHub Repo Manager',
        alternateName: 'RepoManager',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Windows, Linux, macOS (self-hosted); any modern browser',
        softwareVersion: version,
        url: `${origin}/`,
        image: `${origin}/og-1200x630.png`,
        description: 'One dashboard for GitHub repositories, teams and CI/CD, a cross-repo Work Board with DORA metrics, AI Deep Review and Azure DevOps/TFVC migration. Bring your own AI key. Open source under Apache-2.0.',
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        codeRepository: 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager',
        downloadUrl: 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/latest',
        author: { '@type': 'Organization', name: 'BolaLabs', url: 'https://bolalabs.pt/' },
    };
}

/** Fill the placeholders and add the structured-data block before </head>. */
export function renderShell(html, { origin, version }) {
    const filled = html.replace(PLACEHOLDER, origin);
    // "<" inside the JSON could close the script element early; escape it as
    // JSON allows so the block stays inert data whatever the strings contain.
    const json = JSON.stringify(softwareApplicationJsonLd({ origin, version })).replace(/</g, '\\u003c');
    const block = `<script type="application/ld+json">${json}</script>`;
    return filled.includes('</head>')
        ? filled.replace('</head>', `    ${block}\n  </head>`)
        : filled + block;
}

export function robotsTxt(origin) {
    return [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        '',
        `Sitemap: ${origin}/sitemap.xml`,
        '',
    ].join('\n');
}

export function sitemapXml(origin, lastmod) {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url>',
        `    <loc>${origin}/</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        '    <changefreq>weekly</changefreq>',
        '  </url>',
        '  <url>',
        `    <loc>${origin}/brand</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        '    <changefreq>monthly</changefreq>',
        '  </url>',
        '</urlset>',
        '',
    ].join('\n');
}
