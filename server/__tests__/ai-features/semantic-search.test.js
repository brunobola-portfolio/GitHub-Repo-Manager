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

    it('skips candidate rows with malformed embedding JSON instead of crashing', async () => {
        const target = { embedding: JSON.stringify([1, 0, 0]) };
        const others = [
            { repo_id: 2, embedding: '{not valid json', topics: null, summary: 'corrupt' },
            { repo_id: 3, embedding: JSON.stringify([1, 0, 0]), topics: null, summary: 'C' },
        ];
        const db = {
            prepare: () => ({
                get: () => target,
                all: () => others,
            }),
        };
        const out = await findSimilarById({ db }, 1, { topK: 5 });
        // Only the well-formed row should remain.
        expect(out).toHaveLength(1);
        expect(out[0].repoId).toBe(3);
    });

    it('returns null when the target row\'s embedding is malformed', async () => {
        const db = {
            prepare: () => ({
                get: () => ({ embedding: 'totally bogus' }),
                all: () => [],
            }),
        };
        const result = await findSimilarById({ db }, 1);
        expect(result).toBeNull();
    });
});

/**
 * The ranking scan runs on the request thread over every indexed repo, so it
 * must pull nothing it does not need: no repo_metadata join for rows that will
 * never make the top-K, and no per-candidate recomputation of the query
 * vector's own norm.
 */
describe('ai-features/semantic-search — hot-path shape', () => {
    /** Record every SQL string prepared, and route .all()/.get() by table. */
    function recordingDb({ embeddings = [], metadata = [], target = null }) {
        const sql = [];
        return {
            sql,
            prepare(text) {
                sql.push(text);
                const isMetadata = /FROM repo_metadata/.test(text);
                return {
                    get: () => target,
                    all: () => (isMetadata ? metadata : embeddings),
                };
            },
        };
    }

    it('does not touch repo_metadata while scanning candidates', async () => {
        const db = recordingDb({
            target: { embedding: JSON.stringify([1, 0, 0]) },
            embeddings: [
                { repo_id: 2, embedding: JSON.stringify([0, 1, 0]) },
                { repo_id: 3, embedding: JSON.stringify([1, 0, 0]) },
            ],
            metadata: [{ repo_id: 3, summary: 'C' }, { repo_id: 2, summary: 'B' }],
        });

        await findSimilarById({ db }, 1, { topK: 2 });

        const scanSql = db.sql.find((s) => /FROM repo_embeddings/.test(s) && /repo_id != /.test(s));
        expect(scanSql).toBeDefined();
        expect(scanSql).not.toMatch(/repo_metadata/);
        expect(scanSql).not.toMatch(/JOIN/i);
        expect(scanSql).not.toMatch(/summary/);
        expect(scanSql).not.toMatch(/topics/);
    });

    it('still returns the winners descriptions, fetched only for the winners', async () => {
        const db = recordingDb({
            target: { embedding: JSON.stringify([1, 0, 0]) },
            embeddings: [
                { repo_id: 2, embedding: JSON.stringify([0, 1, 0]) },
                { repo_id: 3, embedding: JSON.stringify([1, 0, 0]) },
                { repo_id: 4, embedding: JSON.stringify([0.9, 0.1, 0]) },
            ],
            metadata: [{ repo_id: 3, summary: 'C' }, { repo_id: 4, summary: 'D' }],
        });

        const out = await findSimilarById({ db }, 1, { topK: 2 });
        expect(out.map((r) => r.repoId)).toEqual([3, 4]);
        expect(out.map((r) => r.description)).toEqual(['C', 'D']);

        const lookup = db.sql.find((s) => /FROM repo_metadata/.test(s));
        // One bound placeholder per winner — never the whole candidate set.
        expect(lookup.match(/\?/g)).toHaveLength(2);
        expect(lookup).not.toMatch(/'/); // ids stay bound, never interpolated
    });

    it('scopes the summary lookup by user when a tenant is given', async () => {
        const db = recordingDb({
            target: { embedding: JSON.stringify([1, 0, 0]) },
            embeddings: [{ repo_id: 3, embedding: JSON.stringify([1, 0, 0]) }],
            metadata: [{ repo_id: 3, summary: 'C' }],
        });

        await findSimilarById({ db }, 1, { topK: 5, userId: 42 });
        const lookup = db.sql.find((s) => /FROM repo_metadata/.test(s));
        expect(lookup).toMatch(/user_id = \?/);
    });

    it('skips the summary query entirely when nothing scored', async () => {
        const db = recordingDb({ target: { embedding: JSON.stringify([1, 0, 0]) }, embeddings: [] });
        const out = await findSimilarById({ db }, 1, { topK: 5 });
        expect(out).toEqual([]);
        expect(db.sql.some((s) => /repo_metadata/.test(s))).toBe(false);
    });

    it('degrades to empty descriptions when the summary lookup fails', async () => {
        const db = {
            prepare(text) {
                if (/repo_metadata/.test(text)) throw new Error('no such table: repo_metadata');
                return {
                    get: () => ({ embedding: JSON.stringify([1, 0, 0]) }),
                    all: () => [{ repo_id: 3, embedding: JSON.stringify([1, 0, 0]) }],
                };
            },
        };
        const out = await findSimilarById({ db }, 1, { topK: 5 });
        expect(out).toEqual([{ repoId: 3, score: expect.closeTo(1, 5), description: '' }]);
    });

    it('hoisting the query norm does not change any score', () => {
        // Reference implementation: norms recomputed inside the loop.
        const naive = (a, b) => {
            let dot = 0, na = 0, nb = 0;
            for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
            return dot / (Math.sqrt(na) * Math.sqrt(nb));
        };
        const vectors = [
            [[1, 2, 3], [4, 5, 6]],
            [[0.1, -0.2, 0.3, 0.4], [-0.5, 0.6, 0.7, -0.8]],
            [[3, 0, 0], [3, 0, 0]],
            [[1, 0], [0, 1]],
        ];
        for (const [a, b] of vectors) {
            expect(cosineSimilarity(a, b)).toBeCloseTo(naive(a, b), 12);
        }
    });
});

describe('ai-features/semantic-search.semanticSearch — malformed rows', () => {
    it('skips rows with malformed embedding JSON instead of throwing', async () => {
        const rows = [
            { repo_id: 1, embedding: JSON.stringify([1, 0, 0]) },
            { repo_id: 2, embedding: '{this is invalid' },
            { repo_id: 3, embedding: JSON.stringify([0, 1, 0]) },
        ];
        const db = buildDb({ all: rows });
        const provider = buildProvider({ embed: vi.fn(async () => [1, 0, 0]) });
        const out = await semanticSearch({ provider, db }, 'query', 5);
        const ids = out.map(r => r.repo_id);
        expect(ids).toContain(1);
        expect(ids).toContain(3);
        expect(ids).not.toContain(2);
    });
});
