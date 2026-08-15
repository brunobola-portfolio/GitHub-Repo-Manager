// SPDX-License-Identifier: Apache-2.0
//
// Schema assertions for tables added to initDB() that are not covered by a
// dedicated migration test file. Each describe block corresponds to one table.

import { describe, it, expect, vi } from 'vitest';
import { makeIntegrationDb } from './helpers/integration-db.js';

const { initDB } = await vi.importActual('../db.js');
const db = makeIntegrationDb(initDB);

describe('dashboard_inbox_state table', () => {
    it('exists with expected columns', () => {
        const cols = db.prepare("PRAGMA table_info('dashboard_inbox_state')").all();
        const names = cols.map(c => c.name).sort();
        expect(names).toEqual(['archived_at', 'item_id', 'snoozed_until', 'user_id']);
    });

    it('uses (user_id, item_id) as composite primary key', () => {
        const cols = db.prepare("PRAGMA table_info('dashboard_inbox_state')").all();
        const pkCols = cols.filter(c => c.pk > 0).map(c => c.name).sort();
        expect(pkCols).toEqual(['item_id', 'user_id']);
    });
});
