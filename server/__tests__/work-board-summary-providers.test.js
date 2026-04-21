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
            vi.doMock('../lib/ai-provider.js', () => ({
                createProviderForUser: vi.fn(async () => provider),
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
