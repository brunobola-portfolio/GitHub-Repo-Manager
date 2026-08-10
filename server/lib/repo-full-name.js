// Parse the simple "owner/repo" form returned by GitHub's REST `full_name`
// field. Returns null for any non-string, empty, or malformed input.
//
// Both segments are validated, not just split out. Every backend caller feeds
// the result straight into an api.github.com path
// (`/repos/${owner}/${repo}/...`), and `full_name` arrives from request bodies
// — so a repo segment of 'a/../../users/victim' silently retargets the call to
// a different endpoint once fetch normalises the path. GitHub itself never
// emits a full_name with more than one slash, which is why the old
// "preserve slash-bearing repo portion" behaviour had no legitimate caller.
//
// Deliberately stricter than src/utils/githubUrlParser.js#parseRepoFullName:
// that one feeds display and links, this one feeds URLs we sign with the
// user's token.
import { isValidOwner, isValidRepoName } from './github-names.js'

export function parseRepoFullName(fullName) {
  if (typeof fullName !== 'string') return null
  const trimmed = fullName.trim()
  if (!trimmed) return null

  const idx = trimmed.indexOf('/')
  if (idx <= 0 || idx === trimmed.length - 1) return null

  const owner = trimmed.slice(0, idx)
  const repo = trimmed.slice(idx + 1)

  if (!isValidOwner(owner) || !isValidRepoName(repo)) return null

  return { owner, repo }
}
