import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAIDeepReview } from '../../src/hooks/useAIDeepReview';

const sampleDraft = { walkthrough: { summary: 'ok' }, lineComments: [] };

beforeEach(() => {
    global.fetch = vi.fn();
});

function jsonResponse(status, body) {
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

describe('useAIDeepReview', () => {
    it('loads cached draft on mount', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, draft: sampleDraft }));
        const { result } = renderHook(() => useAIDeepReview('acme', 'api', 42));
        await waitFor(() => expect(result.current.draft).toEqual(sampleDraft));
        expect(result.current.draftId).toBe(1);
    });

    it('treats 404 as no-draft (loading=false, draft=null)', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(404, { code: 'NOT_FOUND' }));
        const { result } = renderHook(() => useAIDeepReview('acme', 'api', 42));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.draft).toBeNull();
    });

    it('generate() calls POST and updates state', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(404, {}));
        const { result } = renderHook(() => useAIDeepReview('acme', 'api', 42));
        await waitFor(() => expect(result.current.loading).toBe(false));

        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 7, draft: sampleDraft }));
        await act(async () => { await result.current.generate(); });
        expect(result.current.draftId).toBe(7);
        expect(result.current.draft).toEqual(sampleDraft);
    });

    it('dismiss(idx) PATCHes with action=dismiss', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, draft: { walkthrough: {}, lineComments: [{ body: 'x' }] } }));
        const { result } = renderHook(() => useAIDeepReview('acme', 'api', 42));
        await waitFor(() => expect(result.current.draft).toBeTruthy());

        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, draft: { walkthrough: {}, lineComments: [] } }));
        await act(async () => { await result.current.dismiss(0); });
        expect(global.fetch).toHaveBeenLastCalledWith(
            '/api/ai/deep-review/1/comments/0',
            expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"dismiss"') })
        );
        expect(result.current.draft.lineComments).toHaveLength(0);
    });

    it('publish() POSTs and reports the github review id', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, draft: sampleDraft }));
        const { result } = renderHook(() => useAIDeepReview('acme', 'api', 42));
        await waitFor(() => expect(result.current.draft).toBeTruthy());

        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, githubReviewId: 9999 }));
        let pubResult;
        await act(async () => { pubResult = await result.current.publish('COMMENT'); });
        expect(pubResult.githubReviewId).toBe(9999);
    });

    it('publish() marks the local draft as published', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, draft: sampleDraft }));
        const { result } = renderHook(() => useAIDeepReview('acme', 'api', 42));
        await waitFor(() => expect(result.current.draft).toBeTruthy());

        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, githubReviewId: 9999 }));
        await act(async () => { await result.current.publish('COMMENT'); });
        expect(result.current.draft.status).toBe('published');
        expect(result.current.draft.githubReviewId).toBe(9999);
    });

    it('publish() with queued response sets draft.status="publishing"', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, draft: sampleDraft }));
        const { result } = renderHook(() => useAIDeepReview('acme', 'api', 42));
        await waitFor(() => expect(result.current.draft).toBeTruthy());

        global.fetch.mockReturnValueOnce(jsonResponse(202, { draftId: 1, queued: true, outboxId: 42 }));
        let pubResult;
        await act(async () => { pubResult = await result.current.publish('COMMENT'); });
        expect(pubResult.queued).toBe(true);
        expect(result.current.draft.status).toBe('publishing');
        expect(result.current.draft.outboxId).toBe(42);
    });
});
