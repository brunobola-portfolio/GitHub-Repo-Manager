// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE work_board_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        filters TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, name)
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));
const { createPreset, listPresets, updatePreset, deletePreset } = await import('../lib/work-board-presets.js');

describe('work-board-presets', () => {
    beforeEach(() => testDb.exec('DELETE FROM work_board_presets'));

    it('createPreset + listPresets roundtrip', () => {
        const p = createPreset({ userId: 1, name: 'My team', filters: { repos: ['acme/x'] } });
        expect(p.id).toBeGreaterThan(0);
        const list = listPresets(1);
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('My team');
        expect(list[0].filters).toEqual({ repos: ['acme/x'] });
    });

    it('createPreset trims whitespace in the name', () => {
        createPreset({ userId: 1, name: '  Trimmed  ', filters: {} });
        expect(listPresets(1)[0].name).toBe('Trimmed');
    });

    it('createPreset enforces unique (user_id, name)', () => {
        createPreset({ userId: 1, name: 'X', filters: {} });
        expect(() => createPreset({ userId: 1, name: 'X', filters: {} })).toThrow(/unique|constraint/i);
    });

    it('createPreset allows same name across different users', () => {
        createPreset({ userId: 1, name: 'Shared', filters: {} });
        expect(() => createPreset({ userId: 2, name: 'Shared', filters: {} })).not.toThrow();
    });

    it('createPreset rejects empty name', () => {
        expect(() => createPreset({ userId: 1, name: '', filters: {} })).toThrow(/name required/i);
        expect(() => createPreset({ userId: 1, name: '   ', filters: {} })).toThrow(/name required/i);
    });

    it('createPreset rejects name > 100 chars', () => {
        expect(() => createPreset({ userId: 1, name: 'a'.repeat(101), filters: {} })).toThrow(/100 chars/i);
    });

    it('updatePreset updates name + filters', () => {
        const p = createPreset({ userId: 1, name: 'A', filters: {} });
        updatePreset({ userId: 1, id: p.id, name: 'B', filters: { repos: ['r'] } });
        const list = listPresets(1);
        expect(list[0].name).toBe('B');
        expect(list[0].filters).toEqual({ repos: ['r'] });
    });

    it('updatePreset returns 0 if id does not belong to user', () => {
        const p = createPreset({ userId: 1, name: 'A', filters: {} });
        const n = updatePreset({ userId: 2, id: p.id, name: 'B', filters: {} });
        expect(n).toBe(0);
    });

    it('deletePreset removes the row and returns count', () => {
        const p = createPreset({ userId: 1, name: 'A', filters: {} });
        expect(deletePreset({ userId: 1, id: p.id })).toBe(1);
        expect(listPresets(1)).toHaveLength(0);
    });

    it('deletePreset returns 0 when id belongs to another user', () => {
        const p = createPreset({ userId: 1, name: 'A', filters: {} });
        expect(deletePreset({ userId: 2, id: p.id })).toBe(0);
    });

    it('listPresets returns presets ordered by name', () => {
        createPreset({ userId: 1, name: 'Zed', filters: {} });
        createPreset({ userId: 1, name: 'Alpha', filters: {} });
        const names = listPresets(1).map(p => p.name);
        expect(names).toEqual(['Alpha', 'Zed']);
    });
});
