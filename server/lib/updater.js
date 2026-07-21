// SPDX-License-Identifier: AGPL-3.0-only
//
// Core primitives plus orchestration for the Windows one-click self-update:
// marker files that hand off state across process boundaries (this server ->
// apply-update.ps1 -> the restarted server), install-mode/asset resolution,
// sha256 verification for downloaded release artifacts, and the download ->
// verify -> snapshot -> handoff -> shutdown sequence that drives them. The
// marker-file helpers must agree byte-for-byte with a PowerShell reader
// (file names, JSON shapes, the hash format); the orchestration below is
// pure Node and everything it does to the outside world (fetch, spawn,
// shutdown) is injectable so it can be driven by tests without a network,
// an installer, or a real process exit.
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, createReadStream, createWriteStream, copyFileSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { checkForUpdate } from './update-check.js';
import { runDbBackupOnce } from './db-backup.js';
import { requestShutdown } from './shutdown.js';

export function updatesDir(dataDir) {
    return path.join(dataDir, 'updates');
}

export function updateIntentPath(dataDir) {
    return path.join(updatesDir(dataDir), 'update-intent.json');
}

export function updateResultPath(dataDir) {
    return path.join(updatesDir(dataDir), 'last-update-result.json');
}

// A missing marker is a normal "nothing pending" state; a corrupt one
// (partial write, crash mid-write) must never wedge boot or a status poll —
// it's deleted and treated as absent rather than surfaced as an error.
function readMarker(filePath) {
    if (!existsSync(filePath)) return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
        try { unlinkSync(filePath); } catch { /* best-effort cleanup */ }
        return null;
    }
}

function writeMarker(dataDir, filePath, data) {
    mkdirSync(updatesDir(dataDir), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function writeUpdateIntent(dataDir, intent) {
    writeMarker(dataDir, updateIntentPath(dataDir), intent);
}

export function writeUpdateResult(dataDir, result) {
    writeMarker(dataDir, updateResultPath(dataDir), result);
}

/**
 * Read-and-clear the last update result for /api/system/status: a client
 * that never polled while the update was applying still learns the outcome
 * exactly once, on its first status check after the restart.
 * @returns {object|null}
 */
export function readAndClearUpdateResult(dataDir) {
    const filePath = updateResultPath(dataDir);
    const result = readMarker(filePath);
    if (existsSync(filePath)) {
        try { unlinkSync(filePath); } catch { /* best-effort cleanup */ }
    }
    return result;
}

/**
 * Reconciles a pending update-intent marker against the version that just
 * booted. apply-update.ps1 writes the intent before replacing files and
 * restarting the app; this runs on every boot to close the loop:
 *   - to === currentVersion  -> the swap worked; record success, clear intent.
 *   - to !== currentVersion, intent stale (older than staleMs) -> the
 *     updater died or the swap failed silently; record failure and clear
 *     the intent so boot doesn't loop on it forever.
 *   - to !== currentVersion, intent still young -> apply-update.ps1 may
 *     still be mid-swap (this boot could be a crash-restart racing it);
 *     leave the marker in place for the next boot to re-evaluate.
 * A missing or corrupt intent is "nothing to resolve" ('none') — this never
 * throws, since it runs unconditionally on every boot.
 * @returns {'success'|'failed'|'none'|'pending'}
 */
export function resolveIntentOnBoot(dataDir, currentVersion, staleMs = 10 * 60 * 1000) {
    const intentPath = updateIntentPath(dataDir);
    const intent = readMarker(intentPath);
    if (!intent) return 'none';

    if (intent.to === currentVersion) {
        writeUpdateResult(dataDir, {
            status: 'success',
            from: intent.from,
            to: intent.to,
            at: new Date().toISOString(),
            logPath: null,
        });
        try { unlinkSync(intentPath); } catch { /* best-effort cleanup */ }
        return 'success';
    }

    const intentAt = Date.parse(intent.at);
    // An unparseable `at` can't prove the update is still young, so treat it
    // as stale rather than leaving a marker that could never resolve.
    const age = Number.isFinite(intentAt) ? Date.now() - intentAt : Infinity;
    if (age > staleMs) {
        writeUpdateResult(dataDir, {
            status: 'failed',
            from: intent.from,
            to: intent.to,
            at: new Date().toISOString(),
            logPath: null,
        });
        try { unlinkSync(intentPath); } catch { /* best-effort cleanup */ }
        return 'failed';
    }

    return 'pending';
}

/**
 * Packaged (Program-Files-style) install vs. portable zip extraction — the
 * installer writes install-config.txt as its layout marker; portable
 * extracts never have one.
 */
export function isInstalledMode(packageRoot) {
    return existsSync(path.join(packageRoot, 'install-config.txt'));
}

/**
 * Picks the (installer-exe, sidecar) or (zip, sidecar) pair to download for
 * this install's layout, from the `assets` shape produced by
 * update-check.js's extractReleaseAssets. Either half missing (asset
 * dropped from a release, a malformed payload, etc.) means the update can't
 * proceed safely — null, never a half-populated pair a caller could
 * download without a hash to verify it against.
 * @returns {{asset: object, sha: object}|null}
 */
export function selectUpdateAssets(checkResult, installed) {
    const assets = checkResult?.assets;
    if (!assets) return null;
    const asset = installed ? assets.setup : assets.zip;
    const sha = installed ? assets.setupSha256 : assets.zipSha256;
    if (!asset || !sha) return null;
    return { asset, sha };
}

// sha256sum-style sidecar files look like "<hex>  filename" or
// "<hex> *filename" (the `*` marks binary mode) — only the hex digest
// matters here, so this ignores everything around it.
const SHA256_HEX_RE = /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/;

/** @returns {string|null} lowercased 64-char hex digest, or null if absent */
export function parseSha256Sidecar(text) {
    const match = typeof text === 'string' ? text.match(SHA256_HEX_RE) : null;
    return match ? match[0].toLowerCase() : null;
}

/**
 * Streams the file rather than reading it whole — installer/zip downloads
 * can be tens of MB and this runs on every self-update.
 * @returns {Promise<boolean>}
 */
export async function verifyFileSha256(filePath, expectedHex) {
    if (typeof expectedHex !== 'string' || expectedHex.length === 0) return false;
    const hash = createHash('sha256');
    try {
        await new Promise((resolve, reject) => {
            const stream = createReadStream(filePath);
            stream.on('data', (chunk) => hash.update(chunk));
            stream.on('end', resolve);
            stream.on('error', reject);
        });
    } catch {
        return false;
    }
    return hash.digest('hex') === expectedHex.toLowerCase();
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Thrown for every precondition/verification failure startUpdate rejects on.
 * `.code` drives the route's HTTP status mapping (already_running -> 409,
 * everything else -> 400) and is what the client-side progress UI branches
 * on, so it's part of the contract — never rename a code without updating
 * both sides.
 */
export class UpdateError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'UpdateError';
        this.code = code;
    }
}

