import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isAllowedHost, resolveAzureBaseUrl, invalidateAllowlistCache,
  addHostToAllowlist, removeHostFromAllowlist,
} from '../lib/azure-host-validator.js';
import db from '../db.js';

describe('azure-host-validator', () => {
  const originalEnv = process.env.ALLOWED_AZURE_HOSTS;

  beforeEach(() => {
    delete process.env.ALLOWED_AZURE_HOSTS;
    // The validator caches the merged (env+DB) patterns for 30s. Reset
    // between tests so env changes take effect immediately. Also clear
    // any DB entries left over from other tests in the wider suite so
    // the default-allowlist tests don't see pollution from a sibling
    // test that inserted patterns.
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS azure_host_allowlist (
            pattern    TEXT PRIMARY KEY,
            added_by   INTEGER,
            added_at   TEXT NOT NULL DEFAULT (datetime('now')),
            notes      TEXT
        )
      `);
      db.prepare('DELETE FROM azure_host_allowlist').run();
    } catch { /* ignore */ }
    invalidateAllowlistCache();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ALLOWED_AZURE_HOSTS;
    else process.env.ALLOWED_AZURE_HOSTS = originalEnv;
    try { db.prepare('DELETE FROM azure_host_allowlist').run(); } catch { /* ignore */ }
    invalidateAllowlistCache();
  });

  describe('isAllowedHost (default allowlist)', () => {
    it('allows dev.azure.com by default', () => {
      expect(isAllowedHost('dev.azure.com')).toBe(true);
    });

    it('allows *.visualstudio.com wildcard by default', () => {
      expect(isAllowedHost('contoso.visualstudio.com')).toBe(true);
    });

    it('rejects on-prem TFS when env not set', () => {
      expect(isAllowedHost('tfs.trigenius.com')).toBe(false);
    });

    it('rejects random hosts', () => {
      expect(isAllowedHost('attacker.com')).toBe(false);
      expect(isAllowedHost('localhost')).toBe(false);
    });

    it('rejects empty/invalid input', () => {
      expect(isAllowedHost('')).toBe(false);
      expect(isAllowedHost(null)).toBe(false);
      expect(isAllowedHost(undefined)).toBe(false);
    });
  });

  describe('isAllowedHost (custom allowlist)', () => {
    it('allows on-prem TFS when env lists it', () => {
      process.env.ALLOWED_AZURE_HOSTS = 'dev.azure.com,tfs.trigenius.com';
      expect(isAllowedHost('tfs.trigenius.com')).toBe(true);
      expect(isAllowedHost('dev.azure.com')).toBe(true);
    });

    it('honours wildcard patterns in env', () => {
      process.env.ALLOWED_AZURE_HOSTS = '*.tfs.trigenius.com';
      expect(isAllowedHost('eu.tfs.trigenius.com')).toBe(true);
      expect(isAllowedHost('tfs.trigenius.com')).toBe(false); // wildcard requires a label
    });

    it('case-insensitive matching', () => {
      process.env.ALLOWED_AZURE_HOSTS = 'TFS.Trigenius.COM';
      expect(isAllowedHost('tfs.trigenius.com')).toBe(true);
      expect(isAllowedHost('TFS.TRIGENIUS.COM')).toBe(true);
    });

    it('rejects hosts not in env after override', () => {
      process.env.ALLOWED_AZURE_HOSTS = 'tfs.trigenius.com';
      // dev.azure.com no longer allowed because env overrides defaults
      expect(isAllowedHost('dev.azure.com')).toBe(false);
    });

    it('trims whitespace and ignores empty entries', () => {
      process.env.ALLOWED_AZURE_HOSTS = ' dev.azure.com , , tfs.trigenius.com ';
      expect(isAllowedHost('dev.azure.com')).toBe(true);
      expect(isAllowedHost('tfs.trigenius.com')).toBe(true);
    });
  });

  describe('isAllowedHost — port handling', () => {
    it('allows host:port when bare host is on the allowlist', () => {
      process.env.ALLOWED_AZURE_HOSTS = 'tfs.trigenius.com';
      expect(isAllowedHost('tfs.trigenius.com:8080')).toBe(true);
      expect(isAllowedHost('tfs.trigenius.com:443')).toBe(true);
    });

    it('rejects host:port when bare host is NOT on the allowlist', () => {
      process.env.ALLOWED_AZURE_HOSTS = 'tfs.trigenius.com';
      expect(isAllowedHost('attacker.com:8080')).toBe(false);
    });

    it('handles wildcard with port', () => {
      process.env.ALLOWED_AZURE_HOSTS = '*.visualstudio.com';
      expect(isAllowedHost('contoso.visualstudio.com:443')).toBe(true);
    });

    it('handles IPv6 bracketed forms', () => {
      process.env.ALLOWED_AZURE_HOSTS = '[2001:db8::1]';
      expect(isAllowedHost('[2001:db8::1]:8080')).toBe(true);
      expect(isAllowedHost('[2001:db8::2]')).toBe(false);
    });
  });

  describe('resolveAzureBaseUrl', () => {
    it('returns naked origin for dev.azure.com', () => {
      expect(resolveAzureBaseUrl('dev.azure.com')).toBe('https://dev.azure.com');
    });

    it('returns naked origin for *.visualstudio.com', () => {
      expect(resolveAzureBaseUrl('contoso.visualstudio.com')).toBe('https://contoso.visualstudio.com');
    });

    it('returns naked origin for on-prem hosts (no auto /tfs prefix)', () => {
      // The /tfs/DefaultCollection prefix is server-specific (some TFS deployments
      // host the collection at the root, others under /tfs/). The parser captures
      // that prefix as part of the `org` field instead of guessing here.
      expect(resolveAzureBaseUrl('tfs.trigenius.com')).toBe('https://tfs.trigenius.com');
    });

    it('preserves port in URL', () => {
      expect(resolveAzureBaseUrl('contoso.visualstudio.com:443')).toBe('https://contoso.visualstudio.com:443');
      expect(resolveAzureBaseUrl('tfs.trigenius.com:8080')).toBe('https://tfs.trigenius.com:8080');
    });

    it('throws when host is missing', () => {
      expect(() => resolveAzureBaseUrl('')).toThrow();
      expect(() => resolveAzureBaseUrl(null)).toThrow();
    });
  });

  describe('DB-managed allowlist', () => {
    beforeEach(() => {
      // Ensure table + clean state for each test. The real init runs at
      // server startup via initDB(); when running tests in isolation we
      // re-assert the schema so the suite works on a fresh checkout.
      db.exec(`
        CREATE TABLE IF NOT EXISTS azure_host_allowlist (
            pattern    TEXT PRIMARY KEY,
            added_by   INTEGER,
            added_at   TEXT NOT NULL DEFAULT (datetime('now')),
            notes      TEXT
        )
      `);
      db.prepare('DELETE FROM azure_host_allowlist').run();
      invalidateAllowlistCache();
    });

    it('addHostToAllowlist persists and takes effect immediately', () => {
      expect(isAllowedHost('tfs.trigenius.com')).toBe(false);
      const out = addHostToAllowlist('tfs.trigenius.com', null, 'test');
      expect(out).toEqual({ added: true, pattern: 'tfs.trigenius.com' });
      expect(isAllowedHost('tfs.trigenius.com')).toBe(true);
    });

    it('addHostToAllowlist is idempotent (second call returns added=false)', () => {
      addHostToAllowlist('tfs.x.com');
      const out = addHostToAllowlist('tfs.x.com');
      expect(out.added).toBe(false);
      expect(out.pattern).toBe('tfs.x.com');
    });

    it('addHostToAllowlist rejects invalid patterns', () => {
      expect(() => addHostToAllowlist('not a hostname!')).toThrow();
      expect(() => addHostToAllowlist('')).toThrow();
      expect(() => addHostToAllowlist('http://x.com')).toThrow(); // schemes not allowed
    });

    it('addHostToAllowlist accepts wildcard patterns', () => {
      const out = addHostToAllowlist('*.tfs.empresa.com');
      expect(out.added).toBe(true);
      expect(isAllowedHost('eu.tfs.empresa.com')).toBe(true);
      expect(isAllowedHost('tfs.empresa.com')).toBe(false); // wildcard needs a label
    });

    it('removeHostFromAllowlist removes and invalidates cache', () => {
      addHostToAllowlist('removable.com');
      expect(isAllowedHost('removable.com')).toBe(true);
      const out = removeHostFromAllowlist('removable.com');
      expect(out.removed).toBe(true);
      expect(isAllowedHost('removable.com')).toBe(false);
    });

    it('removeHostFromAllowlist returns removed=false when pattern not present', () => {
      expect(removeHostFromAllowlist('notthere.com')).toEqual({ removed: false });
    });

    it('DB entries union with env patterns', () => {
      process.env.ALLOWED_AZURE_HOSTS = 'env-host.com';
      invalidateAllowlistCache();
      addHostToAllowlist('db-host.com');
      expect(isAllowedHost('env-host.com')).toBe(true);
      expect(isAllowedHost('db-host.com')).toBe(true);
    });
  });
});
