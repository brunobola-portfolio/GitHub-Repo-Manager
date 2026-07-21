// server/__tests__/updater-orchestration.test.js
//
// Orchestration layer of the Windows one-click self-update: startUpdate's
// download -> verify -> snapshot -> handoff -> shutdown sequence. Every
// outside-world effect (release-check fetch, asset download, spawn, final
// shutdown, DB backup) is injected, so this exercises the real control flow
// against a real sha256 fixture and a real (small) release-payload shape —
// no network, no installer, no process exit.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import path from 'path';
import {
    startUpdate, getUpdateProgress, resetUpdaterForTests, UpdateError,
    updatesDir, updateIntentPath,
} from '../lib/updater.js';
import { resetUpdateCheckCacheForTests } from '../lib/update-check.js';

const CURRENT_VERSION = '4.8.2';
const LATEST_VERSION = '4.9.0';
const RELEASES_URL = 'https://api.github.com/repos/brunobola-portfolio/GitHub-Repo-Manager/releases/latest';

const ASSET_CONTENT = Buffer.from('grm self-update fixture payload\n'.repeat(200));
const ASSET_HEX = createHash('sha256').update(ASSET_CONTENT).digest('hex');
const CORRUPT_HEX = 'b'.repeat(64);

const SETUP_URL = 'https://dl.test/grm-setup.exe';
const SETUP_SHA_URL = 'https://dl.test/grm-setup.exe.sha256';
const ZIP_URL = 'https://dl.test/grm-win-x64.zip';
const ZIP_SHA_URL = 'https://dl.test/grm-win-x64.zip.sha256';

function releaseJson({ withAssets = true } = {}) {
    return {
        tag_name: `v${LATEST_VERSION}`,
        html_url: 'https://github.com/example/releases/tag/v4.9.0',
        assets: withAssets
            ? [
                { name: 'grm-setup.exe', browser_download_url: SETUP_URL, size: ASSET_CONTENT.length },
                { name: 'grm-setup.exe.sha256', browser_download_url: SETUP_SHA_URL, size: 65 },
                { name: 'grm-win-x64.zip', browser_download_url: ZIP_URL, size: ASSET_CONTENT.length },
                { name: 'grm-win-x64.zip.sha256', browser_download_url: ZIP_SHA_URL, size: 65 },
            ]
            : [],
    };
}

function jsonResponse(body) {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function assetResponse(hex = ASSET_HEX) {
    void hex;
    return new Response(ASSET_CONTENT, { status: 200, headers: { 'content-length': String(ASSET_CONTENT.length) } });
}

function shaResponse(hex) {
    return new Response(`${hex} *grm-asset\n`, { status: 200 });
}

/**
 * Builds a fetchImpl that resolves the releases API, the setup pair, and
 * the zip pair from fixed URLs — matching how checkForUpdate/startUpdate
 * actually call it (one shared fetchImpl for the check and both downloads).
 */
function makeFetch({ assetHex = ASSET_HEX, withAssets = true } = {}) {
    return vi.fn(async (url) => {
        if (url === RELEASES_URL) return jsonResponse(releaseJson({ withAssets }));
        if (url === SETUP_URL || url === ZIP_URL) return assetResponse();
        if (url === SETUP_SHA_URL || url === ZIP_SHA_URL) return shaResponse(assetHex);
        throw new Error(`unexpected fetch: ${url}`);
    });
}

function recordingSpawn() {
    const calls = [];
    const spawnImpl = vi.fn((cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return { unref: vi.fn() };
    });
    return { spawnImpl, calls };
}

let dataDir;
let packageRoot;

beforeEach(() => {
    resetUpdaterForTests();
    resetUpdateCheckCacheForTests();
    dataDir = mkdtempSync(path.join(tmpdir(), 'grm-update-data-'));
    packageRoot = mkdtempSync(path.join(tmpdir(), 'grm-update-pkg-'));
});

afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(packageRoot, { recursive: true, force: true });
});

