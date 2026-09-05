// SPDX-License-Identifier: Apache-2.0
/**
 * Named filter presets ("saved views") per user, scoped by feature surface.
 * Supports CRUD; uniqueness per (user, scope, name).
 *
 * Originally Work Board-only (hence the module/table name); generalised for
 * G5 so the Repositories filter bar can save/apply views too, via `scope`.
 * Every export defaults `scope` to 'work-board' so existing Work Board call
 * sites keep working unmodified.
 */
import db from '../db.js';

const DEFAULT_SCOPE = 'work-board';

function validateName(name) {
    if (typeof name !== 'string') throw new Error('name required');
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('name required');
    if (trimmed.length > 100) throw new Error('name must be at most 100 chars');
    return trimmed;
}

function validateScope(scope) {
    if (scope === undefined || scope === null) return DEFAULT_SCOPE;
    if (typeof scope !== 'string' || scope.trim().length === 0) throw new Error('scope must be a non-empty string');
    if (scope.length > 50) throw new Error('scope must be at most 50 chars');
    return scope.trim();
}

export function createPreset({ userId, name, filters, scope = DEFAULT_SCOPE }) {
    const trimmed = validateName(name);
    const scoped = validateScope(scope);
    const info = db.prepare(`
        INSERT INTO work_board_presets (user_id, scope, name, filters) VALUES (?, ?, ?, ?)
    `).run(userId, scoped, trimmed, JSON.stringify(filters || {}));
    return { id: info.lastInsertRowid };
}

export function listPresets(userId, scope = DEFAULT_SCOPE) {
    const rows = db.prepare(`
        SELECT id, scope, name, filters, created_at AS createdAt, updated_at AS updatedAt
        FROM work_board_presets WHERE user_id = ? AND scope = ?
        ORDER BY name ASC
    `).all(userId, validateScope(scope));
    return rows.map(r => ({ ...r, filters: safeParse(r.filters) }));
}

export function updatePreset({ userId, id, name, filters, scope = DEFAULT_SCOPE }) {
    const scoped = validateScope(scope);
    const current = db.prepare('SELECT name, filters FROM work_board_presets WHERE id = ? AND user_id = ? AND scope = ?').get(id, userId, scoped);
    if (!current) return 0;
    const newName = name !== undefined ? validateName(name) : current.name;
    const newFilters = filters !== undefined ? JSON.stringify(filters) : current.filters;
    const info = db.prepare(`
        UPDATE work_board_presets
        SET name = ?, filters = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND scope = ?
    `).run(newName, newFilters, id, userId, scoped);
    return info.changes;
}

export function deletePreset({ userId, id, scope = DEFAULT_SCOPE }) {
    const info = db.prepare('DELETE FROM work_board_presets WHERE id = ? AND user_id = ? AND scope = ?').run(id, userId, validateScope(scope));
    return info.changes;
}

function safeParse(raw) {
    try { return JSON.parse(raw || '{}'); }
    catch { return {}; }
}
