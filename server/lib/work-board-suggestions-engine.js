// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic pattern matcher for AI Assistant suggestions.
 * LLM-free for MVP — later phases can add LLM-generated phrasing.
 */

import db from '../db.js';

const STALE_DAYS = 90;
const MAX_SUGGESTIONS = 3;
const BOT_PREFIX_MIN = 3;

function isDismissed(userId, patternKey, repoFullName = '') {
    const row = db.prepare(
        'SELECT 1 FROM work_board_ai_dismissed WHERE user_id = ? AND pattern_key = ? AND repo_full_name = ?'
    ).get(userId, patternKey, repoFullName);
    return Boolean(row);
}

function detectBotPrefix(userId, repos) {
    const muted = repos.filter(r => r.is_muted === 1);
    const byPrefix = new Map();
    for (const r of muted) {
        const [, name] = r.repo_full_name.split('/');
        if (!name) continue;
        const m = name.match(/^([a-z]+)[-_]/i);
        if (!m) continue;
        const prefix = m[1].toLowerCase();
        if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
        byPrefix.get(prefix).push(r.repo_full_name);
    }
    const results = [];
    for (const [prefix, names] of byPrefix.entries()) {
        if (names.length < BOT_PREFIX_MIN) continue;
        if (isDismissed(userId, 'BotPrefix', prefix)) continue;
        results.push({
            pattern_key: 'BotPrefix',
            dismiss_key: prefix,
            title: `Always mute ${prefix}-* repositories`,
            description: `You've muted ${names.length} repos starting with "${prefix}-".`,
            repos: names,
            confidence: 0.85,
        });
    }
    return results;
}

function detectStale(userId, repos) {
    const cutoff = Date.now() - STALE_DAYS * 86400 * 1000;
    const stale = [];
    for (const r of repos) {
        if (r.is_pinned === 1) continue;
        if (r.is_muted === 1) continue;
        if (!r.last_activity_at) continue;
        if (new Date(r.last_activity_at).getTime() < cutoff) {
            if (isDismissed(userId, 'StaleNoActivity', r.repo_full_name)) continue;
            stale.push(r.repo_full_name);
        }
    }
    if (stale.length === 0) return [];
    return [{
        pattern_key: 'StaleNoActivity',
        title: `Mute ${stale.length} repos without activity for 3+ months`,
        description: "These repos haven't had relevant activity in 90+ days.",
        repos: stale,
        confidence: 0.7,
    }];
}

export function computeSuggestions(userId) {
    const repos = db.prepare(
        'SELECT repo_full_name, is_pinned, is_muted, last_activity_at FROM work_board_tracked_repos WHERE user_id = ?'
    ).all(userId);

    if (repos.length === 0) return [];

    const all = [
        ...detectBotPrefix(userId, repos),
        ...detectStale(userId, repos),
    ];

    return all.slice(0, MAX_SUGGESTIONS);
}

export function dismissSuggestion(userId, patternKey, repoFullName = '') {
    db.prepare(`
        INSERT INTO work_board_ai_dismissed (user_id, pattern_key, repo_full_name)
        VALUES (?, ?, ?)
        ON CONFLICT DO NOTHING
    `).run(userId, patternKey, repoFullName);
}
