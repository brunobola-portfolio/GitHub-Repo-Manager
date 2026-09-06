#!/usr/bin/env node
/*
 * Read-only smoke test against a live deployment. Nothing here signs in,
 * writes, or needs a token: it checks what an anonymous visitor, a crawler
 * and a load balancer see. Run it after every deploy:
 *
 *   npm run smoke:prod                       # https://repomanager.bolalabs.pt
 *   npm run smoke:prod -- https://grm.local  # any origin
 *
 * Exit code 1 on any failure, so it can gate a pipeline. Each check names
 * what it expected and what it saw; a failure is a fact to act on, not a
 * flake to retry. Written after the 4.24.0 deploy, when the mock-mode suites
 * were green and production had a setup wizard, a reload loop and a login
 * that pointed at 127.0.0.1 — three things only this environment can show.
 */

const origin = String(process.argv[2] || 'https://repomanager.bolalabs.pt').replace(/\/+$/, '')
const results = []

async function get(path, init = {}) {
    const res = await fetch(origin + path, { redirect: 'manual', ...init })
    const text = await res.text()
    return { res, text }
}

function check(name, ok, detail) {
    results.push({ name, ok: Boolean(ok), detail })
}

async function run() {
    // 1. Health and readiness — the load balancer's view.
    {
        const { res, text } = await get('/api/health')
        let body = null
        try { body = JSON.parse(text) } catch { /* not JSON */ }
        check('health answers 200 JSON with status ok', res.status === 200 && body?.status === 'ok', `${res.status} ${text.slice(0, 80)}`)
        check('health reports the database connected', body?.database === 'connected', body?.database)
        check('health reports a semver version', /^\d+\.\d+\.\d+$/.test(body?.version || ''), body?.version)
    }
    {
        const { res, text } = await get('/api/health/ready')
        check('readiness answers 200', res.status === 200, `${res.status} ${text.slice(0, 80)}`)
    }

    // 2. Boot signals the shell reads before it decides what to render.
    {
        const { res, text } = await get('/api/system/status')
        let body = null
        try { body = JSON.parse(text) } catch { /* not JSON */ }
        check('system status is JSON with initialized=true', res.status === 200 && body?.initialized === true, `${res.status} ${text.slice(0, 80)}`)
    }
    {
        const { text } = await get('/api/auth/setup-status')
        let body = null
        try { body = JSON.parse(text) } catch { /* not JSON */ }
        check('OAuth is configured', body?.oauthConfigured === true, text.slice(0, 120))
        check('setup-status advertises the public origin, not loopback', typeof body?.callbackUrl === 'string' && body.callbackUrl.startsWith(origin + '/'), body?.callbackUrl)
    }
    {
        const { res } = await get('/api/auth/session')
        check('anonymous session probe is 401 (not 500, not 200)', res.status === 401, String(res.status))
    }

    // 3. Sign-in leaves for GitHub with the public callback.
    {
        const { res } = await get('/api/auth/login')
        const loc = res.headers.get('location') || ''
        check('login redirects (302)', res.status === 302, String(res.status))
        check('login points at github.com/login/oauth/authorize', loc.startsWith('https://github.com/login/oauth/authorize'), loc.replace(/client_id=[^&]*/, 'client_id=…').slice(0, 120))
        check('redirect_uri is this origin', loc.includes('redirect_uri=' + encodeURIComponent(origin + '/api/auth/callback')), decodeURIComponent((loc.match(/redirect_uri=([^&]*)/) || [])[1] || ''))
    }

    // 4. The shell a visitor and a crawler get.
    {
        const { res, text } = await get('/')
        check('landing answers 200 HTML', res.status === 200 && /text\/html/.test(res.headers.get('content-type') || ''), `${res.status} ${res.headers.get('content-type')}`)
        check('shell is not cached', /no-cache/.test(res.headers.get('cache-control') || ''), res.headers.get('cache-control'))
        check('no __PUBLIC_ORIGIN__ placeholder survives', !text.includes('__PUBLIC_ORIGIN__'))
        check('canonical names this origin', text.includes(`<link rel="canonical" href="${origin}/" />`))
        check('og:url names this origin', text.includes(`<meta property="og:url" content="${origin}/" />`))
        check('og:image is served from this origin', text.includes(`content="${origin}/og-1200x630.png"`))
        check('JSON-LD SoftwareApplication is present', /"@type":"SoftwareApplication"/.test(text))
        check('title is search-sized (under 60 characters)', ((text.match(/<title>([^<]*)<\/title>/) || [])[1] || '').length <= 60, (text.match(/<title>([^<]*)<\/title>/) || [])[1])
        const csp = res.headers.get('content-security-policy') || ''
        check('CSP header present without unsafe-inline scripts', csp.length > 0 && !/script-src[^;]*'unsafe-inline'/.test(csp), csp.slice(0, 80))
        check('HSTS present', /max-age=\d+/.test(res.headers.get('strict-transport-security') || ''), res.headers.get('strict-transport-security'))
        check('X-Content-Type-Options nosniff', res.headers.get('x-content-type-options') === 'nosniff')
        check('Permissions-Policy present', Boolean(res.headers.get('permissions-policy')))
        check('frame-ancestors restricted', /frame-ancestors/.test(csp) || Boolean(res.headers.get('x-frame-options')))
        check('request id echoed', Boolean(res.headers.get('x-request-id')))
    }
    for (const asset of ['/og-1200x630.png', '/landing/dashboard-dark.jpg', '/landing/dashboard-light.jpg', '/favicon-32.png']) {
        const { res } = await get(asset)
        check(`${asset} is a real image, not the shell`, res.status === 200 && /^image\//.test(res.headers.get('content-type') || ''), `${res.status} ${res.headers.get('content-type')}`)
    }
    {
        const { res, text } = await get('/robots.txt')
        check('robots.txt is text and names the sitemap here', res.status === 200 && /text\/plain/.test(res.headers.get('content-type') || '') && text.includes(`Sitemap: ${origin}/sitemap.xml`), text.slice(0, 80))
    }
    {
        const { res, text } = await get('/sitemap.xml')
        check('sitemap is XML and lists the landing page', res.status === 200 && /xml/.test(res.headers.get('content-type') || '') && text.includes(`<loc>${origin}/</loc>`), text.slice(0, 80))
    }
    {
        const { text } = await get('/')
        const m = text.match(/src="(\/assets\/index-[^"]+\.js)"/)
        check('shell references a hashed entry script', Boolean(m), m?.[1])
        if (m) {
            const a = await get(m[1], { headers: { 'accept-encoding': 'br, gzip' } })
            check('hashed asset is immutable-cached', /immutable/.test(a.res.headers.get('cache-control') || ''), a.res.headers.get('cache-control'))
            check('hashed asset is served precompressed', ['br', 'gzip'].includes(a.res.headers.get('content-encoding') || ''), a.res.headers.get('content-encoding') || 'identity')
        }
    }
    {
        const { res } = await get('/brand/')
        check('brand guide answers 200', res.status === 200, String(res.status))
    }

    // 5. API contract for the unknown and the unauthenticated.
    {
        const { res, text } = await get('/api/definitely-not-a-route')
        check('unknown /api path is a JSON 404', res.status === 404 && /application\/json/.test(res.headers.get('content-type') || ''), `${res.status} ${text.slice(0, 60)}`)
    }
    {
        const { res } = await get('/api/repos')
        check('a protected route answers 401 to anonymous, not 500', res.status === 401, String(res.status))
    }
    {
        const { res } = await get('/api/health')
        check('rate-limit headers present on /api', Boolean(res.headers.get('ratelimit-limit') || res.headers.get('x-ratelimit-limit')), res.headers.get('ratelimit-limit') || res.headers.get('x-ratelimit-limit') || 'none')
    }
    {
        const { res } = await get('/api/v1/webhooks/github', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        check('unsigned webhook is rejected (401/403/404/410), never 200', [401, 403, 404, 410].includes(res.status), String(res.status))
    }

    // 6. HTTP→HTTPS and www hygiene, when the origin is https.
    if (origin.startsWith('https://')) {
        try {
            const httpRes = await fetch(origin.replace('https://', 'http://') + '/', { redirect: 'manual' })
            check('plain http redirects to https', [301, 302, 307, 308].includes(httpRes.status) && (httpRes.headers.get('location') || '').startsWith('https://'), `${httpRes.status} ${httpRes.headers.get('location')}`)
        } catch (e) {
            check('plain http redirects to https', false, e.message)
        }
    }
}

try {
    await run()
} catch (e) {
    check('smoke run completed', false, e.message)
}

const failed = results.filter((r) => !r.ok)
for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`)
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${origin}`)
process.exit(failed.length ? 1 : 0)
