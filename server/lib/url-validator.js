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
 * Check if a URL targets a private/internal network (SSRF protection).
 *
 * Returns true (block) for non-https/git schemes, embedded credentials,
 * localhost/.local aliases, and any IP literal in a private / loopback /
 * link-local range. Unlike the previous hand-rolled checks (which caught only
 * the exact 127.0.0.1), IP literals are delegated to isPrivateAddress so the
 * full 127/8, RFC1918, link-local, IPv6 loopback/link-local/unique-local and
 * IPv4-mapped-IPv6 ranges are covered — matching assertSafeExternalUrl.
 *
 * `git://` stays allowed because import-service supports git clone URLs; the
 * scheme allowlist is the one intentional difference from assertSafeExternalUrl.
 * Callers run resolveAndValidateHost() afterwards for DNS-rebinding protection.
 */
export function isInternalUrl(urlString) {
    let parsed;
    try {
        parsed = new URL(urlString);
    } catch {
        return true; // Invalid URLs are blocked
    }

    // Scheme allowlist: public HTTPS and git:// only.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'git:') {
        return true;
    }

    // Embedded credentials — credential-smuggling / phishing risk.
    if (parsed.username || parsed.password) {
        return true;
    }

    // Normalise hostname; Node keeps the brackets around IPv6 literals.
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
        hostname = hostname.slice(1, -1);
    }
    if (!hostname) return true;

    // Localhost aliases and mDNS suffixes.
    if (
        hostname === 'localhost' ||
        hostname === '0.0.0.0' ||
        hostname === '::' ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.localhost')
    ) {
        return true;
    }

    // IP literal? Delegate to the comprehensive private-range matcher.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
        return isPrivateAddress(hostname);
    }

    // A real hostname — string checks can't see where it resolves.
    return false;
}

/**
 * SSRF guard for a user-supplied BYOK AI endpoint URL.
 *
 * Self-hosted "local" providers (Ollama, LM Studio, vLLM) legitimately point at
 * loopback / RFC1918 hosts — but allowing arbitrary private targets turns the
 * server into an SSRF proxy to cloud metadata (169.254.169.254) and internal
 * services. So private ranges are blocked by default and only permitted when the
 * operator EXPLICITLY opts in via ALLOW_LOCAL_AI_ENDPOINTS=true AND the provider
 * is 'local'. Everything else goes through the strict https-only public guard.
 *
 * Throws (message prefixed `ssrf_guard:`) when the endpoint is not allowed;
 * returns the parsed URL when safe.
 *
 * @param {string} raw
 * @param {{ provider?: string }} [opts]
 * @returns {URL}
 */
export function assertSafeAIEndpoint(raw, { provider } = {}) {
    const allowLocal = provider === 'local' && process.env.ALLOW_LOCAL_AI_ENDPOINTS === 'true';
    if (allowLocal) {
        // Opt-in local endpoint: still require a parseable http(s) URL with no
        // embedded credentials, but skip the private-range block.
        if (typeof raw !== 'string' || raw.length === 0) {
            throw new Error('ssrf_guard: url must be a non-empty string');
        }
        let parsed;
        try { parsed = new URL(raw); } catch { throw new Error('ssrf_guard: invalid url'); }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            throw new Error(`ssrf_guard: protocol "${parsed.protocol}" not allowed`);
        }
        if (parsed.username || parsed.password) {
            throw new Error('ssrf_guard: embedded credentials not allowed');
        }
        return parsed;
    }
    // Public BYOK endpoint (openai/openrouter compatible, etc.) — https only,
    // no private/loopback/link-local hosts.
    return assertSafeExternalUrl(raw, { allowHttp: false });
}

function isPrivateIpv4Parts(parts) {
    const [a, b] = parts;
    return a === 0 || a === 127 || a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254);
}

/**
 * True when a resolved IP address (v4 or v6) lands in a private, loopback,
 * link-local or otherwise non-public range. Unparseable input is treated
 * as private (block).
 */
export function isPrivateAddress(address) {
    if (!address || typeof address !== 'string') return true;
    const ip = address.toLowerCase();

    if (ip.includes(':')) {
        // IPv6
        if (ip === '::' || ip === '::1') return true;
        if (/^fe[89ab][0-9a-f]:/i.test(ip)) return true;   // link-local fe80::/10
        if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;   // unique-local fc00::/7
        // IPv4-mapped IPv6 — dotted (::ffff:10.0.0.1) or hex (::ffff:a00:1)
        const mappedDotted = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
        if (mappedDotted) {
            return isPrivateIpv4Parts(mappedDotted[1].split('.').map(Number));
        }
        const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
        if (mappedHex) {
            const hi = parseInt(mappedHex[1], 16);
            const lo = parseInt(mappedHex[2], 16);
            return isPrivateIpv4Parts([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
        }
        return false;
    }

    const parts = ip.split('.').map(Number);
    if (parts.length === 4 && parts.every(p => Number.isInteger(p) && p >= 0 && p <= 255)) {
        return isPrivateIpv4Parts(parts);
    }
    // Not a recognisable address — block.
    return true;
}

/**
 * Resolve hostname and check if it points to a private/internal IP (DNS
 * rebinding protection). Validates EVERY resolved address — A and AAAA —
 * because an attacker controlling DNS can return a public A record next
 * to a private AAAA record and let the HTTP client pick the private one.
 */
export async function resolveAndValidateHost(urlString) {
    try {
        const parsed = new URL(urlString);
        const hostname = parsed.hostname;

        // Skip resolution for IP literals (already validated by the
        // synchronous guards in assertSafeExternalUrl / isInternalUrl)
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
            return true;
        }

        const results = await dns.lookup(hostname, { all: true });
        if (!Array.isArray(results) || results.length === 0) return false;
        return results.every((r) => !isPrivateAddress(r.address));
    } catch {
        return false; // DNS resolution failed - block the request
    }
}