const IDLE_PROGRESS = Object.freeze({ phase: 'idle', percent: 0, error: null, target: null });

// Module singleton: there is exactly one update in flight per running
// server process, and the progress poll (/api/system/update/status) needs
// to read it without threading state through the request that started it.
let progress = IDLE_PROGRESS;

/** @returns {{phase: string, percent: number, error: string|null, target: object|null}} */
export function getUpdateProgress() {
    return progress;
}

/** Test-only: reset the module singleton between test cases. */
export function resetUpdaterForTests() {
    progress = IDLE_PROGRESS;
}

/**
 * Streams a URL to disk, reporting percent from the response's
 * content-length when the server sends one (release assets always do, but
 * this must degrade quietly rather than throw when it doesn't). Aborts on
 * a non-2xx status before anything is written.
 */
async function downloadToFile(fetchImpl, url, destPath, onProgress) {
    const res = await fetchImpl(url);
    if (!res || !res.ok) {
        throw new Error(`update asset download failed: ${res?.status ?? 'no response'} (${url})`);
    }
    const total = Number(res.headers?.get?.('content-length')) || 0;
    let received = 0;
    const source = res.body
        ? Readable.fromWeb(res.body)
        : Readable.from(Buffer.from(await res.arrayBuffer()));
    if (total > 0 && typeof onProgress === 'function') {
        source.on('data', (chunk) => {
            received += chunk.length;
            onProgress(Math.min(100, Math.round((received / total) * 100)));
        });
    }
    await pipeline(source, createWriteStream(destPath));
}

/**
 * Runs the full self-update sequence: precondition checks, download,
 * checksum verification, a DB snapshot for rollback, an update-intent
 * marker for the next boot to reconcile, then handoff to either the signed
 * installer (installed mode) or apply-update.ps1 (portable mode) followed
 * by a graceful shutdown so the handoff process can replace files this
 * process currently has open.
 *
 * Every side effect that crosses a process/network boundary is injectable
 * so this can be exercised end-to-end without a real release, installer,
 * or process exit — see updater-orchestration.test.js.
 *
 * @throws {UpdateError}
 */
