/**
 * Adapter — converts the cross-surface action registry
 * (`src/actions/repoActions.js` → `buildRepoActionCommands`) into the cmdk
 * palette item shape used elsewhere in this folder.
 *
 * Why an adapter and not a direct registry consumption: the registry returns
 * `{ id, label, description, run }` items already, but the palette renders
 * via cmdk + `runContextCommand` switch on `kind`. Adding `kind: 'run'` to
 * that switch + this builder keeps registry items rendering consistently
 * alongside the existing event/copy/open-external commands.
 *
 * Limit reposLimit to keep the palette palatable — the registry would
 * otherwise emit one item per (action × repo) which scales O(N×M) with
 * repo count.
 */
import { buildRepoActionCommands, repoActions } from '../../actions/repoActions'

const ICON_KEY_BY_ACTION = {
    open_detail: 'ExternalLink',
    open_repo_settings: 'Settings',
    open_on_github: 'ExternalLink',
    migration_history: 'Clock',
    community_health: 'ShieldAlert',
    fix_community_health: 'ShieldAlert',
    copy_clone_https: 'Copy',
    copy_clone_ssh: 'Copy',
    copy_clone_gh: 'Copy',
}

/**
 * @param {Array} repos          subset of repos to enumerate (callers usually
 *                               pass the top displayRepos to bound work)
 * @param {Object} ctx           result of useRepoActionContext()
 * @param {Object} [opts]
 * @param {number} [opts.reposLimit=3]   hard cap on repos enumerated
 * @returns {Array} palette items: { id, label, searchValue, icon, kind: 'run', run }
 */
export function buildRepoActionsCommands(repos, ctx, { reposLimit = 3 } = {}) {
    if (!Array.isArray(repos) || repos.length === 0 || !ctx) return []
    const sliced = repos.slice(0, reposLimit)
    const raw = buildRepoActionCommands(sliced, ctx)
    return raw.map((item) => {
        const actionId = item.id.split('::')[0]
        return {
            id: item.id,
            label: item.label,
            searchValue: item.label,
            icon: ICON_KEY_BY_ACTION[actionId] ?? null,
            kind: 'run',
            run: item.run,
        }
    })
}

// Re-export so callers can import both from the same module.
export { repoActions }
