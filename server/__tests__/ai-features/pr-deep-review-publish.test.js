import { describe, it, expect } from 'vitest';
import { buildGitHubReviewPayload, FOOTER_REGEX } from '../../lib/ai-features/pr-deep-review-publish.js';

const draft = {
    walkthrough: {
        summary: 'Adds X.',
        perFileTable: [
            { path: 'a.js', change: 'modified', summary: 'tweak' },
            { path: 'b.js', change: 'added', summary: 'new helper' },
        ],
        mermaid: 'sequenceDiagram\n  A->>B: hi',
        estimatedReviewTime: '10 min',
        riskLevel: 'low',
    },
    lineComments: [
        { path: 'a.js', side: 'RIGHT', line: 12, severity: 'warning', body: 'use ===' },
        { path: 'a.js', side: 'RIGHT', line: 20, startLine: 18, severity: 'suggestion', body: 'extract helper', suggestion: 'function helper() {}\nreturn helper();' },
    ],
    modelUsed: 'gemini-2.5-flash',
};

const meta = { commitId: 'abc123def456', user: 'alice', costUSD: 0.04, lastReviewedSha: null };

describe('buildGitHubReviewPayload', () => {
    it('produces a single batched review payload', () => {
        const out = buildGitHubReviewPayload({ draft, meta, event: 'COMMENT' });
        expect(out.commit_id).toBe('abc123def456');
        expect(out.event).toBe('COMMENT');
        expect(out.comments).toHaveLength(2);
    });

    it('renders walkthrough summary, table, mermaid, and footer in the body', () => {
        const out = buildGitHubReviewPayload({ draft, meta, event: 'COMMENT' });
        expect(out.body).toContain('Adds X.');
        expect(out.body).toContain('| a.js |');
        expect(out.body).toContain('| b.js |');
        expect(out.body).toContain('```mermaid');
        expect(out.body).toContain('sequenceDiagram');
        expect(out.body).toMatch(FOOTER_REGEX);
        expect(out.body).toContain('@alice');
        expect(out.body).toContain('gemini-2.5-flash');
    });

    it('omits mermaid block when source is empty', () => {
        const noMermaid = { ...draft, walkthrough: { ...draft.walkthrough, mermaid: '' } };
        const out = buildGitHubReviewPayload({ draft: noMermaid, meta, event: 'COMMENT' });
        expect(out.body).not.toContain('```mermaid');
    });

    it('wraps suggestion text in a ```suggestion fence with original body', () => {
        const out = buildGitHubReviewPayload({ draft, meta, event: 'COMMENT' });
        const withSuggestion = out.comments[1];
        expect(withSuggestion.body).toContain('extract helper');
        expect(withSuggestion.body).toContain('```suggestion');
        expect(withSuggestion.body).toContain('function helper()');
    });

    it('passes through start_line / start_side for multi-line comments', () => {
        const out = buildGitHubReviewPayload({ draft, meta, event: 'COMMENT' });
        const multi = out.comments[1];
        expect(multi.start_line).toBe(18);
        expect(multi.start_side).toBe('RIGHT');
    });

    it('omits start_line on single-line comments', () => {
        const out = buildGitHubReviewPayload({ draft, meta, event: 'COMMENT' });
        const single = out.comments[0];
        expect(single.start_line).toBeUndefined();
        expect(single.start_side).toBeUndefined();
    });

    it('truncates body when over 50,000 chars and appends [truncated]', () => {
        const huge = {
            ...draft,
            walkthrough: { ...draft.walkthrough, summary: 'x'.repeat(60000) },
        };
        const out = buildGitHubReviewPayload({ draft: huge, meta, event: 'COMMENT' });
        expect(out.body.length).toBeLessThan(55000);
        expect(out.body).toContain('[truncated]');
    });

    it('shows "Incremental from <sha7>" when lastReviewedSha provided', () => {
        const out = buildGitHubReviewPayload({ draft, meta: { ...meta, lastReviewedSha: 'deadbeef1234' }, event: 'COMMENT' });
        expect(out.body).toContain('deadbee');
    });

    it('escapes \\r\\n in cell content (CRLF safety)', () => {
        const crlfDraft = {
            ...draft,
            walkthrough: {
                ...draft.walkthrough,
                perFileTable: [{ path: 'a.js', change: 'modified', summary: 'line1\r\nline2' }],
            },
        };
        const out = buildGitHubReviewPayload({ draft: crlfDraft, meta, event: 'COMMENT' });
        expect(out.body).toContain('| a.js | modified | line1 line2 |');
        expect(out.body).not.toMatch(/line1\r/);
    });

    it('escapes pipes in cell content', () => {
        const pipeDraft = {
            ...draft,
            walkthrough: {
                ...draft.walkthrough,
                perFileTable: [{ path: 'a|b.js', change: 'added', summary: 'foo|bar' }],
            },
        };
        const out = buildGitHubReviewPayload({ draft: pipeDraft, meta, event: 'COMMENT' });
        expect(out.body).toContain('a\\|b.js');
        expect(out.body).toContain('foo\\|bar');
    });

    it('uses a longer fence when suggestion contains triple backticks', () => {
        const tickyDraft = {
            ...draft,
            lineComments: [
                { path: 'a.js', side: 'RIGHT', line: 1, severity: 'info', body: 'b', suggestion: 'before\n```\ncode\n```\nafter' },
            ],
        };
        const out = buildGitHubReviewPayload({ draft: tickyDraft, meta, event: 'COMMENT' });
        const cmt = out.comments[0];
        // Outer fence must be 4+ backticks
        expect(cmt.body).toMatch(/````+suggestion\n/);
        expect(cmt.body).toMatch(/\n````+$/);
    });

    it('uses a longer fence when mermaid source contains triple backticks', () => {
        const tickyMermaid = {
            ...draft,
            walkthrough: { ...draft.walkthrough, mermaid: 'sequenceDiagram\n```\nA->>B: hi' },
        };
        const out = buildGitHubReviewPayload({ draft: tickyMermaid, meta, event: 'COMMENT' });
        expect(out.body).toMatch(/````+mermaid\n/);
    });
});
