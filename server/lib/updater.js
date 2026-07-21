// SPDX-License-Identifier: AGPL-3.0-only
//
// Core primitives for the Windows one-click self-update: marker files that
// hand off state across process boundaries (this server -> apply-update.ps1
// -> the restarted server), install-mode/asset resolution, and sha256
// verification for downloaded release artifacts. Orchestration (downloading,
// spawning the updater script, progress reporting) lives elsewhere — this
// module only owns the parts that must agree byte-for-byte with a
// PowerShell reader: file names, JSON shapes, and the hash format.
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, createReadStream } from 'fs';
import path from 'path';
import { createHash } from 'crypto';

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
