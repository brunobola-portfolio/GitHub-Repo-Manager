// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI Deep Review preset store.
 *
 * Thin wrapper around the `ai_review_prompts` table (created in server/db.js).
 * Holds the user-authored / scoped preset library that powers slice 1b's
 * Prompt Studio. Built-in presets (general, security, performance,
 * accessibility, refactor) live in `server/lib/ai-features/builtin-prompts.js`
 * and are NOT persisted here — they're constants surfaced to every user.
 *
 * Composite identity is `(user_id, scope, scope_target, preset_key)`. Scope
 * is one of 'user' | 'repo' | 'org'; scope_target is null for user-scope and
 * `${owner}/${name}` for repo / org scope.
 *
 * Every read/update/delete is scoped by `user_id` so cross-user IDOR is
 * structurally impossible — a row id collision still fails the user check.
 * All SQL goes through prepared statements with bound parameters.
 */
import db from '../db.js';

function rowToPreset(row) {
    if (!row) return null;
    let pathRules = [];
    try {
        if (row.path_rules_json) pathRules = JSON.parse(row.path_rules_json);
    } catch { /* ignore — corrupt JSON drops back to empty rules */ }
    return {
        id: row.id,
        userId: row.user_id,
        scope: row.scope,
        scopeTarget: row.scope_target,
        presetKey: row.preset_key,
        name: row.name,
        systemPrompt: row.system_prompt,
        pathRules,
        severityFloor: row.severity_floor,
        isDefault: !!row.is_default,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/**
 * List presets owned by `userId`. Optional `scope` and `scopeTarget` filters
 * narrow to a single bucket — pass `scopeTarget: null` to match the user-scope
 * sentinel value (the `IS ?` operator binds null as SQL NULL).
 */
export function listPresets(userId, { scope, scopeTarget } = {}) {
    let sql = 'SELECT * FROM ai_review_prompts WHERE user_id = ?';
    const params = [userId];
    if (scope) {
        sql += ' AND scope = ?';
        params.push(scope);
        if (scopeTarget !== undefined) {
            sql += ' AND scope_target IS ?';
            params.push(scopeTarget);
        }
    }
    sql += ' ORDER BY scope, name';
    return db.prepare(sql).all(...params).map(rowToPreset);
}

export function getPresetById(userId, id) {
    const row = db.prepare('SELECT * FROM ai_review_prompts WHERE id = ? AND user_id = ?').get(id, userId);
    return rowToPreset(row);
}

/**
 * Resolve the default preset for a (scope, scopeTarget) bucket. Returns null
 * when no row in that bucket has `is_default = 1`. The resolver in
 * `server/lib/ai-features/prompt-registry.js` chains repo → user → fallback.
 */
export function getDefaultForScope(userId, scope, scopeTarget) {
    const row = db.prepare(`
        SELECT * FROM ai_review_prompts
        WHERE user_id = ? AND scope = ? AND scope_target IS ? AND is_default = 1
        LIMIT 1
    `).get(userId, scope, scopeTarget ?? null);
    return rowToPreset(row);
}

/**
 * Insert or replace a preset by `(user_id, scope, scope_target, preset_key)`.
 *
 * SQLite treats NULL values as distinct in a UNIQUE constraint, so the
 * `ON CONFLICT(...)` clause cannot match an existing row whose
 * `scope_target` is NULL (the user-scope sentinel). We pre-check for that
 * row manually and route to UPDATE; everything else uses native UPSERT.
 *
 * RETURNING id avoids the better-sqlite3 footgun where `lastInsertRowid`
 * carries a stale value on the UPDATE branch of an UPSERT.
 */
export function savePreset(userId, payload) {
    const { scope, scopeTarget, presetKey, name, systemPrompt, pathRules, severityFloor, isDefault } = payload;
    const pathJson = pathRules ? JSON.stringify(pathRules) : null;
    const target = scopeTarget ?? null;
    const isFlag = isDefault ? 1 : 0;
    const sevFloor = severityFloor ?? null;

    if (target === null) {
        // NULL scope_target: SQLite UNIQUE doesn't treat two NULLs as equal,
        // so emulate the upsert ourselves. Wrap the SELECT + INSERT/UPDATE in
        // a transaction so two concurrent callers can't both miss the existing
        // row and both INSERT (TOCTOU race producing duplicate rows).
        return db.transaction(() => {
            const existing = db.prepare(
                'SELECT id FROM ai_review_prompts WHERE user_id = ? AND scope = ? AND scope_target IS NULL AND preset_key = ?',
            ).get(userId, scope, presetKey);
            if (existing) {
                db.prepare(`
                    UPDATE ai_review_prompts SET
                        name = ?,
                        system_prompt = ?,
                        path_rules_json = ?,
                        severity_floor = ?,
                        is_default = ?,
                        updated_at = datetime('now')
                    WHERE id = ? AND user_id = ?
                `).run(name, systemPrompt, pathJson, sevFloor, isFlag, existing.id, userId);
                return existing.id;
            }
            const inserted = db.prepare(`
                INSERT INTO ai_review_prompts (user_id, scope, scope_target, preset_key, name, system_prompt, path_rules_json, severity_floor, is_default, created_at, updated_at)
                VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                RETURNING id
            `).get(userId, scope, presetKey, name, systemPrompt, pathJson, sevFloor, isFlag);
            return inserted?.id ?? null;
        })();
    }

    const row = db.prepare(`
        INSERT INTO ai_review_prompts (user_id, scope, scope_target, preset_key, name, system_prompt, path_rules_json, severity_floor, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(user_id, scope, scope_target, preset_key) DO UPDATE SET
            name = excluded.name,
            system_prompt = excluded.system_prompt,
            path_rules_json = excluded.path_rules_json,
            severity_floor = excluded.severity_floor,
            is_default = excluded.is_default,
            updated_at = datetime('now')
        RETURNING id
    `).get(
        userId,
        scope,
        target,
        presetKey,
        name,
        systemPrompt,
        pathJson,
        sevFloor,
        isFlag,
    );
    return row?.id ?? null;
}

/**
 * Patch a subset of mutable columns. Skips updates when no fields are passed
 * (returns 0). Always enforces ownership via `user_id` in the WHERE clause.
 */
export function updatePreset(userId, id, payload) {
    const updates = [];
    const params = [];
    if (payload.name !== undefined) {
        updates.push('name = ?');
        params.push(payload.name);
    }
    if (payload.systemPrompt !== undefined) {
        updates.push('system_prompt = ?');
        params.push(payload.systemPrompt);
    }
    if (payload.pathRules !== undefined) {
        updates.push('path_rules_json = ?');
        params.push(payload.pathRules ? JSON.stringify(payload.pathRules) : null);
    }
    if (payload.severityFloor !== undefined) {
        updates.push('severity_floor = ?');
        params.push(payload.severityFloor);
    }
    if (updates.length === 0) return 0;
    updates.push("updated_at = datetime('now')");
    params.push(id, userId);
    return db.prepare(
        `UPDATE ai_review_prompts SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
    ).run(...params).changes;
}

export function deletePreset(userId, id) {
    return db.prepare('DELETE FROM ai_review_prompts WHERE id = ? AND user_id = ?').run(id, userId).changes;
}

/**
 * Mark a preset as the default for its (scope, scope_target) bucket. Clears
 * `is_default` on every sibling row in the same bucket so only one default
 * exists per scope. Wrapped in a transaction so the clear+set is atomic — a
 * crash mid-call cannot leave two defaults visible.
 *
 * @returns {number} 1 if the preset was found and updated, 0 if not found
 *                   (or not owned by `userId`).
 */
export function setDefault(userId, id) {
    const target = getPresetById(userId, id);
    if (!target) return 0;
    db.transaction(() => {
        db.prepare(
            'UPDATE ai_review_prompts SET is_default = 0 WHERE user_id = ? AND scope = ? AND scope_target IS ?',
        ).run(userId, target.scope, target.scopeTarget);
        db.prepare(
            'UPDATE ai_review_prompts SET is_default = 1 WHERE id = ? AND user_id = ?',
        ).run(id, userId);
    })();
    return 1;
}
