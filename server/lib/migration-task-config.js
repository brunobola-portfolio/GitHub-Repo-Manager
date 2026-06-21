/**
 * Helpers for mutating a migration task's stored `config` blob.
 *
 * Tasks persist their config as a JSON string in `migration_tasks.config`.
 * The replace-retry recovery path needs to inject the destructive
 * `onConflict: 'replace'` intent into an already-stored config without
 * losing the other fields — and without choking on a malformed/empty blob.
 */

/**
 * Return a JSON string of the task config with `onConflict: 'replace'` set,
 * tolerating string, object, null/undefined, or malformed input.
 * @param {string|object|null|undefined} config
 * @returns {string} serialized config including `onConflict: 'replace'`
 */
export function withReplaceOnConflict(config) {
    return withPatch(config, { onConflict: 'replace' });
}

/**
 * Return a JSON string of the task config with `sizeStrategy: 'lfs-migrate'`
 * set, so a re-run converts large blobs to LFS pointers
 * (`git lfs migrate import --above=100MiB`) and clears GitHub's 100 MB per-file
 * rejection. Tolerates string, object, null/undefined, or malformed input.
 * @param {string|object|null|undefined} config
 * @returns {string} serialized config including `sizeStrategy: 'lfs-migrate'`
 */
export function withLfsMigrate(config) {
    return withPatch(config, { sizeStrategy: 'lfs-migrate' });
}

/**
 * Parse a config blob (string/object/null/malformed) into an object and merge
 * the given patch over it, returning a JSON string.
 * @param {string|object|null|undefined} config
 * @param {object} patch
 * @returns {string}
 */
function withPatch(config, patch) {
    let obj = {};
    if (config && typeof config === 'object') {
        obj = config;
    } else if (typeof config === 'string') {
        try { obj = JSON.parse(config) || {}; } catch { obj = {}; }
    }
    return JSON.stringify({ ...obj, ...patch });
}
