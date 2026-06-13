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

import { decideConflictResolution } from '../import-service.js';

describe('decideConflictResolution', () => {
    it('reuses an empty repo (size 0, no default branch) regardless of onConflict', () => {
        expect(decideConflictResolution({ size: 0, defaultBranch: null, onConflict: 'fail' }))
            .toEqual({ action: 'reuse' });
        expect(decideConflictResolution({ size: 0, defaultBranch: null, onConflict: 'replace' }))
            .toEqual({ action: 'reuse' });
    });

    it('replaces a non-empty repo when onConflict is "replace"', () => {
        expect(decideConflictResolution({ size: 1234, defaultBranch: 'main', onConflict: 'replace' }))
            .toEqual({ action: 'replace' });
    });

    it('fails on a non-empty repo when onConflict is not "replace"', () => {
        expect(decideConflictResolution({ size: 1234, defaultBranch: 'main', onConflict: 'fail' }))
            .toEqual({ action: 'fail' });
        expect(decideConflictResolution({ size: 1234, defaultBranch: 'main', onConflict: undefined }))
            .toEqual({ action: 'fail' });
    });

    it('treats size 0 WITH a default branch as non-empty (stale-read guard)', () => {
        expect(decideConflictResolution({ size: 0, defaultBranch: 'main', onConflict: 'fail' }))
            .toEqual({ action: 'fail' });
        expect(decideConflictResolution({ size: 0, defaultBranch: 'main', onConflict: 'replace' }))
            .toEqual({ action: 'replace' });
    });
});
