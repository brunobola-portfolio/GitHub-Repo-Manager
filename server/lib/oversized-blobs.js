/**
 * Helpers for detecting and reporting individual blobs that exceed GitHub's
 * hard per-file size limit. GitHub rejects pushes containing any blob over
 * 100 MiB regardless of total repo size, so size-based migration planning
 * that only looks at repo totals misses this failure mode entirely.
 *
 * Two paths:
 *   - `findOversizedBlobs(workDir, threshold)` walks the bare clone and
 *     enumerates blobs above `threshold` BEFORE the push attempt.
 *   - `parseOversizedPushError(stderr)` rescues blob info from the GH001
 *     push rejection AFTER the fact, in case pre-check was skipped.
 *
 * The serialised form (`OVERSIZED_FILES:` prefix + JSON) is what we write
 * into the `error_message` column so the frontend can render a structured
 * panel instead of a stderr wall.
 */

import { simpleGit } from 'simple-git';

export const GITHUB_FILE_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;
export const STRUCTURED_ERROR_PREFIX = 'OVERSIZED_FILES:';

/**
 * Scan every blob in a bare repo and return those above `thresholdBytes`.
 * Uses `git rev-list --objects --all` to enumerate, then a single
 * `git cat-file --batch-check` to size each object. Both commands are
 * read-only and run against the local on-disk pack, so they cost roughly
 * what `git fsck` would: seconds for normal repos, minutes for huge ones.
 *
 * Returns up to `limit` entries to keep the structured error compact.
 */
export async function findOversizedBlobs(workDir, thresholdBytes = GITHUB_FILE_SIZE_LIMIT_BYTES, limit = 50) {
    const git = simpleGit(workDir);

    let revListOutput;
    try {
        revListOutput = await git.raw(['rev-list', '--objects', '--all']);
    } catch {
        return [];
    }

    // Each line is "<sha> [<path>]". Blobs have a path; commits/trees/tags don't.
    // Build a sha → path map and a list of shas to size-check.
    const shaToPath = new Map();
    const shas = [];
    for (const line of revListOutput.split('\n')) {
        const space = line.indexOf(' ');
        if (space === -1) continue;
        const sha = line.slice(0, space);
        const path = line.slice(space + 1);
        if (!sha || !path) continue;
        shaToPath.set(sha, path);
        shas.push(sha);
    }
    if (shas.length === 0) return [];

    // Feed sha list to cat-file --batch-check; output is "<sha> <type> <size>\n".
    let batchOutput;
    try {
        batchOutput = await git.raw(
            ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
            { input: shas.join('\n') + '\n' },
        );
    } catch {
        return [];
    }

    const oversized = [];
    for (const line of batchOutput.split('\n')) {
        if (!line) continue;
        const [sha, type, sizeStr] = line.split(' ');
        if (type !== 'blob') continue;
        const sizeBytes = Number(sizeStr);
        if (!Number.isFinite(sizeBytes) || sizeBytes <= thresholdBytes) continue;
        const path = shaToPath.get(sha);
        if (!path) continue;
        oversized.push({ path, sizeBytes });
        if (oversized.length >= limit) break;
    }

    // Largest first — easier for the UI to truncate and for users to triage.
    oversized.sort((a, b) => b.sizeBytes - a.sizeBytes);
    return oversized;
}

/**
 * Parse a `git push` stderr for GitHub's GH001 "exceeds file size limit"
 * messages. Each offending blob produces a line like:
 *   remote: error: File path/to/x.dll is 214.70 MB; this exceeds GitHub's file size limit of 100.00 MB
 *
 * Returns `{ files }` with bytes derived from the displayed unit so the
 * frontend can format consistently with the rest of the wizard.
 */
export function parseOversizedPushError(stderr) {
    if (!stderr || typeof stderr !== 'string') return null;
    if (!/GH001|exceeds GitHub's file size limit/i.test(stderr)) return null;

    const re = /remote:\s*error:\s*File\s+(.+?)\s+is\s+([\d.]+)\s*(KB|MB|GB|TB)\s*;\s*this exceeds GitHub's file size limit/gi;
    const unitToBytes = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
    const files = [];
    let m;
    while ((m = re.exec(stderr)) !== null) {
        const [, path, value, unit] = m;
        files.push({ path, sizeBytes: Math.round(Number(value) * unitToBytes[unit]) });
    }
    if (files.length === 0) return null;
    return { files };
}

/**
 * Serialise structured oversized-files info into the single `error_message`
 * TEXT column. We prefix with a sentinel so consumers can distinguish from
 * a plain-text error without adding a new column or a separate channel.
 */
export function encodeOversizedError(files, fallbackMessage) {
    const payload = JSON.stringify({ files });
    return `${STRUCTURED_ERROR_PREFIX}${payload}|${fallbackMessage || 'GitHub rejected push due to oversized files.'}`;
}

/**
 * Inverse of `encodeOversizedError`. Returns null for plain-text errors
 * so callers can fall back to rendering the raw message.
 */
export function decodeOversizedError(errorMessage) {
    if (typeof errorMessage !== 'string') return null;
    if (!errorMessage.startsWith(STRUCTURED_ERROR_PREFIX)) return null;
    const rest = errorMessage.slice(STRUCTURED_ERROR_PREFIX.length);
    const pipe = rest.indexOf('|');
    const json = pipe === -1 ? rest : rest.slice(0, pipe);
    const fallback = pipe === -1 ? '' : rest.slice(pipe + 1);
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed.files)) return null;
        return { files: parsed.files, fallback };
    } catch {
        return null;
    }
}
