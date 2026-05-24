// Frontend mirror of server/lib/migration-tagging-constants.js DEFAULT_POLICY.
// Kept thin so it can be imported without pulling in components.
export const DEFAULT_TAGGING_POLICY = Object.freeze({
  enabled: true,
  writeSource: true,
  writeDestination: true,
  writeGitTag: true,
  hideSourceName: false
})
