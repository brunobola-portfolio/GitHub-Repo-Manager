import logger from '../logger.js';
import { AIError, AI_ERROR_CODE, getGeminiModelDefaults } from '../ai-provider.js';

/**
 * Safely parse a stored embedding column. Embeddings are persisted as
 * `JSON.stringify(Array<number>)` but corrupted rows (truncated writes,
 * older schemas, manual edits) would crash the search loop with an
 * unguarded JSON.parse. Returns null on any failure so callers can skip.
 *
 * @param {string|null|undefined} json
 * @param {number|string} [repoId]   used only for the warn log breadcrumb
 * @returns {Array<number>|null}
 */
function parseEmbedding(json, repoId) {
    if (typeof json !== 'string' || json.length === 0) return null;
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) return null;
        return parsed;
    } catch (err) {
        logger.warn({ err, repoId }, 'semantic-search: skipping row with malformed embedding JSON');
        return null;
    }
}

/**
 * Euclidean norm of a vector.
 * @param {Array<number>} vec
 * @returns {number}
 */
function vectorNorm(vec) {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
    return Math.sqrt(sum);
}

/**
 * Cosine similarity against a fixed query vector whose norm is computed once.
 *
 * The ranking loops below compare ONE query vector against every indexed repo,
 * so recomputing the query's norm per candidate burns a third of the arithmetic
 * on an answer that never changes — at 3072 dimensions x hundreds of repos that
 * is tens of milliseconds of blocked event loop per request.
 *
 * @param {Array<number>} queryVec
 * @returns {(candidate: Array<number>) => number} score in [-1, 1]
 */
function makeCosineScorer(queryVec) {
    const queryNorm = vectorNorm(queryVec);
    return function score(candidate) {
        let dotProduct = 0;
        let normB = 0;
        for (let i = 0; i < queryVec.length; i++) {
            dotProduct += queryVec[i] * candidate[i];
            normB += candidate[i] * candidate[i];
        }
        return dotProduct / (queryNorm * Math.sqrt(normB));
    };
}

/**
 * Cosine similarity between two equal-length vectors.
 * Returns a score in [-1, 1].
 */
export function cosineSimilarity(vecA, vecB) {
    return makeCosineScorer(vecA)(vecB);
}

/**
 * Generate an embedding for a given text.
 * @param {object} ctx
 * @param {object} ctx.provider
 * @param {string} text
 */
export async function embedText(ctx, text) {
    const provider = ctx?.provider;
    if (!provider?.embeddingModel) {
        throw new Error('AI embedding model not initialized. Please check GEMINI_API_KEY configuration.');
    }

    try {
        return await provider.embed(text);
    } catch (error) {
        logger.error({ err: error }, 'Embedding generation failed');
        if (error instanceof AIError && error.code === AI_ERROR_CODE.NOT_FOUND) {
            const { embeddingModel } = getGeminiModelDefaults();
            throw new Error(`Embedding model "${embeddingModel}" is not available. Please verify your API access and GEMINI_EMBEDDING_MODEL configuration.`);
        }
        throw error;
    }
}

/**
 * Find repositories semantically similar to a given repo by its ID.
 * Queries only repos belonging to the same user (multi-tenancy).
 *
 * @param {object} ctx
 * @param {object} ctx.db - better-sqlite3 handle
 * @param {number|string} repoId
 * @param {object} opts
 * @param {number} opts.topK
 * @param {boolean} opts.excludeSelf
 * @param {number} [opts.userId]
 * @returns {Promise<Array|null>} Scored results, or null if repo is not indexed
 */
