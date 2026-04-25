/**
 * Pure builder — produces cmdk command items relevant only when the user is
 * looking at the Teams view (activeView === 'teams'). No React.
 *
 * @typedef {object} TeamsCommand
 * @property {string} id
 * @property {string} label
 * @property {string} searchValue
 * @property {string} icon
 * @property {'event'} kind
 * @property {string} event
 */

/**
 * @returns {TeamsCommand[]}
 */
export function buildTeamsCommands() {
    return [
        {
            id: 'teams-create',
            label: 'Create new team',
            searchValue: 'create new team',
            icon: 'Plus',
            kind: 'event',
            event: 'teams:create',
        },
        {
            id: 'teams-refresh',
            label: 'Refresh teams list',
            searchValue: 'refresh teams',
            icon: 'RefreshCw',
            kind: 'event',
            event: 'teams:refresh',
        },
    ]
}
