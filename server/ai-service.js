import db from './db.js';
import logger from './lib/logger.js';
import { GeminiProvider, loadProviders, resolveServerProviderFromEnv } from './lib/ai-provider.js';
import { sanitizeForPrompt } from './lib/ai-features/sanitize.js';
import {
    detectPatterns,
    calculateQualityMetrics,
    getScoreSummary,
    generateQualityReport,
} from './lib/ai-features/quality-metrics.js';
import { analyzeRepo } from './lib/ai-features/repo-analysis.js';
import { enhanceReadme } from './lib/ai-features/readme-enhance.js';
import { reviewPullRequest } from './lib/ai-features/pr-review.js';
import {
    cosineSimilarity,
    embedText,
    findSimilarById,
    semanticSearch,
} from './lib/ai-features/semantic-search.js';

export { sanitizeForPrompt };

/**
 * AI service façade.
 *
 * State it still owns: the provider handle (initialized via .initialize()).
 * All per-feature logic lives in ./lib/ai-features/* and is composed here so
 * the public method surface (analyzeRepo, enhanceReadme, reviewPullRequest,
 * embedText, semanticSearch, findSimilarById, generateQualityReport,
 * detectPatterns, calculateQualityMetrics, cosineSimilarity) is preserved
 * for all existing route / worker consumers and tests.
 */
class AIService {
    constructor() {
        this.provider = null;
    }

    /**
     * Backward-compat getter: returns the raw SDK instance.
     * Used by req.genAI middleware and tests that mock the SDK directly.
     */
    get genAI() {
        return this.provider?.rawSDK ?? null;
    }

    /**
     * Backward-compat getter: returns the provider's main model handle.
     * External code that reads aiService.model continues to work.
     */
    get model() {
        return this.provider?.model ?? null;
    }

    /**
     * Backward-compat getter: returns the provider's embedding model handle.
     */
    get embeddingModel() {
        return this.provider?.embeddingModel ?? null;
    }

    async initialize(apiKey, modelName = null) {
        // Honor AI_PROVIDER server-wide: when a non-Gemini provider is
        // configured, build it from the registry (its module loads lazily).
        const providerName = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
        if (providerName !== 'gemini') {
            try {
                await loadProviders();
                this.provider = resolveServerProviderFromEnv();
                if (this.provider) {
                    logger.info({ provider: providerName }, 'AI Service: Initialized configured provider');
                } else {
                    logger.warn({ provider: providerName }, 'AI Service: AI_PROVIDER set but its API key is missing');
                }
            } catch (error) {
                logger.error({ err: error }, 'AI Service: Initialization failed');
                this.provider = null;
            }
            return;
        }

        if (!apiKey) {
            logger.warn('AI Service: No API key provided');
            return;
        }

        try {
            const model = modelName || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
            const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

            this.provider = new GeminiProvider({ apiKey, model, embeddingModel });

            if (this.provider.model) {
                logger.info({ model }, 'AI Service: Initialized with model');
            } else {
                logger.warn('Suggestion: Verify GEMINI_MODEL in .env or try: gemini-2.5-flash-lite, gemini-3-flash-preview');
            }

            if (this.provider.embeddingModel) {
                logger.info({ embeddingModel }, 'AI Service: Embedding model initialized');
            } else {
                logger.warn('Suggestion: Verify GEMINI_EMBEDDING_MODEL in .env or try: gemini-embedding-001, gemini-embedding-2-preview');
            }
        } catch (error) {
            logger.error({ err: error }, 'AI Service: Initialization failed');
            this.provider = null;
        }
    }

    // ── pattern / quality (pure) ──────────────────────────────────────────
    detectPatterns(readmeContent, fileStructure) {
        return detectPatterns(readmeContent, fileStructure);
    }

    calculateQualityMetrics(patterns, repoData) {
        return calculateQualityMetrics(patterns, repoData);
    }

    getScoreSummary(score) {
        return getScoreSummary(score);
    }

    generateQualityReport(repoData, readmeContent, fileStructure, extraData) {
        return generateQualityReport(repoData, readmeContent, fileStructure, extraData);
    }

    // ── embeddings / similarity ───────────────────────────────────────────
    cosineSimilarity(vecA, vecB) {
        return cosineSimilarity(vecA, vecB);
    }

    /**
     * Resolve which key pays for a call.
     *
     * Every method below used to hard-bind `this.provider` — the server-wide
     * key from the environment — while `requireAI` gated the same routes on
     * the caller's BYOK provider. With a server key set, a BYOK user's
     * indexing and search spent the OPERATOR's key; in the BYOK-only
     * deployment `.env.example` recommends, there is no server key and the
     * same calls threw. Callers with a request in scope must pass
     * `req.aiProvider`; the server provider stays as the fallback for
     * background work that has no user.
     */
    _resolveProvider(provider) {
        return provider || this.provider;
    }

    async embedText(text, provider) {
        return embedText({ provider: this._resolveProvider(provider) }, text);
    }

    async findSimilarById(repoId, opts = {}) {
        return findSimilarById({ db }, repoId, opts);
    }

    async semanticSearch(query, limit = 5, userId, provider) {
        return semanticSearch({ provider: this._resolveProvider(provider), db }, query, limit, userId);
    }

    // ── feature methods (provider-backed) ─────────────────────────────────
    async analyzeRepo(repoData, readmeContent, fileStructure, provider) {
        return analyzeRepo({ provider: this._resolveProvider(provider) }, repoData, readmeContent, fileStructure);
    }

    async enhanceReadme(currentReadme, repoData, fileStructure, provider) {
        return enhanceReadme({ provider: this._resolveProvider(provider) }, currentReadme, repoData, fileStructure);
    }

    async reviewPullRequest(fileManifest, topFilePatches, prMetadata, provider) {
        return reviewPullRequest({ provider: this._resolveProvider(provider) }, fileManifest, topFilePatches, prMetadata);
    }
}

export const aiService = new AIService();
