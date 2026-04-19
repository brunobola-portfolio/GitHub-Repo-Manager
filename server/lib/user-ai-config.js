/**
 * User AI config storage.
 *
 * Wraps the `user_ai_config` table with CRUD operations and AES-256-GCM
 * credential encryption (reuses server/lib/credential-encryption.js).
 *
 * Public-shape contract (returned to callers / API responses):
 *  {
 *    userId,
 *    completionProvider,
 *    completionModel,
 *    hasCompletionKey,         // boolean — never expose the key
 *    embeddingProvider,
 *    embeddingModel,
 *    hasEmbeddingKey,          // boolean
 *    featureOverrides,         // { CHAT: "model", PR_REVIEW: "model", ... } or {}
 *    updatedAt,
 *  }
 *
 * The encrypted blobs and plaintext keys are NEVER included in the public shape.
 */

import db from '../db.js';
import { encryptCredentials, decryptCredentials } from './credential-encryption.js';
import logger from './logger.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a DB row to the public-safe shape.
 * @param {object} row
 * @returns {object}
 */
function toPublicShape(row) {
    let featureOverrides = {};
    if (row.feature_overrides_json) {
        try {
            featureOverrides = JSON.parse(row.feature_overrides_json);
        } catch {
            featureOverrides = {};
        }
    }
    return {
        userId: row.user_id,
        completionProvider: row.completion_provider ?? null,
        completionModel: row.completion_model ?? null,
        hasCompletionKey: !!row.completion_credentials_enc,
        embeddingProvider: row.embedding_provider ?? null,
        embeddingModel: row.embedding_model ?? null,
        hasEmbeddingKey: !!row.embedding_credentials_enc,
        featureOverrides,
        updatedAt: row.updated_at ?? null,
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the public-shape AI config for a user.
 * Returns null if the user has no config row yet.
 *
 * @param {number} userId
 * @returns {object|null}
 */
export function getUserAIConfig(userId) {
    const row = db.prepare(
        'SELECT * FROM user_ai_config WHERE user_id = ?'
    ).get(userId);

    if (!row) return null;
    return toPublicShape(row);
}

/**
 * Get the full AI config (including plaintext credentials) for internal use.
 * Used by createProviderForUser — must NEVER be returned to API clients.
 *
 * @param {number} userId
 * @returns {{
 *   userId: number,
 *   completionProvider: string|null,
 *   completionModel: string|null,
 *   completionCredentials: object|null,
 *   embeddingProvider: string|null,
 *   embeddingModel: string|null,
 *   embeddingCredentials: object|null,
 * }|null}
 */
export function getDecryptedConfig(userId) {
    const row = db.prepare(
        'SELECT * FROM user_ai_config WHERE user_id = ?'
    ).get(userId);

    if (!row) return null;

    let completionCredentials = null;
    if (row.completion_credentials_enc) {
        try {
            completionCredentials = decryptCredentials(row.completion_credentials_enc);
        } catch {
            // If decryption fails (e.g. key rotation), treat as no credentials
            logger.warn({ userId }, 'Failed to decrypt completion credentials — possible CREDENTIAL_ENCRYPTION_KEY rotation');
            completionCredentials = null;
        }
    }

    let embeddingCredentials = null;
    if (row.embedding_credentials_enc) {
        try {
            embeddingCredentials = decryptCredentials(row.embedding_credentials_enc);
        } catch {
            logger.warn({ userId }, 'Failed to decrypt embedding credentials — possible CREDENTIAL_ENCRYPTION_KEY rotation');
            embeddingCredentials = null;
        }
    }

    let featureOverrides = {};
    if (row.feature_overrides_json) {
        try {
            featureOverrides = JSON.parse(row.feature_overrides_json);
        } catch {
            featureOverrides = {};
        }
    }

    return {
        userId: row.user_id,
        completionProvider: row.completion_provider ?? null,
        completionModel: row.completion_model ?? null,
        completionCredentials,
        embeddingProvider: row.embedding_provider ?? null,
        embeddingModel: row.embedding_model ?? null,
        embeddingCredentials,
        featureOverrides,
    };
}

/**
 * Create or update AI config for a user.
 *
 * Fields that are undefined are NOT changed (partial updates).
 * Fields that are explicitly null clear the stored value.
 *
 * @param {number} userId
 * @param {object} config
 * @param {string|null|undefined}  [config.completionProvider]
 * @param {string|null|undefined}  [config.completionModel]
 * @param {object|null|undefined}  [config.completionCredentials]  — e.g. { apiKey, endpointUrl? }
 * @param {string|null|undefined}  [config.embeddingProvider]
 * @param {string|null|undefined}  [config.embeddingModel]
 * @param {object|null|undefined}  [config.embeddingCredentials]
 * @param {object|null|undefined}  [config.featureOverrides]  — e.g. { CHAT: "gemini-2.5-pro", PR_REVIEW: "claude-opus-4-5" }
 */
export function setUserAIConfig(userId, config) {
    const {
        completionProvider,
        completionModel,
        completionCredentials,
        embeddingProvider,
        embeddingModel,
        embeddingCredentials,
        featureOverrides,
    } = config;

    // Check if a row already exists
    const existing = db.prepare(
        'SELECT * FROM user_ai_config WHERE user_id = ?'
    ).get(userId);

    if (!existing) {
        // Insert new row — treat undefined fields as null
        const compCredsEnc = completionCredentials != null
            ? encryptCredentials(completionCredentials)
            : null;
        const embCredsEnc = embeddingCredentials != null
            ? encryptCredentials(embeddingCredentials)
            : null;
        const featureOverridesJson = featureOverrides != null
            ? JSON.stringify(featureOverrides)
            : null;

        db.prepare(`
            INSERT INTO user_ai_config (
                user_id,
                completion_provider,
                completion_model,
                completion_credentials_enc,
                embedding_provider,
                embedding_model,
                embedding_credentials_enc,
                feature_overrides_json,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
            userId,
            completionProvider ?? null,
            completionModel ?? null,
            compCredsEnc,
            embeddingProvider ?? null,
            embeddingModel ?? null,
            embCredsEnc,
            featureOverridesJson,
        );
    } else {
        // Partial update: only set fields that are not undefined
        const updates = [];
        const values = [];

        if (completionProvider !== undefined) {
            updates.push('completion_provider = ?');
            values.push(completionProvider ?? null);
        }
        if (completionModel !== undefined) {
            updates.push('completion_model = ?');
            values.push(completionModel ?? null);
        }
        if (completionCredentials !== undefined) {
            updates.push('completion_credentials_enc = ?');
            values.push(completionCredentials != null ? encryptCredentials(completionCredentials) : null);
        }
        if (embeddingProvider !== undefined) {
            updates.push('embedding_provider = ?');
            values.push(embeddingProvider ?? null);
        }
        if (embeddingModel !== undefined) {
            updates.push('embedding_model = ?');
            values.push(embeddingModel ?? null);
        }
        if (embeddingCredentials !== undefined) {
            updates.push('embedding_credentials_enc = ?');
            values.push(embeddingCredentials != null ? encryptCredentials(embeddingCredentials) : null);
        }
        if (featureOverrides !== undefined) {
            updates.push('feature_overrides_json = ?');
            values.push(featureOverrides != null ? JSON.stringify(featureOverrides) : null);
        }

        if (updates.length === 0) return; // nothing to update

        updates.push("updated_at = datetime('now')");
        values.push(userId);

        db.prepare(`
            UPDATE user_ai_config
            SET ${updates.join(', ')}
            WHERE user_id = ?
        `).run(...values);
    }
}

/**
 * Delete the AI config for a user (wipes all stored config + credentials).
 *
 * @param {number} userId
 */
export function deleteUserAIConfig(userId) {
    db.prepare('DELETE FROM user_ai_config WHERE user_id = ?').run(userId);
}

/**
 * Return the model to use for a specific feature, respecting per-feature overrides.
 *
 * Lookup order:
 *  1. User's featureOverrides[featureKey] if set.
 *  2. fallbackModel.
 *
 * @param {number} userId
 * @param {string} featureKey  — UPPER_SNAKE key e.g. 'CHAT', 'PR_REVIEW', 'EMBED'
 * @param {string} fallbackModel  — the model to use when no override is set
 * @returns {string}
 */
export function getModelForFeature(userId, featureKey, fallbackModel) {
    const config = getUserAIConfig(userId);
    if (config && config.featureOverrides && config.featureOverrides[featureKey]) {
        return config.featureOverrides[featureKey];
    }
    return fallbackModel;
}
