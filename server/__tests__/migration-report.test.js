import { describe, it, expect } from 'vitest'
import { buildMigrationReportData, renderMigrationReportMarkdown, getSuggestionForError } from '../lib/migration-report.js'

// Fixture mirrors the shape MigrationEngine#getPlanStatus returns: a
// snake_case migration_plans row with a `tasks` array of snake_case
// migration_tasks rows whose config/metadata are already-parsed objects.
const fixturePlan = {
  id: 7,
  status: 'completed',
  is_dry_run: 0,
  source_type: 'azure',
  azure_host: 'dev.azure.com',
  source_org: 'contoso',
  source_project: 'Platform',
  target_org: 'contoso-gh',
  started_at: '2026-08-01T10:00:00Z',
  completed_at: '2026-08-01T10:10:00Z',
  summary: { total: 4, success: 2, failed: 1, skipped: 1 },
  tasks: [
    {
      id: 1, type: 'repo', source_ref: 'contoso/Platform/repo-a', target_ref: 'contoso-gh/repo-a',
      status: 'completed', retries: 0, config: { onConflict: 'replace' },
      metadata: { replacedExistingRepo: true, branchCount: 4 },
      started_at: '2026-08-01T10:00:00Z', completed_at: '2026-08-01T10:03:00Z',
    },
    {
      id: 2, type: 'repo', source_ref: 'contoso/Platform/repo-b', target_ref: 'contoso-gh/repo-b',
      status: 'completed', retries: 2, config: { sizeStrategy: 'lfs-migrate' },
      metadata: { lfsPushFailed: true, branchCount: 6 },
      started_at: '2026-08-01T10:03:00Z', completed_at: '2026-08-01T10:07:00Z',
    },
    {
      id: 3, type: 'repo-tfvc', source_ref: 'contoso/Platform/repo-c', target_ref: 'contoso-gh/repo-c',
      status: 'failed', retries: 3, config: {}, metadata: {},
      started_at: '2026-08-01T10:07:00Z', completed_at: '2026-08-01T10:09:00Z',
      error_message: 'Authentication failed: 401',
    },
    {
      id: 4, type: 'wiki', source_ref: 'contoso/Platform/wiki', target_ref: null,
      status: 'skipped', retries: 0, config: {}, metadata: null,
      started_at: null, completed_at: null,
      error_message: 'No active wiki found',
    },
  ],
}

const fixtureMarks = [
  { scope: 'destination', target_kind: 'github-topic', target_id: 'contoso-gh/repo-a', status: 'written', written_at: '2026-08-01T10:03:30Z', skip_reason: null, error_message: null },
  { scope: 'git-tag', target_kind: 'git-annotated-tag', target_id: 'contoso-gh/repo-b', status: 'failed', written_at: null, skip_reason: null, error_message: 'push rejected' },
]

describe('buildMigrationReportData', () => {
  it('carries plan identity, source/target and overall duration', () => {
    const report = buildMigrationReportData(fixturePlan, fixtureMarks)
    expect(report.plan).toMatchObject({
      id: 7, status: 'completed', isDryRun: false,
      source: { type: 'azure', host: 'dev.azure.com', org: 'contoso', project: 'Platform' },
      targetOrg: 'contoso-gh',
      durationSeconds: 600,
    })
  })

  it('uses the plan summary when present, otherwise computes one from tasks', () => {
    const withSummary = buildMigrationReportData(fixturePlan, [])
    expect(withSummary.summary).toEqual({ total: 4, success: 2, failed: 1, skipped: 1 })

    const noSummary = buildMigrationReportData({ ...fixturePlan, summary: null }, [])
    expect(noSummary.summary).toEqual({ total: 4, success: 2, failed: 1, skipped: 1 })
  })

  it('keeps task.metadata verbatim for SummaryStep.jsx back-compat', () => {
    const report = buildMigrationReportData(fixturePlan, [])
    const taskA = report.tasks.find(t => t.id === 1)
    expect(taskA.metadata).toEqual({ replacedExistingRepo: true, branchCount: 4 })
  })

  it('surfaces a conflict resolution for a replaced target', () => {
    const report = buildMigrationReportData(fixturePlan, [])
    expect(report.conflicts).toHaveLength(1)
    expect(report.conflicts[0]).toMatchObject({ taskId: 1, targetRef: 'contoso-gh/repo-a' })
    expect(report.conflicts[0].resolution).toMatch(/replaced/i)
  })

  it('surfaces an LFS event for a push failure', () => {
    const report = buildMigrationReportData(fixturePlan, [])
    expect(report.lfs).toHaveLength(1)
    expect(report.lfs[0]).toMatchObject({ taskId: 2, targetRef: 'contoso-gh/repo-b', retries: 2 })
    expect(report.lfs[0].note).toMatch(/LFS/)
  })

  it('surfaces the skip reason for a skipped task', () => {
    const report = buildMigrationReportData(fixturePlan, [])
    expect(report.skipped).toEqual([
      { taskId: 4, type: 'wiki', sourceRef: 'contoso/Platform/wiki', reason: 'No active wiki found' },
    ])
  })

  it('surfaces a failed task with an error and a suggestion', () => {
    const report = buildMigrationReportData(fixturePlan, [])
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]).toMatchObject({ taskId: 3, targetRef: 'contoso-gh/repo-c' })
    expect(report.errors[0].suggestion).toMatch(/PAT/)
  })

  it('formats provenance marks', () => {
    const report = buildMigrationReportData(fixturePlan, fixtureMarks)
    expect(report.marks).toEqual([
      { scope: 'destination', targetKind: 'github-topic', targetId: 'contoso-gh/repo-a', status: 'written', skipReason: null, errorMessage: null, writtenAt: '2026-08-01T10:03:30Z' },
      { scope: 'git-tag', targetKind: 'git-annotated-tag', targetId: 'contoso-gh/repo-b', status: 'failed', skipReason: null, errorMessage: 'push rejected', writtenAt: null },
    ])
  })

  it('handles a plan with no tasks and no marks', () => {
    const report = buildMigrationReportData({ ...fixturePlan, tasks: [], summary: null }, [])
    expect(report.summary).toEqual({ total: 0, success: 0, failed: 0, skipped: 0 })
    expect(report.tasks).toEqual([])
    expect(report.conflicts).toEqual([])
    expect(report.lfs).toEqual([])
    expect(report.skipped).toEqual([])
    expect(report.marks).toEqual([])
    expect(report.errors).toEqual([])
  })
})

