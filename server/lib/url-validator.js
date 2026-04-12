/**
 * URL Validator — shared SSRF protection utilities.
 * Used by import-service.js and wiki-service.js.
 */

import { promises as dns } from 'dns';

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
