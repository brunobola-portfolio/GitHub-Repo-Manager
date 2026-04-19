// @vitest-environment node
/**
 * Tests for server/lib/user-ai-config.js
 *
 * Verifies:
 *  - setUserAIConfig + getUserAIConfig: public shape has no plaintext keys
 *  - getDecryptedConfig returns full shape with plaintext credentials
 *  - setUserAIConfig with completionCredentials: null wipes credentials
 *  - deleteUserAIConfig removes the row
 *  - Partial updates leave unspecified fields unchanged
 *  - featureOverrides CRUD
 *  - getModelForFeature helper
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// We need to mock the DB and credential-encryption so tests are self-contained
// ---------------------------------------------------------------------------

// In-memory row store for tests
let _store = null; // single row keyed by userId (we only test one user at a time)

const mockDb = {
    prepare: vi.fn((sql) => {
        // Route each SQL statement to the right mock implementation
        if (sql.includes('SELECT * FROM user_ai_config')) {
            return { get: (userId) => (_store && _store.user_id === userId ? { ..._store } : undefined) };
        }
        if (sql.includes('INSERT INTO user_ai_config')) {
            return {
                run: (userId, compProv, compModel, compCredsEnc, embProv, embModel, embCredsEnc, featureOverridesJson) => {
                    _store = {
                        user_id: userId,
                        completion_provider: compProv,
                        completion_model: compModel,
                        completion_credentials_enc: compCredsEnc,
                        embedding_provider: embProv,
                        embedding_model: embModel,
                        embedding_credentials_enc: embCredsEnc,
                        feature_overrides_json: featureOverridesJson ?? null,
                        updated_at: new Date().toISOString(),
                    };
                },
            };
        }
        if (sql.includes('UPDATE user_ai_config')) {
            return {
                run: (...args) => {
                    // Parse SET clause to update the right fields
                    // We match by looking at the SQL dynamically — we'll capture by convention
                    // The mock simply replaces fields that appear in the store with the values.
                    // Since the SQL is dynamic, we track updates via a closure approach:
                    // args = [value1, ..., valueN, userId]
                    // The SQL string contains the field names in order.
                    const fields = [];
                    const fieldRegex = /(\w+)\s*=\s*\?/g;
                    let match;
                    while ((match = fieldRegex.exec(sql)) !== null) {
                        fields.push(match[1]);
                    }
                    // Last arg is userId (WHERE user_id = ?)
                    const userId = args[args.length - 1];
                    if (_store && _store.user_id === userId) {
                        fields.forEach((field, i) => {
                            if (field !== 'user_id') {
                                _store[field] = args[i];
                            }
                        });
                    }
                },
            };
        }
        if (sql.includes('DELETE FROM user_ai_config')) {
            return {
                run: (userId) => {
                    if (_store && _store.user_id === userId) _store = null;
                },
            };
        }
        // Fallback
        return { get: vi.fn(), run: vi.fn(), all: vi.fn(() => []) };
    }),
};

vi.mock('../db.js', () => ({ default: mockDb }));

// Deterministic encrypt/decrypt: just JSON-serialise with a prefix
vi.mock('../lib/credential-encryption.js', () => ({
    encryptCredentials: (obj) => 'ENC:' + JSON.stringify(obj),
    decryptCredentials: (enc) => {
        if (!enc.startsWith('ENC:')) throw new Error('Invalid ciphertext');
        return JSON.parse(enc.slice(4));
    },
}));

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import SUT AFTER mocks are registered
// ---------------------------------------------------------------------------

const { getUserAIConfig, getDecryptedConfig, setUserAIConfig, deleteUserAIConfig, getModelForFeature } =
    await import('../lib/user-ai-config.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const USER_ID = 42;

beforeEach(() => {
    _store = null;
    vi.clearAllMocks();
});

describe('getUserAIConfig()', () => {
    it('returns null when no config exists', () => {
        expect(getUserAIConfig(USER_ID)).toBeNull();
    });

    it('returns public shape after setUserAIConfig', () => {
        setUserAIConfig(USER_ID, {
            completionProvider: 'openai',
            completionModel: 'gpt-4o',
            completionCredentials: { apiKey: 'sk-secret' },
        });

        const config = getUserAIConfig(USER_ID);
        expect(config).not.toBeNull();
        expect(config.userId).toBe(USER_ID);
        expect(config.completionProvider).toBe('openai');
        expect(config.completionModel).toBe('gpt-4o');
        expect(config.hasCompletionKey).toBe(true);
        // Must NOT expose the encrypted blob or plaintext
        expect(config).not.toHaveProperty('completion_credentials_enc');
        expect(config).not.toHaveProperty('completionCredentials');
    });

    it('hasCompletionKey is false when no credentials stored', () => {
        setUserAIConfig(USER_ID, {
            completionProvider: 'openai',
            completionCredentials: null,
        });

        const config = getUserAIConfig(USER_ID);
        expect(config.hasCompletionKey).toBe(false);
    });

    it('hasEmbeddingKey reflects stored embedding credentials', () => {
        setUserAIConfig(USER_ID, {
            embeddingProvider: 'openai',
            embeddingCredentials: { apiKey: 'sk-embed' },
        });

        const config = getUserAIConfig(USER_ID);
        expect(config.hasEmbeddingKey).toBe(true);
    });
});

describe('getDecryptedConfig()', () => {
    it('returns null when no config exists', () => {
        expect(getDecryptedConfig(USER_ID)).toBeNull();
    });

    it('returns full shape with plaintext credentials', () => {
        setUserAIConfig(USER_ID, {
            completionProvider: 'anthropic',
            completionModel: 'claude-sonnet-4-6',
            completionCredentials: { apiKey: 'sk-ant-secret' },
        });

        const decrypted = getDecryptedConfig(USER_ID);
        expect(decrypted.completionProvider).toBe('anthropic');
        expect(decrypted.completionCredentials).toEqual({ apiKey: 'sk-ant-secret' });
    });

    it('returns null credentials when none are stored', () => {
        setUserAIConfig(USER_ID, { completionProvider: 'anthropic' });

        const decrypted = getDecryptedConfig(USER_ID);
        expect(decrypted.completionCredentials).toBeNull();
    });
});

describe('setUserAIConfig() — partial updates', () => {
    it('updates only the specified fields', () => {
        // First insert
        setUserAIConfig(USER_ID, {
            completionProvider: 'openai',
            completionModel: 'gpt-4o',
            completionCredentials: { apiKey: 'sk-original' },
        });

        // Partial update: only change the model
        setUserAIConfig(USER_ID, { completionModel: 'gpt-4o-mini' });

        const config = getUserAIConfig(USER_ID);
        expect(config.completionModel).toBe('gpt-4o-mini');
        expect(config.completionProvider).toBe('openai'); // unchanged
    });

    it('wipes completion credentials when completionCredentials is null', () => {
        setUserAIConfig(USER_ID, {
            completionProvider: 'openai',
            completionCredentials: { apiKey: 'sk-secret' },
        });

        // Explicit null wipe
        setUserAIConfig(USER_ID, { completionCredentials: null });

        const config = getUserAIConfig(USER_ID);
        expect(config.hasCompletionKey).toBe(false);
    });

    it('creates a new row if one does not exist', () => {
        expect(getUserAIConfig(USER_ID)).toBeNull();

        setUserAIConfig(USER_ID, { completionProvider: 'gemini' });

        const config = getUserAIConfig(USER_ID);
        expect(config).not.toBeNull();
        expect(config.completionProvider).toBe('gemini');
    });

    it('no-op when all fields are undefined', () => {
        setUserAIConfig(USER_ID, { completionProvider: 'openai' });
        setUserAIConfig(USER_ID, {}); // all undefined

        const config = getUserAIConfig(USER_ID);
        expect(config.completionProvider).toBe('openai'); // unchanged
    });
});

describe('deleteUserAIConfig()', () => {
    it('removes the row — subsequent getUserAIConfig returns null', () => {
        setUserAIConfig(USER_ID, { completionProvider: 'openai' });
        expect(getUserAIConfig(USER_ID)).not.toBeNull();

        deleteUserAIConfig(USER_ID);

        expect(getUserAIConfig(USER_ID)).toBeNull();
    });

    it('does not throw when no row exists', () => {
        expect(() => deleteUserAIConfig(USER_ID)).not.toThrow();
    });
});

describe('featureOverrides CRUD', () => {
    it('stores featureOverrides on insert and returns them in public shape', () => {
        setUserAIConfig(USER_ID, {
            completionProvider: 'openai',
            completionCredentials: { apiKey: 'sk-test' },
            featureOverrides: { CHAT: 'gpt-4o', PR_REVIEW: 'claude-opus-4-5' },
        });

        const config = getUserAIConfig(USER_ID);
        expect(config.featureOverrides).toEqual({ CHAT: 'gpt-4o', PR_REVIEW: 'claude-opus-4-5' });
    });

    it('stores featureOverrides via partial update', () => {
        setUserAIConfig(USER_ID, { completionProvider: 'gemini' });

        setUserAIConfig(USER_ID, {
            featureOverrides: { EMBED: 'text-embedding-3-large' },
        });

        const config = getUserAIConfig(USER_ID);
        expect(config.featureOverrides).toEqual({ EMBED: 'text-embedding-3-large' });
    });

    it('clears featureOverrides when set to null', () => {
        setUserAIConfig(USER_ID, {
            completionProvider: 'openai',
            featureOverrides: { CHAT: 'gpt-4o' },
        });

        setUserAIConfig(USER_ID, { featureOverrides: null });

        const config = getUserAIConfig(USER_ID);
        expect(config.featureOverrides).toEqual({});
    });

    it('returns empty featureOverrides when none stored', () => {
        setUserAIConfig(USER_ID, { completionProvider: 'gemini' });
        const config = getUserAIConfig(USER_ID);
        expect(config.featureOverrides).toEqual({});
    });

    it('includes featureOverrides in getDecryptedConfig', () => {
        setUserAIConfig(USER_ID, {
            completionProvider: 'anthropic',
            completionCredentials: { apiKey: 'sk-ant' },
            featureOverrides: { PR_REVIEW: 'claude-opus-4-5' },
        });

        const decrypted = getDecryptedConfig(USER_ID);
        expect(decrypted.featureOverrides).toEqual({ PR_REVIEW: 'claude-opus-4-5' });
    });
});

describe('getModelForFeature()', () => {
    it('returns fallback when no config exists', () => {
        const model = getModelForFeature(USER_ID, 'CHAT', 'gemini-2.5-flash');
        expect(model).toBe('gemini-2.5-flash');
    });

    it('returns fallback when featureOverrides is empty', () => {
        setUserAIConfig(USER_ID, { completionProvider: 'gemini' });
        const model = getModelForFeature(USER_ID, 'CHAT', 'gemini-2.5-flash');
        expect(model).toBe('gemini-2.5-flash');
    });

    it('returns override when featureOverrides has the key', () => {
        setUserAIConfig(USER_ID, {
            completionProvider: 'openai',
            featureOverrides: { CHAT: 'gpt-4o', PR_REVIEW: 'gpt-4o-mini' },
        });

        expect(getModelForFeature(USER_ID, 'CHAT', 'gpt-4o-mini')).toBe('gpt-4o');
        expect(getModelForFeature(USER_ID, 'PR_REVIEW', 'gpt-4o')).toBe('gpt-4o-mini');
    });

    it('returns fallback for a key not present in featureOverrides', () => {
        setUserAIConfig(USER_ID, {
            completionProvider: 'openai',
            featureOverrides: { CHAT: 'gpt-4o' },
        });

        expect(getModelForFeature(USER_ID, 'EMBED', 'text-embedding-3-small')).toBe('text-embedding-3-small');
    });
});
