// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockProvider = { type: 'anthropic', modelName: 'claude-sonnet-4-5', generate: vi.fn() };
vi.mock('../lib/ai-provider.js', async (importOriginal) => ({
    ...(await importOriginal()),
    createProviderForUser: vi.fn(async () => mockProvider),
}));

const { buildFactSheet, generateSummary, SUMMARY_SCHEMA, SYSTEM_PROMPT } = await import('../lib/work-board-summary.js');

describe('buildFactSheet', () => {
    it('includes counts and top-5 lines for each source', () => {
        const fact = buildFactSheet({
            reviews: [{ repoFullName: 'o/r', prNumber: 1, title: 'X', authorLogin: 'a', ageHours: 2 }],
            stalePRs: [],
            issues: [{ repoFullName: 'o/r', issueNumber: 9, title: 'Y', ageDays: 3, labels: ['bug'] }],
            techDebt: { items: [], hotspots: [] },
        });
        expect(fact).toContain('pending reviews: 1');
        expect(fact).toContain('o/r#1');
        expect(fact).toContain('open issues: 1');
        expect(fact.length).toBeLessThan(4000);
    });

    it('truncates each section to top 5', () => {
        const many = Array.from({ length: 12 }, (_, i) => ({
            repoFullName: 'o/r', prNumber: i + 1, title: `t${i}`, authorLogin: 'a', ageHours: i,
        }));
        const fact = buildFactSheet({ reviews: many, stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } });
        expect(fact.match(/o\/r#/g).length).toBe(5);
    });

    it('includes hotspots section when present', () => {
        const fact = buildFactSheet({
            reviews: [], stalePRs: [], issues: [],
            techDebt: { items: [], hotspots: [{ repoFullName: 'a/b', count: 5 }, { repoFullName: 'c/d', count: 2 }] },
        });
        expect(fact).toContain('debt hotspots');
        expect(fact).toContain('a/b(5)');
    });
});

describe('generateSummary', () => {
    beforeEach(() => {
        mockProvider.generate.mockReset();
    });

    it('passes prompt + systemPrompt + schema to provider', async () => {
        mockProvider.generate.mockResolvedValue({
            text: '',
            parsed: { headline: 'All quiet', bullets: [{ text: 'Nothing urgent', severity: 'info' }], urgencyScore: 0.1 },
        });
        const summary = await generateSummary({
            userId: 1,
            dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } },
        });
        expect(summary).toMatchObject({ headline: 'All quiet', urgencyScore: 0.1 });
        const call = mockProvider.generate.mock.calls[0][0];
        expect(call.systemPrompt).toBe(SYSTEM_PROMPT);
        expect(call.schema).toBe(SUMMARY_SCHEMA);
        expect(call.prompt).toContain('pending reviews');
    });

    it('uses parsed when provider returns structured output', async () => {
        mockProvider.generate.mockResolvedValue({
            text: 'ignored',
            parsed: { headline: 'h', bullets: [{ text: 'b', severity: 'info' }], urgencyScore: 0.5 },
        });
        const s = await generateSummary({ userId: 1, dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } } });
        expect(s.headline).toBe('h');
    });

    it('falls back to tolerant text extraction when parsed is missing', async () => {
        mockProvider.generate.mockResolvedValue({
            text: 'prefix\n```json\n{"headline":"h","bullets":[{"text":"b","severity":"info"}],"urgencyScore":0.2}\n```\ntrailing',
        });
        const s = await generateSummary({ userId: 1, dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } } });
        expect(s.headline).toBe('h');
    });

    it('extracts JSON even without markdown fence (first { to last })', async () => {
        mockProvider.generate.mockResolvedValue({
            text: 'Sure, here is the summary: {"headline":"h","bullets":[{"text":"b","severity":"info"}],"urgencyScore":0.2} Let me know if you need more.',
        });
        const s = await generateSummary({ userId: 1, dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } } });
        expect(s.headline).toBe('h');
    });

    it('clamps urgencyScore into [0,1]', async () => {
        mockProvider.generate.mockResolvedValue({
            text: '', parsed: { headline: 'h', bullets: [{ text: 'b', severity: 'info' }], urgencyScore: 1.7 },
        });
        const s = await generateSummary({ userId: 1, dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } } });
        expect(s.urgencyScore).toBe(1);
    });

    it('truncates headline to 200 chars and bullets to 5 items', async () => {
        const bullets = Array.from({ length: 10 }, () => ({ text: 'b', severity: 'info' }));
        mockProvider.generate.mockResolvedValue({
            text: '', parsed: { headline: 'a'.repeat(400), bullets, urgencyScore: 0.5 },
        });
        const s = await generateSummary({ userId: 1, dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } } });
        expect(s.headline).toHaveLength(200);
        expect(s.bullets).toHaveLength(5);
    });

    it('includes provider + model metadata in response', async () => {
        mockProvider.generate.mockResolvedValue({
            text: '', parsed: { headline: 'h', bullets: [{ text: 'b', severity: 'info' }], urgencyScore: 0 },
        });
        const s = await generateSummary({ userId: 1, dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } } });
        expect(s.provider).toBe('anthropic');
        expect(s.model).toBe('claude-sonnet-4-5');
    });

    it('throws ai_not_configured when createProviderForUser returns null', async () => {
        const { createProviderForUser } = await import('../lib/ai-provider.js');
        createProviderForUser.mockResolvedValueOnce(null);
        await expect(
            generateSummary({ userId: 1, dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } } })
        ).rejects.toThrow(/ai_not_configured/);
    });

    it('throws ai_invalid_response when neither parsed nor text can be parsed', async () => {
        mockProvider.generate.mockResolvedValue({ text: 'just plain text, no json here' });
        await expect(
            generateSummary({ userId: 1, dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } } })
        ).rejects.toThrow(/ai_invalid_response/);
    });
});

describe('SUMMARY_SCHEMA', () => {
    // Regression guard: Gemini rejects `enum` unless the property also declares
    // `type: 'string'`. An earlier revision omitted `type` on severity and
    // link.type and the /work-board/ai-summary endpoint responded 500 for any
    // user whose provider was Gemini (including the server fallback key).
    it('declares type: "string" on every enum property', () => {
        const bulletProps = SUMMARY_SCHEMA.properties.bullets.items.properties;
        expect(bulletProps.severity).toEqual(expect.objectContaining({ type: 'string' }));
        expect(bulletProps.severity.enum).toEqual(['high', 'medium', 'info']);
        expect(bulletProps.link.properties.type).toEqual(expect.objectContaining({ type: 'string' }));
        expect(bulletProps.link.properties.type.enum).toEqual(['pr', 'issue']);
    });
});
