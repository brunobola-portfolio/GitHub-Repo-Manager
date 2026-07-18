// @vitest-environment node
//
// Cancel-really-cancels: unit tests for the cancellation mechanics added to
// importRepository (server/import-service.js) — the 'repo' task type that
// does 95% of a migration's real work and was previously the one task type
// that never honored a cancel request (see docs/specs design doc B1).
//
// Two layers are tested:
//   1. throwIfCancelled / startCancelWatcher in isolation — the flag-check
//      and hard-abort primitives themselves.
//   2. importRepository end-to-end — proves a cancel request actually stops
//      the import at the next phase boundary (never reaches git clone) and
//      that a mid-git-operation abort is reported as 'cancelled', not
//      'failed'.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let cloneMock;
let capturedAbortSignals;

vi.mock('simple-git', () => ({
    simpleGit: vi.fn((a, b) => {
        // Mirrors both call shapes used in import-service.js:
        //   simpleGit({ timeout, abort })       — options only (clone)
        //   simpleGit(workDir, { abort })        — baseDir + options (lfs/push)
        const opts = typeof a === 'string' ? b : a;
        if (opts && opts.abort) capturedAbortSignals.push(opts.abort);
        return {
            version: vi.fn(async () => ({ installed: true })),
            clone: (...args) => cloneMock(...args),
            push: vi.fn(async () => {}),
            addRemote: vi.fn(async () => {}),
            listRemote: vi.fn(async () => ''),
            raw: vi.fn(async (args) => {
                if (Array.isArray(args) && args[0] === 'for-each-ref') return 'refs/heads/main\n';
                if (Array.isArray(args) && args[0] === 'symbolic-ref') return 'main\n';
                if (Array.isArray(args) && args[0] === 'lfs') return '';
                return '';
            }),
        };
    }),
}));

vi.mock('../lib/url-validator.js', () => ({
    isInternalUrl: vi.fn(() => false),
    resolveAndValidateHost: vi.fn(async () => true),
}));

vi.mock('../lib/oversized-blobs.js', () => ({
    findOversizedBlobs: vi.fn(async () => []),
    parseOversizedPushError: vi.fn(() => null),
    encodeOversizedError: vi.fn((files, msg) => msg),
    GITHUB_FILE_SIZE_LIMIT_BYTES: 100 * 1024 * 1024,
}));

import { importRepository, throwIfCancelled, startCancelWatcher } from '../import-service.js';

const okCreateResponse = () => ({
    ok: true,
    json: async () => ({
        full_name: 'acme/widget',
        html_url: 'https://github.com/acme/widget',
        default_branch: null,
    }),
});

describe('throwIfCancelled', () => {
    it('throws a CANCELLED-coded error once isCancelled() reports true', () => {
        let thrown;
        try { throwIfCancelled(() => true); } catch (e) { thrown = e; }
        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.message).toBe('Migration cancelled');
        expect(thrown.code).toBe('CANCELLED');
    });

    it('is a no-op while isCancelled() reports false', () => {
        expect(() => throwIfCancelled(() => false)).not.toThrow();
    });
});

describe('startCancelWatcher', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('trips the AbortController the first poll after isCancelled() flips true', () => {
        let flag = false;
        const controller = new AbortController();
        const timer = startCancelWatcher(() => flag, controller);

        vi.advanceTimersByTime(1200);
        expect(controller.signal.aborted).toBe(false);

        flag = true;
        vi.advanceTimersByTime(400);
        expect(controller.signal.aborted).toBe(true);

        clearInterval(timer);
    });

    it('never aborts while isCancelled() stays false', () => {
        const controller = new AbortController();
        const timer = startCancelWatcher(() => false, controller);
        vi.advanceTimersByTime(10000);
        expect(controller.signal.aborted).toBe(false);
        clearInterval(timer);
    });
});

