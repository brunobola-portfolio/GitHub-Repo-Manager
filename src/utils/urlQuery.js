/**
 * Write the query string without touching the path or the hash.
 *
 * The app routes by hash (#/repo/:owner/:name/:tab, #/work, …). Several
 * call sites rebuilt the URL as pathname + query and dropped the hash, so
 * closing a commit or clearing an ?error= param silently moved the user off
 * the repository they were in, and a shared ?commit= link opened the
 * dashboard instead of the commit.
 *
 * @param {URLSearchParams} params
 * @param {{ push?: boolean, state?: unknown }} [opts]
 */
export function writeQuery(params, { push = false, state = {} } = {}) {
    const query = params.toString()
    const url = window.location.pathname + (query ? `?${query}` : '') + window.location.hash
    if (push) window.history.pushState(state, '', url)
    else window.history.replaceState(state, '', url)
}
