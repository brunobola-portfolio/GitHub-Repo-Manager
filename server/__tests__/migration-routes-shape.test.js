import { describe, it, expect } from 'vitest'
import { formatPlanForApi, formatTaskForApi } from '../routes/migration.js'

describe('formatPlanForApi', () => {
    const baseRow = {
        id: 42,
        user_id: 7,
        status: 'completed',
        source_type: 'azure',
        source_org: 'contoso',
        source_project: 'platform',
        target_org: 'contoso-gh',
        is_dry_run: 0,
        scheduled_at: null,
        started_at: '2026-04-30T10:00:00Z',
        completed_at: '2026-04-30T10:05:00Z',
        ai_analysis: '{"risk":"low"}',
        summary: '{"total":3,"success":3,"failed":0}',
        created_at: '2026-04-30T09:59:00Z',
        updated_at: '2026-04-30T10:05:00Z',
    }

    it('maps snake_case columns to nested camelCase API shape', () => {
        const out = formatPlanForApi(baseRow, { taskCount: 3 })
        expect(out).toMatchObject({
            id: 42,
            status: 'completed',
            source: { type: 'azure', org: 'contoso', project: 'platform' },
            targetOrg: 'contoso-gh',
            isDryRun: false,
            startedAt: '2026-04-30T10:00:00Z',
            completedAt: '2026-04-30T10:05:00Z',
            createdAt: '2026-04-30T09:59:00Z',
            taskCount: 3,
        })
        // ai_analysis / summary parsed
        expect(out.aiAnalysis).toEqual({ risk: 'low' })
        expect(out.summary).toEqual({ total: 3, success: 3, failed: 0 })
        // Snake-case columns must NOT leak into the API shape
        expect(out.source_org).toBeUndefined()
        expect(out.source_project).toBeUndefined()
        expect(out.created_at).toBeUndefined()
    })

    it('handles already-parsed JSON fields (engine.getPlanStatus path)', () => {
        const row = { ...baseRow, ai_analysis: { risk: 'low' }, summary: { total: 1 } }
        const out = formatPlanForApi(row, { taskCount: 1 })
        expect(out.aiAnalysis).toEqual({ risk: 'low' })
        expect(out.summary).toEqual({ total: 1 })
    })

    it('emits null source.org/project for legacy rows missing values', () => {
        const row = { ...baseRow, source_org: '', source_project: null }
        const out = formatPlanForApi(row, { taskCount: 0 })
        expect(out.source).toEqual({ type: 'azure', host: 'dev.azure.com', org: null, project: null })
        expect(out.taskCount).toBe(0)
    })

    it('includes azure_host in source when present', () => {
        const row = { ...baseRow, azure_host: 'tfs.trigenius.com' }
        const out = formatPlanForApi(row, { taskCount: 0 })
        expect(out.source).toMatchObject({ host: 'tfs.trigenius.com', org: 'contoso', project: 'platform' })
    })

    it('formats and counts tasks when provided', () => {
        const tasks = [
            {
                id: 1, plan_id: 42, type: 'repo-clone', execution_order: 0,
                source_ref: 'frontend', target_ref: 'frontend', config: '{"lfs":true}',
                status: 'complete', progress_pct: 100, progress_message: 'Done',
                error_message: null, retries: 0, max_retries: 3,
                started_at: '2026-04-30T10:00:30Z', completed_at: '2026-04-30T10:01:00Z',
                metadata: '{"branchCount":4}', created_at: '2026-04-30T09:59:00Z',
            },
        ]
        const out = formatPlanForApi(baseRow, { tasks })
        expect(out.taskCount).toBe(1)
        expect(out.tasks).toHaveLength(1)
        expect(out.tasks[0]).toMatchObject({
            id: 1, type: 'repo-clone', sourceRef: 'frontend', repoName: 'frontend',
            status: 'complete', progressPct: 100, retries: 0, maxRetries: 3,
            startedAt: '2026-04-30T10:00:30Z', completedAt: '2026-04-30T10:01:00Z',
        })
        expect(out.tasks[0].config).toEqual({ lfs: true })
        expect(out.tasks[0].metadata).toEqual({ branchCount: 4 })
    })

    it('returns null for nullish input', () => {
        expect(formatPlanForApi(null)).toBeNull()
        expect(formatPlanForApi(undefined)).toBeNull()
    })
})

describe('formatTaskForApi', () => {
    it('maps task row to UI shape', () => {
        const out = formatTaskForApi({
            id: 9, plan_id: 1, type: 'wiki', execution_order: 2,
            source_ref: 'docs-wiki', target_ref: null, config: null,
            status: 'failed', progress_pct: 0, progress_message: null,
            error_message: 'PAT expired', retries: 2, max_retries: 3,
            started_at: '2026-04-30T11:00:00Z', completed_at: '2026-04-30T11:00:05Z',
            metadata: null, created_at: '2026-04-30T10:59:00Z',
        })
        expect(out).toMatchObject({
            id: 9, type: 'wiki', executionOrder: 2,
            sourceRef: 'docs-wiki', repoName: 'docs-wiki', targetRef: null,
            status: 'failed', progressPct: 0, errorMessage: 'PAT expired',
            retries: 2, maxRetries: 3,
            startedAt: '2026-04-30T11:00:00Z', completedAt: '2026-04-30T11:00:05Z',
        })
    })

    it('returns null for nullish input', () => {
        expect(formatTaskForApi(null)).toBeNull()
        expect(formatTaskForApi(undefined)).toBeNull()
    })
})
