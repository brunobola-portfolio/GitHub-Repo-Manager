/**
 * AI Prompt Registry
 *
 * Catalog of every system prompt the user is allowed to customize. Each
 * entry exposes:
 *
 *   - `key`            stable identifier persisted in the `user_ai_prompts`
 *                      table. Never rename; use a migration if you must.
 *   - `title`          short human label for the Settings UI.
 *   - `description`    one-paragraph explanation of when this prompt fires.
 *   - `defaultPrompt`  the canonical prompt text shipped with the app.
 *                      Routes that need dynamic context inline `{variable}`
 *                      placeholders rendered via `renderPrompt`.
 *   - `variables`      list of variable names the route expects, used by
 *                      both validation and the editor's documentation.
 *
 * Adding a new editable prompt:
 *   1. Add an entry below.
 *   2. In the route, replace the inline string with
 *      `await getResolvedPrompt(userId, 'your_key', { var1, var2 })`.
 *   3. Add a test in ai-prompt-registry.test.js if it has variables so we
 *      catch missing/typo'd placeholders early.
 */

import db from '../db.js';

// ============================================================================
// Default prompts. Kept here so routes have a single place to look and the
// Settings UI can preview the canonical version.
// ============================================================================

// NOTE: only the *persona / tone* portion of the chat prompt is user-editable.
// The capabilities catalog, action whitelist, and JSON output schema are
// appended programmatically in `server/lib/ai-chat-prompt.js`. This keeps
// hallucinated action types impossible regardless of how the user writes
// their override, and protects the app's behavioural guarantees.
const CHAT_DEFAULT = `You are the AI assistant embedded inside **GitHub Repo Manager**, the application the user is currently using. You are not a generic GitHub helper, and you are not github.com — you are this product's in-app assistant. Your purpose is to help the user accomplish things **without leaving the app whenever possible**.

Default tone: concise, professional, never patronizing. Match the user's language (PT-PT vs PT-BR, English, etc) and never switch unprompted.`;

const SUGGEST_NAME_DESC_DEFAULT = `You are renaming a GitHub repo. Given the metadata below, propose:
- name: kebab-case, 3-5 words, descriptive of WHAT it does (not generic).
  Keep current name if already good (don't rename for the sake of it).
- description: ONE sentence, max 120 chars, no marketing fluff,
  starts with a verb or noun (not "A repo that…").
- rationale: 1 sentence explaining what signals you used.

Return JSON only: { "name": "...", "description": "...", "rationale": "..." }

Repo: {name} ({language}, {visibility})
Current description: {description}
Topics: {topics}
README excerpt:
{readme}`;

// More features (PR review, issue→plan, migration description) will be added
// to the registry as their routes are migrated. Each addition needs:
//   1. A default constant here.
//   2. An entry in AI_PROMPT_REGISTRY below.
//   3. The route updated to call `getResolvedPrompt(userId, key, vars)`
//      instead of an inline string.
// The DB table, endpoints, and Settings UI all derive from the registry, so
// adding a new key surfaces it everywhere automatically.

// ============================================================================
// Registry catalog
// ============================================================================

export const AI_PROMPT_REGISTRY = Object.freeze({
    chat: {
        key: 'chat',
        title: 'Assistant chat — persona',
        description: 'Persona and tone of the floating AI assistant. The app capabilities catalog, action whitelist, and JSON output schema are always appended automatically — your override only changes the persona.',
        defaultPrompt: CHAT_DEFAULT,
        variables: [],
    },
    suggest_name_description: {
        key: 'suggest_name_description',
        title: 'Suggest name & description',
        description: 'Drives the rename / re-describe modal. The variables below are sanitized repo metadata the model uses to ground its proposal. Keep the JSON return contract intact (`{ "name", "description", "rationale" }`) — the route parses the response.',
        defaultPrompt: SUGGEST_NAME_DESC_DEFAULT,
        variables: ['name', 'description', 'language', 'visibility', 'topics', 'readme'],
    },
});

export const REGISTRY_KEYS = Object.freeze(Object.keys(AI_PROMPT_REGISTRY));

export function isValidPromptKey(key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(AI_PROMPT_REGISTRY, key);
}

