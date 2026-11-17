/**
 * Where this install sends people for help and for buying a licence.
 *
 * Lives in its own module rather than src/config.js because dozens of tests
 * replace `@/config` with a factory mock, and a value read at module load
 * (the generic error fallback) would then throw in every one of them.
 *
 * The server writes the contacts into the shell (`<meta name="grm-support">`,
 * from email-identity.js publicSupport), so one build serves the hosted app
 * and every self-hosted install. A build-time VITE_SUPPORT_EMAIL still works
 * for static hosting. Nothing configured means no contact is shown: the old
 * default sent every self-hosted user to the maintainer's personal inbox.
 */

const PUBLISHER_LICENCE_URL = 'https://bolalabs.pt/en/repomanager'
const DESK_LOCALES = new Set(['pt', 'es', 'fr'])

let cached = null

function readMeta() {
    try {
        const raw = typeof document !== 'undefined'
            ? document.querySelector('meta[name="grm-support"]')?.getAttribute('content')
            : null
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

const isHttps = (v) => typeof v === 'string' && /^https:\/\/[^\s"<>]+$/.test(v)
const isEmail = (v) => typeof v === 'string' && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v)

/** @returns {{ url?: string, email?: string, salesUrl: string }} */
export function getSupport() {
    if (cached) return cached
    const meta = readMeta()
    const envEmail = import.meta.env.VITE_SUPPORT_EMAIL
    const email = isEmail(meta.email) ? meta.email : isEmail(envEmail) ? envEmail : undefined
    cached = {
        ...(isHttps(meta.url) ? { url: meta.url } : {}),
        ...(email ? { email } : {}),
        salesUrl: isHttps(meta.salesUrl) ? meta.salesUrl : PUBLISHER_LICENCE_URL,
    }
    return cached
}

/** Test seam: forget the parsed meta. */
export function resetSupportCache() {
    cached = null
}

/**
 * A link to ask for help, or null when this install has no contact.
 * The BolaLabs desk speaks four languages, so its `/en/` follows the
 * browser's language there; any other desk URL is left untouched.
 *
 * @param {{ category?: 'question'|'incident'|'request'|'billing'|'licence', subject?: string }} [opts]
 */
export function supportHref({ category, subject } = {}) {
    const { url, email } = getSupport()
    if (url) {
        try {
            const u = new URL(url)
            if (u.hostname === 'bolalabs.pt') {
                const lang = (typeof navigator !== 'undefined' ? navigator.language : '').slice(0, 2).toLowerCase()
                if (DESK_LOCALES.has(lang)) u.pathname = u.pathname.replace(/^\/en\//, `/${lang}/`)
                if (category) u.searchParams.set('category', category)
            }
            return u.toString()
        } catch {
            return url
        }
    }
    if (email) return `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`
    return null
}

/** Human-readable name of the contact, for sentences ("contact …"). */
export function supportLabel() {
    const { url, email } = getSupport()
    if (email) return email
    if (url) {
        try { return new URL(url).hostname } catch { return url }
    }
    return null
}

/** Where to buy or ask about a licence. Always defined: licences come from the publisher. */
export function salesHref() {
    return getSupport().salesUrl
}
