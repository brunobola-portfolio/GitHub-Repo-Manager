// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// simple-git is constructed at import time; stub it to keep the import light.
vi.mock('simple-git', () => ({
    simpleGit: () => ({
        version: vi.fn(async () => ({ installed: true })),
        clone: vi.fn(async () => {}),
        push: vi.fn(async () => {}),
    }),
}));

import { lfsPushNeeded, ensureGitLfs, LFS_MIGRATE_IMPORT_ARGS } from '../import-service.js';

describe('ensureGitLfs', () => {
    it('resolves when `git lfs version` succeeds', async () => {
        await expect(ensureGitLfs(async () => 'git-lfs/3.4.0 (GitHub)')).resolves.toBeUndefined();
    });

    it('throws a coded, actionable error when git-lfs is not installed', async () => {
        const runRaw = async () => { throw new Error("git: 'lfs' is not a git command"); };
        await expect(ensureGitLfs(runRaw)).rejects.toMatchObject({ code: 'GIT_LFS_MISSING' });
        await expect(ensureGitLfs(runRaw)).rejects.toThrow(/git lfs is not installed|git-lfs/i);
    });
});

describe('LFS_MIGRATE_IMPORT_ARGS', () => {
    it('uses a size unit git-lfs can parse for --above (not a bare "M")', () => {
        // Regression: `--above=100M` is rejected by git-lfs with
        // `unknown unit: "m"`, which silently aborts the conversion and
        // surfaces later as an opaque "exceeded 100 MB during push" failure.
        const above = LFS_MIGRATE_IMPORT_ARGS.find((a) => a.startsWith('--above='));
        expect(above).toBeDefined();
        const value = above.split('=')[1];
        // git-lfs ParseBytes accepts b/kb/mb/gb/tb and the binary kib/mib/gib/tib.
        expect(value).toMatch(/^\d+(b|kb|mb|gb|tb|kib|mib|gib|tib)$/i);
    });

    it('converts across all refs, non-interactively', () => {
        expect(LFS_MIGRATE_IMPORT_ARGS.slice(0, 3)).toEqual(['lfs', 'migrate', 'import']);
        expect(LFS_MIGRATE_IMPORT_ARGS).toEqual(
            expect.arrayContaining(['--everything', '--yes']),
        );
    });
});

describe('lfsPushNeeded', () => {
    it('true when the source already used LFS', () => {
        expect(lfsPushNeeded(true, undefined)).toBe(true);
    });

    it('true when lfs-migrate converted blobs (even if source had no LFS)', () => {
        // Regression: the LFS objects created by `git lfs migrate import` MUST be
        // pushed, or the target gets pointers to objects that do not exist.
        expect(lfsPushNeeded(false, 'lfs-migrate')).toBe(true);
    });

    it('false for a plain non-LFS migration', () => {
        expect(lfsPushNeeded(false, undefined)).toBe(false);
        expect(lfsPushNeeded(false, 'exclude')).toBe(false);
    });
});
