// server/__tests__/updater-core.test.js
//
// Pure-core piece of the Windows one-click self-update: marker files, mode
// detection, asset selection and sha256 verification. apply-update.ps1 reads
// and writes the same JSON files from PowerShell, so the shapes here are a
// cross-language contract, not an implementation detail.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import path from 'path';
import {
    updatesDir, updateIntentPath, updateResultPath,
    writeUpdateIntent, writeUpdateResult, readAndClearUpdateResult,
    resolveIntentOnBoot, isInstalledMode, selectUpdateAssets,
    parseSha256Sidecar, verifyFileSha256,
} from '../lib/updater.js';

let dir;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'grm-updater-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('updater — paths', () => {
    it('nests both markers under <dataDir>/updates', () => {
        expect(updatesDir(dir)).toBe(path.join(dir, 'updates'));
        expect(updateIntentPath(dir)).toBe(path.join(dir, 'updates', 'update-intent.json'));
        expect(updateResultPath(dir)).toBe(path.join(dir, 'updates', 'last-update-result.json'));
    });
});

describe('updater — writeUpdateIntent / writeUpdateResult', () => {
    it('creates the updates dir and writes JSON that round-trips', () => {
        writeUpdateIntent(dir, { from: '4.8.2', to: '4.9.0', mode: 'installed', at: new Date().toISOString() });
        expect(existsSync(updateIntentPath(dir))).toBe(true);
        const parsed = JSON.parse(readFileSync(updateIntentPath(dir), 'utf8'));
        expect(parsed).toMatchObject({ from: '4.8.2', to: '4.9.0', mode: 'installed' });

        writeUpdateResult(dir, { status: 'success', from: '4.8.2', to: '4.9.0', at: new Date().toISOString(), logPath: null });
        expect(existsSync(updateResultPath(dir))).toBe(true);
    });
});

describe('updater — readAndClearUpdateResult', () => {
    it('returns null when nothing was written', () => {
        expect(readAndClearUpdateResult(dir)).toBeNull();
    });

    it('returns the result once, then null, deleting the file', () => {
        writeUpdateResult(dir, { status: 'success', from: '4.8.2', to: '4.9.0', at: 'x', logPath: null });
        const first = readAndClearUpdateResult(dir);
        expect(first).toMatchObject({ status: 'success', from: '4.8.2', to: '4.9.0' });
        expect(existsSync(updateResultPath(dir))).toBe(false);
        expect(readAndClearUpdateResult(dir)).toBeNull();
    });

    it('never throws on corrupt JSON — deletes the file and treats it as absent', () => {
        mkdirSync(updatesDir(dir), { recursive: true });
        writeFileSync(updateResultPath(dir), '{not json', 'utf8');
        expect(() => readAndClearUpdateResult(dir)).not.toThrow();
        expect(readAndClearUpdateResult(dir)).toBeNull();
        expect(existsSync(updateResultPath(dir))).toBe(false);
    });
});

describe('updater — resolveIntentOnBoot', () => {
    it("returns 'none' when there is no intent file", () => {
        expect(resolveIntentOnBoot(dir, '4.9.0')).toBe('none');
    });

    it('matching version -> writes a success result and clears the intent', () => {
        writeUpdateIntent(dir, { from: '4.8.2', to: '4.9.0', mode: 'installed', at: new Date().toISOString() });
        const outcome = resolveIntentOnBoot(dir, '4.9.0');
        expect(outcome).toBe('success');
        expect(existsSync(updateIntentPath(dir))).toBe(false);
        const result = JSON.parse(readFileSync(updateResultPath(dir), 'utf8'));
        expect(result).toMatchObject({ status: 'success', from: '4.8.2', to: '4.9.0' });
    });

    it('mismatched version + stale intent -> writes a failed result and clears the intent', () => {
        const oldAt = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago
        writeUpdateIntent(dir, { from: '4.8.2', to: '4.9.0', mode: 'installed', at: oldAt });
        const outcome = resolveIntentOnBoot(dir, '4.8.2', 10 * 60 * 1000);
        expect(outcome).toBe('failed');
        expect(existsSync(updateIntentPath(dir))).toBe(false);
        const result = JSON.parse(readFileSync(updateResultPath(dir), 'utf8'));
        expect(result).toMatchObject({ status: 'failed', from: '4.8.2', to: '4.9.0' });
    });

    it('mismatched version + young intent -> pending, intent left in place, no result written', () => {
        const recentAt = new Date(Date.now() - 30 * 1000).toISOString(); // 30s ago
        writeUpdateIntent(dir, { from: '4.8.2', to: '4.9.0', mode: 'installed', at: recentAt });
        const outcome = resolveIntentOnBoot(dir, '4.8.2', 10 * 60 * 1000);
        expect(outcome).toBe('pending');
        expect(existsSync(updateIntentPath(dir))).toBe(true);
        expect(existsSync(updateResultPath(dir))).toBe(false);
    });

    it('never throws on corrupt intent JSON — deletes it and returns none', () => {
        mkdirSync(updatesDir(dir), { recursive: true });
        writeFileSync(updateIntentPath(dir), '{not json', 'utf8');
        expect(() => resolveIntentOnBoot(dir, '4.9.0')).not.toThrow();
        expect(resolveIntentOnBoot(dir, '4.9.0')).toBe('none');
        expect(existsSync(updateIntentPath(dir))).toBe(false);
    });
});

