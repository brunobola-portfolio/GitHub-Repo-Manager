// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A suggested topic the user cannot actually use is not a suggestion.
 *
 * `analyzeRepo` passed the model's `suggested_topics` straight through, and the
 * modal renders them as "#Machine Learning"-style chips. GitHub topics — and
 * this app's own topicsSchema — accept only `^[a-z0-9-]+$`, so anything with a
 * capital, a space, or a dot is rejected the moment it is applied. Normalising
 * at the source keeps what is displayed and what is storable the same thing.
 */
import { describe, it, expect, vi } from 'vitest';
import { topicsSchema } from '../../lib/validators.js';

vi.mock('../../lib/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { analyzeRepo } = await import('../../lib/ai-features/repo-analysis.js');

function providerReturning(topics) {
    return {
        model: 'test-model',
        generate: vi.fn(async () => ({
            text: JSON.stringify({
                summary: 's', project_type: 'tool', suggested_topics: topics,
                improvements: [], readme_suggestions: [], highlights: [],
            }),
            usage: null,
            costUSD: null,
        })),
    };
}

const REPO = { name: 'api', full_name: 'acme/api', description: 'd', language: 'JavaScript', topics: [] };

describe('analyzeRepo normalises suggested topics', () => {
    it('produces topics the app own topicsSchema accepts', async () => {
        const provider = providerReturning(['Machine Learning', 'CI/CD', 'node.js', 'REST APIs']);
        const result = await analyzeRepo({ provider }, REPO, '', []);

        const parsed = topicsSchema.safeParse({ names: result.suggested_topics });
        expect(
            parsed.success,
            `unusable topics ${JSON.stringify(result.suggested_topics)}: ${parsed.error?.issues?.map((i) => i.message).join('; ')}`,
        ).toBe(true);
    });

    it('drops anything that cannot be normalised rather than emitting it broken', async () => {
        const provider = providerReturning(['ok-topic', '???', '', '   ']);
        const result = await analyzeRepo({ provider }, REPO, '', []);
        expect(result.suggested_topics).toEqual(['ok-topic']);
    });

    it('leaves an already-valid list untouched', async () => {
        const provider = providerReturning(['react', 'vite', 'open-source']);
        const result = await analyzeRepo({ provider }, REPO, '', []);
        expect(result.suggested_topics).toEqual(['react', 'vite', 'open-source']);
    });
});