describe('startUpdate — installed mode (setup.exe handoff)', () => {
    it('downloads, verifies, snapshots, writes intent, spawns the installer, and requests shutdown', async () => {
        writeFileSync(path.join(packageRoot, 'install-config.txt'), 'InstallMode=CurrentUser\n', 'utf8');
        const fetchImpl = makeFetch();
        const { spawnImpl, calls } = recordingSpawn();
        const requestShutdownImpl = vi.fn();
        const runDbBackupOnceImpl = vi.fn().mockResolvedValue({ skipped: false, destPath: null });

        await startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl, spawnImpl, requestShutdownImpl, runDbBackupOnceImpl });

        expect(getUpdateProgress().phase).toBe('restarting');
        expect(getUpdateProgress().target).toEqual({ from: CURRENT_VERSION, to: LATEST_VERSION, mode: 'installed' });

        expect(existsSync(path.join(updatesDir(dataDir), 'grm-setup.exe'))).toBe(true);
        expect(existsSync(updateIntentPath(dataDir))).toBe(true);
        const intent = JSON.parse(readFileSync(updateIntentPath(dataDir), 'utf8'));
        expect(intent).toMatchObject({ from: CURRENT_VERSION, to: LATEST_VERSION, mode: 'installed' });

        expect(calls).toHaveLength(1);
        const [call] = calls;
        expect(call.cmd).toBe(path.join(updatesDir(dataDir), 'grm-setup.exe'));
        expect(call.args).toEqual([
            '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-',
            '/LOG=' + path.join(updatesDir(dataDir), `update-${LATEST_VERSION}.log`),
            '/UPDATED=1',
        ]);
        expect(call.opts).toMatchObject({ detached: true, stdio: 'ignore' });

        // requestShutdown is deferred (setTimeout) so the 202 response can
        // reach the caller before teardown begins — wait it out.
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(requestShutdownImpl).toHaveBeenCalledTimes(1);
        expect(requestShutdownImpl).toHaveBeenCalledWith('update');
    });

    it('copies the DB backup destPath into a pre-update snapshot when one is produced', async () => {
        writeFileSync(path.join(packageRoot, 'install-config.txt'), 'InstallMode=CurrentUser\n', 'utf8');
        const fetchImpl = makeFetch();
        const { spawnImpl } = recordingSpawn();
        const requestShutdownImpl = vi.fn();

        const fakeBackupPath = path.join(dataDir, 'fake-backup.db');
        writeFileSync(fakeBackupPath, 'sqlite-bytes', 'utf8');
        const runDbBackupOnceImpl = vi.fn().mockResolvedValue({ skipped: false, destPath: fakeBackupPath });

        await startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl, spawnImpl, requestShutdownImpl, runDbBackupOnceImpl });

        const snapshotPath = path.join(updatesDir(dataDir), `pre-update-${CURRENT_VERSION}.db`);
        expect(existsSync(snapshotPath)).toBe(true);
        expect(readFileSync(snapshotPath, 'utf8')).toBe('sqlite-bytes');
    });
});

describe('startUpdate — portable mode (apply-update.ps1 handoff)', () => {
    it('copies apply-update.ps1 into the updates dir and spawns powershell with the documented arg vector', async () => {
        // No install-config.txt in packageRoot -> portable mode.
        writeFileSync(path.join(packageRoot, 'apply-update.ps1'), '# fixture script\n', 'utf8');
        const fetchImpl = makeFetch();
        const { spawnImpl, calls } = recordingSpawn();
        const requestShutdownImpl = vi.fn();
        const runDbBackupOnceImpl = vi.fn().mockResolvedValue({ skipped: true, reason: 'disabled' });

        const originalPort = process.env.PORT;
        process.env.PORT = '3001';
        try {
            await startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl, spawnImpl, requestShutdownImpl, runDbBackupOnceImpl });
        } finally {
            if (originalPort === undefined) delete process.env.PORT; else process.env.PORT = originalPort;
        }

        expect(getUpdateProgress().target).toEqual({ from: CURRENT_VERSION, to: LATEST_VERSION, mode: 'portable' });

        const copiedScript = path.join(updatesDir(dataDir), 'apply-update.ps1');
        expect(existsSync(copiedScript)).toBe(true);
        expect(readFileSync(copiedScript, 'utf8')).toBe('# fixture script\n');

        expect(calls).toHaveLength(1);
        const [call] = calls;
        expect(call.cmd).toBe('powershell.exe');
        expect(call.args).toEqual([
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', copiedScript,
            '-PackageRoot', packageRoot, '-DataDir', dataDir,
            '-ZipPath', path.join(updatesDir(dataDir), 'grm-win-x64.zip'),
            '-FromVersion', CURRENT_VERSION, '-ToVersion', LATEST_VERSION,
            '-ServerPid', String(process.pid), '-Port', '3001',
        ]);
        expect(call.opts).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true });
    });
});

