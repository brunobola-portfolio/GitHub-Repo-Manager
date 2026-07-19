/**
 * Resolves the single writable data directory the app persists state under:
 * the SQLite DB (adapters/sqlite-adapter.js), the session store rows (same
 * DB), scheduled backups (db-backup.js, derived from the DB path), and the
 * import/wiki clone scratch space (import-service.js, wiki-service.js).
 *
 * Everything routes through here so a self-hosted install can redirect all
 * of it with a single env var. This matters for the Windows package: an
 * installed-to-Program-Files layout is read-only, so the installer points
 * DATA_DIR at %LOCALAPPDATA%\GitHubRepoManager\data.
 *
 *   DATA_DIR unset   -> `<repo>/server/data` (unchanged from every prior release)
 *   DATA_DIR=<path>  -> that path, resolved to absolute and created if missing
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This file lives at server/lib/data-dir.js, so its parent is server/.
const SERVER_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = path.join(SERVER_ROOT, 'data');

/**
 * Resolve the data directory, creating it (and any missing parents) if it
 * does not yet exist. Reads process.env.DATA_DIR on every call rather than
 * caching, so tests can flip it between calls without a module reset.
 *
 * @returns {string} absolute path to the resolved data directory
 */
export function getDataDir() {
    const configured = process.env.DATA_DIR;
    const resolved = configured ? path.resolve(configured) : DEFAULT_DATA_DIR;
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
}
