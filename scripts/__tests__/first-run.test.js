// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureFirstRunEnv, persistPort } from '../first-run.mjs';

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

describe('persistPort', () => {
    it('rewrites PORT in place and leaves every other line untouched', async () => {
        // The busy-port fallback in packaging/windows/start.ps1 calls this
        // against the SAME .env that holds CREDENTIAL_ENCRYPTION_KEY, so the
        // whole point is that nothing but the PORT line moves.
        const envPath = path.join(tmpDir, '.env');
        ensureFirstRunEnv({ envPath });
        const before = fs.readFileSync(envPath, 'utf8');

        await persistPort({ envPath, port: 3007 });

        const after = fs.readFileSync(envPath, 'utf8');
        expect(after).toContain('PORT=3007');
        expect(after).not.toContain('PORT=3001');
        expect(after.replace(/^PORT=.*$/m, '')).toBe(before.replace(/^PORT=.*$/m, ''));
    });

    it('makes the drifted port survive the next launch (start.ps1 re-reads PORT from .env)', async () => {
        const envPath = path.join(tmpDir, '.env');
        ensureFirstRunEnv({ envPath });
        await persistPort({ envPath, port: 3009 });
        // Same regex start.ps1's Get-ConfiguredPort uses.
        const match = fs.readFileSync(envPath, 'utf8').match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
        expect(match && match[1]).toBe('3009');
    });

    it('adds PORT to a hand-written .env that never had one', async () => {
        const envPath = path.join(tmpDir, '.env');
        fs.writeFileSync(envPath, 'SESSION_SECRET=mine\n');
        await persistPort({ envPath, port: 4100 });
        const content = fs.readFileSync(envPath, 'utf8');
        expect(content).toContain('SESSION_SECRET=mine');
        expect(content).toMatch(/^PORT=4100$/m);
    });

    it.each([0, -1, 70000, 65536, 'abc', '3001 && calc', '', null])(
        'refuses to persist %p rather than writing junk into .env',
        async (bad) => {
            const envPath = path.join(tmpDir, '.env');
            ensureFirstRunEnv({ envPath });
            const before = fs.readFileSync(envPath, 'utf8');
            await expect(persistPort({ envPath, port: bad })).rejects.toThrow(/invalid PORT/);
            expect(fs.readFileSync(envPath, 'utf8')).toBe(before);
        },
    );
});
