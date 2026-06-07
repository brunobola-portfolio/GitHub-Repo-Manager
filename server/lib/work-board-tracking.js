// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CRUD on work_board_tracked_repos. Every mutation records an undo-log
 * entry so the user can revert within UNDO_TTL_HOURS. Mutations are
 * idempotent at the row level (ON CONFLICT DO UPDATE).
 */

import db from '../db.js';
import { recordOperation } from './work-board-undo-log.js';

const VALID_ACTIONS = new Set(['pin', 'unpin', 'mute', 'unmute', 'track', 'untrack']);

/** Compact snapshot for undo-log (only the columns that matter for reverting). */
function snapshotForUndo(row) {
    if (!row) return null;
    return {
        repo_full_name: row.repo_full_name,
        is_pinned: row.is_pinned,
        is_muted: row.is_muted,
        source_signal: row.source_signal,
    };
}

/** Full snapshot returned to the caller (includes source_signal for UI). */
function snapshotRow(row) {
    if (!row) return null;
    return {
        repo_full_name: row.repo_full_name,
        is_pinned: row.is_pinned,
        is_muted: row.is_muted,
        source_signal: row.source_signal,
    };
}

/**
 * Apply a single-repo action.
 * @param {number} userId
 * @param {string} repoFullName — "owner/repo"
 * @param {'pin'|'unpin'|'mute'|'unmute'|'track'|'untrack'} action
 * @returns {{ operationId: string|null, newState: object|null }}
 */
export function upsertTrackedRepo(userId, repoFullName, action) {
    if (!VALID_ACTIONS.has(action)) {
        throw new Error(`Invalid action: ${action}`);
    }

    const existing = db.prepare(
        'SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?'
    ).get(userId, repoFullName);

    const beforeUndo = snapshotForUndo(existing);

    if (action === 'untrack') {
        if (!existing) return { operationId: null, newState: null };
        db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?')
          .run(userId, repoFullName);
        const opId = recordOperation(userId, 'untrack', [beforeUndo], []);
        return { operationId: opId, newState: null };
    }

    const base = existing
        ? {
            user_id: existing.user_id,
            repo_full_name: existing.repo_full_name,
            repo_id: existing.repo_id,
            source_signal: existing.source_signal,
            is_pinned: existing.is_pinned,
            is_muted: existing.is_muted,
          }
        : {
            user_id: userId,
            repo_full_name: repoFullName,
            repo_id: null,
            source_signal: 'pinned',
            is_pinned: 0,
            is_muted: 0,
          };

    switch (action) {
        case 'pin':
            base.is_pinned = 1;
            if (!existing) base.source_signal = 'pinned';
            break;
        case 'unpin':
            base.is_pinned = 0;
            break;
        case 'mute':
            base.is_muted = 1;
            break;
        case 'unmute':
            base.is_muted = 0;
            break;
        case 'track':
            if (!existing) {
                base.is_pinned = 1;
                base.source_signal = 'pinned';
            }
            break;
    }

    db.prepare(`
        INSERT INTO work_board_tracked_repos
            (user_id, repo_full_name, repo_id, source_signal, is_pinned, is_muted, last_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
            is_pinned = excluded.is_pinned,
            is_muted = excluded.is_muted,
            last_synced_at = CURRENT_TIMESTAMP
    `).run(base.user_id, base.repo_full_name, base.repo_id, base.source_signal, base.is_pinned, base.is_muted);

    const afterUndo = snapshotForUndo(base);
    const opId = recordOperation(userId, action, beforeUndo ? [beforeUndo] : [], [afterUndo]);

    return { operationId: opId, newState: snapshotRow(base) };
}

/**
 * @param {number} userId
 * @param {object} filters
 * @param {string} [filters.search] — substring match on repo_full_name (case-insensitive)
 * @param {string} [filters.signal] — exact source_signal match
 * @param {string} [filters.org] — owner prefix match (e.g. "tesla" matches "tesla/foo")
 * @param {boolean} [filters.muted] — if true returns only muted; if false only non-muted; if undefined returns all
 * @param {boolean} [filters.pinned] — same semantics as muted
 * @param {number} [filters.limit=500]
 * @param {number} [filters.offset=0]
 * @returns {{ items: object[], total: number, countsBySignal: Record<string, number> }}
 */
