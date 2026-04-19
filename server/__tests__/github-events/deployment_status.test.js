// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => {
    const mockRun = vi.fn(() => ({ changes: 1 }));
    const mockPrepare = vi.fn(() => ({ run: mockRun }));
    return {
        default: { prepare: mockPrepare },
        __mockPrepare: mockPrepare,
        __mockRun: mockRun,
    };
});

vi.mock('../../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { default as db, __mockPrepare as mockPrepare, __mockRun as mockRun } from '../../db.js';
import { handle } from '../../lib/github-events/deployment_status.js';

function makePayload(overrides = {}) {
    return {
        deployment_status: {
            state: 'success',
        },
        deployment: {
            id: 77,
            environment: 'production',
            sha: 'abc123',
            ref: 'main',
        },
        repository: { id: 303, full_name: 'org/service' },
        ...overrides,
    };
}

describe('deployment_status handler', () => {
    beforeEach(() => {
        mockPrepare.mockClear();
        mockRun.mockClear();
        mockRun.mockReturnValue({ changes: 1 });
        mockPrepare.mockReturnValue({ run: mockRun });
    });

    it('success → inserts deployment_events row with environment and state', async () => {
        let capturedArgs = [];
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT OR IGNORE INTO deployment_events')) {
                return { run: vi.fn((...args) => { capturedArgs = args; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        await handle(makePayload(), 'delivery-deploy-1');

        expect(capturedArgs[0]).toBe('delivery-deploy-1');
        expect(capturedArgs[1]).toBe(303);
        expect(capturedArgs[2]).toBe('org/service');
        expect(capturedArgs[3]).toBe(77);          // deployment_id
        expect(capturedArgs[4]).toBe('production'); // environment
        expect(capturedArgs[5]).toBe('success');   // state
        expect(capturedArgs[6]).toBe('abc123');    // sha
        expect(capturedArgs[7]).toBe('main');      // ref
    });

    it('failure state → stored correctly', async () => {
        let capturedState = '';
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT OR IGNORE INTO deployment_events')) {
                return { run: vi.fn((...args) => { capturedState = args[5]; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        await handle(makePayload({ deployment_status: { state: 'failure' } }), 'delivery-deploy-2');

        expect(capturedState).toBe('failure');
    });

    it('staging environment → stored correctly', async () => {
        let capturedEnv = '';
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT OR IGNORE INTO deployment_events')) {
                return { run: vi.fn((...args) => { capturedEnv = args[4]; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        await handle(
            makePayload({ deployment: { id: 88, environment: 'staging', sha: 'def456', ref: 'main' } }),
            'delivery-deploy-3'
        );

        expect(capturedEnv).toBe('staging');
    });

    it('duplicate deliveryId → INSERT OR IGNORE handles idempotency without throwing', async () => {
        mockRun.mockReturnValue({ changes: 0 });
        await expect(handle(makePayload(), 'delivery-dup')).resolves.not.toThrow();
    });

    it('malformed payload (missing deployment_status) → handler does not throw', async () => {
        await expect(handle({ deployment: { id: 1 }, repository: { id: 1 } }, 'bad')).resolves.not.toThrow();
        expect(mockPrepare).not.toHaveBeenCalled();
    });
});
