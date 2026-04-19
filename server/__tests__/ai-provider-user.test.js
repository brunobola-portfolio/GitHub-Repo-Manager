// @vitest-environment node
/**
 * Tests for createProviderForUser (extension of ai-provider.js)
 *
 * Verifies:
 *  - Returns user's configured provider when user config exists
 *  - Falls back to GEMINI_API_KEY env when no user config
 *  - Returns null when neither is set (non-production)
 *  - Embedding dispatch falls back to user's embedding_provider when completion
 *    provider is anthropic (no native embeddings)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock providers — we just need them to be constructable and identifiable
// ---------------------------------------------------------------------------

class MockGeminiProvider { constructor(opts) { this._opts = opts; this._modelName = opts.model; } }
class MockAnthropicProvider { constructor(opts) { this._opts = opts; this._modelName = opts.model; } }
class MockOpenAIProvider { constructor(opts) { this._opts = opts; this._modelName = opts.model; } }
class MockOpenRouterProvider { constructor(opts) { this._opts = opts; this._modelName = opts.model; } }
class MockLocalProvider { constructor(opts) { this._opts = opts; this._modelName = opts.model; } }

vi.mock('@google/generative-ai', () => {
    const GoogleGenerativeAI = function GoogleGenerativeAI() {
        this.getGenerativeModel = vi.fn(() => ({ generateContent: vi.fn(), embedContent: vi.fn(), generateContentStream: vi.fn() }));
    };
    return { GoogleGenerativeAI };
});

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../lib/providers/anthropic.js', () => ({
    AnthropicProvider: MockAnthropicProvider,
}));

vi.mock('../lib/providers/openai.js', () => ({
    OpenAIProvider: MockOpenAIProvider,
}));

vi.mock('../lib/providers/openrouter.js', () => ({
    OpenRouterProvider: MockOpenRouterProvider,
}));

vi.mock('../lib/providers/local.js', () => ({
    LocalProvider: MockLocalProvider,
}));

// ---------------------------------------------------------------------------
// Mock user-ai-config — configurable per test
// ---------------------------------------------------------------------------

let _mockDecryptedConfig = null;

vi.mock('../lib/user-ai-config.js', () => ({
    getDecryptedConfig: vi.fn((userId) => _mockDecryptedConfig),
    getUserAIConfig: vi.fn(),
    setUserAIConfig: vi.fn(),
    deleteUserAIConfig: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

const { createProviderForUser, GeminiProvider } = await import('../lib/ai-provider.js');

// ---------------------------------------------------------------------------
// Env management
// ---------------------------------------------------------------------------

const savedEnv = { ...process.env };

beforeEach(() => {
    _mockDecryptedConfig = null;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_EMBEDDING_MODEL;
    delete process.env.NODE_ENV;
    vi.clearAllMocks();
});

afterEach(() => {
    Object.assign(process.env, savedEnv);
    for (const key of Object.keys(process.env)) {
        if (!(key in savedEnv)) delete process.env[key];
    }
});

// ---------------------------------------------------------------------------
// createProviderForUser tests
// ---------------------------------------------------------------------------

describe('createProviderForUser()', () => {
    it('returns the user configured provider when user config exists (openai)', async () => {
        _mockDecryptedConfig = {
            userId: 1,
            completionProvider: 'openai',
            completionModel: 'gpt-4o',
            completionCredentials: { apiKey: 'sk-user' },
            embeddingProvider: null,
            embeddingModel: null,
            embeddingCredentials: null,
        };

        const provider = await createProviderForUser(1, 'completion');

        expect(provider).toBeInstanceOf(MockOpenAIProvider);
        expect(provider._opts.apiKey).toBe('sk-user');
        expect(provider._modelName).toBe('gpt-4o');
    });

    it('returns the user configured provider for anthropic', async () => {
        _mockDecryptedConfig = {
            userId: 1,
            completionProvider: 'anthropic',
            completionModel: 'claude-sonnet-4-6',
            completionCredentials: { apiKey: 'sk-ant-user' },
            embeddingProvider: null,
            embeddingModel: null,
            embeddingCredentials: null,
        };

        const provider = await createProviderForUser(1, 'completion');

        expect(provider).toBeInstanceOf(MockAnthropicProvider);
        expect(provider._opts.apiKey).toBe('sk-ant-user');
    });

    it('falls back to GEMINI_API_KEY env when no user config', async () => {
        _mockDecryptedConfig = null;
        process.env.GEMINI_API_KEY = 'server-key';

        const provider = await createProviderForUser(1, 'completion');

        // GeminiProvider from ai-provider.js itself
        expect(provider).toBeInstanceOf(GeminiProvider);
    });

    it('returns null when neither user config nor GEMINI_API_KEY is set (non-production)', async () => {
        _mockDecryptedConfig = null;
        delete process.env.GEMINI_API_KEY;

        const provider = await createProviderForUser(1, 'completion');

        expect(provider).toBeNull();
    });

    it('returns null when user config has no credentials (provider set but no key)', async () => {
        _mockDecryptedConfig = {
            userId: 1,
            completionProvider: 'openai',
            completionModel: null,
            completionCredentials: null, // no key stored
            embeddingProvider: null,
            embeddingModel: null,
            embeddingCredentials: null,
        };

        const provider = await createProviderForUser(1, 'completion');

        // Falls through to env — no env key either, so null
        expect(provider).toBeNull();
    });

    // ----- Embedding dispatch -----

    it('embedding: uses completion provider if it supports embeddings (openai)', async () => {
        _mockDecryptedConfig = {
            userId: 1,
            completionProvider: 'openai',
            completionModel: 'gpt-4o',
            completionCredentials: { apiKey: 'sk-user' },
            embeddingProvider: null,
            embeddingModel: null,
            embeddingCredentials: null,
        };

        const provider = await createProviderForUser(1, 'embedding');

        expect(provider).toBeInstanceOf(MockOpenAIProvider);
    });

    it('embedding: falls back to embeddingProvider when completion is anthropic (no native embeddings)', async () => {
        _mockDecryptedConfig = {
            userId: 1,
            completionProvider: 'anthropic',
            completionModel: 'claude-sonnet-4-6',
            completionCredentials: { apiKey: 'sk-ant' },
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
            embeddingCredentials: { apiKey: 'sk-embed' },
        };

        const provider = await createProviderForUser(1, 'embedding');

        expect(provider).toBeInstanceOf(MockOpenAIProvider);
        expect(provider._opts.apiKey).toBe('sk-embed');
    });

    it('embedding: returns null when anthropic completion + no embedding provider configured', async () => {
        _mockDecryptedConfig = {
            userId: 1,
            completionProvider: 'anthropic',
            completionModel: 'claude-sonnet-4-6',
            completionCredentials: { apiKey: 'sk-ant' },
            embeddingProvider: null,
            embeddingModel: null,
            embeddingCredentials: null,
        };
        delete process.env.GEMINI_API_KEY;

        const provider = await createProviderForUser(1, 'embedding');

        expect(provider).toBeNull();
    });

    it('embedding: falls back to GEMINI_API_KEY env when no user config', async () => {
        _mockDecryptedConfig = null;
        process.env.GEMINI_API_KEY = 'server-key';

        const provider = await createProviderForUser(1, 'embedding');

        expect(provider).toBeInstanceOf(GeminiProvider);
    });
});
