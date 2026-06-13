/**
 * Azure host allowlist — gatekeeper for which Azure DevOps hosts the server
 * is allowed to call. Combines:
 *
 *   1. `ALLOWED_AZURE_HOSTS` env var (baseline, for bootstrap / IaC)
 *   2. `azure_host_allowlist` DB table (live, admin-editable from UI)
 *
 * Reads union the two sources, so admins can extend the env-defined list
 * at runtime without a server restart. Writes go to the DB only.
 *
 * Default (when neither source provides any pattern) allows just the
 * Azure DevOps cloud surfaces.
 */

import db from '../db.js';
import { assertSafeExternalUrl, resolveAndValidateHost } from './url-validator.js';

const DEFAULT_HOSTS = ['dev.azure.com', '*.visualstudio.com'];

// Tiny TTL cache so isAllowedHost() doesn't hit SQLite on every API request.
// The cache is invalidated immediately on any add/remove so admin changes
// take effect on the next request.
const CACHE_TTL_MS = 30_000;
let cache = { at: 0, patterns: null };

function envPatterns() {
  const raw = process.env.ALLOWED_AZURE_HOSTS;
  if (!raw || !raw.trim()) return [];
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function dbPatterns() {
  try {
    return db.prepare('SELECT pattern FROM azure_host_allowlist').all().map(r => r.pattern.toLowerCase());
  } catch {
    // Table may not exist yet during very-first init — fall back to empty.
    return [];
  }
}

function getAllowedPatterns() {
  const now = Date.now();
  if (cache.patterns && now - cache.at < CACHE_TTL_MS) {
    return cache.patterns;
  }
  const env = envPatterns();
  const dbList = dbPatterns();
  // Union, deduped, preserve env order first then DB.
  const merged = Array.from(new Set([...env, ...dbList]));
  // If both sources are empty, fall back to defaults (cloud only).
  const patterns = merged.length > 0 ? merged : DEFAULT_HOSTS.slice();
  cache = { at: now, patterns };
  return patterns;
}

/** Force a cache refresh — call after any DB mutation. */
export function invalidateAllowlistCache() {
  cache = { at: 0, patterns: null };
}

/**
 * Strict shape check: the value must be exactly `hostname[:port]` (or a
 * bracketed IPv6 literal). Rejects userinfo (`user@host`), paths, query
 * strings, whitespace — anything that would make the validated string and
 * the URL actually contacted diverge. Without this, a "host" like
 * `dev.azure.com:0@169.254.169.254` passes the allowlist (port-split keeps
 * `dev.azure.com`) while `https://${host}` routes the request — PAT
 * included — to the part after the `@`.
 */
function hasSafeHostShape(host) {
  if (!host || typeof host !== 'string') return false;
  if (host.startsWith('[')) {
    return /^\[[0-9a-f:]+\](:[0-9]{1,5})?$/i.test(host);
  }
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/i.test(host);
}

/** Strip an optional port suffix and lowercase the hostname. */
function normalizeHost(host) {
  if (!host || typeof host !== 'string') return '';
  if (host.startsWith('[')) {
    const closeIdx = host.indexOf(']');
    if (closeIdx < 0) return '';
    return host.slice(0, closeIdx + 1).toLowerCase();
  }
  return host.split(':')[0].toLowerCase();
}

/**
 * @param {string} host - hostname (port permitted and stripped before comparison)
 * @returns {boolean}
 */
export function isAllowedHost(host) {
  if (!hasSafeHostShape(host)) return false;
  const h = normalizeHost(host);
  if (!h) return false;
  const patterns = getAllowedPatterns();
  for (const pattern of patterns) {
    const p = normalizeHost(pattern);
    if (p === h) return true;
    if (p.startsWith('*.')) {
      const suffix = p.slice(1);
      if (h.endsWith(suffix) && h.length > suffix.length) return true;
    }
  }
  return false;
}

/**
 * Full check: validate that the given Azure host is on the allowlist AND
 * passes the SSRF + DNS-rebinding guard for an example URL on that host.
 *
 * Trust model:
 *   - Cloud hosts (dev.azure.com, *.visualstudio.com) MUST resolve to a
 *     public IP. There's no legitimate reason for them to live behind
 *     RFC1918 — if they do, it's a rebinding attempt.
 *   - On-prem hosts (anything else explicitly allowlisted by an admin)
 *     are EXPECTED to resolve to private addresses (corporate LAN, VPN).
 *     The allowlist IS the trust boundary here — admin intent overrides
 *     the generic SSRF heuristic. We still run the synchronous URL check
 *     to catch scheme/userinfo/localhost-literal attacks.
 */
export async function validateAzureHost(host) {
  if (!isAllowedHost(host)) {
    return { ok: false, code: 'HOST_NOT_ALLOWED', reason: `Host "${host}" is not in ALLOWED_AZURE_HOSTS` };
  }
  const probeHost = normalizeHost(host);
  const probeUrl = `https://${probeHost}/`;
  try {
    assertSafeExternalUrl(probeUrl);
  } catch (e) {
    return { ok: false, code: 'UNSAFE_URL', reason: String(e.message || '').replace(/^ssrf_guard:\s*/, '') };
  }
  // Skip the DNS private-IP check for on-prem hosts — TFS servers are
  // normally deployed inside corporate networks and resolve to RFC1918.
  // Cloud hosts keep the full DNS-rebinding defence.
  const isCloud = probeHost === 'dev.azure.com' || probeHost.endsWith('.visualstudio.com');
  if (!isCloud) {
    return { ok: true };
  }
  const dnsOk = await cachedDnsCheck(probeHost, probeUrl);
  if (!dnsOk) {
    return { ok: false, code: 'PRIVATE_ADDRESS', reason: `Host "${host}" resolves to a non-public address` };
  }
  return { ok: true };
}

// Cloud hosts are validated on every Azure API request — cache the DNS
// verdict briefly so hot paths don't pay a lookup per request. The TTL is
// short enough that a genuine DNS change (or rebinding attempt) is
// re-checked within minutes.
const DNS_OK_TTL_MS = 5 * 60_000;
const dnsCache = new Map(); // probeHost -> { at, ok }

async function cachedDnsCheck(probeHost, probeUrl) {
  const hit = dnsCache.get(probeHost);
  if (hit && Date.now() - hit.at < DNS_OK_TTL_MS) return hit.ok;
  const ok = await resolveAndValidateHost(probeUrl);
  if (dnsCache.size > 100) dnsCache.clear();
  dnsCache.set(probeHost, { at: Date.now(), ok });
  return ok;
}

/**
 * Resolve the effective Azure base URL for a given host. Always returns
 * `https://${host}` — collection-prefix routing (e.g., `tfs/DefaultCollection`)
 * is handled by the parser as part of the `org` string.
 */
export function resolveAzureBaseUrl(host) {
  if (!host) throw new Error('resolveAzureBaseUrl: host required');
  // Defence in depth — callers validate first, but never build a URL from
  // a string that could smuggle userinfo/path past the allowlist.
  if (!hasSafeHostShape(host)) throw new Error('resolveAzureBaseUrl: invalid host');
  return `https://${host}`;
}

/**
 * Encode each segment of a path-like org separately, preserving "/" so
 * values like "tfs/DefaultCollection" survive intact.
 */
export function encodePathSegments(pathlike) {
  if (!pathlike) return '';
  return String(pathlike).split('/').map(encodeURIComponent).join('/');
}

// ── Public introspection helpers (used by the /api/azure/host-allowlist
// ── endpoint and the migration wizard UI to self-diagnose).

/**
 * Returns the merged effective patterns (env + DB), in the order they
 * resolve to.
 */
export function getAllowedHostPatterns() {
  return getAllowedPatterns();
}

/** Patterns coming from the env var only. */
export function getEnvHostPatterns() {
  return envPatterns();
}

/** Detailed view of DB-managed entries (with metadata). */
export function getDbHostEntries() {
  try {
    return db.prepare(`
      SELECT a.pattern, a.added_at, a.notes, u.username AS added_by_username, a.added_by
      FROM azure_host_allowlist a
      LEFT JOIN users u ON u.id = a.added_by
      ORDER BY a.added_at DESC
    `).all();
  } catch {
    return [];
  }
}

/** Whether the default fallback list is in effect (no env, no DB entries). */
export function isUsingDefaultAllowlist() {
  return envPatterns().length === 0 && dbPatterns().length === 0;
}

// ── Mutations (admin-only — gate at the route layer)

const PATTERN_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(:[0-9]{1,5})?$/i;

/**
 * Add a host pattern to the DB allowlist.
 * @param {string} pattern - hostname or `*.domain` wildcard
 * @param {number|null} addedBy - user id
 * @param {string|null} notes
 * @returns {{ added: boolean, pattern: string }}
 */
export function addHostToAllowlist(pattern, addedBy = null, notes = null) {
  const clean = String(pattern || '').trim().toLowerCase();
  if (!clean) throw new Error('Pattern is required');
  if (!PATTERN_RE.test(clean)) {
    throw new Error('Pattern must be a hostname or `*.domain` wildcard (e.g., tfs.empresa.com or *.tfs.empresa.com)');
  }
  const result = db.prepare(`
    INSERT INTO azure_host_allowlist (pattern, added_by, notes)
    VALUES (?, ?, ?)
    ON CONFLICT(pattern) DO NOTHING
  `).run(clean, addedBy, notes);
  invalidateAllowlistCache();
  return { added: result.changes > 0, pattern: clean };
}

/**
 * Remove a host pattern from the DB allowlist.
 * @returns {{ removed: boolean }}
 */
export function removeHostFromAllowlist(pattern) {
  const clean = String(pattern || '').trim().toLowerCase();
  if (!clean) throw new Error('Pattern is required');
  const result = db.prepare('DELETE FROM azure_host_allowlist WHERE pattern = ?').run(clean);
  invalidateAllowlistCache();
  return { removed: result.changes > 0 };
}
