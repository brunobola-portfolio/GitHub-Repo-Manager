// SPDX-License-Identifier: Apache-2.0
/**
 * Named filter presets per user. Supports CRUD; uniqueness per (user, name).
 */
import db from '../db.js';

function validateName(name) {
    if (typeof name !== 'string') throw new Error('name required');
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('name required');
    if (trimmed.length > 100) throw new Error('name must be at most 100 chars');
    return trimmed;
}

export function createPreset({ userId, name, filters }) {
    const trimmed = validateName(name);
    const info = db.prepare(`
        INSERT INTO work_board_presets (user_id, name, filters) VALUES (?, ?, ?)
    `).run(userId, trimmed, JSON.stringify(filters || {}));
    return { id: info.lastInsertRowid };
}

export function listPresets(userId) {
    const rows = db.prepare(`
        SELECT id, name, filters, created_at AS createdAt, updated_at AS updatedAt
        FROM work_board_presets WHERE user_id = ?
        ORDER BY name ASC
    `).all(userId);
    return rows.map(r => ({ ...r, filters: safeParse(r.filters) }));
}

export function updatePreset({ userId, id, name, filters }) {
    const current = db.prepare('SELECT name, filters FROM work_board_presets WHERE id = ? AND user_id = ?').get(id, userId);
    if (!current) return 0;
    const newName = name !== undefined ? validateName(name) : current.name;
    const newFilters = filters !== undefined ? JSON.stringify(filters) : current.filters;
    const info = db.prepare(`
        UPDATE work_board_presets
        SET name = ?, filters = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
    `).run(newName, newFilters, id, userId);
    return info.changes;
}

export function deletePreset({ userId, id }) {
    const info = db.prepare('DELETE FROM work_board_presets WHERE id = ? AND user_id = ?').run(id, userId);
    return info.changes;
}

function safeParse(raw) {
    try { return JSON.parse(raw || '{}'); }
    catch { return {}; }
}
