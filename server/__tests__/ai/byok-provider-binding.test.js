// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Repo Insights and Semantic Search must spend the USER's key, not the
 * operator's.
 *
 * `requireAI` gates these routes on the caller's BYOK provider, but the
 * `aiService` wrapper bound every feature method to `this.provider` — the
 * server-wide key resolved from the environment. With a server key set, every
 * BYOK user's indexing and search silently billed the operator. In the
 * BYOK-only deployment `.env.example` recommends there is no server key at
 * all, so the same calls threw instead — and Semantic Search is sold on all
 * three tiers.
 *
 * The underlying `ai-features/*` functions already take a `ctx.provider`, so
 * the fix is to stop the wrapper from overriding it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }));
vi.mock('../../db.js', () => ({ default: {} }));

const analyzeRepo = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const embedText = vi.hoisted(() => vi.fn(async () => [0.1, 0.2]));
const semanticSearch = vi.hoisted(() => vi.fn(async () => []));
const enhanceReadme = vi.hoisted(() => vi.fn(async () => 'readme'));
const reviewPullRequest = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('../../lib/ai-features/repo-analysis.js', async (io) => ({
    ...(await io()), analyzeRepo,
}));
vi.mock('../../lib/ai-features/semantic-search.js', async (io) => ({
    ...(await io()), embedText, semanticSearch,
}));
vi.mock('../../lib/ai-features/readme-enhance.js', async (io) => ({
    ...(await io()), enhanceReadme,
}));
vi.mock('../../lib/ai-features/pr-review.js', async (io) => ({
    ...(await io()), reviewPullRequest,
}));

const { aiService } = await import('../../ai-service.js');

const OPERATOR = { model: 'operator-model', embeddingModel: 'operator-embed', __who: 'operator' };
const USER = { model: 'user-model', embeddingModel: 'user-embed', __who: 'user' };

beforeEach(() => {
    for (const fn of [analyzeRepo, embedText, semanticSearch, enhanceReadme, reviewPullRequest]) fn.mockClear();
    // Simulate an operator who has a server-wide key configured — the case
    // where the bug costs money rather than throwing.
    aiService.provider = OPERATOR;
});

describe('aiService spends the caller-supplied provider', () => {
    it('analyzeRepo uses the user provider when one is passed', async () => {
        await aiService.analyzeRepo({ full_name: 'a/b' }, 'readme', 'tree', USER);
        expect(analyzeRepo.mock.calls[0][0].provider).toBe(USER);
    });

    it('embedText uses the user provider when one is passed', async () => {
        await aiService.embedText('text', USER);
        expect(embedText.mock.calls[0][0].provider).toBe(USER);
    });

    it('semanticSearch uses the user provider when one is passed', async () => {
        await aiService.semanticSearch('q', 5, 7, USER);
        expect(semanticSearch.mock.calls[0][0].provider).toBe(USER);
    });

    it('enhanceReadme uses the user provider when one is passed', async () => {
        await aiService.enhanceReadme('cur', { full_name: 'a/b' }, 'tree', USER);
        expect(enhanceReadme.mock.calls[0][0].provider).toBe(USER);
    });

    it('reviewPullRequest uses the user provider when one is passed', async () => {
        await aiService.reviewPullRequest([], [], {}, USER);
        expect(reviewPullRequest.mock.calls[0][0].provider).toBe(USER);
    });

    it('still falls back to the server provider when no caller provider exists', async () => {
        // Background jobs and the legacy callers have no request in scope.
        await aiService.analyzeRepo({ full_name: 'a/b' }, 'readme', 'tree');
        expect(analyzeRepo.mock.calls[0][0].provider).toBe(OPERATOR);
    });

    it('never silently swaps a passed provider for the operator one', async () => {
        // The whole defect in one assertion: with BOTH set, the user's must win.
        await aiService.semanticSearch('q', 5, 7, USER);
        expect(semanticSearch.mock.calls[0][0].provider).not.toBe(OPERATOR);
    });
});

describe('every route callsite hands over the caller provider', () => {
    // Making the wrapper accept a provider fixes nothing on its own — the
    // routes have to pass one. That is an omission failure mode, so gate it
    // statically: the next route that calls a provider-backed aiService method
    // and forgets `req.aiProvider` bills the operator, silently, again.
    const PROVIDER_BACKED = ['analyzeRepo', 'embedText', 'semanticSearch', 'enhanceReadme', 'reviewPullRequest'];

    function routeCalls() {
        const found = [];
        const dir = 'server/routes';
        for (const rel of readdirSync(dir, { recursive: true })) {
            if (typeof rel !== 'string' || !rel.endsWith('.js')) continue;
            const file = join(dir, rel);
            const src = readFileSync(file, 'utf8');
            for (const method of PROVIDER_BACKED) {
                const re = new RegExp(`aiService\\.${method}\\(([^;]*?)\\)\\s*;`, 'g');
                let m;
                while ((m = re.exec(src)) !== null) {
                    found.push({ file, method, args: m[1], line: src.slice(0, m.index).split('\n').length });
                }
            }
        }
        return found;
    }

    const calls = routeCalls();

    it('finds the callsites at all (guards the scanner itself)', () => {
        expect(calls.length).toBeGreaterThanOrEqual(5);
    });

    it('passes req.aiProvider at every callsite', () => {
        const missing = calls
            .filter(({ args }) => !/\breq\.aiProvider\b/.test(args))
            .map(({ file, line, method }) => `${file}:${line} (${method})`);

        expect(missing, 'these would spend the operator key for a BYOK user').toEqual([]);
    });
});
