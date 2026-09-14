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

export function softwareApplicationJsonLd({ origin, version, stripeEnabled = false }) {
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
        // The Pro offer is advertised only when this deployment can actually
        // take the money. A priced Offer in structured data on an instance
        // whose checkout answers 503 is a claim a crawler repeats and a visitor
        // tests; "with your own key" belongs on the Free line for the same
        // reason — the AI quota is metered against the user's own provider.
        offers: [
            { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'EUR', description: 'Every feature, metered AI with your own key, unlimited repositories and teams.' },
            ...(stripeEnabled
                ? [{ '@type': 'Offer', name: 'Pro', price: '19', priceCurrency: 'EUR', description: 'More AI headroom and more API keys, billed monthly.' }]
                : []),
        ],
        codeRepository: 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager',
        downloadUrl: 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/latest',
        author: { '@type': 'Organization', name: 'BolaLabs', url: 'https://bolalabs.pt/' },
    };
}

/** Fill the placeholders and add the structured-data block before </head>. */
/**
 * Head overrides for the pages served by path outside the hash router. The
 * shell's own <head> describes the application; served verbatim on /privacy,
 * /terms and /status it told crawlers those pages were the homepage (same
 * canonical, same og:url) — which asks for them to be dropped from the index,
 * while the sitemap submits them. Title and description here match what each
 * page sets on itself once mounted.
 */
const ROUTE_HEAD = {
    '/privacy': {
        title: 'Privacy policy — GitHub Repo Manager',
        description: 'Who controls the data on repomanager.bolalabs.pt, what is stored and why, which processors receive it, for how long, and how to export or erase it.',
    },
    '/terms': {
        title: 'Terms of service — GitHub Repo Manager',
        description: 'Price, billing, cancellation and the 14-day right of withdrawal for the hosted GitHub Repo Manager at repomanager.bolalabs.pt.',
    },
    '/status': {
        title: 'System status — GitHub Repo Manager',
        description: 'Live health of the hosted GitHub Repo Manager: database, session store and the last time each was checked.',
    },
};

const escapeAttr = (s) => String(s).replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);

function applyRouteHead(html, origin, path) {
    const normalised = String(path || '/').replace(/\/+$/, '') || '/';
    const head = ROUTE_HEAD[normalised];
    if (!head) return html;
    const url = `${origin}${normalised}`;
    const title = escapeAttr(head.title);
    const description = escapeAttr(head.description);
    return html
        .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
        .replace(/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`)
        .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
        .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
        .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
        .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`);
}

export function renderShell(html, { origin, version, sentryDsn, stripeEnabled = false, path = '/' }) {
    const filled = applyRouteHead(html.replace(PLACEHOLDER, origin), origin, path);
    // "<" inside the JSON could close the script element early; escape it as
    // JSON allows so the block stays inert data whatever the strings contain.
    const json = JSON.stringify(softwareApplicationJsonLd({ origin, version, stripeEnabled })).replace(/</g, '\\u003c');
    // Browser telemetry is runtime configuration: the meta tag carries the
    // deployment's public DSN (or is absent), so one build serves every
    // install and the CSP needs no inline script to deliver it.
    const meta = sentryDsn ? `<meta name="grm-sentry-dsn" content="${String(sentryDsn).replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`)}">\n    ` : '';
    const block = `${meta}<script type="application/ld+json">${json}</script>`;
    return filled.includes('</head>')
        ? filled.replace('</head>', `    ${block}\n  </head>`)
        : filled + block;
}

/**
 * Paths a person can legitimately land on outside the hash router: the root,
 * the public status page, and the two pathnames the server itself sends people
 * to (Stripe's success/cancel/portal return URLs and the upgrade links).
 * Everything else still gets the shell — the SPA sends it home — but with a
 * 404, so a crawler or a mistyped link is not told the page exists.
 */
const SHELL_PATHS = new Set(['/', '/index.html', '/status', '/privacy', '/terms', '/settings', '/pricing']);

export function shellStatus(path) {
    const normalised = String(path || '/').replace(/\/+$/, '') || '/';
    return SHELL_PATHS.has(normalised) ? 200 : 404;
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

/**
 * RFC 9116 contact file. An Apache-2.0 infrastructure tool on a public domain
 * attracts vulnerability reports; without this, a finder's only options are a
 * public issue or nothing. `Expires` is required by the RFC — a year out, and
 * the deploy that renders this file is what refreshes it.
 */
export function securityTxt(origin, now = new Date()) {
    const expires = new Date(now.getTime());
    expires.setUTCFullYear(expires.getUTCFullYear() + 1);
    return [
        `Contact: ${origin}/security`,
        'Contact: mailto:security@bolalabs.pt',
        `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
        'Preferred-Languages: en, pt',
        `Policy: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/SECURITY.md`,
        `Acknowledgments: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/SECURITY.md`,
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
        // The status page is public, path-routed and answers 200 — a crawler
        // that finds it is one search away from telling a visitor the instance
        // is up. It was the one public page missing from this list.
        '  <url>',
        `    <loc>${origin}/status</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        '    <changefreq>daily</changefreq>',
        '  </url>',
        // The privacy policy is the page a cautious visitor looks for before
        // signing in, and the one a regulator expects to find without an
        // account. The terms are the other half of that: price, cancellation
        // and the withdrawal right, readable before paying.
        '  <url>',
        `    <loc>${origin}/privacy</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        '    <changefreq>yearly</changefreq>',
        '  </url>',
        '  <url>',
        `    <loc>${origin}/terms</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        '    <changefreq>yearly</changefreq>',
        '  </url>',
        '  <url>',
        `    <loc>${origin}/brand/</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        '    <changefreq>monthly</changefreq>',
        '  </url>',
        '</urlset>',
        '',
    ].join('\n');
}