describe('renderMigrationReportMarkdown', () => {
  const report = buildMigrationReportData(fixturePlan, fixtureMarks)
  const md = renderMigrationReportMarkdown(report)

  it('titles the report with the plan id', () => {
    expect(md).toMatch(/^# Migration Report — Plan #7/)
  })

  it('states source and target', () => {
    expect(md).toMatch(/contoso\/Platform \(dev\.azure\.com\)/)
    expect(md).toMatch(/contoso-gh/)
  })

  it('lists every task under "What moved"', () => {
    for (const ref of ['repo-a', 'repo-b', 'repo-c', 'wiki']) {
      expect(md).toContain(ref)
    }
  })

  it('explains the skip under "What was skipped, and why"', () => {
    const section = md.split('## What was skipped, and why')[1].split('## Conflicts')[0]
    expect(section).toMatch(/No active wiki found/)
  })

  it('explains the conflict resolution', () => {
    const section = md.split('## Conflicts and their resolutions')[1].split('## Git LFS')[0]
    expect(section).toMatch(/repo-a/)
    expect(section).toMatch(/replaced/i)
  })

  it('lists the LFS retry', () => {
    const section = md.split('## Git LFS')[1].split('## Provenance marks')[0]
    expect(section).toMatch(/repo-b/)
    expect(section).toMatch(/2 retries/)
  })

  it('lists provenance marks in a table', () => {
    const section = md.split('## Provenance marks')[1].split('## Errors')[0]
    expect(section).toMatch(/github-topic/)
    expect(section).toMatch(/git-annotated-tag/)
  })

  it('lists errors with their suggestion', () => {
    expect(md).toMatch(/## Errors/)
    expect(md).toMatch(/Authentication failed: 401/)
    expect(md).toMatch(/_Suggestion:_/)
  })

  it('says so explicitly when nothing was skipped, conflicted or LFS-touched', () => {
    const cleanPlan = {
      ...fixturePlan,
      tasks: [{
        id: 9, type: 'repo', source_ref: 'a/b', target_ref: 'a-gh/b', status: 'completed',
        retries: 0, config: {}, metadata: {}, started_at: '2026-08-01T10:00:00Z', completed_at: '2026-08-01T10:01:00Z',
      }],
      summary: null,
    }
    const cleanMd = renderMigrationReportMarkdown(buildMigrationReportData(cleanPlan, []))
    expect(cleanMd).toMatch(/Nothing was skipped/)
    expect(cleanMd).toMatch(/No naming conflicts encountered/)
    expect(cleanMd).toMatch(/No Git LFS activity/)
    expect(cleanMd).toMatch(/No provenance marks recorded/)
    expect(cleanMd).not.toMatch(/## Errors/)
  })
})

describe('getSuggestionForError', () => {
  it('returns an empty string for no error message', () => {
    expect(getSuggestionForError(null, 'repo')).toBe('')
  })

  it('tailors the auth suggestion for an in-place TFVC conversion', () => {
    const s = getSuggestionForError('Authentication failed: 401', 'repo-tfvc', { inPlace: true })
    expect(s).toMatch(/SAME Azure DevOps/)
  })

  it('falls back to a generic auth suggestion for a plain repo task', () => {
    const s = getSuggestionForError('403 Forbidden', 'repo')
    expect(s).toMatch(/access token/i)
  })
})
