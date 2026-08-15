// SPDX-License-Identifier: Apache-2.0
/**
 * True only for a direct loopback connection. A request that arrived through
 * a reverse proxy has a proxy-owned socket (which may itself be loopback on
 * a single-box deploy), so any X-Forwarded-For header also disqualifies.
 *
 * The Host header must ALSO name a loopback address: in a DNS-rebinding
 * attack a malicious page resolves its own domain to 127.0.0.1, so the
 * victim's browser reaches this server over a genuine loopback socket —
 * from an origin the attacker scripts (which defeats the CSRF check too:
 * the attacker's origin can run the whole csrf-token dance itself, since
 * the session cookie it receives is keyed to *its* domain). Such requests
 * always carry the attacker's hostname in Host; a strict loopback-name
 * allowlist is the standard local-server defense (same one Vite/webpack
 * dev servers adopted).
 */
export function isLoopbackRequest(req) {
    if (req.headers['x-forwarded-for']) return false;
    const addr = req.socket?.remoteAddress || '';
    if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') return false;
    const host = String(req.headers.host || '').toLowerCase();
    const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost';
}