export async function findSimilarById(ctx, repoId, { topK = 5, excludeSelf = true, userId } = {}) {
    const db = ctx?.db;
    if (!db) throw new Error('findSimilarById: ctx.db is required');

    let row;
    if (userId !== undefined && userId !== null) {
        row = db.prepare('SELECT embedding FROM repo_embeddings WHERE repo_id = ? AND user_id = ?').get(repoId, userId);
    } else {
        row = db.prepare('SELECT embedding FROM repo_embeddings WHERE repo_id = ?').get(repoId);
    }
    if (!row) return null;

    const targetVec = parseEmbedding(row.embedding, repoId);
    if (!targetVec) return null;

    // The ranking scan pulls one row per indexed repo and only ever needs the
    // embedding. Joining repo_metadata here dragged a summary blob through for
    // every candidate when at most `topK` of them are ever read; those are
    // fetched below, once the winners are known.
    let others;
    if (userId !== undefined && userId !== null) {
        others = excludeSelf
            ? db.prepare('SELECT repo_id, embedding FROM repo_embeddings WHERE user_id = ? AND repo_id != ?').all(userId, repoId)
            : db.prepare('SELECT repo_id, embedding FROM repo_embeddings WHERE user_id = ?').all(userId);
    } else {
        others = excludeSelf
            ? db.prepare('SELECT repo_id, embedding FROM repo_embeddings WHERE repo_id != ?').all(repoId)
            : db.prepare('SELECT repo_id, embedding FROM repo_embeddings').all();
    }

    const score = makeCosineScorer(targetVec);
    const scored = others.flatMap(o => {
        const vec = parseEmbedding(o.embedding, o.repo_id);
        if (!vec) return [];
        return [{ repoId: o.repo_id, score: score(vec) }];
    });

    const winners = scored.sort((a, b) => b.score - a.score).slice(0, topK);
    const summaries = fetchSummaries(db, winners.map(w => w.repoId), userId);
    return winners.map(w => ({ ...w, description: summaries.get(w.repoId) || '' }));
}

/**
 * Look up repo_metadata summaries for a handful of repo ids.
 * Placeholders are generated from the id COUNT (never from the values), so the
 * ids themselves stay bound parameters.
 *
 * @param {object} db
 * @param {Array<number|string>} repoIds
 * @param {number} [userId]
 * @returns {Map<number|string, string>}
 */
function fetchSummaries(db, repoIds, userId) {
    const summaries = new Map();
    if (repoIds.length === 0) return summaries;
    const placeholders = repoIds.map(() => '?').join(',');
    const scoped = userId !== undefined && userId !== null;
    const sql = scoped
        ? `SELECT repo_id, summary FROM repo_metadata WHERE user_id = ? AND repo_id IN (${placeholders})`
        : `SELECT repo_id, summary FROM repo_metadata WHERE repo_id IN (${placeholders})`;
    try {
        const rows = db.prepare(sql).all(...(scoped ? [userId, ...repoIds] : repoIds));
        for (const row of rows) summaries.set(row.repo_id, row.summary);
    } catch (err) {
        // A missing summary degrades the result card, never the ranking.
        logger.warn({ err }, 'semantic-search: summary lookup failed');
    }
    return summaries;
}

/**
 * Natural-language semantic search across indexed repo embeddings.
 *
 * @param {object} ctx
 * @param {object} ctx.provider
 * @param {object} ctx.db
 * @param {string} query
 * @param {number} limit
 * @param {number} [userId] - Tenant user ID to scope results (omit for all)
 */
export async function semanticSearch(ctx, query, limit = 5, userId) {
    const provider = ctx?.provider;
    const db = ctx?.db;
    if (!db) throw new Error('semanticSearch: ctx.db is required');
    if (!provider?.embeddingModel) return [];

    // 1. Embed the query
    const queryEmbedding = await embedText(ctx, query);

    // 2. Fetch repo embeddings scoped by user (multi-tenancy)
    // Note: For large datasets, this is inefficient. optimize with FAISS or vector DB.
    let rows;
    if (userId !== undefined && userId !== null) {
        rows = db.prepare('SELECT repo_id, embedding FROM repo_embeddings WHERE user_id = ?').all(userId);
    } else {
        rows = db.prepare('SELECT repo_id, embedding FROM repo_embeddings').all();
    }

    // 3. Rank by similarity (skip rows whose embedding column is corrupted)
    const score = makeCosineScorer(queryEmbedding);
    const results = rows.flatMap(row => {
        const embedding = parseEmbedding(row.embedding, row.repo_id);
        if (!embedding) return [];
        return [{ repo_id: row.repo_id, score: score(embedding) }];
    });

    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
