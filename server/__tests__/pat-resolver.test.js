// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Shared Azure PAT resolver — priority-order tests.
 *
 * resolveAzurePat(req, { patField }) is the single source of truth for how
 * an Azure PAT is chosen across the Azure API routes and the migration
 * execute/resume/retry routes. The priority is:
 *
 *   1. savedCredentialId (vault)  — EXPLICIT error on failure; NEVER falls
 *                                   back to the env PAT.
 *   2. pasted PAT in the body (patField).
 *   3. encrypted session OAuth token (req.session.azureToken).
 *   4. AZURE_PAT env fallback.
 *
 * Both collaborators are mocked so these tests exercise only the resolver's
 * branching and return shapes:
 *   - ../lib/azure-credentials-manager.js  → decryptForUse spy
 *   - ../lib/credential-encryption.js      → decryptCredentials spy
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────
// pat-resolver imports the vault as a namespace (`import * as credsVault`)
// and calls credsVault.decryptForUse(userId, id).
const decryptForUse = vi.fn();
vi.mock('../lib/azure-credentials-manager.js', () => ({
  decryptForUse: (...args) => decryptForUse(...args),
}));

// pat-resolver imports the named decryptCredentials for the session branch.
const decryptCredentials = vi.fn();
vi.mock('../lib/credential-encryption.js', () => ({
  decryptCredentials: (...args) => decryptCredentials(...args),
}));

// Import AFTER mocks are registered.
const { resolveAzurePat } = await import('../lib/pat-resolver.js');

/** Build a minimal Express-like request literal. */
function makeReq({ body = {}, session = {} } = {}) {
  return { body, session };
}

const ORIGINAL_AZURE_PAT = process.env.AZURE_PAT;

beforeEach(() => {
  decryptForUse.mockReset();
  decryptCredentials.mockReset();
  delete process.env.AZURE_PAT;
});

afterEach(() => {
  if (ORIGINAL_AZURE_PAT === undefined) delete process.env.AZURE_PAT;
  else process.env.AZURE_PAT = ORIGINAL_AZURE_PAT;
});

