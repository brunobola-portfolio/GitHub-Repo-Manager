/**
 * Normalize the `showTransfer` modal payload into a stable shape.
 *
 * Entry-points historically hand the modal different shapes:
 *   - an array of repos      — App "Transfer" button, `transfer_selected` batch
 *   - a single repo object   — legacy context-menu `transfer` action
 *   - `{ repos, action }`     — `mirror` entry-point, which opens the modal
 *                              pre-switched to mirror mode
 *
 * `TransferModal` calls `repos.map(...)`, so `repos` MUST always be an array.
 * Coercing here (rather than guarding at every call site) means a stray
 * non-array payload degrades to an empty list instead of crashing the modal
 * with "repos.map is not a function".
 *
 * @param {object[]|object|{repos:object[]|object, action?:string}|null|undefined} data
 * @returns {{ repos: object[], action: 'transfer' | 'mirror' }}
 */
export function normalizeTransferModalData(data) {
	const action = (data && !Array.isArray(data) && data.action === 'mirror') ? 'mirror' : 'transfer'

	if (Array.isArray(data)) return { repos: data, action }

	if (data && typeof data === 'object') {
		if (Array.isArray(data.repos)) return { repos: data.repos, action }
		if (data.repos) return { repos: [data.repos], action }
		// A bare repo object (has full_name/name but no `repos` key).
		if (data.full_name || data.name) return { repos: [data], action }
	}

	return { repos: [], action }
}
