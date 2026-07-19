// @vitest-environment node
/**
 * Tests for scripts/first-run.mjs (W1.3.1) — the first-run bootstrap that
 * generates a boot-viable .env for local/desktop installs (Windows package).
 *
 * Idempotency and "never touch an existing .env" are the load-bearing
 * behaviors here: a packaged app calls this on every launch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { ensureFirstRunEnv } from '../../scripts/first-run.mjs';

let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grm-first-run-test-'));
});

afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

function parseEnv(content) {
    const out = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return out;
}

describe('ensureFirstRunEnv', () => {
    it('generates a .env with all four required secrets + the fixed keys when missing', () => {
        const envPath = path.join(tmpDir, '.env');
        const result = ensureFirstRunEnv({ envPath });

        expect(result.created).toBe(true);
        expect(fs.existsSync(envPath)).toBe(true);

        const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'));
        expect(parsed.NODE_ENV).toBe('production');
        expect(parsed.HOST).toBe('127.0.0.1');
        expect(parsed.PORT).toBe('3001');
        expect(parsed.ALLOW_CONSOLE_EMAIL).toBe('true');

        for (const key of ['SESSION_SECRET', 'WEBHOOK_SECRET', 'CREDENTIAL_ENCRYPTION_KEY', 'API_KEY_SECRET']) {
            expect(parsed[key]).toBeTruthy();
            // 48 random bytes as base64url is >= 32 bytes long as a raw string —
            // every min-length gate in startup-secrets-check.js requires 32.
            expect(parsed[key].length).toBeGreaterThanOrEqual(32);
        }
    });

    it('generates four DISTINCT secrets — a copy-paste bug would collapse them', () => {
        const envPath = path.join(tmpDir, '.env');
        ensureFirstRunEnv({ envPath });
        const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'));
        const values = ['SESSION_SECRET', 'WEBHOOK_SECRET', 'CREDENTIAL_ENCRYPTION_KEY', 'API_KEY_SECRET'].map(k => parsed[k]);
        expect(new Set(values).size).toBe(4);
    });

    it('omits DATA_DIR when not passed as an option', () => {
        const envPath = path.join(tmpDir, '.env');
        ensureFirstRunEnv({ envPath });
        const content = fs.readFileSync(envPath, 'utf8');
        expect(content).not.toMatch(/^DATA_DIR=/m);
    });

    it('writes DATA_DIR only when explicitly passed', () => {
        const envPath = path.join(tmpDir, '.env');
        const dataDir = path.join(tmpDir, 'appdata');
        ensureFirstRunEnv({ envPath, dataDir });
        const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'));
        expect(parsed.DATA_DIR).toBe(dataDir);
    });

    it('is idempotent: a second call against an existing .env touches nothing', () => {
        const envPath = path.join(tmpDir, '.env');
        ensureFirstRunEnv({ envPath });
        const originalContent = fs.readFileSync(envPath, 'utf8');
        const originalMtime = fs.statSync(envPath).mtimeMs;

        const second = ensureFirstRunEnv({ envPath });

        expect(second.created).toBe(false);
        expect(fs.readFileSync(envPath, 'utf8')).toBe(originalContent);
        expect(fs.statSync(envPath).mtimeMs).toBe(originalMtime);
    });

    it('never overwrites a hand-written .env, even one missing every generated key', () => {
        const envPath = path.join(tmpDir, '.env');
        fs.writeFileSync(envPath, 'SESSION_SECRET=my-own-secret-value-thats-already-here\n');
        const result = ensureFirstRunEnv({ envPath });
        expect(result.created).toBe(false);
        expect(fs.readFileSync(envPath, 'utf8')).toBe('SESSION_SECRET=my-own-secret-value-thats-already-here\n');
    });
});