// ===========================================================================
// 1. savedCredentialId → vault success
// ===========================================================================
describe('resolveAzurePat — savedCredentialId (vault)', () => {
  it('decrypts from the vault and reports source "vault"', () => {
    decryptForUse.mockReturnValue('vault-pat-123');
    const req = makeReq({ body: { savedCredentialId: 42 }, session: { userId: 7 } });

    const result = resolveAzurePat(req, { patField: 'pat' });

    expect(result).toEqual({ pat: 'vault-pat-123', source: 'vault', error: null });
    expect(decryptForUse).toHaveBeenCalledTimes(1);
    expect(decryptForUse).toHaveBeenCalledWith(7, 42);
  });

  it('accepts a numeric-string savedCredentialId', () => {
    decryptForUse.mockReturnValue('vault-pat-from-string');
    const req = makeReq({ body: { savedCredentialId: '99' }, session: { userId: 3 } });

    const result = resolveAzurePat(req, {});

    expect(result).toEqual({ pat: 'vault-pat-from-string', source: 'vault', error: null });
    expect(decryptForUse).toHaveBeenCalledWith(3, 99);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. vault failure (throws OR null) → explicit error, NO env fallback
  // ─────────────────────────────────────────────────────────────────────────
  it('returns an explicit error (no env fallback) when decryptForUse returns null', () => {
    // env PAT IS set to prove we deliberately do not fall back to it.
    process.env.AZURE_PAT = 'env-should-not-be-used';
    decryptForUse.mockReturnValue(null);
    const req = makeReq({ body: { savedCredentialId: 5 }, session: { userId: 1 } });

    const result = resolveAzurePat(req, {});

    expect(result.pat).toBeNull();
    expect(result.source).toBeNull();
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
    expect(result.error).toMatch(/could not be decrypted|not found/i);
    // Must NOT have leaked the env PAT.
    expect(result.pat).not.toBe('env-should-not-be-used');
  });

  it('returns an explicit error (no env fallback) when decryptForUse throws', () => {
    process.env.AZURE_PAT = 'env-should-not-be-used';
    decryptForUse.mockImplementation(() => {
      throw new Error('vault boom');
    });
    const req = makeReq({ body: { savedCredentialId: 8 }, session: { userId: 2 } });

    const result = resolveAzurePat(req, {});

    expect(result.pat).toBeNull();
    expect(result.source).toBeNull();
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
    expect(result.error).toMatch(/could not be decrypted|not found/i);
    expect(result.pat).not.toBe('env-should-not-be-used');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. non-numeric / NaN savedCredentialId → Invalid savedCredentialId
  // ─────────────────────────────────────────────────────────────────────────
  it('rejects a non-numeric savedCredentialId with "Invalid savedCredentialId"', () => {
    const req = makeReq({ body: { savedCredentialId: 'abc' }, session: { userId: 1 } });

    const result = resolveAzurePat(req, {});

    expect(result).toEqual({ pat: null, source: null, error: 'Invalid savedCredentialId' });
    // Never touched the vault for an unparseable id.
    expect(decryptForUse).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. pasted PAT — both default and custom patField
// ===========================================================================
describe('resolveAzurePat — pasted PAT', () => {
  it('uses the pasted value under the default patField "pat"', () => {
    const req = makeReq({ body: { pat: 'pasted-default' } });

    const result = resolveAzurePat(req, { patField: 'pat' });

    expect(result).toEqual({ pat: 'pasted-default', source: 'pasted', error: null });
    expect(decryptForUse).not.toHaveBeenCalled();
  });

  it('uses the pasted value under a custom patField "azurePat"', () => {
    const req = makeReq({ body: { azurePat: 'pasted-azure' } });

    const result = resolveAzurePat(req, { patField: 'azurePat' });

    expect(result).toEqual({ pat: 'pasted-azure', source: 'pasted', error: null });
  });

  it('ignores a whitespace-only pasted value and falls through', () => {
    process.env.AZURE_PAT = 'env-pat';
    const req = makeReq({ body: { pat: '   ' } });

    const result = resolveAzurePat(req, { patField: 'pat' });

    // Whitespace-only is not a usable PAT — falls through to env here.
    expect(result.source).toBe('env');
    expect(result.pat).toBe('env-pat');
  });
});

// ===========================================================================
// 5. session OAuth token → decryptCredentials → source "session"
// ===========================================================================
describe('resolveAzurePat — encrypted session token', () => {
  it('decrypts req.session.azureToken via decryptCredentials', () => {
    decryptCredentials.mockReturnValue({ token: 'sess-pat' });
    const req = makeReq({ body: {}, session: { azureToken: 'encrypted-blob' } });

    const result = resolveAzurePat(req, {});

    expect(result).toEqual({ pat: 'sess-pat', source: 'session', error: null });
    expect(decryptCredentials).toHaveBeenCalledWith('encrypted-blob');
  });

  it('falls through to env when the session token decrypt yields no token', () => {
    process.env.AZURE_PAT = 'env-after-session';
    decryptCredentials.mockReturnValue({ token: undefined });
    const req = makeReq({ body: {}, session: { azureToken: 'encrypted-blob' } });

    const result = resolveAzurePat(req, {});

    expect(result.source).toBe('env');
    expect(result.pat).toBe('env-after-session');
  });

  it('falls through to env when decryptCredentials throws', () => {
    process.env.AZURE_PAT = 'env-after-throw';
    decryptCredentials.mockImplementation(() => {
      throw new Error('bad blob');
    });
    const req = makeReq({ body: {}, session: { azureToken: 'corrupt' } });

    const result = resolveAzurePat(req, {});

    expect(result.source).toBe('env');
    expect(result.pat).toBe('env-after-throw');
  });
});

// ===========================================================================
// 6. AZURE_PAT env fallback
// ===========================================================================
describe('resolveAzurePat — env fallback', () => {
  it('uses process.env.AZURE_PAT when nothing else is present', () => {
    process.env.AZURE_PAT = 'env-pat-value';
    const req = makeReq({ body: {}, session: {} });

    const result = resolveAzurePat(req, {});

    expect(result).toEqual({ pat: 'env-pat-value', source: 'env', error: null });
  });
});

// ===========================================================================
// 7. nothing at all → null with a non-empty error
// ===========================================================================
describe('resolveAzurePat — nothing available', () => {
  it('returns null pat/source with a non-empty error', () => {
    const req = makeReq({ body: {}, session: {} });

    const result = resolveAzurePat(req, {});

    expect(result.pat).toBeNull();
    expect(result.source).toBeNull();
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });
});