describe('importRepository — cancellation', () => {
    beforeEach(() => {
        global.fetch = vi.fn();
        cloneMock = vi.fn(async () => {});
        capturedAbortSignals = [];
    });
    afterEach(() => { delete global.fetch; vi.restoreAllMocks(); });

    it('cancel between phases: stops before ever cloning when cancellation is requested while the create-repo call is in flight', async () => {
        let cancelled = false;
        global.fetch.mockImplementationOnce(async () => {
            // Simulate the user clicking Cancel while the create-repo request is
            // still in flight — the NEXT phase boundary (before clone) must honor
            // the flag, and clone must never be reached.
            cancelled = true;
            return okCreateResponse();
        });

        const result = await importRepository({
            sourceUrl: 'https://github.com/src/widget.git',
            targetOwner: 'acme',
            targetName: 'widget',
            githubToken: 'gh',
            isCancelled: () => cancelled,
        });

        expect(result).toMatchObject({ success: false, cancelled: true, error: 'Migration cancelled' });
        expect(cloneMock).not.toHaveBeenCalled();
    });

    it('cancel-requested flag honored: never even reaches the create-repo call when cancellation is requested up front', async () => {
        const result = await importRepository({
            sourceUrl: 'https://github.com/src/widget.git',
            targetOwner: 'acme',
            targetName: 'widget',
            githubToken: 'gh',
            isCancelled: () => true,
        });

        expect(result).toMatchObject({ success: false, cancelled: true, error: 'Migration cancelled' });
        expect(global.fetch).not.toHaveBeenCalled();
        expect(cloneMock).not.toHaveBeenCalled();
    });

    it('reports the run as cancelled (not failed) when the clone rejects while cancellation was requested — the hard-abort path', async () => {
        global.fetch.mockResolvedValue(okCreateResponse());
        let cancelled = false;
        cloneMock.mockImplementation(async () => {
            // Cancellation lands exactly as the clone (the hard-abort target) is
            // running — this is what happens for real once the AbortController
            // watcher kills the child git process mid-clone.
            cancelled = true;
            throw new Error('fatal: The remote end hung up unexpectedly');
        });

        const result = await importRepository({
            sourceUrl: 'https://github.com/src/widget.git',
            targetOwner: 'acme',
            targetName: 'widget',
            githubToken: 'gh',
            isCancelled: () => cancelled,
        });

        expect(result).toMatchObject({ success: false, cancelled: true, error: 'Migration cancelled' });
    });

    it('does NOT misreport a genuine clone failure as cancelled when no cancellation was ever requested', async () => {
        global.fetch.mockResolvedValue(okCreateResponse());
        cloneMock.mockRejectedValue(new Error('fatal: repository not found'));

        const result = await importRepository({
            sourceUrl: 'https://github.com/src/widget.git',
            targetOwner: 'acme',
            targetName: 'widget',
            githubToken: 'gh',
            isCancelled: () => false,
        });

        expect(result.success).toBe(false);
        expect(result.cancelled).toBeUndefined();
        expect(result.error).toMatch(/repository not found/);
    });

    it('threads a real AbortSignal into the git instance used for clone (genuine hard-abort wiring, not just a flag)', async () => {
        global.fetch.mockResolvedValue(okCreateResponse());
        cloneMock.mockResolvedValue(undefined);

        const result = await importRepository({
            sourceUrl: 'https://github.com/src/widget.git',
            targetOwner: 'acme',
            targetName: 'widget',
            githubToken: 'gh',
            isCancelled: () => false,
        });

        expect(result.success).toBe(true);
        expect(capturedAbortSignals.length).toBeGreaterThan(0);
        expect(capturedAbortSignals[0]).toBeInstanceOf(AbortSignal);
        expect(capturedAbortSignals[0].aborted).toBe(false);
    });

    it('is backward compatible: omitting isCancelled behaves exactly as before (no cancellation)', async () => {
        global.fetch.mockResolvedValue(okCreateResponse());
        cloneMock.mockResolvedValue(undefined);

        const result = await importRepository({
            sourceUrl: 'https://github.com/src/widget.git',
            targetOwner: 'acme',
            targetName: 'widget',
            githubToken: 'gh',
        });

        expect(result.success).toBe(true);
        expect(result.cancelled).toBeUndefined();
    });
});
