// tests/components/MigrationWizard/steps/RepoSelectStep/fixtures.js
export function makeRepo(overrides = {}) {
  return {
    id: 'repo-id',
    name: 'my-repo',
    size: 1024,
    branches: 1,
    selected: true,
    isDisabled: false,
    isTfvc: false,
    hasLfsMarker: false,
    lfsEnabled: false,
    lastCommitDate: new Date().toISOString(),
    targetName: undefined,
    sizeStrategy: undefined,
    ...overrides,
  }
}
