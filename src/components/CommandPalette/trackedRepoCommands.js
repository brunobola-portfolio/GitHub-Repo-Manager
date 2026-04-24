/**
 * Pure builder — generates cmdk command items for every tracked repo.
 * No React / no DOM access. Kept framework-free so it's trivially unit-tested.
 *
 * @typedef {object} TrackedRepoCommand
 * @property {string} id
 * @property {string} label
 * @property {string} searchValue
 * @property {'pin'|'unpin'|'mute'|'unmute'|'untrack'} actionType
 * @property {string} repoFullName
 * @property {string} icon — lucide icon name
 */

/**
 * @param {Array<{repo_full_name: string, is_pinned: number, is_muted: number}>} repos
 * @returns {TrackedRepoCommand[]}
 */
export function buildTrackedRepoCommands(repos) {
    const items = []
    if (!Array.isArray(repos)) return items
    for (const r of repos) {
        const name = r.repo_full_name

        if (r.is_pinned === 1) {
            items.push({
                id: `track-unpin-${name}`,
                label: `Unpin ${name}`,
                searchValue: `unpin ${name}`,
                actionType: 'unpin',
                repoFullName: name,
                icon: 'PinOff',
            })
        } else {
            items.push({
                id: `track-pin-${name}`,
                label: `Pin ${name}`,
                searchValue: `pin ${name}`,
                actionType: 'pin',
                repoFullName: name,
                icon: 'Pin',
            })
        }

        if (r.is_muted === 1) {
            items.push({
                id: `track-unmute-${name}`,
                label: `Unmute ${name}`,
                searchValue: `unmute ${name}`,
                actionType: 'unmute',
                repoFullName: name,
                icon: 'Bell',
            })
        } else {
            items.push({
                id: `track-mute-${name}`,
                label: `Mute ${name}`,
                searchValue: `mute ${name}`,
                actionType: 'mute',
                repoFullName: name,
                icon: 'BellOff',
            })
        }

        items.push({
            id: `track-untrack-${name}`,
            label: `Stop tracking ${name}`,
            searchValue: `untrack ${name}`,
            actionType: 'untrack',
            repoFullName: name,
            icon: 'X',
        })
    }
    return items
}
