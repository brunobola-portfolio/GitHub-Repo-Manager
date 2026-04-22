import logger from '../logger.js';
import { AIError, AI_ERROR_CODE } from '../ai-provider.js';

/**
 * Cosine similarity between two equal-length vectors.
 * Returns a score in [-1, 1].
 */
export function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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
            const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
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

    const targetVec = JSON.parse(row.embedding);

    let others;
    if (userId !== undefined && userId !== null) {
        others = excludeSelf
            ? db.prepare('SELECT re.repo_id, re.embedding, rm.topics, rm.summary FROM repo_embeddings re LEFT JOIN repo_metadata rm ON re.repo_id = rm.repo_id AND re.user_id = rm.user_id WHERE re.user_id = ? AND re.repo_id != ?').all(userId, repoId)
            : db.prepare('SELECT re.repo_id, re.embedding, rm.topics, rm.summary FROM repo_embeddings re LEFT JOIN repo_metadata rm ON re.repo_id = rm.repo_id AND re.user_id = rm.user_id WHERE re.user_id = ?').all(userId);
    } else {
        others = excludeSelf
            ? db.prepare('SELECT re.repo_id, re.embedding, rm.topics, rm.summary FROM repo_embeddings re LEFT JOIN repo_metadata rm ON re.repo_id = rm.repo_id WHERE re.repo_id != ?').all(repoId)
            : db.prepare('SELECT re.repo_id, re.embedding, rm.topics, rm.summary FROM repo_embeddings re LEFT JOIN repo_metadata rm ON re.repo_id = rm.repo_id').all();
    }

    const scored = others.map(o => {
        const vec = JSON.parse(o.embedding);
        return {
            repoId: o.repo_id,
            score: cosineSimilarity(targetVec, vec),
            description: o.summary || ''
        };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
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

    // 3. Rank by similarity
    const results = rows.map(row => {
        const embedding = JSON.parse(row.embedding);
        const score = cosineSimilarity(queryEmbedding, embedding);
        return { repo_id: row.repo_id, score };
    });

    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
