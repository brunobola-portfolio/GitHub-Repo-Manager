/**
 * Per-user Azure DevOps credentials vault.
 *
 * Stores PATs encrypted-at-rest, indexed by `(user_id, host[, org])`, so the
 * migration wizard can offer "use saved token" instead of asking the user
 * to paste it on every session. Each row carries a user-chosen label, the
 * detected scopes (when known), a non-secret prefix for visual ID, and a
 * `last_used_at` timestamp for grooming stale entries.
 *
 * Security:
 *   - Token bytes never returned through any list endpoint — only via
 *     `decryptForUse()` which logs a touch into `last_used_at`.
 *   - Encryption uses the project-wide `credential-encryption.js` helper
 *     (AES-256-GCM with PBKDF2-derived key from CREDENTIAL_ENCRYPTION_KEY).
 *   - All mutations are scoped to `req.session.userId` at the route layer.
 *
 * Validation:
 *   - Hostname / port format enforced via the same regex as the allowlist.
 *   - Label trimmed and bounded to 60 chars.
 *   - Scopes optional, free-form (informational only — actual scope
 *     enforcement is done by Azure on the token itself).
 */

import db from '../db.js';
import { encryptCredentials, decryptCredentials } from './credential-encryption.js';

const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(:[0-9]{1,5})?$/i;
const MAX_LABEL = 60;
const MAX_SCOPES = 500;
const MAX_PER_USER = 25;

/** Strip a hostname to a normalised form (lowercase, port-aware). */
function normaliseHost(host) {
  return String(host || '').trim().toLowerCase();
}

/** First/last 4 chars of a PAT, masked between. Non-secret — for visual ID only. */
function buildPrefix(pat) {
  const s = String(pat || '');
  if (s.length <= 12) return '****';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * Shape returned to clients. Never includes the PAT itself.
 */
function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    org: row.org || null,
    scopes: row.scopes ? safeParseScopes(row.scopes) : null,
    prefix: row.pat_prefix || null,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
  };
}

function safeParseScopes(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * List credentials for the current user, optionally filtered by host.
 * @param {number} userId
 * @param {{ host?: string|null }} [filters]
 * @returns {Array<{id, label, host, org, scopes, prefix, createdAt, lastUsedAt}>}
 */
export function listForUser(userId, { host } = {}) {
  if (host) {
    const h = normaliseHost(host);
    return db.prepare(`
      SELECT * FROM user_azure_credentials
      WHERE user_id = ? AND host = ?
      ORDER BY last_used_at DESC NULLS LAST, created_at DESC
    `).all(userId, h).map(toPublic);
  }
  return db.prepare(`
    SELECT * FROM user_azure_credentials
    WHERE user_id = ?
    ORDER BY last_used_at DESC NULLS LAST, created_at DESC
  `).all(userId).map(toPublic);
}

/**
 * Create a new credential for the user.
 *
 * @param {number} userId
 * @param {{ label: string, host: string, org?: string|null, pat: string, scopes?: string[]|null }} payload
 * @returns {{id, label, host, org, scopes, prefix, createdAt, lastUsedAt}}
 */
export function create(userId, payload) {
  const label = String(payload.label || '').trim().slice(0, MAX_LABEL);
  if (!label) throw badRequest('Label is required');
  const host = normaliseHost(payload.host);
  if (!host || !HOST_RE.test(host)) {
    throw badRequest('Host must be a valid hostname (e.g., tfs.empresa.com or dev.azure.com)');
  }
  const org = payload.org ? String(payload.org).trim().slice(0, 200) : null;
  const pat = String(payload.pat || '').trim();
  if (!pat) throw badRequest('PAT is required');
  if (pat.length < 20) throw badRequest('PAT looks too short to be a valid token');

  const scopes = Array.isArray(payload.scopes) && payload.scopes.length > 0
    ? JSON.stringify(payload.scopes.map(String).slice(0, 20)).slice(0, MAX_SCOPES)
    : null;

  // Quota guard — prevents runaway accumulation per user
  const count = db.prepare('SELECT COUNT(*) AS n FROM user_azure_credentials WHERE user_id = ?').get(userId)?.n || 0;
  if (count >= MAX_PER_USER) {
    throw badRequest(`Maximum ${MAX_PER_USER} stored credentials per user reached. Delete an unused one first.`);
  }

  const encrypted = encryptCredentials({ pat });
  const prefix = buildPrefix(pat);

  const info = db.prepare(`
    INSERT INTO user_azure_credentials (user_id, label, host, org, pat_encrypted, pat_prefix, scopes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, label, host, org, encrypted, prefix, scopes);

  const row = db.prepare('SELECT * FROM user_azure_credentials WHERE id = ?').get(info.lastInsertRowid);
  return toPublic(row);
}

/**
 * Update label / org of an existing credential (NOT the PAT itself — rotate
 * by deleting + recreating so the prefix stays in sync with the value).
 *
 * @param {number} userId
 * @param {number} id
 * @param {{ label?: string, org?: string|null, scopes?: string[]|null }} patch
 */
export function update(userId, id, patch) {
  const row = db.prepare('SELECT * FROM user_azure_credentials WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw notFound('Credential not found');
  const label = patch.label !== undefined
    ? String(patch.label || '').trim().slice(0, MAX_LABEL)
    : row.label;
  if (!label) throw badRequest('Label is required');
  const org = patch.org !== undefined
    ? (patch.org ? String(patch.org).trim().slice(0, 200) : null)
    : row.org;
  const scopes = patch.scopes !== undefined
    ? (Array.isArray(patch.scopes) && patch.scopes.length > 0
        ? JSON.stringify(patch.scopes.map(String).slice(0, 20)).slice(0, MAX_SCOPES)
        : null)
    : row.scopes;

  db.prepare(`
    UPDATE user_azure_credentials
    SET label = ?, org = ?, scopes = ?
    WHERE id = ? AND user_id = ?
  `).run(label, org, scopes, id, userId);

  return toPublic(db.prepare('SELECT * FROM user_azure_credentials WHERE id = ?').get(id));
}

/**
 * Remove a stored credential. Returns the deleted row's public shape so
 * the caller can confirm in the audit log / toast.
 */
export function remove(userId, id) {
  const row = db.prepare('SELECT * FROM user_azure_credentials WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw notFound('Credential not found');
  db.prepare('DELETE FROM user_azure_credentials WHERE id = ? AND user_id = ?').run(id, userId);
  return toPublic(row);
}

/**
 * Decrypt a stored PAT for actual use. Touches `last_used_at` so the
 * Settings UI can show grooming hints (e.g., "not used in 6 months").
 *
 * @returns {string|null} the decrypted PAT or null if not found / wrong user
 */
export function decryptForUse(userId, id) {
  const row = db.prepare('SELECT * FROM user_azure_credentials WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return null;
  let pat = null;
  try {
    const decoded = decryptCredentials(row.pat_encrypted);
    pat = decoded?.pat || null;
  } catch {
    return null;
  }
  if (pat) {
    db.prepare('UPDATE user_azure_credentials SET last_used_at = datetime(\'now\') WHERE id = ?').run(id);
  }
  return pat;
}

/** Look up a single credential's public shape. */
export function getPublic(userId, id) {
  const row = db.prepare('SELECT * FROM user_azure_credentials WHERE id = ? AND user_id = ?').get(id, userId);
  return toPublic(row);
}

// ── Errors with HTTP status hints so routes can map them cleanly.
function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}
function notFound(msg) {
  const e = new Error(msg);
  e.status = 404;
  return e;
}
