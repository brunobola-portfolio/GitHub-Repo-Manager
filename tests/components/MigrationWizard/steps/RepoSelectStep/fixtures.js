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
    lastCommitDate: '2025-01-01T00:00:00Z',
    targetName: undefined,
    sizeStrategy: undefined,
    ...overrides,
  }
}