export function getTrackedRepos(userId, filters = {}) {
    const conds = ['user_id = ?'];
    const params = [userId];

    if (filters.search) {
        conds.push('LOWER(repo_full_name) LIKE ?');
        params.push(`%${filters.search.toLowerCase()}%`);
    }
    if (filters.signal) {
        conds.push('source_signal = ?');
        params.push(filters.signal);
    }
    if (filters.org) {
        conds.push('repo_full_name LIKE ?');
        params.push(`${filters.org}/%`);
    }
    if (filters.muted === true) conds.push('is_muted = 1');
    if (filters.muted === false) conds.push('is_muted = 0');
    if (filters.pinned === true) conds.push('is_pinned = 1');
    if (filters.pinned === false) conds.push('is_pinned = 0');

    const where = conds.join(' AND ');
    // Coerce to int first: a non-numeric query value (e.g. ?limit=abc) would
    // otherwise reach Math.max as a string -> NaN -> "LIMIT NaN" (invalid SQL).
    const limit = Math.min(Math.max(1, Number.parseInt(filters.limit, 10) || 500), 500);
    const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);

    const items = db.prepare(`
        SELECT repo_full_name, repo_id, source_signal, is_pinned, is_muted,
               last_activity_at, discovered_at, last_synced_at
        FROM work_board_tracked_repos
        WHERE ${where}
        ORDER BY last_activity_at DESC
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = db.prepare(`SELECT COUNT(*) AS c FROM work_board_tracked_repos WHERE ${where}`)
        .get(...params).c;

    const countsRows = db.prepare(`
        SELECT source_signal, COUNT(*) AS c
        FROM work_board_tracked_repos
        WHERE user_id = ?
        GROUP BY source_signal
    `).all(userId);
    const countsBySignal = Object.fromEntries(countsRows.map(r => [r.source_signal, r.c]));

    return { items, total, countsBySignal };
}

const BULK_MAX = 200;
const EXISTING_REQUIRED = new Set(['pin', 'unpin', 'mute', 'unmute', 'untrack']);

/**
 * Apply an action to many repos in one atomic undo-unit.
 * @param {number} userId
 * @param {string[]} repoFullNames
 * @param {'pin'|'unpin'|'mute'|'unmute'|'track'|'untrack'} action
 * @returns {{ operationId: string|null, updated: number, skipped: string[] }}
 */
export function bulkUpdate(userId, repoFullNames, action) {
    if (!VALID_ACTIONS.has(action)) {
        throw new Error(`Invalid action: ${action}`);
    }
    if (repoFullNames.length > BULK_MAX) {
        throw new Error(`Bulk size exceeds ${BULK_MAX}`);
    }
    if (repoFullNames.length === 0) {
        return { operationId: null, updated: 0, skipped: [] };
    }

    const beforeStates = [];
    const afterStates = [];
    const skipped = [];

    const tx = db.transaction(() => {
        for (const repo of repoFullNames) {
            const existing = db.prepare(
                'SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?'
            ).get(userId, repo);

            if (EXISTING_REQUIRED.has(action) && !existing) {
                skipped.push(repo);
                continue;
            }

            const before = snapshotForUndo(existing);
            if (before) beforeStates.push(before);

            if (action === 'untrack') {
                db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?')
                  .run(userId, repo);
                afterStates.push({ repo_full_name: repo, is_pinned: 0, is_muted: 0, deleted: true });
                continue;
            }

            const base = existing ?? { source_signal: 'pinned', is_pinned: 0, is_muted: 0 };
            let is_pinned = base.is_pinned, is_muted = base.is_muted, source_signal = base.source_signal;

            switch (action) {
                case 'pin':    is_pinned = 1; if (!existing) source_signal = 'pinned'; break;
                case 'unpin':  is_pinned = 0; break;
                case 'mute':   is_muted = 1; break;
                case 'unmute': is_muted = 0; break;
                case 'track':  is_pinned = existing ? is_pinned : 1;
                               if (!existing) source_signal = 'pinned';
                               break;
            }

            db.prepare(`
                INSERT INTO work_board_tracked_repos
                    (user_id, repo_full_name, source_signal, is_pinned, is_muted, last_synced_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
                    is_pinned = excluded.is_pinned,
                    is_muted = excluded.is_muted,
                    last_synced_at = CURRENT_TIMESTAMP
            `).run(userId, repo, source_signal, is_pinned, is_muted);

            afterStates.push({ repo_full_name: repo, is_pinned, is_muted });
        }
    });
    tx();

    const opId = (beforeStates.length + afterStates.length) > 0
        ? recordOperation(userId, 'bulk', beforeStates, afterStates)
        : null;

    return {
        operationId: opId,
        updated: afterStates.length,
        skipped,
    };
}
export function deleteTrackedRepo() { throw new Error('not implemented'); }

/**
 * Auto-insert a tracked_repos row when a webhook delivery references a repo
 * not yet tracked. Uses source_signal='webhook'. Updates last_activity_at on
 * subsequent events. No undo-log entry (system action, not user action).
 *
 * Safe to call on every webhook delivery — the ON CONFLICT clause makes it
 * idempotent.
 *
 * @param {number|null|undefined} userId
 * @param {string} repoFullName
 * @param {number|null|undefined} repoId
 */
export function upsertTrackedRepoFromWebhook(userId, repoFullName, repoId) {
    if (!userId || !repoFullName) return;
    db.prepare(`
        INSERT INTO work_board_tracked_repos
            (user_id, repo_full_name, repo_id, source_signal, is_pinned, is_muted, last_activity_at, last_synced_at)
        VALUES (?, ?, ?, 'webhook', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
            last_activity_at = CURRENT_TIMESTAMP,
            last_synced_at = CURRENT_TIMESTAMP
    `).run(userId, repoFullName, repoId ?? null);
}

const PREF_DEFAULTS = {
    discovery_window_days: 60,
    max_auto_repos: 50,
    auto_mute_bots: 0,
    ai_assistant_enabled: 0,
    ai_monthly_cap_cents: 500,
    ai_response_locale: null,
    last_discovery_at: null,
};

const PREF_VALIDATORS = {
    discovery_window_days: (v) => {
        if (!Number.isInteger(v) || v < 30 || v > 180) throw new Error('discovery_window_days out of range (30-180)');
    },
    max_auto_repos: (v) => {
        if (!Number.isInteger(v) || v < 20 || v > 200) throw new Error('max_auto_repos out of range (20-200)');
    },
    auto_mute_bots: (v) => {
        if (v !== 0 && v !== 1) throw new Error('auto_mute_bots must be 0 or 1');
    },
    ai_assistant_enabled: (v) => {
        if (v !== 0 && v !== 1) throw new Error('ai_assistant_enabled must be 0 or 1');
    },
    ai_monthly_cap_cents: (v) => {
        if (!Number.isInteger(v) || v < 0 || v > 100000) throw new Error('ai_monthly_cap_cents out of range (0-100000)');
    },
    ai_response_locale: (v) => {
        if (v !== null && (typeof v !== 'string' || v.length > 10)) throw new Error('ai_response_locale must be short string or null');
    },
};

/**
 * @returns {object} merged prefs (defaults + user overrides)
 */
export function getPrefs(userId) {
    const row = db.prepare('SELECT * FROM work_board_prefs WHERE user_id = ?').get(userId);
    if (!row) return { ...PREF_DEFAULTS };
    const { user_id, ...rest } = row;
    return { ...PREF_DEFAULTS, ...rest };
}

/**
 * @param {number} userId
 * @param {object} patch — partial prefs
 * @returns {object} merged prefs after patch
 */
export function patchPrefs(userId, patch) {
    for (const key of Object.keys(patch)) {
        if (!(key in PREF_VALIDATORS)) {
            throw new Error(`Unknown pref key: ${key}`);
        }
        PREF_VALIDATORS[key](patch[key]);
    }

    const current = getPrefs(userId);
    const merged = { ...current, ...patch };

    db.prepare(`
        INSERT INTO work_board_prefs
            (user_id, discovery_window_days, max_auto_repos, auto_mute_bots,
             ai_assistant_enabled, ai_monthly_cap_cents, ai_response_locale, last_discovery_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            discovery_window_days = excluded.discovery_window_days,
            max_auto_repos        = excluded.max_auto_repos,
            auto_mute_bots        = excluded.auto_mute_bots,
            ai_assistant_enabled  = excluded.ai_assistant_enabled,
            ai_monthly_cap_cents  = excluded.ai_monthly_cap_cents,
            ai_response_locale    = excluded.ai_response_locale,
            last_discovery_at     = excluded.last_discovery_at
    `).run(
        userId,
        merged.discovery_window_days,
        merged.max_auto_repos,
        merged.auto_mute_bots,
        merged.ai_assistant_enabled,
        merged.ai_monthly_cap_cents,
        merged.ai_response_locale,
        merged.last_discovery_at,
    );

    return merged;
}
