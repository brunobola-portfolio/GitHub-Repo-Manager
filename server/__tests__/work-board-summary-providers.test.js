// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const makeProvider = (type) => ({
    type,
    modelName: `${type}-test-model`,
    generate: vi.fn(async () => ({
        text: '',
        parsed: {
            headline: `${type} headline within bounds`,
            bullets: [
                { text: `${type} info bullet`, severity: 'info' },
                { text: `${type} medium bullet with link`, severity: 'medium', link: { type: 'pr', repo: 'o/r', number: 1 } },
            ],
            urgencyScore: 0.3,
        },
    })),
});

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'openrouter', 'local'];

for (const p of PROVIDERS) {
    describe(`AI summary — provider ${p}`, () => {
        it('produces a response that satisfies the schema contract', async () => {
            vi.resetModules();
            const provider = makeProvider(p);
            vi.doMock('../lib/ai-provider.js', async (importOriginal) => ({
                ...(await importOriginal()),
                createProviderForUser: vi.fn(async () => provider),
                AI_ERROR_CODE: { INVALID_RESPONSE: 'INVALID_RESPONSE' },
            }));
            const { generateSummary, SUMMARY_SCHEMA } = await import('../lib/work-board-summary.js');

            const summary = await generateSummary({
                userId: 1,
                dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } },
            });

            expect(summary.headline.length).toBeGreaterThan(0);
            expect(summary.headline.length).toBeLessThanOrEqual(200);
            expect(summary.bullets.length).toBeGreaterThanOrEqual(1);
            expect(summary.bullets.length).toBeLessThanOrEqual(5);
            for (const b of summary.bullets) {
                expect(typeof b.text).toBe('string');
                expect(['high', 'medium', 'info']).toContain(b.severity);
            }
            expect(summary.urgencyScore).toBeGreaterThanOrEqual(0);
            expect(summary.urgencyScore).toBeLessThanOrEqual(1);
            expect(summary.provider).toBe(p);
            expect(summary.model).toBe(`${p}-test-model`);
            expect(provider.generate).toHaveBeenCalledTimes(1);
            const call = provider.generate.mock.calls[0][0];
            expect(call.systemPrompt).toBeTruthy();
            expect(call.schema).toBe(SUMMARY_SCHEMA);
        });
    });
}

// ---------------------------------------------------------------------------
// Schema-less fallback path — keeps free-tier / non-compliant models usable.
// ---------------------------------------------------------------------------

