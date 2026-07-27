// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read/update helpers for the runtime .env file.
 *
 * Used by the first-run OAuth setup endpoint (routes/auth-setup.js) to persist
 * GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET entered through the in-app wizard,
 * so a desktop/self-host install never has to hand-edit a text file.
 *
 * The file being edited is the SAME file dotenv loaded at boot:
 *   - GRM_ENV_FILE set (Windows package launcher) → that path
 *   - otherwise → `<repo root>/.env` (dotenv's default resolution)
 *
 * Writes are atomic (temp file + rename) so a crash mid-write can never leave
 * a truncated .env behind — for a desktop install that file holds the session
 * and credential-vault secrets, and truncating it would strand every
 * encrypted credential in the database.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This file lives at server/lib/env-file.js → repo root is two levels up.
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Only ever touch keys in this allowlist — updateEnvFile is reachable from an
// HTTP endpoint, and a bug or future misuse must never be able to rewrite
// arbitrary keys (SESSION_SECRET, CREDENTIAL_ENCRYPTION_KEY, ...).
//
// PORT is here for the Windows launcher's busy-port fallback only
// (scripts/first-run.mjs `persistPort`, invoked from packaging/windows/start.ps1):
// a drifting port silently breaks the registered OAuth callback, so the port
// the launcher actually bound to has to become the persisted one. No HTTP route
// passes it — routes/auth-setup.js writes a fixed two-key object.
const WRITABLE_KEYS = new Set(['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'PORT']);

/**
 * Resolve the .env file the running process loaded (see server/config.js).
 * @returns {string} absolute path
 */
export function resolveEnvFilePath() {
    const configured = process.env.GRM_ENV_FILE;
    return configured ? path.resolve(configured) : path.join(REPO_ROOT, '.env');
}

/**
 * Replace-or-append `KEY=value` lines in the .env file, atomically.
 * Existing unrelated lines (comments, other keys, ordering) are preserved
 * byte-for-byte. Creates the file (and parent dir) when missing.
 *
 * @param {Record<string, string>} updates - keys must be in WRITABLE_KEYS
 * @param {{ envPath?: string }} [opts]
 * @returns {{ envPath: string, created: boolean }}
 */
export function updateEnvFile(updates, { envPath } = {}) {
    const targetPath = envPath ? path.resolve(envPath) : resolveEnvFilePath();

    for (const key of Object.keys(updates)) {
        if (!WRITABLE_KEYS.has(key)) {
            throw new Error(`Refusing to write non-allowlisted env key: ${key}`);
        }
        if (/[\r\n]/.test(String(updates[key]))) {
            throw new Error(`Refusing to write env value containing a newline for: ${key}`);
        }
    }

    let existing = '';
    let created = false;
    try {
        existing = fs.readFileSync(targetPath, 'utf8');
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        created = true;
    }

    const lines = existing.length ? existing.split('\n') : [];
    const remaining = { ...updates };

    const updated = lines.map((line) => {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
        if (match && Object.prototype.hasOwnProperty.call(remaining, match[1])) {
            const key = match[1];
            const value = remaining[key];
            delete remaining[key];
            return `${key}=${value}`;
        }
        return line;
    });

    const appended = Object.entries(remaining);
    if (appended.length > 0) {
        // Drop trailing blank lines so the appended block sits directly under
        // the existing content, then restore a single trailing newline.
        while (updated.length > 0 && updated[updated.length - 1].trim() === '') {
            updated.pop();
        }
        if (updated.length > 0) updated.push('');
        updated.push('# Added by the in-app GitHub connection setup.');
        for (const [key, value] of appended) {
            updated.push(`${key}=${value}`);
        }
    }

    let content = updated.join('\n');
    if (!content.endsWith('\n')) content += '\n';

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tmpPath = `${targetPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, targetPath);

    return { envPath: targetPath, created };
}
