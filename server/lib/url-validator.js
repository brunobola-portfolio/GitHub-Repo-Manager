/**
 * URL Validator — shared SSRF protection utilities.
 * Used by import-service.js, wiki-service.js, and the /api/import/url route.
 */

import { promises as dns } from 'dns';

/**
 * Strict synchronous SSRF guard for untrusted request URLs.
 *
 * Rejects:
 *   - Non-parseable URLs
 *   - Schemes other than `https:` (or `http:` when allowHttp=true)
 *   - Embedded credentials (user:pass@host)
 *   - `localhost`, `0.0.0.0`, `::1`, and any `*.local` hostname
 *   - IPv4 literals in RFC1918, loopback (127/8), link-local (169.254/16)
 *   - IPv6 loopback and link-local (fe80::/10) literals
 *
 * Throws an Error with message prefixed `ssrf_guard:` when the URL is unsafe.
 *
 * Note: This performs string-level checks only. For defence-in-depth against
 * DNS rebinding, callers should additionally run `resolveAndValidateHost`.
 *
 * @param {string} raw
 * @param {{ allowHttp?: boolean }} [opts]
 * @returns {URL} the parsed URL when safe
 */
export function assertSafeExternalUrl(raw, opts = {}) {
    const { allowHttp = false } = opts;

    if (typeof raw !== 'string' || raw.length === 0) {
        throw new Error('ssrf_guard: url must be a non-empty string');
    }

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error('ssrf_guard: invalid url');
    }

    // Scheme allowlist — default to https only
    const allowedProtocols = allowHttp ? ['https:', 'http:'] : ['https:'];
    if (!allowedProtocols.includes(parsed.protocol)) {
        throw new Error(`ssrf_guard: protocol "${parsed.protocol}" not allowed`);
    }

    // Embedded credentials — phishing / credential smuggling risk
    if (parsed.username || parsed.password) {
        throw new Error('ssrf_guard: embedded credentials not allowed');
    }

    // Normalise hostname. Node keeps the brackets around IPv6 literals
    // (e.g. "[::1]") — strip them so downstream matchers see "::1".
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
        hostname = hostname.slice(1, -1);
    }
    if (!hostname) {
        throw new Error('ssrf_guard: missing hostname');
    }

    // Common localhost aliases and mDNS suffixes
    if (
        hostname === 'localhost' ||
        hostname === '0.0.0.0' ||
        hostname === '::' ||
        hostname === '::1' ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.localhost')
    ) {
        throw new Error(`ssrf_guard: hostname "${hostname}" is not a public address`);
    }

    // IPv4 literal checks
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
        const parts = hostname.split('.').map(Number);
        if (parts.some(p => p > 255)) {
            throw new Error('ssrf_guard: invalid ipv4 literal');
        }
        // 0.0.0.0/8
        if (parts[0] === 0) throw new Error('ssrf_guard: ipv4 0.0.0.0/8 blocked');
        // 127.0.0.0/8 loopback
        if (parts[0] === 127) throw new Error('ssrf_guard: ipv4 loopback blocked');
        // 10.0.0.0/8
        if (parts[0] === 10) throw new Error('ssrf_guard: ipv4 rfc1918 10.0.0.0/8 blocked');
        // 172.16.0.0/12
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
            throw new Error('ssrf_guard: ipv4 rfc1918 172.16.0.0/12 blocked');
        }
        // 192.168.0.0/16
        if (parts[0] === 192 && parts[1] === 168) {
            throw new Error('ssrf_guard: ipv4 rfc1918 192.168.0.0/16 blocked');
        }
        // 169.254.0.0/16 link-local (includes AWS/GCP/Azure IMDS 169.254.169.254)
        if (parts[0] === 169 && parts[1] === 254) {
            throw new Error('ssrf_guard: ipv4 link-local blocked');
        }
    }

    // IPv6 literal checks — URL parses "[::1]" into hostname "::1"
    if (hostname.includes(':')) {
        // Loopback and unspecified
        if (hostname === '::1' || hostname === '::') {
            throw new Error('ssrf_guard: ipv6 loopback/unspecified blocked');
        }
        // Link-local fe80::/10
        if (/^fe[89ab][0-9a-f]?:/i.test(hostname)) {
            throw new Error('ssrf_guard: ipv6 link-local blocked');
        }
        // Unique local fc00::/7
        if (/^f[cd][0-9a-f]{2}:/i.test(hostname)) {
            throw new Error('ssrf_guard: ipv6 unique-local blocked');
        }
        // IPv4-mapped IPv6 — can appear in two forms:
        //   dotted   : ::ffff:127.0.0.1
        //   hex pair : ::ffff:7f00:1   (Node's URL normaliser emits this)
        const mappedDotted = hostname.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
        const mappedHex = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
        let v4Parts = null;
        if (mappedDotted) {
            v4Parts = mappedDotted[1].split('.').map(Number);
        } else if (mappedHex) {
            const hi = parseInt(mappedHex[1], 16);
            const lo = parseInt(mappedHex[2], 16);
            v4Parts = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
        }
        if (v4Parts && v4Parts.length === 4) {
            const [a, b] = v4Parts;
            if (a === 0 || a === 127 || a === 10 ||
                (a === 172 && b >= 16 && b <= 31) ||
                (a === 192 && b === 168) ||
                (a === 169 && b === 254)) {
                throw new Error('ssrf_guard: ipv4-mapped ipv6 points at private range');
            }
        }
    }

    return parsed;
}

/**
 * Check if a URL targets a private/internal network (SSRF protection)
 */
export function isInternalUrl(urlString) {
    try {
        const parsed = new URL(urlString);
        const hostname = parsed.hostname.toLowerCase();
        const protocol = parsed.protocol;

        // Only allow https:// and git:// protocols
        if (protocol !== 'https:' && protocol !== 'git:') {
            return true;
        }

        // Block localhost and loopback
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
            return true;
        }

        // Block private IP ranges (RFC 1918 + link-local + cloud metadata)
        const parts = hostname.split('.').map(Number);
        if (parts.length === 4 && parts.every(p => !isNaN(p))) {
            // 10.0.0.0/8
            if (parts[0] === 10) return true;
            // 172.16.0.0/12
            if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
            // 192.168.0.0/16
            if (parts[0] === 192 && parts[1] === 168) return true;
            // 169.254.0.0/16 (link-local / cloud metadata)
            if (parts[0] === 169 && parts[1] === 254) return true;
            // 0.0.0.0
            if (parts.every(p => p === 0)) return true;
        }

        return false;
    } catch {
        return true; // Invalid URLs are blocked
    }
}

/**
 * Resolve hostname and check if it points to a private/internal IP (DNS rebinding protection)
 */
export async function resolveAndValidateHost(urlString) {
    try {
        const parsed = new URL(urlString);
        const hostname = parsed.hostname;

        // Skip resolution for IP literals (already validated by isInternalUrl)
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
            return true; // Already checked by isInternalUrl
        }

        const { address } = await dns.lookup(hostname);
        const parts = address.split('.').map(Number);

        if (parts.length === 4 && parts.every(p => !isNaN(p))) {
            if (parts[0] === 10) return false;
            if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
            if (parts[0] === 192 && parts[1] === 168) return false;
            if (parts[0] === 169 && parts[1] === 254) return false;
            if (parts[0] === 127) return false;
            if (parts.every(p => p === 0)) return false;
        }

        return true;
    } catch {
        return false; // DNS resolution failed - block the request
    }
}
