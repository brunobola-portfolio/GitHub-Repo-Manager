/**
 * Adapter — the command palette's "Repo Actions" group entry point.
 *
 * Emits ONE item per repo (a picker), not the old action × repo cartesian
 * product. Selecting a repo pushes CommandPalette's second-level "scoped"
 * mode, whose items enumerate the FULL, uncapped action list for that one
 * repo via `buildRepoActionCommands` from the registry
 * (`src/actions/repoActions.js`) — see CommandPalette.jsx's `repoActionMode`
 * state.
 *
 * The old shape (one item per action × repo, capped at `reposLimit` repos
 * to keep the combinatorics sane) could only ever reach the first few
 * repos' worth of actions. A picker scales to as many repos as the palette
 * already shows elsewhere — the caller passes `displayRepos`, capped to 10
 * the same way "Your Repositories" is — and the per-repo drill-down itself
 * has no cap at all, since it is bounded by the action registry (~20
 * entries), not by repo count.
 */
export function buildRepoActionsCommands(repos) {
    if (!Array.isArray(repos) || repos.length === 0) return []
    return repos.map((repo) => ({
        id: `repo-actions-picker::${repo.id}`,
        label: repo.full_name,
        searchValue: `Repo actions ${repo.full_name}`,
        icon: 'GitFork',
        kind: 'drill',
        repo,
    }))
}