describe('startUpdate — preconditions', () => {
    it('rejects with already_running when a call is already in flight', async () => {
        let releaseDeferred;
        const releasePromise = new Promise((resolve) => { releaseDeferred = resolve; });
        const fetchImpl = vi.fn(async (url) => {
            if (url === RELEASES_URL) {
                await releasePromise;
                return jsonResponse(releaseJson());
            }
            if (url === SETUP_URL || url === ZIP_URL) return assetResponse();
            if (url === SETUP_SHA_URL || url === ZIP_SHA_URL) return shaResponse(ASSET_HEX);
            throw new Error(`unexpected fetch: ${url}`);
        });
        writeFileSync(path.join(packageRoot, 'apply-update.ps1'), '# fixture\n', 'utf8');
        const { spawnImpl } = recordingSpawn();
        const requestShutdownImpl = vi.fn();
        const runDbBackupOnceImpl = vi.fn().mockResolvedValue({ skipped: true });

        const first = startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl, spawnImpl, requestShutdownImpl, runDbBackupOnceImpl });
        // Give the first call's synchronous prelude a chance to claim the
        // busy phase before the second call's guard check runs.
        await new Promise((resolve) => setImmediate(resolve));
        expect(getUpdateProgress().phase).toBe('downloading');

        await expect(
            startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl, spawnImpl, requestShutdownImpl, runDbBackupOnceImpl })
        ).rejects.toMatchObject({ code: 'already_running' });

        releaseDeferred();
        await first;
    });

    it('rejects with no_update when checkForUpdate reports no update available', async () => {
        const fetchImpl = vi.fn(async (url) => {
            if (url === RELEASES_URL) return jsonResponse({ tag_name: `v${CURRENT_VERSION}`, assets: [] });
            throw new Error(`unexpected fetch: ${url}`);
        });
        await expect(
            startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl })
        ).rejects.toMatchObject({ code: 'no_update' });
        expect(getUpdateProgress().phase).toBe('error');
        expect(getUpdateProgress().error).toBe('no_update');
    });

    it('rejects with no_assets when the release is missing the pair for this install mode', async () => {
        const fetchImpl = makeFetch({ withAssets: false });
        await expect(
            startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl })
        ).rejects.toMatchObject({ code: 'no_assets' });
        expect(getUpdateProgress().phase).toBe('error');
    });

    it('resets to idle/error after a failure so a subsequent call is accepted again', async () => {
        const fetchImpl = vi.fn(async (url) => {
            if (url === RELEASES_URL) return jsonResponse({ tag_name: `v${CURRENT_VERSION}`, assets: [] });
            throw new Error(`unexpected fetch: ${url}`);
        });
        await expect(startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl }))
            .rejects.toBeInstanceOf(UpdateError);

        // checkForUpdate caches a successful (if "no update") check result for
        // 24h — without clearing it, the second call below would short-circuit
        // straight back to the same cached "no update" answer.
        resetUpdateCheckCacheForTests();
        writeFileSync(path.join(packageRoot, 'apply-update.ps1'), '# fixture\n', 'utf8');
        const okFetch = makeFetch();
        const { spawnImpl } = recordingSpawn();
        const requestShutdownImpl = vi.fn();
        const runDbBackupOnceImpl = vi.fn().mockResolvedValue({ skipped: true });
        await expect(
            startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl: okFetch, spawnImpl, requestShutdownImpl, runDbBackupOnceImpl })
        ).resolves.toBeUndefined();
    });
});

describe('startUpdate — checksum verification', () => {
    it('rejects with checksum_mismatch and deletes the downloaded asset when the sidecar does not match', async () => {
        writeFileSync(path.join(packageRoot, 'apply-update.ps1'), '# fixture\n', 'utf8');
        const fetchImpl = makeFetch({ assetHex: CORRUPT_HEX });
        const spawnFns = recordingSpawn();
        const requestShutdownImpl = vi.fn();
        const runDbBackupOnceImpl = vi.fn().mockResolvedValue({ skipped: true });

        await expect(
            startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl, spawnImpl: spawnFns.spawnImpl, requestShutdownImpl, runDbBackupOnceImpl })
        ).rejects.toMatchObject({ code: 'checksum_mismatch' });

        expect(getUpdateProgress().phase).toBe('error');
        expect(getUpdateProgress().error).toBe('checksum_mismatch');
        expect(existsSync(path.join(updatesDir(dataDir), 'grm-win-x64.zip'))).toBe(false);
        expect(existsSync(updateIntentPath(dataDir))).toBe(false);
        expect(spawnFns.calls).toHaveLength(0);
        expect(requestShutdownImpl).not.toHaveBeenCalled();
    });
});

describe('startUpdate — download failure', () => {
    it('rejects with download_failed on a non-2xx asset response', async () => {
        mkdirSync(updatesDir(dataDir), { recursive: true });
        const fetchImpl = vi.fn(async (url) => {
            if (url === RELEASES_URL) return jsonResponse(releaseJson());
            if (url === ZIP_URL) return new Response('nope', { status: 500 });
            if (url === ZIP_SHA_URL) return shaResponse(ASSET_HEX);
            throw new Error(`unexpected fetch: ${url}`);
        });
        await expect(
            startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl })
        ).rejects.toMatchObject({ code: 'download_failed' });
        expect(getUpdateProgress().phase).toBe('error');
        expect(getUpdateProgress().error).toBe('download_failed');
    });

    it('cleans up the partially-downloaded asset when the sidecar download fails', async () => {
        const fetchImpl = vi.fn(async (url) => {
            if (url === RELEASES_URL) return jsonResponse(releaseJson());
            if (url === ZIP_URL) return assetResponse();
            if (url === ZIP_SHA_URL) return new Response('nope', { status: 500 });
            throw new Error(`unexpected fetch: ${url}`);
        });
        await expect(
            startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl })
        ).rejects.toMatchObject({ code: 'download_failed' });
        expect(existsSync(path.join(updatesDir(dataDir), 'grm-win-x64.zip'))).toBe(false);
    });
});

