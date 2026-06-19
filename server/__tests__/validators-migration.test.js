// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createPlanSchema } from '../lib/validators.js'

describe('createPlanSchema', () => {
  const validPlan = {
    source: { type: 'azure', org: 'myorg', project: 'myproj' },
    tasks: [{ type: 'repo', sourceRef: 'org/proj/repo', targetRef: 'gh-org/repo', config: {} }]
  }

  it('accepts valid minimal plan', () => {
    const result = createPlanSchema.safeParse(validPlan)
    expect(result.success).toBe(true)
  })

  it('rejects plan without source org', () => {
    const plan = { ...validPlan, source: { type: 'azure', org: '', project: 'p' } }
    expect(createPlanSchema.safeParse(plan).success).toBe(false)
  })

  it('rejects plan with no tasks', () => {
    const plan = { ...validPlan, tasks: [] }
    expect(createPlanSchema.safeParse(plan).success).toBe(false)
  })

  it('rejects plan with >60 tasks', () => {
    const tasks = Array.from({ length: 61 }, (_, i) => ({
      type: 'repo', sourceRef: `ref${i}`, targetRef: `t${i}`
    }))
    const plan = { ...validPlan, tasks }
    expect(createPlanSchema.safeParse(plan).success).toBe(false)
  })

  it('accepts work-items task with valid config', () => {
    const plan = {
      ...validPlan,
      tasks: [{
        type: 'work-items', sourceRef: 'org/proj', targetRef: 'gh/repo',
        config: { types: ['Bug'], includeComments: true }
      }]
    }
    expect(createPlanSchema.safeParse(plan).success).toBe(true)
  })

  it('accepts wiki task with valid config', () => {
    const plan = {
      ...validPlan,
      tasks: [{
        type: 'wiki', sourceRef: 'org/proj/wiki', targetRef: 'gh/repo',
        config: { destination: 'docs' }
      }]
    }
    expect(createPlanSchema.safeParse(plan).success).toBe(true)
  })

  it('rejects wiki task with invalid destination', () => {
    const plan = {
      ...validPlan,
      tasks: [{
        type: 'wiki', sourceRef: 'ref', targetRef: 'ref',
        config: { destination: 'invalid' }
      }]
    }
    expect(createPlanSchema.safeParse(plan).success).toBe(false)
  })

  it('applies defaults for schedule', () => {
    const result = createPlanSchema.parse(validPlan)
    expect(result.schedule.mode).toBe('now')
    expect(result.schedule.isDryRun).toBe(false)
  })

  it('validates rollback policy enum', () => {
    const plan = {
      ...validPlan,
      tasks: [{
        type: 'repo', sourceRef: 'ref', targetRef: 'ref',
        config: { rollbackPolicy: 'invalid' }
      }]
    }
    expect(createPlanSchema.safeParse(plan).success).toBe(false)
  })

  it('accepts sizeStrategy on repo task config', () => {
    const plan = {
      source: { type: 'azure', org: 'o', project: 'p' },
      tasks: [{ type: 'repo', sourceRef: 'o/p/r', targetRef: 'gh/r', config: { sizeStrategy: 'exclude' } }],
    }
    const res = createPlanSchema.safeParse(plan)
    expect(res.success).toBe(true)
  })

  it('accepts sizeStrategy on repo-tfvc task config', () => {
    const plan = {
      source: { type: 'azure', org: 'o', project: 'p' },
      tasks: [{ type: 'repo-tfvc', sourceRef: 'o/p/r', targetRef: 'gh/r', config: { sizeStrategy: 'lfs-migrate' } }],
    }
    const res = createPlanSchema.safeParse(plan)
    expect(res.success).toBe(true)
  })

  it('rejects invalid sizeStrategy values', () => {
    const plan = {
      source: { type: 'azure', org: 'o', project: 'p' },
      tasks: [{ type: 'repo', sourceRef: 'o/p/r', targetRef: 'gh/r', config: { sizeStrategy: 'split-history' } }],
    }
    const res = createPlanSchema.safeParse(plan)
    expect(res.success).toBe(false)
  })

  // Regression: the "Replace" conflict action must survive validation. Zod
  // strips unknown keys silently (without failing), so `success: true` alone
  // does NOT prove the field was kept — assert the parsed value explicitly.
  it('preserves onConflict: replace on repo task config', () => {
    const plan = {
      source: { type: 'azure', org: 'o', project: 'p' },
      tasks: [{ type: 'repo', sourceRef: 'o/p/r', targetRef: 'gh/r', config: { onConflict: 'replace' } }],
    }
    const res = createPlanSchema.safeParse(plan)
    expect(res.success).toBe(true)
    expect(res.data.tasks[0].config.onConflict).toBe('replace')
  })

  it('preserves onConflict: replace on repo-tfvc task config', () => {
    const plan = {
      source: { type: 'azure', org: 'o', project: 'p' },
      tasks: [{ type: 'repo-tfvc', sourceRef: 'o/p/r', targetRef: 'gh/r', config: { onConflict: 'replace' } }],
    }
    const res = createPlanSchema.safeParse(plan)
    expect(res.success).toBe(true)
    expect(res.data.tasks[0].config.onConflict).toBe('replace')
  })

  it('rejects invalid onConflict values', () => {
    const plan = {
      source: { type: 'azure', org: 'o', project: 'p' },
      tasks: [{ type: 'repo', sourceRef: 'o/p/r', targetRef: 'gh/r', config: { onConflict: 'overwrite' } }],
    }
    expect(createPlanSchema.safeParse(plan).success).toBe(false)
  })

  // Regression (same class as onConflict): TFVC in-place keys read by the
  // engine must survive validation, otherwise the wizard's in-place choice
  // is silently dropped and the migration pushes to GitHub instead.
  it('preserves in-place keys on repo-tfvc task config', () => {
    const plan = {
      source: { type: 'azure', org: 'o', project: 'p' },
      tasks: [{
        type: 'repo-tfvc', sourceRef: 'o/p/r', targetRef: 'o/r',
        config: { inPlace: true, targetProject: 'DestProj', existingRepoId: 'abc-123-guid' },
      }],
    }
    const res = createPlanSchema.safeParse(plan)
    expect(res.success).toBe(true)
    expect(res.data.tasks[0].config.inPlace).toBe(true)
    expect(res.data.tasks[0].config.targetProject).toBe('DestProj')
    expect(res.data.tasks[0].config.existingRepoId).toBe('abc-123-guid')
  })
})
