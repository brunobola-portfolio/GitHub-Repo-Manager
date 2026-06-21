// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { findErrorKbEntry, ERROR_KB } from '../lib/ai-features/error-kb.js';

describe('findErrorKbEntry', () => {
    it('matches by explicit error code (case-insensitive)', () => {
        expect(findErrorKbEntry({ code: 'GIT_LFS_MISSING' })?.id).toBe('git-lfs-missing');
        expect(findErrorKbEntry({ code: 'git_lfs_missing' })?.id).toBe('git-lfs-missing');
    });

    it('matches the git-lfs unit error by message substring', () => {
        const e = findErrorKbEntry({ message: 'Cannot parse --above=<n>: unknown unit: "m"' });
        expect(e?.id).toBe('lfs-migrate-failed');
    });

    it('matches oversized files by code and by message', () => {
        expect(findErrorKbEntry({ code: 'OVERSIZED_FILES' })?.id).toBe('oversized-files');
        expect(findErrorKbEntry({ message: '3 file(s) exceeded GitHub\'s 100 MB limit during push' })?.id).toBe('oversized-files');
    });

    it('prefers an explicit code over a weaker message match', () => {
        const e = findErrorKbEntry({ code: 'GIT_LFS_MISSING', message: 'something about 100 MB' });
        expect(e?.id).toBe('git-lfs-missing');
    });

    it('returns null when nothing matches', () => {
        expect(findErrorKbEntry({ message: 'totally unrelated text' })).toBeNull();
        expect(findErrorKbEntry({})).toBeNull();
    });

    it('every entry has the required shape', () => {
        expect(ERROR_KB.length).toBeGreaterThan(0);
        for (const e of ERROR_KB) {
            expect(typeof e.id).toBe('string');
            expect(Array.isArray(e.codes)).toBe(true);
            expect(Array.isArray(e.matchers)).toBe(true);
            expect(typeof e.title).toBe('string');
            expect(typeof e.cause).toBe('string');
            expect(Array.isArray(e.fix) && e.fix.length > 0).toBe(true);
            expect(typeof e.docs).toBe('string');
        }
    });
});
