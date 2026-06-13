/**
 * Shared Azure PAT resolution — the single source of truth for the
 * priority order, used by both the Azure API routes and the migration
 * plan execute/resume/retry routes:
 *
 *   1. `savedCredentialId` in body → decrypt from the per-user vault.
 *      A failed lookup is an EXPLICIT error — we deliberately do NOT
 *      fall back to the env PAT in that case: it's almost always a
 *      cloud token that would 401 against the on-prem host the saved
 *      credential targeted, producing a confusing downstream error.
 *   2. Pasted PAT in the body (`patField`, defaults to `pat`).
 *   3. Encrypted session OAuth token (`req.session.azureToken`).
 *   4. `AZURE_PAT` env fallback.
 *
 * Returns `{ pat, source: 'vault'|'pasted'|'session'|'env'|null, error }`.
 * Never throws.
 */

import * as credsVault from './azure-credentials-manager.js';
import { decryptCredentials } from './credential-encryption.js';

export function resolveAzurePat(req, { patField = 'pat' } = {}) {
  const body = req.body || {};

  if (body.savedCredentialId) {
    const id = Number(body.savedCredentialId);
    if (!Number.isFinite(id)) {
      return { pat: null, source: null, error: 'Invalid savedCredentialId' };
    }
    let pat = null;
    try {
      pat = credsVault.decryptForUse(req.session.userId, id);
    } catch { /* treated as null below */ }
    if (!pat) {
      return {
        pat: null,
        source: null,
        error: 'Saved credential not found or could not be decrypted. It may have been deleted, or the encryption key changed. Open Settings → Azure Credentials to revoke and recreate.',
      };
    }
    return { pat, source: 'vault', error: null };
  }

  const pasted = body[patField];
  if (typeof pasted === 'string' && pasted.trim()) {
    return { pat: pasted, source: 'pasted', error: null };
  }

  if (req.session?.azureToken) {
    try {
      const { token } = decryptCredentials(req.session.azureToken);
      if (token) return { pat: token, source: 'session', error: null };
    } catch { /* fall through to env */ }
  }

  if (process.env.AZURE_PAT) {
    return { pat: process.env.AZURE_PAT, source: 'env', error: null };
  }
  return { pat: null, source: null, error: 'No PAT provided and no server PAT configured' };
}
