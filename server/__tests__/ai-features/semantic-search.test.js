import { describe, it, expect, vi } from 'vitest';
import {
    cosineSimilarity,
    embedText,
    semanticSearch,
    findSimilarById,
} from '../../lib/ai-features/semantic-search.js';
import { AIError, AI_ERROR_CODE } from '../../lib/ai-provider.js';

function buildProvider(overrides = {}) {
    return {
        model: {},
        embeddingModel: {},
        embed: vi.fn(async () => [1, 0, 0]),
        ...overrides,
    };
}

function buildDb(rows) {
    // Minimal better-sqlite3 lookalike: prepare(sql).all() / .get()
    return {
        prepare: (sql) => ({
            all: (..._args) => rows.all ?? [],
            get: (..._args) => rows.get ?? null,
            _sql: sql,
        }),
    };
}

describe('ai-features/semantic-search.cosineSimilarity', () => {
    it('returns 1 for identical vectors, 0 for orthogonal', () => {
        expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });
});

describe('ai-features/semantic-search.embedText', () => {
    it('delegates to provider.embed (happy path)', async () => {
        const provider = buildProvider();
        const out = await embedText({ provider }, 'query');
        expect(provider.embed).toHaveBeenCalledWith('query');
        expect(out).toEqual([1, 0, 0]);
    });

    it('maps NOT_FOUND embedding errors to a clearer message (error path)', async () => {
        const provider = buildProvider({
            embed: vi.fn(async () => {
                throw new AIError({ code: AI_ERROR_CODE.NOT_FOUND, message: 'no model', status: 404 });
            }),
        });
        await expect(embedText({ provider }, 'q')).rejects.toThrow(/not available/);
    });
});

describe('ai-features/semantic-search.semanticSearch', () => {
    it('scores rows with cosine similarity and returns top-N (happy path)', async () => {
        const rows = [
            { repo_id: 1, embedding: JSON.stringify([1, 0, 0]) },
            { repo_id: 2, embedding: JSON.stringify([0, 1, 0]) },
        ];
        const db = buildDb({ all: rows });
        const provider = buildProvider({ embed: vi.fn(async () => [1, 0, 0]) });
        const out = await semanticSearch({ provider, db }, 'query', 5);
        expect(out[0].repo_id).toBe(1);
        expect(out[0].score).toBeCloseTo(1);
    });

    it('returns [] when no embedding model is configured (error path)', async () => {
        const provider = { model: {}, embeddingModel: null, embed: vi.fn() };
        const db = buildDb({ all: [] });
        const out = await semanticSearch({ provider, db }, 'query', 5);
        expect(out).toEqual([]);
    });
});

describe('ai-features/semantic-search.findSimilarById', () => {
    it('returns null when target repo is not indexed', async () => {
        const db = buildDb({ get: null });
        const result = await findSimilarById({ db }, 999);
        expect(result).toBeNull();
    });

    it('scores + sorts candidates by similarity (happy path)', async () => {
        const target = { embedding: JSON.stringify([1, 0, 0]) };
        const others = [
            { repo_id: 2, embedding: JSON.stringify([0, 1, 0]), topics: null, summary: 'B' },
            { repo_id: 3, embedding: JSON.stringify([1, 0, 0]), topics: null, summary: 'C' },
        ];
        // prepare() returns first with .get(), then .all() for others.
        const db = {
            prepare: () => ({
                get: () => target,
                all: () => others,
            }),
        };
        const out = await findSimilarById({ db }, 1, { topK: 2 });
        expect(out[0].repoId).toBe(3);
        expect(out[0].score).toBeCloseTo(1);
        expect(out[1].repoId).toBe(2);
    });
});