export async function startUpdate({
    currentVersion,
    dataDir,
    packageRoot,
    fetchImpl = fetch,
    spawnImpl = spawn,
    requestShutdownImpl = requestShutdown,
    runDbBackupOnceImpl = runDbBackupOnce,
}) {
    if (progress.phase !== 'idle' && progress.phase !== 'error') {
        throw new UpdateError('already_running', 'An update is already in progress');
    }

    // Claimed before the network check (not after) so a second call that
    // arrives while checkForUpdate is still in flight also sees a busy
    // phase instead of racing through the same guard.
    progress = { phase: 'downloading', percent: 0, error: null, target: null };

    const checkResult = await checkForUpdate({ currentVersion, fetchImpl });
    if (checkResult.updateAvailable !== true) {
        progress = { phase: 'error', percent: 0, error: 'no_update', target: null };
        throw new UpdateError('no_update', 'No update is available');
    }

    const installed = isInstalledMode(packageRoot);
    const pair = selectUpdateAssets(checkResult, installed);
    if (!pair) {
        progress = { phase: 'error', percent: 0, error: 'no_assets', target: null };
        throw new UpdateError('no_assets', 'The latest release is missing required update assets for this install type');
    }

    const latest = checkResult.latest;
    const mode = installed ? 'installed' : 'portable';
    const dir = updatesDir(dataDir);
    mkdirSync(dir, { recursive: true });
    progress = { phase: 'downloading', percent: 0, error: null, target: { from: currentVersion, to: latest, mode } };

    const assetPath = path.join(dir, pair.asset.name);
    const shaPath = path.join(dir, pair.sha.name);

    try {
        await downloadToFile(fetchImpl, pair.asset.url, assetPath, (percent) => {
            progress = { ...progress, percent };
        });
        await downloadToFile(fetchImpl, pair.sha.url, shaPath, () => {});
    } catch {
        progress = { phase: 'error', percent: 0, error: 'download_failed', target: progress.target };
        throw new UpdateError('download_failed', 'Failed to download the update');
    }

    progress = { ...progress, phase: 'verifying', percent: 100 };
    const expectedHex = parseSha256Sidecar(readFileSync(shaPath, 'utf8'));
    const verified = expectedHex ? await verifyFileSha256(assetPath, expectedHex) : false;
    if (!verified) {
        try { unlinkSync(assetPath); } catch { /* best-effort cleanup */ }
        try { unlinkSync(shaPath); } catch { /* best-effort cleanup */ }
        progress = { phase: 'error', percent: 0, error: 'checksum_mismatch', target: progress.target };
        throw new UpdateError('checksum_mismatch', 'Downloaded update failed checksum verification');
    }

    // Best-effort: a snapshot failure must never block the update itself —
    // the worst case is a rollback that can't restore the DB, not a
    // blocked update. apply-update.ps1 only uses the snapshot if present.
    try {
        const backup = await runDbBackupOnceImpl();
        if (backup?.destPath) {
            copyFileSync(backup.destPath, path.join(dir, `pre-update-${currentVersion}.db`));
        }
    } catch { /* see above */ }

    writeUpdateIntent(dataDir, { from: currentVersion, to: latest, mode, at: new Date().toISOString() });

    progress = { ...progress, phase: 'restarting' };

    if (installed) {
        const logPath = path.join(dir, `update-${latest}.log`);
        spawnImpl(
            assetPath,
            ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/LOG=' + logPath, '/UPDATED=1'],
            { detached: true, stdio: 'ignore' }
        ).unref();
    } else {
        const scriptDest = path.join(dir, 'apply-update.ps1');
        copyFileSync(path.join(packageRoot, 'apply-update.ps1'), scriptDest);
        spawnImpl(
            'powershell.exe',
            [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptDest,
                '-PackageRoot', packageRoot, '-DataDir', dataDir, '-ZipPath', assetPath,
                '-FromVersion', currentVersion, '-ToVersion', latest,
                '-ServerPid', String(process.pid), '-Port', String(process.env.PORT || 3001),
            ],
            { detached: true, stdio: 'ignore', windowsHide: true }
        ).unref();
    }

    // Delayed rather than immediate: the response to POST /update needs to
    // reach the caller before this process starts tearing itself down.
    const timer = setTimeout(() => requestShutdownImpl('update'), 500);
    timer.unref();
}
