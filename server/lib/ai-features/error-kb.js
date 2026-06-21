// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Authored error knowledge base for Repo Advisor (Phase 2, Slice 1).
 *
 * A small, version-controlled catalog of known product errors with a cause and
 * concrete fix. It exists so the in-app assistant can ANSWER "how do I fix
 * this?" instead of failing — the gap that left the Git LFS migration error
 * unanswered. Content is FIRST-PARTY/authored (not user or repo content), so
 * injecting it into a prompt adds no prompt-injection surface.
 *
 * Lookup is deterministic (exact error code, then message matchers) — more
 * reliable than embeddings for short, exact error strings like
 * `unknown unit: "m"`. A DB-backed, embedded KB is a later slice (Slice 4) for
 * when this outgrows a curated module.
 *
 * Each entry: { id, codes[], matchers: RegExp[], title, cause, fix[], docs }.
 * Do NOT use the `g` flag on matchers (RegExp.test is stateful with `g`).
 */

export const ERROR_KB = [
    {
        id: 'git-lfs-missing',
        codes: ['GIT_LFS_MISSING'],
        matchers: [
            /git[- ]lfs is not installed/i,
            /'?lfs'? is not a git command/i,
        ],
        title: 'Git LFS is not installed on the migration server',
        cause:
            'The repository has files over GitHub\'s 100 MiB per-file limit and the migration is set to convert them to Git LFS, but the git-lfs binary is not available to the server process that runs the migration.',
        fix: [
            'Install Git LFS on the machine running the backend (https://git-lfs.com), e.g. `winget install GitHub.GitLFS` on Windows.',
            'Run `git lfs install --skip-repo` once to register the global LFS filters.',
            'Restart the backend so the running Node process picks up git-lfs on its PATH (a process started before the install will not see it).',
            'Retry the migration with the "Migrate to Git LFS" size strategy. Alternatively, choose "Exclude" to skip this repository.',
        ],
        docs: 'https://git-lfs.com',
    },
    {
        id: 'lfs-migrate-failed',
        codes: ['LFS_MIGRATE_FAILED'],
        matchers: [
            /converting large files to git lfs failed/i,
            /git[- ]lfs migrate/i,
            /unknown unit/i,
            /--above=<n>/i,
        ],
        title: 'Converting large files to Git LFS failed',
        cause:
            'The `git lfs migrate import` step failed, so the oversized blobs were left unconverted and the push was rejected. Common causes: git-lfs is not installed, or the conversion command hit an error (e.g. an invalid size unit).',
        fix: [
            'Confirm Git LFS is installed on the migration server: `git lfs version` should print a version.',
            'If it is missing, install it (https://git-lfs.com) and restart the backend so it is on the process PATH.',
            'Retry the migration with the "Migrate to Git LFS" strategy. If it still fails, check the backend logs for the underlying git-lfs error.',
        ],
        docs: 'https://github.com/git-lfs/git-lfs/wiki/Tutorial',
    },
    {
        id: 'oversized-files',
        codes: ['OVERSIZED_FILES'],
        matchers: [
            /exceed(ed|s)?\b.*100 ?mi?b/i,
            /100 ?mi?b (per-file )?limit/i,
            /file.*exceed.*github/i,
        ],
        title: 'Files exceed GitHub\'s 100 MiB per-file limit',
        cause:
            'GitHub rejects any single file larger than 100 MiB during a push, regardless of total repo size. One or more files in the repository history are over that limit.',
        fix: [
            'In the Migration Wizard, select the "Migrate to Git LFS" size strategy for the affected repository — it rewrites the oversized blobs as LFS pointers across history, then retry.',
            'This requires Git LFS installed on the migration server (https://git-lfs.com).',
            'Alternatively, choose "Exclude" on the Configure step to skip the repository.',
        ],
        docs: 'https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github',
    },
];

/**
 * Find the best-matching KB entry for an error. Matches by explicit error code
 * first (exact, case-insensitive), then by any message matcher. Pure (no I/O).
 *
 * @param {{ message?: string, code?: string }} [input]
 * @returns {object|null} the matching entry, or null
 */
export function findErrorKbEntry({ message = '', code = '' } = {}) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (normalizedCode) {
        const byCode = ERROR_KB.find((entry) =>
            entry.codes.some((k) => k.toUpperCase() === normalizedCode),
        );
        if (byCode) return byCode;
    }

    const text = String(message || '');
    if (text) {
        const byMessage = ERROR_KB.find((entry) =>
            entry.matchers.some((rx) => rx.test(text)),
        );
        if (byMessage) return byMessage;
    }

    return null;
}
