import { describe, it, expect } from 'vitest'
import { buildWizardPayload } from '@/utils/pasteDialogPayload'

function azureDialog(overrides = {}) {
  return {
    status: 'ready',
    sourceType: 'azure',
    parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
    answers: { targetOrg: 'bolalabs', targetName: 'Cacadores' },
    nextField: null,
    ...overrides,
  }
}

function githubDialog(overrides = {}) {
  return {
    status: 'ready',
    sourceType: 'github',
    parsed: { owner: 'bolalabs', repo: 'BolaLabs' },
    answers: { targetOrg: 'bolalabs', targetName: 'BolaLabs' },
    nextField: null,
    ...overrides,
  }
}

describe('buildWizardPayload — Azure', () => {
  it('builds a full repoConfig payload when org/project/repo and both answers are set', () => {
    const payload = buildWizardPayload(azureDialog())
    expect(payload).toEqual({
      initialSource: {
        sourceType: 'azure',
        org: 'bruno',
        project: 'AWIP',
        targetOrg: 'bolalabs',
        targetName: 'Cacadores',
      },
      initialRepos: [
        { id: 'paste-Cacadores', name: 'Cacadores', selected: true, targetName: 'Cacadores' },
      ],
      initialStep: 'repoConfig',
    })
  })

  it('routes to azureConnect with an empty initialRepos when repo is missing', () => {
    const payload = buildWizardPayload(azureDialog({
      parsed: { org: 'bruno', project: 'AWIP', repo: null },
      answers: { targetOrg: 'bolalabs', targetName: 'keep' },
    }))
    expect(payload.initialStep).toBe('azureConnect')
    expect(payload.initialRepos).toEqual([])
    expect(payload.initialSource.org).toBe('bruno')
    expect(payload.initialSource.project).toBe('AWIP')
  })

  it('treats "keep" (case-insensitive) as "use detected name"', () => {
    const payload = buildWizardPayload(azureDialog({
      answers: { targetOrg: 'bolalabs', targetName: 'KEEP' },
    }))
    expect(payload.initialSource.targetName).toBe('Cacadores')
    expect(payload.initialRepos[0].targetName).toBe('Cacadores')
  })

  it('treats empty/whitespace targetName as "use detected name"', () => {
    const payload = buildWizardPayload(azureDialog({
      answers: { targetOrg: 'bolalabs', targetName: '  ' },
    }))
    expect(payload.initialSource.targetName).toBe('Cacadores')
  })

  it('uses custom targetName when the user types a real name', () => {
    const payload = buildWizardPayload(azureDialog({
      answers: { targetOrg: 'bolalabs', targetName: 'NewName' },
    }))
    expect(payload.initialSource.targetName).toBe('NewName')
    expect(payload.initialRepos[0].targetName).toBe('NewName')
  })

  it('handles missing org/project gracefully (defaults to empty string)', () => {
    const payload = buildWizardPayload(azureDialog({
      parsed: { org: null, project: null, repo: 'Only' },
    }))
    expect(payload.initialSource.org).toBe('')
    expect(payload.initialSource.project).toBe('')
    expect(payload.initialStep).toBe('repoConfig')
  })
})

describe('buildWizardPayload — GitHub', () => {
  it('builds a targetConfig payload with a reconstructed githubSourceUrl', () => {
    const payload = buildWizardPayload(githubDialog())
    expect(payload).toEqual({
      initialSource: {
        sourceType: 'github',
        githubSourceUrl: 'https://github.com/bolalabs/BolaLabs',
        targetOrg: 'bolalabs',
        targetName: 'BolaLabs',
      },
      initialRepos: [],
      initialStep: 'targetConfig',
    })
  })

  it('treats "keep" as "use detected repo name"', () => {
    const payload = buildWizardPayload(githubDialog({
      answers: { targetOrg: 'bolalabs', targetName: 'keep' },
    }))
    expect(payload.initialSource.targetName).toBe('BolaLabs')
  })

  it('uses custom targetName when user types a different name', () => {
    const payload = buildWizardPayload(githubDialog({
      answers: { targetOrg: 'bolalabs', targetName: 'renamed-repo' },
    }))
    expect(payload.initialSource.targetName).toBe('renamed-repo')
  })

  it('normalises SSH-style parsed owner/repo back into an https URL', () => {
    // parseGitHubUrl normalises SSH into owner/repo; buildWizardPayload
    // composes the final https URL consistently regardless of paste source.
    const payload = buildWizardPayload(githubDialog({
      parsed: { owner: 'user-ssh', repo: 'repo-ssh' },
    }))
    expect(payload.initialSource.githubSourceUrl).toBe('https://github.com/user-ssh/repo-ssh')
  })
})