describe('updater — isInstalledMode', () => {
    it('true only when install-config.txt exists in the package root', () => {
        expect(isInstalledMode(dir)).toBe(false);
        writeFileSync(path.join(dir, 'install-config.txt'), 'InstallMode=CurrentUser\n', 'utf8');
        expect(isInstalledMode(dir)).toBe(true);
    });
});

describe('updater — selectUpdateAssets', () => {
    const setup = { name: 'grm-setup.exe', url: 'https://example/grm-setup.exe', size: 100 };
    const setupSha = { name: 'grm-setup.exe.sha256', url: 'https://example/grm-setup.exe.sha256', size: 65 };
    const zip = { name: 'grm-win-x64.zip', url: 'https://example/grm-win-x64.zip', size: 200 };
    const zipSha = { name: 'grm-win-x64.zip.sha256', url: 'https://example/grm-win-x64.zip.sha256', size: 65 };

    it('installed mode picks the setup pair', () => {
        const result = selectUpdateAssets({ assets: { setup, setupSha256: setupSha, zip, zipSha256: zipSha } }, true);
        expect(result).toEqual({ asset: setup, sha: setupSha });
    });

    it('portable mode picks the zip pair', () => {
        const result = selectUpdateAssets({ assets: { setup, setupSha256: setupSha, zip, zipSha256: zipSha } }, false);
        expect(result).toEqual({ asset: zip, sha: zipSha });
    });

    it('null when the whole assets block is missing', () => {
        expect(selectUpdateAssets({ assets: null }, true)).toBeNull();
        expect(selectUpdateAssets({}, true)).toBeNull();
    });

    it('null when either half of the selected pair is missing', () => {
        expect(selectUpdateAssets({ assets: { setup, setupSha256: null, zip, zipSha256: zipSha } }, true)).toBeNull();
        expect(selectUpdateAssets({ assets: { setup: null, setupSha256: setupSha, zip, zipSha256: zipSha } }, true)).toBeNull();
        expect(selectUpdateAssets({ assets: { setup, setupSha256: setupSha, zip, zipSha256: null } }, false)).toBeNull();
        expect(selectUpdateAssets({ assets: { setup, setupSha256: setupSha, zip: null, zipSha256: zipSha } }, false)).toBeNull();
    });
});

describe('updater — parseSha256Sidecar', () => {
    const hex = 'a'.repeat(64);

    it('parses "<hex> *file.zip" (binary-mode sha256sum format)', () => {
        expect(parseSha256Sidecar(`${hex} *file.zip`)).toBe(hex);
    });

    it('parses "<hex>  file" (text-mode sha256sum format)', () => {
        expect(parseSha256Sidecar(`${hex}  file`)).toBe(hex);
    });

    it('lowercases an uppercase digest', () => {
        expect(parseSha256Sidecar(`${hex.toUpperCase()}  file`)).toBe(hex);
    });

    it('returns null for garbage / short hex / non-string input', () => {
        expect(parseSha256Sidecar('not a hash')).toBeNull();
        expect(parseSha256Sidecar('a'.repeat(63))).toBeNull();
        expect(parseSha256Sidecar('')).toBeNull();
        expect(parseSha256Sidecar(null)).toBeNull();
        expect(parseSha256Sidecar(undefined)).toBeNull();
    });
});

describe('updater — verifyFileSha256', () => {
    it('true for the correct digest, false for a wrong one, computed against a real fixture', async () => {
        const filePath = path.join(dir, 'fixture.bin');
        const content = Buffer.from('github repo manager self-update fixture content\n'.repeat(50));
        writeFileSync(filePath, content);
        const expected = createHash('sha256').update(content).digest('hex');

        expect(await verifyFileSha256(filePath, expected)).toBe(true);
        expect(await verifyFileSha256(filePath, expected.toUpperCase())).toBe(true);
        expect(await verifyFileSha256(filePath, 'b'.repeat(64))).toBe(false);
    });

    it('false (never throws) for a missing file or missing expected hash', async () => {
        const missing = path.join(dir, 'does-not-exist.bin');
        await expect(verifyFileSha256(missing, 'a'.repeat(64))).resolves.toBe(false);
        writeFileSync(path.join(dir, 'x.bin'), 'x');
        await expect(verifyFileSha256(path.join(dir, 'x.bin'), '')).resolves.toBe(false);
        await expect(verifyFileSha256(path.join(dir, 'x.bin'), null)).resolves.toBe(false);
    });
});
