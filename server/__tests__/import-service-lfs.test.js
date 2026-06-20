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

import { lfsPushNeeded } from '../import-service.js';

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
