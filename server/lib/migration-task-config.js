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
    let obj = {};
    if (config && typeof config === 'object') {
        obj = config;
    } else if (typeof config === 'string') {
        try { obj = JSON.parse(config) || {}; } catch { obj = {}; }
    }
    return JSON.stringify({ ...obj, onConflict: 'replace' });
}
