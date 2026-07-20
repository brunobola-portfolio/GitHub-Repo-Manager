// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureFirstRunEnv } from '../first-run.mjs';

let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grm-first-run-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ensureFirstRunEnv', () => {
    it('creates the parent directory when the target lives in a not-yet-created data dir', () => {
        // The Windows package points the .env INSIDE the data dir, which does
        // not exist yet on the very first launch.
        const envPath = path.join(tmpDir, 'data', '.env');
        const result = ensureFirstRunEnv({ envPath, dataDir: path.join(tmpDir, 'data') });

        expect(result.created).toBe(true);
        const content = fs.readFileSync(envPath, 'utf8');
        expect(content).toContain('SESSION_SECRET=');
        expect(content).toContain('CREDENTIAL_ENCRYPTION_KEY=');
        expect(content).toContain(`DATA_DIR=${path.join(tmpDir, 'data')}`);
        expect(content).toContain('HOST=127.0.0.1');
    });

    it('never touches an existing .env (idempotent across launches)', () => {
        const envPath = path.join(tmpDir, '.env');
        fs.writeFileSync(envPath, 'PORT=9999\n');

        const result = ensureFirstRunEnv({ envPath });
        expect(result.created).toBe(false);
        expect(fs.readFileSync(envPath, 'utf8')).toBe('PORT=9999\n');
    });

    it('generates unique secrets per install (nothing shared or deterministic)', () => {
        const a = path.join(tmpDir, 'a', '.env');
        const b = path.join(tmpDir, 'b', '.env');
        ensureFirstRunEnv({ envPath: a });
        ensureFirstRunEnv({ envPath: b });
        const secretOf = (p) => fs.readFileSync(p, 'utf8').match(/^SESSION_SECRET=(.+)$/m)[1];
        expect(secretOf(a)).not.toBe(secretOf(b));
        expect(secretOf(a).length).toBeGreaterThanOrEqual(32);
    });
});
