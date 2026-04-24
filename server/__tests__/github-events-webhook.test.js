// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any import that transitively loads the SUT
// ---------------------------------------------------------------------------
vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock auth middleware — control signature verification per test
const mockVerifyWebhookSignature = vi.fn(() => true);
const mockErrorResponse = vi.fn((res, status, message) => {
    res.statusCode = status;
    res.body = { error: message };
    return res;
});

vi.mock('../middleware/auth.js', () => ({
    verifyWebhookSignature: (...args) => mockVerifyWebhookSignature(...args),
    errorResponse: (...args) => mockErrorResponse(...args),
}));

// Mock all event handlers
const mockPullRequestHandle = vi.fn(() => Promise.resolve());
const mockPRReviewHandle = vi.fn(() => Promise.resolve());
const mockIssuesHandle = vi.fn(() => Promise.resolve());
const mockDeploymentHandle = vi.fn(() => Promise.resolve());

vi.mock('../lib/github-events/pull_request.js', () => ({
    handle: (...args) => mockPullRequestHandle(...args),
}));
vi.mock('../lib/github-events/pull_request_review.js', () => ({
    handle: (...args) => mockPRReviewHandle(...args),
}));
vi.mock('../lib/github-events/issues.js', () => ({
    handle: (...args) => mockIssuesHandle(...args),
}));
vi.mock('../lib/github-events/deployment_status.js', () => ({
    handle: (...args) => mockDeploymentHandle(...args),
}));

// Mock work-board-tracking so its transitive DB imports don't run
vi.mock('../lib/work-board-tracking.js', () => ({
    upsertTrackedRepoFromWebhook: vi.fn(),
}));

// Mock db — the router uses it directly for the owner-user lookup
vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn(() => ({ get: vi.fn(() => null), run: vi.fn() })),
    },
}));

import { githubEventsWebhookHandler } from '../routes/github-events-webhook.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeReqRes({ headers = {}, body = Buffer.from('{}') } = {}) {
    const req = { headers, body };
    const res = {
        statusCode: 200,
        body: null,
        headersSent: false,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.headersSent = true; return this; },
    };
    return { req, res };
}

function validPayloadBuffer(data = { action: 'opened' }) {
    return Buffer.from(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('githubEventsWebhookHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockVerifyWebhookSignature.mockReturnValue(true);
        mockPullRequestHandle.mockResolvedValue(undefined);
        mockPRReviewHandle.mockResolvedValue(undefined);
        mockIssuesHandle.mockResolvedValue(undefined);
        mockDeploymentHandle.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 on bad signature', async () => {
        mockVerifyWebhookSignature.mockReturnValue(false);

        const { req, res } = makeReqRes({
            headers: {
                'x-hub-signature-256': 'sha256=badsig',
                'x-github-event': 'pull_request',
                'x-github-delivery': 'del-1',
            },
        });

        await githubEventsWebhookHandler(req, res);

        expect(mockErrorResponse).toHaveBeenCalledWith(res, 401, 'Invalid webhook signature');
    });

    it('returns 400 on missing X-GitHub-Event header', async () => {
        const { req, res } = makeReqRes({
            headers: {
                'x-hub-signature-256': 'sha256=valid',
                'x-github-delivery': 'del-2',
                // no x-github-event
            },
        });

        await githubEventsWebhookHandler(req, res);

        expect(mockErrorResponse).toHaveBeenCalledWith(res, 400, 'Missing X-GitHub-Event header');
    });

    it('returns 200 on valid pull_request event and invokes handler', async () => {
        const payload = { action: 'opened', pull_request: { number: 1 } };
        const { req, res } = makeReqRes({
            headers: {
                'x-hub-signature-256': 'sha256=valid',
                'x-github-event': 'pull_request',
                'x-github-delivery': 'del-3',
            },
            body: validPayloadBuffer(payload),
        });

        await githubEventsWebhookHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ received: true, eventType: 'pull_request' });
        expect(mockPullRequestHandle).toHaveBeenCalledWith(payload, 'del-3');
    });

    it('returns 200 on unknown event type and does not crash', async () => {
        const { req, res } = makeReqRes({
            headers: {
                'x-hub-signature-256': 'sha256=valid',
                'x-github-event': 'push',
                'x-github-delivery': 'del-4',
            },
            body: validPayloadBuffer({ ref: 'refs/heads/main' }),
        });

        await githubEventsWebhookHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ received: true, eventType: 'push' });
        // No handler should have been called
        expect(mockPullRequestHandle).not.toHaveBeenCalled();
        expect(mockIssuesHandle).not.toHaveBeenCalled();
    });

    it('routes issues event to issues handler', async () => {
        const payload = { action: 'opened', issue: { number: 5 } };
        const { req, res } = makeReqRes({
            headers: {
                'x-hub-signature-256': 'sha256=valid',
                'x-github-event': 'issues',
                'x-github-delivery': 'del-5',
            },
            body: validPayloadBuffer(payload),
        });

        await githubEventsWebhookHandler(req, res);

        expect(mockIssuesHandle).toHaveBeenCalledWith(payload, 'del-5');
    });

    it('routes deployment_status event to deployment handler', async () => {
        const payload = { deployment_status: { state: 'success' } };
        const { req, res } = makeReqRes({
            headers: {
                'x-hub-signature-256': 'sha256=valid',
                'x-github-event': 'deployment_status',
                'x-github-delivery': 'del-6',
            },
            body: validPayloadBuffer(payload),
        });

        await githubEventsWebhookHandler(req, res);

        expect(mockDeploymentHandle).toHaveBeenCalledWith(payload, 'del-6');
    });

    it('response is returned BEFORE handler completes (async dispatch)', async () => {
        const order = [];

        // Slow handler — records when it starts and finishes
        mockPullRequestHandle.mockImplementation(async () => {
            order.push('handler-start');
            await new Promise((r) => setTimeout(r, 10));
            order.push('handler-end');
        });

        // Wrap res.json to record when 200 was sent
        const { req, res } = makeReqRes({
            headers: {
                'x-hub-signature-256': 'sha256=valid',
                'x-github-event': 'pull_request',
                'x-github-delivery': 'del-7',
            },
            body: validPayloadBuffer({ action: 'opened' }),
        });

        const originalJson = res.json.bind(res);
        res.json = function (payload) {
            order.push('response-sent');
            return originalJson(payload);
        };

        await githubEventsWebhookHandler(req, res);

        // Response is sent before handler completes, but handler runs eventually.
        // Because we await the full handler in test, both entries will be present.
        // The key assertion: response-sent comes before handler-end.
        expect(order.indexOf('response-sent')).toBeLessThan(order.indexOf('handler-end'));
    });

    it('handler error → logged but does not crash the process', async () => {
        mockPullRequestHandle.mockRejectedValue(new Error('DB write failed'));

        const { req, res } = makeReqRes({
            headers: {
                'x-hub-signature-256': 'sha256=valid',
                'x-github-event': 'pull_request',
                'x-github-delivery': 'del-8',
            },
            body: validPayloadBuffer({ action: 'opened' }),
        });

        // Should resolve without throwing
        await expect(githubEventsWebhookHandler(req, res)).resolves.not.toThrow();
        expect(res.statusCode).toBe(200);
    });
});
