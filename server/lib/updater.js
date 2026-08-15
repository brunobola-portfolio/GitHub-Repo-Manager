// SPDX-License-Identifier: Apache-2.0
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
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, createReadStream, createWriteStream, copyFileSync, readdirSync, rmSync } from 'fs';
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

/**
 * Absolute path to Windows PowerShell, never the bare image name.
 *
 * spawn() resolves a bare name against PATH, which on Windows includes the
 * current working directory ahead of System32. The portable handoff runs with
 * cwd inside the extracted package, so a `powershell.exe` dropped into a
 * package extracted to a shared or world-writable directory would be executed
 * instead of the real one, during an update, at the user's privilege level.
 *
 * Launcher.cs and installer.iss already take absolute System32 paths for
 * exactly this reason ({sys}	askkill.exe); this matches them. Falls back to
 * the bare name only where SystemRoot is unset (non-Windows test runs).
 */
export function powerShellExe() {
    const root = process.env.SystemRoot || process.env.SYSTEMROOT;
    if (!root) return 'powershell.exe';
    return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function updateIntentPath(dataDir) {
    return path.join(updatesDir(dataDir), 'update-intent.json');
}

// Files the updates dir must keep between runs: the intent marker the next
// boot reads, and anything the CURRENT update is mid-way through using.
const UPDATE_KEEP = new Set(['update-intent.json']);

/**
 * Delete downloaded installers, ZIPs, sha256 sidecars and pre-update database
 * snapshots left by PREVIOUS updates.
 *
 * Nothing ever removed them, so a user who accepted ten updates over a year
 * accumulated ten setup.exe files (~100 MB each), ten sidecars, and ten full
 * database snapshots under %LOCALAPPDATA% — silently, on the same volume the
 * app stores its data. Called just before a new download starts, so the
 * artefacts of the update currently running are never touched.
 *
 * @param {string} dataDir
 * @param {string[]} [keepNames] — basenames the caller is about to write
 * @returns {number} files removed
 */
export function pruneOldUpdateArtifacts(dataDir, keepNames = []) {
    const dir = updatesDir(dataDir);
    const keep = new Set([...UPDATE_KEEP, ...keepNames]);
    let removed = 0;
    try {
        for (const name of readdirSync(dir)) {
            if (keep.has(name)) continue;
            try {
                rmSync(path.join(dir, name), { force: true, recursive: true });
                removed++;
            } catch { /* a locked file is retried on the next update */ }
        }
    } catch { /* dir does not exist yet */ }
    return removed;
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

// Release metadata (asset names, the release tag) comes from GitHub's API —
// untrusted for the purposes of building filesystem paths. Only a plain
// filename is ever accepted; path.basename first collapses any directory
// components a hostile name could carry (both `/` and `\` are separators on
// win32), and requiring the result to equal the input catches traversal
// attempts (`../evil.exe`, `..\\..\\evil.exe`) that basename would otherwise
// silently reduce to something that *looks* safe. The charset allowlist then
// rejects anything else unexpected (spaces, quotes, a bare `..`, etc.) that
// basename alone wouldn't.
const SAFE_ASSET_NAME_RE = /^[A-Za-z0-9._-]+$/;

function sanitizeAssetName(rawName) {
    const name = typeof rawName === 'string' ? rawName : '';
    const base = path.basename(name);
    if (!base || base !== name || base === '.' || base === '..' || !SAFE_ASSET_NAME_RE.test(base)) {
        throw new UpdateError('invalid_asset', 'Release asset name failed validation');
    }
    return base;
}

// The release tag is only cosmetic in the log filename, so sanitize rather
// than reject a tag that fails the strict allowlist above.
function sanitizeForLogName(value) {
    const cleaned = String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '_');
    return cleaned || 'unknown';
}

const IDLE_PROGRESS = Object.freeze({ phase: 'idle', percent: 0, error: null, target: null });

// Module singleton: there is exactly one update in flight per running
// server process, and the progress poll (/api/system/update/status) needs
// to read it without threading state through the request that started it.
let progress = IDLE_PROGRESS;

// The background download/verify/handoff run kicked off by the most recent
// startUpdate() call. Nothing in production awaits this — the route only
// awaits the fast preconditions phase — so it's stored here purely for
// awaitUpdateRunForTests() to give tests a deterministic hook instead of
// racing real timers/IO.
let inFlightRun = null;

/** @returns {{phase: string, percent: number, error: string|null, target: object|null}} */
export function getUpdateProgress() {
    return progress;
}

/** Test-only: reset the module singleton between test cases. */
export function resetUpdaterForTests() {
    progress = IDLE_PROGRESS;
    inFlightRun = null;
}

/**
 * Test-only: await the background download/verify/handoff run kicked off by
 * the most recent startUpdate() call, so assertions on spawn/requestShutdown/
 * checksum-cleanup/etc. can run deterministically after it settles instead of
 * racing it. Resolves immediately if no run is in flight. This promise never
 * rejects — background failures are captured in `progress`, not thrown here.
 */
export function awaitUpdateRunForTests() {
    return inFlightRun || Promise.resolve();
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
 * Heavy phase of the self-update: download, checksum verify, DB snapshot,
 * the update-intent marker, handoff spawn, and the deferred shutdown. Kicked
 * off by startUpdate() but never awaited there — the route needs to respond
 * before a 128MB download even starts, so this runs in the background while
 * the client polls getUpdateProgress() via /update/status for percent.
 *
 * Every exit path funnels through the same hardening catch as the
 * preconditions phase so a background failure still resets `progress` to
 * 'error' rather than wedging future calls behind the already_running guard.
 * Nothing in production awaits this promise, so it must never reject —
 * failures are recorded in `progress`, and tests observe them there (via
 * awaitUpdateRunForTests()) rather than via a caught rejection.
 */
async function runUpdateDownloadAndHandoff({
    currentVersion, dataDir, packageRoot, fetchImpl, spawnImpl, requestShutdownImpl, runDbBackupOnceImpl,
    pair, assetPath, shaPath, dir, latest, mode, installed,
}) {
    try {
        try {
            await downloadToFile(fetchImpl, pair.asset.url, assetPath, (percent) => {
                progress = { ...progress, percent };
            });
            await downloadToFile(fetchImpl, pair.sha.url, shaPath, () => {});
        } catch {
            try { unlinkSync(assetPath); } catch { /* best-effort cleanup */ }
            try { unlinkSync(shaPath); } catch { /* best-effort cleanup */ }
            throw new UpdateError('download_failed', 'Failed to download the update');
        }

        progress = { ...progress, phase: 'verifying', percent: 100 };
        const expectedHex = parseSha256Sidecar(readFileSync(shaPath, 'utf8'));
        const verified = expectedHex ? await verifyFileSha256(assetPath, expectedHex) : false;
        if (!verified) {
            try { unlinkSync(assetPath); } catch { /* best-effort cleanup */ }
            try { unlinkSync(shaPath); } catch { /* best-effort cleanup */ }
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
            const logPath = path.join(dir, `update-${sanitizeForLogName(latest)}.log`);
            spawnImpl(
                assetPath,
                ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/LOG=' + logPath, '/UPDATED=1'],
                { detached: true, stdio: 'ignore' }
            ).unref();
        } else {
            const scriptDest = path.join(dir, 'apply-update.ps1');
            copyFileSync(path.join(packageRoot, 'apply-update.ps1'), scriptDest);
            spawnImpl(
                powerShellExe(),
                [
                    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptDest,
                    '-PackageRoot', packageRoot, '-DataDir', dataDir, '-ZipPath', assetPath,
                    // latest is a GitHub release tag: sanitize before it reaches
                    // apply-update.ps1, which builds staging-/log filesystem paths
                    // from it (a legit semver tag is unchanged). Defense-in-depth,
                    // mirroring the installed-mode log-name sanitize above.
                    '-FromVersion', currentVersion, '-ToVersion', sanitizeForLogName(latest),
                    '-ServerPid', String(process.pid), '-Port', String(process.env.PORT || 3001),
                ],
                { detached: true, stdio: 'ignore', windowsHide: true }
            ).unref();
        }

        // Delayed rather than immediate: the 202 response to POST /update
        // needs to reach the caller before this process starts tearing
        // itself down.
        const timer = setTimeout(() => requestShutdownImpl('update'), 500);
        timer.unref();
    } catch (err) {
        progress = {
            phase: 'error',
            percent: 0,
            error: err instanceof UpdateError ? err.code : 'unexpected',
            target: progress.target,
        };
    }
}

/**
 * Preconditions phase of the self-update, awaited directly by the route:
 * the already_running guard, checkForUpdate, install-mode/asset selection,
 * and the untrusted-name sanitize/allowlist. On success this kicks off the
 * heavy download/verify/handoff work in the background (never awaited here)
 * and returns immediately so POST /update can respond 202 before a 128MB
 * download even starts — the client then polls getUpdateProgress() via
 * /update/status for percent.
 *
 * Every side effect in this phase can throw synchronously (bad packageRoot,
 * a marker write failing) as well as asynchronously (the release-check
 * fetch). Any of it leaving `progress` stuck on a non-idle, non-error phase
 * would wedge every future call behind the already_running guard above
 * until the process restarts, so every exit path here funnels through this
 * catch to reset it before rethrowing — the route still needs the real
 * error to map its HTTP status (already_running -> 409, everything else ->
 * 400).
 *
 * @returns {Promise<{started: boolean}>}
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

    let assetPath, shaPath, dir, latest, mode, installed, pair;
    try {
        const checkResult = await checkForUpdate({ currentVersion, fetchImpl });
        if (checkResult.updateAvailable !== true) {
            throw new UpdateError('no_update', 'No update is available');
        }

        installed = isInstalledMode(packageRoot);
        pair = selectUpdateAssets(checkResult, installed);
        if (!pair) {
            throw new UpdateError('no_assets', 'The latest release is missing required update assets for this install type');
        }

        // Untrusted release metadata: reject anything that isn't a plain
        // filename before it ever reaches path.join.
        const assetName = sanitizeAssetName(pair.asset.name);
        const shaName = sanitizeAssetName(pair.sha.name);

        latest = checkResult.latest;
        mode = installed ? 'installed' : 'portable';
        dir = updatesDir(dataDir);
        mkdirSync(dir, { recursive: true });
        progress = { phase: 'downloading', percent: 0, error: null, target: { from: currentVersion, to: latest, mode } };

        assetPath = path.join(dir, assetName);
        shaPath = path.join(dir, shaName);

        // Clear what previous updates left behind BEFORE downloading, keeping
        // the two files this run is about to write. Nothing else ever deleted
        // them, so the directory grew by one installer plus one database
        // snapshot per update, forever.
        pruneOldUpdateArtifacts(dataDir, [assetName, shaName]);
    } catch (err) {
        progress = {
            phase: 'error',
            percent: 0,
            error: err instanceof UpdateError ? err.code : 'unexpected',
            target: progress.target,
        };
        throw err;
    }

    inFlightRun = runUpdateDownloadAndHandoff({
        currentVersion, dataDir, packageRoot, fetchImpl, spawnImpl, requestShutdownImpl, runDbBackupOnceImpl,
        pair, assetPath, shaPath, dir, latest, mode, installed,
    });

    return { started: true };
}
