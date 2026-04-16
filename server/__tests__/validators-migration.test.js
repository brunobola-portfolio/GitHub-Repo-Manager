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
})
