// SPDX-License-Identifier: Apache-2.0
/**
 * Pure-function merge: takes existing tracked rows + freshly-discovered
 * candidates and decides what to add/remove/keep. Respects user state
 * (pinned / muted rows are never auto-removed). Signal priority: the
 * earliest matching signal wins per repo.
 */

const SIGNAL_PRIORITY = {
    review_requested: 1,
    authored_pr: 2,
    assigned_issue: 3,
    owned: 4,
    recent_commit: 5,
};

/**
 * @param {Array<{repo_full_name, is_pinned, is_muted, source_signal}>} existing
 * @param {Array<{repo_full_name, last_activity_at, signal, repo_id?}>} candidates
 * @param {{ max_auto_repos: number }} prefs
 * @returns {{ keep: Array, add: Array, remove: Array }}
 */
export function mergeCandidates(existing, candidates, prefs) {
    // Dedup candidates — earliest signal wins, latest activity wins
    const byRepo = new Map();
    for (const c of candidates) {
        const current = byRepo.get(c.repo_full_name);
        if (!current) {
            byRepo.set(c.repo_full_name, { ...c });
            continue;
        }
        if ((SIGNAL_PRIORITY[c.signal] ?? 99) < (SIGNAL_PRIORITY[current.signal] ?? 99)) {
            current.signal = c.signal;
        }
        if (c.last_activity_at > current.last_activity_at) {
            current.last_activity_at = c.last_activity_at;
        }
        if (c.repo_id) current.repo_id = c.repo_id;
    }

    const existingByRepo = new Map(existing.map(r => [r.repo_full_name, r]));
    const keep = [];
    const remove = [];
    const add = [];

    for (const row of existing) {
        const isProtected = row.is_pinned === 1 || row.is_muted === 1 || row.source_signal === 'webhook';
        const inCandidates = byRepo.has(row.repo_full_name);
        if (isProtected || inCandidates) {
            keep.push(row);
        } else {
            remove.push(row);
        }
    }

    for (const c of byRepo.values()) {
        if (existingByRepo.has(c.repo_full_name)) continue;
        add.push({
            repo_full_name: c.repo_full_name,
            source_signal: c.signal,
            last_activity_at: c.last_activity_at,
            repo_id: c.repo_id ?? null,
        });
    }

    const room = Math.max(0, prefs.max_auto_repos);
    add.sort((a, b) => (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''));
    if (add.length > room) {
        add.length = room;
    }

    return { keep, add, remove };
}
