// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { initDB } = await vi.importActual('../db.js');
const { makeIntegrationDb } = await import('./helpers/integration-db.js');
const testDb = makeIntegrationDb(initDB);

vi.mock('../db.js', () => ({ default: testDb }));

const {
    listPresets,
    listOrgScopedPresets,
    getPresetById,
    getOrgPresetById,
    getDefaultForScope,
    getOrgDefaultForScope,
    savePreset,
    updatePreset,
    deletePreset,
    setDefault,
} = await import('../lib/ai-prompt-store.js');

const userId = 901;
const otherUserId = 902;

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_review_prompts WHERE user_id IN (?, ?)').run(userId, otherUserId);
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(userId, 'owner-user');
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(otherUserId, 'other-user');
});

function basePayload(overrides = {}) {
    return {
        scope: 'user',
        scopeTarget: null,
        presetKey: 'custom-1',
        name: 'My preset',
        systemPrompt: 'Focus on correctness.',
        pathRules: [{ glob: 'src/**', extraPrompt: 'Be strict' }],
        severityFloor: 'warning',
        isDefault: false,
        ...overrides,
    };
}

describe('ai-prompt-store', () => {
    it('savePreset then listPresets returns the row', () => {
        const id = savePreset(userId, basePayload());
        expect(id).toBeGreaterThan(0);
        const rows = listPresets(userId);
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(id);
        expect(rows[0].name).toBe('My preset');
        expect(rows[0].pathRules).toEqual([{ glob: 'src/**', extraPrompt: 'Be strict' }]);
        expect(rows[0].severityFloor).toBe('warning');
        expect(rows[0].isDefault).toBe(false);
    });

    it('savePreset upserts on the UNIQUE composite — id is stable', () => {
        const id1 = savePreset(userId, basePayload({ name: 'first' }));
        const id2 = savePreset(userId, basePayload({ name: 'second', systemPrompt: 'updated body' }));
        expect(id2).toBe(id1);
        const got = getPresetById(userId, id1);
        expect(got.name).toBe('second');
        expect(got.systemPrompt).toBe('updated body');
    });

    it('getPresetById enforces ownership (other user → null)', () => {
        const id = savePreset(userId, basePayload());
        expect(getPresetById(userId, id)).toBeTruthy();
        expect(getPresetById(otherUserId, id)).toBeNull();
    });

    it("getDefaultForScope(userId, 'user', null) finds the user default", () => {
        savePreset(userId, basePayload({ presetKey: 'p-a', name: 'A', isDefault: false }));
        const defaultId = savePreset(userId, basePayload({ presetKey: 'p-b', name: 'B', isDefault: true }));
        const got = getDefaultForScope(userId, 'user', null);
        expect(got).toBeTruthy();
        expect(got.id).toBe(defaultId);
        expect(got.name).toBe('B');
    });

    it("getDefaultForScope(userId, 'repo', 'acme/api') finds the repo default", () => {
        savePreset(userId, basePayload({ scope: 'repo', scopeTarget: 'acme/api', presetKey: 'r-a', name: 'A', isDefault: false }));
        const defaultId = savePreset(userId, basePayload({ scope: 'repo', scopeTarget: 'acme/api', presetKey: 'r-b', name: 'B', isDefault: true }));
        // A different repo's default must not leak into this lookup.
        savePreset(userId, basePayload({ scope: 'repo', scopeTarget: 'other/api', presetKey: 'r-c', name: 'C', isDefault: true }));

        const got = getDefaultForScope(userId, 'repo', 'acme/api');
        expect(got.id).toBe(defaultId);
        expect(got.scopeTarget).toBe('acme/api');
    });

    it('setDefault clears sibling defaults inside the same scope', () => {
        const a = savePreset(userId, basePayload({ presetKey: 'p-a', name: 'A', isDefault: true }));
        const b = savePreset(userId, basePayload({ presetKey: 'p-b', name: 'B', isDefault: false }));

        const changes = setDefault(userId, b);
        expect(changes).toBe(1);

        const aRow = getPresetById(userId, a);
        const bRow = getPresetById(userId, b);
        expect(aRow.isDefault).toBe(false);
        expect(bRow.isDefault).toBe(true);

        // And only one default exists for that bucket.
        const def = getDefaultForScope(userId, 'user', null);
        expect(def.id).toBe(b);
    });

    it('setDefault on a non-existent / unowned preset returns 0', () => {
        const id = savePreset(userId, basePayload());
        expect(setDefault(otherUserId, id)).toBe(0); // unowned
        expect(setDefault(userId, 999999)).toBe(0); // non-existent
    });

    it('updatePreset patches only the fields provided; ownership enforced', () => {
        const id = savePreset(userId, basePayload({ name: 'orig', severityFloor: 'info' }));
        const changes = updatePreset(userId, id, { name: 'renamed' });
        expect(changes).toBe(1);
        const got = getPresetById(userId, id);
        expect(got.name).toBe('renamed');
        // Untouched fields stay put.
        expect(got.severityFloor).toBe('info');
        expect(got.systemPrompt).toBe('Focus on correctness.');

        // Cross-user update is a no-op.
        const otherChanges = updatePreset(otherUserId, id, { name: 'hijacked' });
        expect(otherChanges).toBe(0);
        const stillOurs = getPresetById(userId, id);
        expect(stillOurs.name).toBe('renamed');

        // Empty payload → 0 changes.
        expect(updatePreset(userId, id, {})).toBe(0);
    });

    it('deletePreset returns 1, removes the row, and is ownership-scoped', () => {
        const id = savePreset(userId, basePayload());
        // Wrong owner cannot delete.
        expect(deletePreset(otherUserId, id)).toBe(0);
        expect(getPresetById(userId, id)).toBeTruthy();

        // Owner deletes successfully.
        expect(deletePreset(userId, id)).toBe(1);
        expect(getPresetById(userId, id)).toBeNull();
    });

    it('listPresets filters by scope and scope target', () => {
        savePreset(userId, basePayload({ scope: 'user', scopeTarget: null, presetKey: 'u-1', name: 'U' }));
        savePreset(userId, basePayload({ scope: 'repo', scopeTarget: 'acme/api', presetKey: 'r-1', name: 'R1' }));
        savePreset(userId, basePayload({ scope: 'repo', scopeTarget: 'other/api', presetKey: 'r-2', name: 'R2' }));

        const userScope = listPresets(userId, { scope: 'user', scopeTarget: null });
        expect(userScope).toHaveLength(1);
        expect(userScope[0].name).toBe('U');

        const acme = listPresets(userId, { scope: 'repo', scopeTarget: 'acme/api' });
        expect(acme).toHaveLength(1);
        expect(acme[0].name).toBe('R1');

        const allRepoBuckets = listPresets(userId, { scope: 'repo' });
        expect(allRepoBuckets).toHaveLength(2);
    });

    it('savePreset is idempotent for user-scope (NULL scope_target)', () => {
        const first = savePreset(userId, {
            scope: 'user', scopeTarget: null, presetKey: 'mine',
            name: 'My', systemPrompt: 'p1',
        });
        const second = savePreset(userId, {
            scope: 'user', scopeTarget: null, presetKey: 'mine',
            name: 'My v2', systemPrompt: 'p2',
        });
        expect(second).toBe(first); // same row id
        const all = listPresets(userId, { scope: 'user', scopeTarget: null });
        expect(all).toHaveLength(1);
        expect(all[0].name).toBe('My v2');
        expect(all[0].systemPrompt).toBe('p2');
    });

    it('updatePreset can replace or null path rules', () => {
        const id = savePreset(userId, basePayload());
        updatePreset(userId, id, { pathRules: null });
        let got = getPresetById(userId, id);
        expect(got.pathRules).toEqual([]);

        updatePreset(userId, id, { pathRules: [{ glob: 'tests/**', extraPrompt: 'Test rigor' }] });
        got = getPresetById(userId, id);
        expect(got.pathRules).toEqual([{ glob: 'tests/**', extraPrompt: 'Test rigor' }]);
    });

    // --- Slice 5 — org-scoped presets -------------------------------------

    describe('listOrgScopedPresets', () => {
        it('returns only rows whose scope=org and scope_target is in the list', () => {
            savePreset(userId, basePayload({ scope: 'org', scopeTarget: 'acme', presetKey: 'o-1', name: 'Acme A' }));
            savePreset(otherUserId, basePayload({ scope: 'org', scopeTarget: 'acme', presetKey: 'o-2', name: 'Acme B' }));
            savePreset(userId, basePayload({ scope: 'org', scopeTarget: 'globex', presetKey: 'o-3', name: 'Globex' }));
            // A user-scope row that should not leak in.
            savePreset(userId, basePayload({ scope: 'user', scopeTarget: null, presetKey: 'u-1', name: 'User row' }));

            const acme = listOrgScopedPresets(['acme']);
            expect(acme).toHaveLength(2);
            expect(acme.map((r) => r.name).sort()).toEqual(['Acme A', 'Acme B']);

            const both = listOrgScopedPresets(['acme', 'globex']);
            expect(both).toHaveLength(3);

            // Empty list → empty result, no SQL syntax break.
            expect(listOrgScopedPresets([])).toEqual([]);
            expect(listOrgScopedPresets(undefined)).toEqual([]);
        });

        it('does not return rows for orgs the caller did not list', () => {
            savePreset(userId, basePayload({ scope: 'org', scopeTarget: 'private-org', presetKey: 'p-1', name: 'P' }));
            const got = listOrgScopedPresets(['acme']);
            expect(got).toHaveLength(0);
        });
    });

    describe('getOrgDefaultForScope', () => {
        it('returns the org default regardless of which member authored it', () => {
            savePreset(userId, basePayload({ scope: 'org', scopeTarget: 'acme', presetKey: 'o-a', name: 'Not default', isDefault: false }));
            const id = savePreset(otherUserId, basePayload({ scope: 'org', scopeTarget: 'acme', presetKey: 'o-b', name: 'The default', isDefault: true }));
            const got = getOrgDefaultForScope('acme');
            expect(got).toBeTruthy();
            expect(got.id).toBe(id);
            expect(got.name).toBe('The default');
            // The author can be a different user than the lookup caller — that's
            // the whole point: org defaults are visible to every member.
            expect(got.userId).toBe(otherUserId);
        });

        it('returns null when no row in that org has is_default=1', () => {
            savePreset(userId, basePayload({ scope: 'org', scopeTarget: 'acme', presetKey: 'o-x', name: 'X', isDefault: false }));
            expect(getOrgDefaultForScope('acme')).toBeNull();
        });

        it('returns null for falsy/missing org login', () => {
            expect(getOrgDefaultForScope('')).toBeNull();
            expect(getOrgDefaultForScope(null)).toBeNull();
            expect(getOrgDefaultForScope(undefined)).toBeNull();
        });
    });

    describe('getOrgPresetById', () => {
        it('returns the row regardless of author when scope=org', () => {
            const id = savePreset(otherUserId, basePayload({ scope: 'org', scopeTarget: 'acme', presetKey: 'o-1', name: 'Theirs' }));
            const got = getOrgPresetById(id);
            expect(got).toBeTruthy();
            expect(got.id).toBe(id);
            expect(got.userId).toBe(otherUserId);
        });

        it('returns null for non-org rows (user or repo scope) — defence-in-depth IDOR guard', () => {
            const userId1 = savePreset(otherUserId, basePayload({ scope: 'user', scopeTarget: null, presetKey: 'u-1', name: 'User row' }));
            const repoId = savePreset(otherUserId, basePayload({ scope: 'repo', scopeTarget: 'acme/api', presetKey: 'r-1', name: 'Repo row' }));
            expect(getOrgPresetById(userId1)).toBeNull();
            expect(getOrgPresetById(repoId)).toBeNull();
        });
    });
});
