// server/__tests__/managed-runtime.test.js
//
// The shutdown token is the auth for POST /api/system/shutdown: written per
// boot, single line, verified constant-time. stop.ps1 and installer.iss read
// the same file, so path and format are a contract.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
    isManaged, shutdownTokenPath, initManagedRuntime,
    verifyShutdownToken, clearManagedRuntime,
} from '../lib/managed-runtime.js';

let dir;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'grm-managed-')); });
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.GRM_MANAGED;
});

describe('managed-runtime', () => {
    it('isManaged only when GRM_MANAGED=1', () => {
        expect(isManaged()).toBe(false);
        process.env.GRM_MANAGED = '1';
        expect(isManaged()).toBe(true);
    });
    it('writes a single-line base64url token and verifies it', () => {
        const token = initManagedRuntime(dir);
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(readFileSync(shutdownTokenPath(dir), 'utf8').trim()).toBe(token);
        expect(verifyShutdownToken(dir, token)).toBe(true);
    });
    it('rejects wrong, empty, and missing tokens without throwing', () => {
        initManagedRuntime(dir);
        expect(verifyShutdownToken(dir, 'x'.repeat(43))).toBe(false);
        expect(verifyShutdownToken(dir, '')).toBe(false);
        expect(verifyShutdownToken(dir, undefined)).toBe(false);
        clearManagedRuntime(dir);
        expect(existsSync(shutdownTokenPath(dir))).toBe(false);
        expect(verifyShutdownToken(dir, 'anything-at-all-of-any-length-1234567890123')).toBe(false);
    });
    it('clearManagedRuntime never throws when file is absent', () => {
        expect(() => clearManagedRuntime(dir)).not.toThrow();
    });
});