describe('AI summary — tolerant fallback', () => {
    const validPayload = {
        headline: 'Stale PRs up 50% — 3 in org/api',
        bullets: [{ text: 'Review #42 today', severity: 'medium' }],
        urgencyScore: 0.4,
    };

    it('retries without schema when the first call throws AIError(INVALID_RESPONSE), parsing JSON from prose', async () => {
        vi.resetModules();
        const generate = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error('not parseable'), {
                name: 'AIError',
                code: 'INVALID_RESPONSE',
            }))
            .mockResolvedValueOnce({
                text: `Here is the summary you asked for:\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\`\nLet me know if you want more detail.`,
            });
        const provider = { type: 'openrouter', modelName: 'flaky/free', generate };
        vi.doMock('../lib/ai-provider.js', async (importOriginal) => ({
                ...(await importOriginal()),
            createProviderForUser: vi.fn(async () => provider),
            AI_ERROR_CODE: { INVALID_RESPONSE: 'INVALID_RESPONSE' },
        }));
        const { generateSummary } = await import('../lib/work-board-summary.js');

        const summary = await generateSummary({
            userId: 1,
            dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } },
        });

        expect(generate).toHaveBeenCalledTimes(2);
        // First call carries the schema, second does NOT — that's the whole point.
        expect(generate.mock.calls[0][0].schema).toBeTruthy();
        expect(generate.mock.calls[1][0].schema).toBeUndefined();
        expect(summary.headline).toBe(validPayload.headline);
        expect(summary.bullets[0].text).toBe(validPayload.bullets[0].text);
    });

    it('does NOT retry when the first error is non-parse (auth/rate-limit/network)', async () => {
        vi.resetModules();
        const generate = vi.fn().mockRejectedValueOnce(Object.assign(new Error('401'), {
            name: 'AIError',
            code: 'AUTH',
        }));
        const provider = { type: 'openrouter', modelName: 'm', generate };
        vi.doMock('../lib/ai-provider.js', async (importOriginal) => ({
                ...(await importOriginal()),
            createProviderForUser: vi.fn(async () => provider),
            AI_ERROR_CODE: { INVALID_RESPONSE: 'INVALID_RESPONSE' },
        }));
        const { generateSummary } = await import('../lib/work-board-summary.js');

        await expect(generateSummary({
            userId: 1,
            dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } },
        })).rejects.toMatchObject({ name: 'AIError', code: 'AUTH' });

        expect(generate).toHaveBeenCalledTimes(1);
    });

    it('normalises bullets that use alias field names (content/repo/prNumber) instead of the schema shape', async () => {
        // Regression test for the minimax/minimax-m2.5:free case: the model
        // returns rich bullets but with field names it invented — `content`
        // for the text and `repo` + `prNumber` at the top level instead of
        // the nested `link` object. The UI was rendering empty dots because
        // `b.text` was undefined.
        vi.resetModules();
        const generate = vi.fn().mockResolvedValueOnce({
            text: '',
            parsed: {
                headline: 'Stale PRs untouched for 14+ days',
                bullets: [
                    { content: 'bolalabs/legacy#18 settings panel is 24 days old', repo: 'bolalabs/legacy', prNumber: 18 },
                    { content: 'WIP embeddings PR is 14 days old', repo: 'bolalabs/legacy', prNumber: 12 },
                    { content: 'Both are draft, not blocking, but cluttering' },
                ],
                urgencyScore: 0.4,
            },
        });
        const provider = { type: 'openrouter', modelName: 'minimax/minimax-m2.5:free', generate };
        vi.doMock('../lib/ai-provider.js', async (importOriginal) => ({
                ...(await importOriginal()),
            createProviderForUser: vi.fn(async () => provider),
            AI_ERROR_CODE: { INVALID_RESPONSE: 'INVALID_RESPONSE' },
        }));
        const { generateSummary } = await import('../lib/work-board-summary.js');

        const summary = await generateSummary({
            userId: 1,
            dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } },
        });

        expect(generate).toHaveBeenCalledTimes(1);
        expect(summary.bullets).toHaveLength(3);
        expect(summary.bullets[0].text).toBe('bolalabs/legacy#18 settings panel is 24 days old');
        expect(summary.bullets[0].link).toEqual({ type: 'pr', repo: 'bolalabs/legacy', number: 18 });
        expect(summary.bullets[1].text).toBe('WIP embeddings PR is 14 days old');
        expect(summary.bullets[2].text).toBe('Both are draft, not blocking, but cluttering');
        expect(summary.bullets[2].link).toBeUndefined();
        // Severity defaults to 'info' when the model omits it
        expect(summary.bullets.every(b => ['high', 'medium', 'info'].includes(b.severity))).toBe(true);
    });

    it('triggers schema-less retry when normalised bullets array is empty (all bullets had no text)', async () => {
        vi.resetModules();
        const generate = vi.fn()
            .mockResolvedValueOnce({
                text: '',
                parsed: { headline: 'A headline', bullets: [{ severity: 'info' }, { severity: 'high' }], urgencyScore: 0.2 },
            })
            .mockResolvedValueOnce({
                text: JSON.stringify({
                    headline: 'A headline',
                    bullets: [{ text: 'Real text now', severity: 'medium' }],
                    urgencyScore: 0.2,
                }),
            });
        const provider = { type: 'openrouter', modelName: 'm', generate };
        vi.doMock('../lib/ai-provider.js', async (importOriginal) => ({
                ...(await importOriginal()),
            createProviderForUser: vi.fn(async () => provider),
            AI_ERROR_CODE: { INVALID_RESPONSE: 'INVALID_RESPONSE' },
        }));
        const { generateSummary } = await import('../lib/work-board-summary.js');

        const summary = await generateSummary({
            userId: 1,
            dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } },
        });

        expect(generate).toHaveBeenCalledTimes(2);
        expect(summary.bullets[0].text).toBe('Real text now');
    });

    it('throws ai_invalid_response when both attempts produce unusable output', async () => {
        vi.resetModules();
        const generate = vi.fn()
            .mockResolvedValueOnce({ text: 'not json at all', parsed: null })
            .mockResolvedValueOnce({ text: 'still not json' });
        const provider = { type: 'openrouter', modelName: 'm', generate };
        vi.doMock('../lib/ai-provider.js', async (importOriginal) => ({
                ...(await importOriginal()),
            createProviderForUser: vi.fn(async () => provider),
            AI_ERROR_CODE: { INVALID_RESPONSE: 'INVALID_RESPONSE' },
        }));
        const { generateSummary } = await import('../lib/work-board-summary.js');

        await expect(generateSummary({
            userId: 1,
            dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } },
        })).rejects.toMatchObject({ code: 'ai_invalid_response' });

        expect(generate).toHaveBeenCalledTimes(2);
    });
});