// ============================================================================
// Persistence helpers (synchronous — better-sqlite3 prepared statements)
// ============================================================================

export function loadUserPrompt(userId, key) {
    if (!isValidPromptKey(key) || !Number.isInteger(userId)) return null;
    try {
        const row = db.prepare('SELECT prompt FROM user_ai_prompts WHERE user_id = ? AND feature_key = ?').get(userId, key);
        return row?.prompt ?? null;
    } catch {
        return null;
    }
}

export function loadAllUserPrompts(userId) {
    if (!Number.isInteger(userId)) return {};
    try {
        const rows = db.prepare('SELECT feature_key, prompt, updated_at FROM user_ai_prompts WHERE user_id = ?').all(userId);
        const out = {};
        for (const row of rows) {
            if (!isValidPromptKey(row.feature_key)) continue; // drop orphan rows
            out[row.feature_key] = { prompt: row.prompt, updatedAt: row.updated_at };
        }
        return out;
    } catch {
        return {};
    }
}

export function saveUserPrompt(userId, key, prompt) {
    if (!isValidPromptKey(key)) throw new Error(`Unknown AI prompt key: ${key}`);
    if (typeof prompt !== 'string') throw new Error('Prompt must be a string');
    const trimmed = prompt.trim();
    if (trimmed.length === 0) throw new Error('Prompt cannot be empty');
    if (trimmed.length > 8000) throw new Error('Prompt exceeds 8000 character limit');
    db.prepare(
        `INSERT INTO user_ai_prompts (user_id, feature_key, prompt, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, feature_key) DO UPDATE SET prompt = excluded.prompt, updated_at = excluded.updated_at`,
    ).run(userId, key, trimmed);
    return { key, prompt: trimmed };
}

export function deleteUserPrompt(userId, key) {
    if (!isValidPromptKey(key)) return { deleted: 0 };
    const result = db.prepare('DELETE FROM user_ai_prompts WHERE user_id = ? AND feature_key = ?').run(userId, key);
    return { deleted: result.changes || 0 };
}

// ============================================================================
// Resolution + rendering
// ============================================================================

/**
 * Resolves the prompt template for a given (user, feature). The user override
 * wins when present, otherwise the registry default is used.
 *
 * @param {number} userId
 * @param {string} key
 * @returns {string}
 */
export function resolvePromptTemplate(userId, key) {
    if (!isValidPromptKey(key)) throw new Error(`Unknown AI prompt key: ${key}`);
    const override = loadUserPrompt(userId, key);
    return override || AI_PROMPT_REGISTRY[key].defaultPrompt;
}

/**
 * Replaces `{variable}` placeholders with the values supplied. Missing values
 * are rendered as empty strings rather than throwing — partial context is
 * common (e.g. a repo with no README) and we never want a crash there. Uses
 * a literal-replacement loop so values that themselves contain `{...}` won't
 * be re-expanded.
 */
export function renderPrompt(template, vars = {}) {
    if (typeof template !== 'string') return '';
    let out = template;
    for (const [key, value] of Object.entries(vars || {})) {
        const token = `{${key}}`;
        const replacement = value === undefined || value === null ? '' : String(value);
        // String#replaceAll uses literal matching when given a string, so {key}
        // tokens nested inside replacement values are left intact.
        out = out.split(token).join(replacement);
    }
    return out;
}

/**
 * Convenience: resolve template + render variables in one call. The two-step
 * variant is exposed for callers that want to log/inspect the raw template.
 */
export function getResolvedPrompt(userId, key, vars = {}) {
    return renderPrompt(resolvePromptTemplate(userId, key), vars);
}

/**
 * Catalog payload for the Settings UI — never includes the user's override
 * directly; the route is responsible for joining that in (see
 * server/routes/ai/prompts.js).
 */
export function getCatalog() {
    return REGISTRY_KEYS.map((key) => ({
        key,
        title: AI_PROMPT_REGISTRY[key].title,
        description: AI_PROMPT_REGISTRY[key].description,
        defaultPrompt: AI_PROMPT_REGISTRY[key].defaultPrompt,
        variables: AI_PROMPT_REGISTRY[key].variables,
    }));
}
