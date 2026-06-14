/**
 * Build the per-repo task `config` object for the migration engine from a
 * configured wizard repo. Pure — extracted from ScheduleStep so the
 * conflict/visibility/in-place wiring is unit-testable.
 *
 * @param {object} repo - a selected, configured wizard repo
 * @param {{ isInPlace: boolean, targetProject?: string }} ctx
 * @returns {object} task config
 */
export function buildRepoTaskConfig(repo, { isInPlace, targetProject }) {
  const baseConfig = {
    makePrivate: repo.visibility === 'private',
    description: repo.description || '',
  }
  let config = repo.sizeStrategy === 'lfs-migrate'
    ? { ...baseConfig, sizeStrategy: 'lfs-migrate' }
    : baseConfig

  // Destructive replace: carry the user's confirmed intent to the backend.
  if (repo.conflictAction === 'replace') {
    config = { ...config, onConflict: 'replace' }
  }

  if (isInPlace && repo.isTfvc) {
    config = {
      ...config,
      inPlace: true,
      targetProject,
      ...(repo.targetType === 'existing-empty' && repo.existingRepoId
        ? { existingRepoId: repo.existingRepoId }
        : {}),
    }
  }
  return config
}