describe('startUpdate — state machine resilience', () => {
    it('resets progress to error (not stuck) when a precondition throws synchronously, and permits a retry', async () => {
        const fetchImpl = makeFetch();
        const { spawnImpl } = recordingSpawn();
        const requestShutdownImpl = vi.fn();
        const runDbBackupOnceImpl = vi.fn().mockResolvedValue({ skipped: true });

        // packageRoot: undefined reproduces the pre-Task-5 condition where
        // GRM_PACKAGE_ROOT isn't wired yet — isInstalledMode(undefined) ->
        // path.join(undefined, ...) throws synchronously, well after the
        // busy-phase claim at the top of startUpdate.
        await expect(
            startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot: undefined, fetchImpl, spawnImpl, requestShutdownImpl, runDbBackupOnceImpl })
        ).rejects.toBeInstanceOf(TypeError);

        expect(getUpdateProgress().phase).toBe('error');
        expect(getUpdateProgress().error).toBe('unexpected');
        expect(spawnImpl).not.toHaveBeenCalled();

        // A subsequent call must be accepted, not bounced with
        // already_running — the whole point of resetting progress above.
        resetUpdateCheckCacheForTests();
        writeFileSync(path.join(packageRoot, 'apply-update.ps1'), '# fixture\n', 'utf8');
        await expect(
            startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl, spawnImpl, requestShutdownImpl, runDbBackupOnceImpl })
        ).resolves.toBeUndefined();
        expect(getUpdateProgress().phase).toBe('restarting');
    });
});

describe('startUpdate — malicious release metadata', () => {
    it('rejects a path-traversal asset name from the release payload without ever spawning', async () => {
        writeFileSync(path.join(packageRoot, 'install-config.txt'), 'InstallMode=CurrentUser\n', 'utf8');
        const fetchImpl = vi.fn(async (url) => {
            if (url === RELEASES_URL) {
                return jsonResponse({
                    tag_name: `v${LATEST_VERSION}`,
                    html_url: 'https://github.com/example/releases/tag/v4.9.0',
                    assets: [
                        { name: '..\\..\\evil-setup.exe', browser_download_url: SETUP_URL, size: ASSET_CONTENT.length },
                        { name: 'grm-setup.exe.sha256', browser_download_url: SETUP_SHA_URL, size: 65 },
                    ],
                });
            }
            throw new Error(`unexpected fetch during malicious-asset test: ${url}`);
        });
        const { spawnImpl } = recordingSpawn();
        const requestShutdownImpl = vi.fn();
        const runDbBackupOnceImpl = vi.fn().mockResolvedValue({ skipped: true });

        await expect(
            startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl, spawnImpl, requestShutdownImpl, runDbBackupOnceImpl })
        ).rejects.toMatchObject({ code: 'invalid_asset' });

        expect(getUpdateProgress().phase).toBe('error');
        expect(getUpdateProgress().error).toBe('invalid_asset');
        expect(spawnImpl).not.toHaveBeenCalled();
        expect(requestShutdownImpl).not.toHaveBeenCalled();
    });

    it('rejects a `../` path-traversal asset name (forward-slash form) without ever spawning', async () => {
        // No install-config.txt in packageRoot -> portable (zip) mode.
        writeFileSync(path.join(packageRoot, 'apply-update.ps1'), '# fixture\n', 'utf8');
        const fetchImpl = vi.fn(async (url) => {
            if (url === RELEASES_URL) {
                return jsonResponse({
                    tag_name: `v${LATEST_VERSION}`,
                    html_url: 'https://github.com/example/releases/tag/v4.9.0',
                    assets: [
                        { name: 'evil/../x-win-x64.zip', browser_download_url: ZIP_URL, size: ASSET_CONTENT.length },
                        { name: 'grm-win-x64.zip.sha256', browser_download_url: ZIP_SHA_URL, size: 65 },
                    ],
                });
            }
            throw new Error(`unexpected fetch during malicious-asset test: ${url}`);
        });
        const { spawnImpl } = recordingSpawn();

        await expect(
            startUpdate({ currentVersion: CURRENT_VERSION, dataDir, packageRoot, fetchImpl, spawnImpl })
        ).rejects.toMatchObject({ code: 'invalid_asset' });
        expect(spawnImpl).not.toHaveBeenCalled();
    });
});
