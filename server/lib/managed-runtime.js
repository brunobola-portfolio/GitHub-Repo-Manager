// SPDX-License-Identifier: Apache-2.0
//
// Managed-mode (packaged Windows) runtime state. start.ps1 sets GRM_MANAGED=1;
// the server then writes a per-boot shutdown token whose value authorizes
// POST /api/system/shutdown. The token lives in the data dir (same trust
// domain as .env beside it): local console readers are already root-equivalent
// for this app, while browser JS can never read files — which is exactly the
// property that lets the route bypass session CSRF.
import { randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync, rmSync } from 'fs';
import path from 'path';

export function isManaged() {
    return process.env.GRM_MANAGED === '1';
}

export function shutdownTokenPath(dataDir) {
    return path.join(dataDir, '.grm.shutdown-token');
}

export function initManagedRuntime(dataDir) {
    const token = randomBytes(32).toString('base64url');
    writeFileSync(shutdownTokenPath(dataDir), token + '\n', 'utf8');
    return token;
}

export function verifyShutdownToken(dataDir, candidate) {
    if (typeof candidate !== 'string' || candidate.length === 0) return false;
    let stored;
    try {
        stored = readFileSync(shutdownTokenPath(dataDir), 'utf8').trim();
    } catch {
        return false;
    }
    if (!stored) return false;
    const a = Buffer.from(stored);
    const b = Buffer.from(candidate);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

export function clearManagedRuntime(dataDir) {
    try {
        rmSync(shutdownTokenPath(dataDir), { force: true });
    } catch {
        // Best-effort: a locked/preremoved file must never break shutdown.
    }
}
