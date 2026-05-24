// Parse the simple "owner/repo" form returned by GitHub's REST `full_name`
// field. Returns null for any non-string, empty, or malformed input.
//
// Mirrors src/utils/githubUrlParser.js#parseRepoFullName for backend callsites
// (auth middleware, work-board engine, actions service, bulk routes, …).
export function parseRepoFullName(fullName) {
  if (typeof fullName !== 'string') return null
  const trimmed = fullName.trim()
  if (!trimmed) return null
  const idx = trimmed.indexOf('/')
  if (idx <= 0 || idx === trimmed.length - 1) return null
  return { owner: trimmed.slice(0, idx), repo: trimmed.slice(idx + 1) }
}
