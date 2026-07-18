import { describe, it, expect } from 'vitest'
import { computeMigrationHealth, buildHealthNarrative } from '../../../../src/components/MigrationWizard/steps/migrationHealth'

describe('computeMigrationHealth', () => {
  it('reports all-clean when no completed task carries caveat metadata', () => {
    const tasks = [
      { id: 1, status: 'completed', targetRef: 'org/a' },
      { id: 2, status: 'completed', targetRef: 'org/b', metadata: {} },
    ]
    const health = computeMigrationHealth(tasks)
    expect(health).toEqual({
      totalCompleted: 2,
      cleanCount: 2,
      actionItems: [],
      notableItems: [],
      hasCaveats: false,
    })
  })

  it('ignores failed/skipped/cancelled tasks entirely', () => {
    const tasks = [
      { id: 1, status: 'failed', targetRef: 'org/a', metadata: { lfsPushFailed: true } },
      { id: 2, status: 'skipped', targetRef: 'org/b' },
      { id: 3, status: 'cancelled', targetRef: 'org/c' },
    ]
    const health = computeMigrationHealth(tasks)
    expect(health.totalCompleted).toBe(0)
    expect(health.hasCaveats).toBe(false)
  })

  it('buckets an lfsPushFailed completed task as actionable', () => {
    const tasks = [
      { id: 1, status: 'completed', targetRef: 'org/repo', metadata: { lfsPushFailed: true } },
      { id: 2, status: 'completed', targetRef: 'org/clean' },
    ]
    const health = computeMigrationHealth(tasks)
    expect(health.totalCompleted).toBe(2)
    expect(health.cleanCount).toBe(1)
    expect(health.hasCaveats).toBe(true)
    expect(health.actionItems).toEqual([
      { taskId: 1, targetRef: 'org/repo', kind: 'lfsPushFailed', text: expect.stringMatching(/fail to clone/i), actionable: true },
    ])
    expect(health.notableItems).toEqual([])
  })

  it('buckets reusedExistingRepo/replacedExistingRepo/emptySource/lfsFetchFailed as notable (non-actionable)', () => {
    const tasks = [
      { id: 1, status: 'completed', targetRef: 'org/a', metadata: { reusedExistingRepo: true } },
      { id: 2, status: 'completed', targetRef: 'org/b', metadata: { replacedExistingRepo: true } },
      { id: 3, status: 'completed', targetRef: 'org/c', metadata: { emptySource: true } },
      { id: 4, status: 'completed', targetRef: 'org/d', metadata: { lfsFetchFailed: true } },
    ]
    const health = computeMigrationHealth(tasks)
    expect(health.totalCompleted).toBe(4)
    expect(health.cleanCount).toBe(0)
    expect(health.actionItems).toEqual([])
    expect(health.notableItems).toHaveLength(4)
    expect(health.notableItems.every((i) => i.actionable === false)).toBe(true)
  })

  it('gives lfsPushFailed priority over other flags on the same task (one line per task)', () => {
    const tasks = [
      { id: 1, status: 'completed', targetRef: 'org/repo', metadata: { replacedExistingRepo: true, lfsPushFailed: true } },
    ]
    const health = computeMigrationHealth(tasks)
    expect(health.actionItems).toHaveLength(1)
    expect(health.actionItems[0].kind).toBe('lfsPushFailed')
    expect(health.notableItems).toHaveLength(0)
  })

  it('defaults to an empty array when no tasks are passed', () => {
    expect(computeMigrationHealth()).toEqual({
      totalCompleted: 0,
      cleanCount: 0,
      actionItems: [],
      notableItems: [],
      hasCaveats: false,
    })
  })
})

describe('buildHealthNarrative', () => {
  it('returns an empty string when there are no completed tasks', () => {
    expect(buildHealthNarrative(computeMigrationHealth([]))).toBe('')
  })

  it('describes a fully clean run', () => {
    const health = computeMigrationHealth([
      { id: 1, status: 'completed', targetRef: 'org/a' },
      { id: 2, status: 'completed', targetRef: 'org/b' },
    ])
    expect(buildHealthNarrative(health)).toBe('2 of 2 completed tasks finished cleanly.')
  })

  it('calls out actionable and notable caveats separately, with correct singular/plural', () => {
    const health = computeMigrationHealth([
      { id: 1, status: 'completed', targetRef: 'org/a' },
      { id: 2, status: 'completed', targetRef: 'org/b', metadata: { lfsPushFailed: true } },
      { id: 3, status: 'completed', targetRef: 'org/c', metadata: { reusedExistingRepo: true } },
    ])
    const narrative = buildHealthNarrative(health)
    expect(narrative).toContain('1 of 3 completed tasks finished cleanly.')
    expect(narrative).toContain('1 needs attention before you rely on it.')
    expect(narrative).toContain('1 completed with a notable change worth reviewing.')
  })
})
