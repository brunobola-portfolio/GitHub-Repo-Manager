/**
 * Pure builder — produces cmdk command items relevant only when the user is
 * looking at a single repository (activeView === 'repo-detail'). No React.
 *
 * @typedef {object} RepoDetailCommand
 * @property {string} id
 * @property {string} label
 * @property {string} searchValue
 * @property {string} icon — lucide icon name as a string key
 * @property {'navigate'|'open-external'|'copy'|'event'} kind
 * @property {string} [tab]    — for navigate
 * @property {string} [url]    — for open-external
 * @property {string} [text]   — for copy
 * @property {string} [event]  — for custom event dispatch
 */

const TAB_ITEMS = [
    { tab: 'overview', label: 'Open Overview tab', icon: 'FileText' },
    { tab: 'branches', label: 'Open Branches tab', icon: 'GitBranch' },
    { tab: 'releases', label: 'Open Releases tab', icon: 'Tag' },
    { tab: 'issues', label: 'Open Issues tab', icon: 'CircleDot' },
    { tab: 'pulls', label: 'Open pull requests tab', icon: 'GitPullRequest' },
    { tab: 'settings', label: 'Open Settings tab', icon: 'Settings' },
]

/**
 * @param {{ full_name?: string, html_url?: string, clone_url?: string, ssh_url?: string } | null | undefined} repo
 * @returns {RepoDetailCommand[]}
 */
export function buildRepoDetailCommands(repo) {
    if (!repo || !repo.full_name) return []
    const name = repo.full_name

    /** @type {RepoDetailCommand[]} */
    const items = []

    if (repo.html_url) {
        items.push({
            id: `rd-open-github-${name}`,
            label: `Open ${name} on GitHub`,
            searchValue: `open github ${name}`,
            icon: 'ExternalLink',
            kind: 'open-external',
            url: repo.html_url,
        })
    }

    if (repo.clone_url) {
        items.push({
            id: `rd-copy-clone-${name}`,
            label: `Copy HTTPS clone URL for ${name}`,
            searchValue: `copy clone https ${name}`,
            icon: 'Copy',
            kind: 'copy',
            text: repo.clone_url,
        })
    }
    if (repo.ssh_url) {
        items.push({
            id: `rd-copy-ssh-${name}`,
            label: `Copy SSH clone URL for ${name}`,
            searchValue: `copy clone ssh ${name}`,
            icon: 'Copy',
            kind: 'copy',
            text: repo.ssh_url,
        })
    }

    items.push({
        id: `rd-run-audit-${name}`,
        label: `Run security audit on ${name}`,
        searchValue: `audit security ${name}`,
        icon: 'ShieldAlert',
        kind: 'event',
        event: 'repo-detail:run-audit',
    })

    for (const t of TAB_ITEMS) {
        items.push({
            id: `rd-tab-${t.tab}-${name}`,
            label: t.label,
            searchValue: `tab ${t.tab} ${name}`,
            icon: t.icon,
            kind: 'event',
            event: 'repo-detail:go-tab',
            tab: t.tab,
        })
    }

    return items
}
