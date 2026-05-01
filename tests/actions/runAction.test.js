import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAction } from '../../src/actions/runAction'

const mkCtx = (overrides = {}) => ({
  toast: { error: vi.fn(), errorFromException: vi.fn() },
  confirmGate: vi.fn().mockResolvedValue(true),
  refresh: vi.fn(),
  ...overrides,
})

const mkAction = (overrides = {}) => ({
  id: 'noop',
  label: 'No-op',
  intent: 'mutation',
  surfaces: ['contextMenu'],
  isBatchSafe: false,
  run: vi.fn().mockResolvedValue(undefined),
  ...overrides,
})

describe('runAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports error if actionId not in registry', async () => {
    const ctx = mkCtx()
    await runAction('does_not_exist', { id: 1 }, ctx, {})
    expect(ctx.toast.error).toHaveBeenCalledWith(expect.stringContaining('Unknown action'))
  })

  it('refuses batch target when action is not batch-safe', async () => {
    const action = mkAction({ id: 'singular', isBatchSafe: false })
    const ctx = mkCtx()
    await runAction('singular', [{ id: 1 }, { id: 2 }], ctx, { singular: action })
    expect(ctx.toast.error).toHaveBeenCalledWith(expect.stringContaining('cannot run in batch mode'))
    expect(action.run).not.toHaveBeenCalled()
  })

  it('runs action when no confirm config returned', async () => {
    const action = mkAction({ confirm: () => null })
    const ctx = mkCtx()
    await runAction('noop', { id: 1 }, ctx, { noop: action })
    expect(action.run).toHaveBeenCalledWith({ id: 1 }, ctx)
    expect(ctx.confirmGate).not.toHaveBeenCalled()
  })

  it('passes confirm config to confirmGate and short-circuits on cancel', async () => {
    const cfg = { title: 'Sure?', message: '...', confirmText: 'Yes', variant: 'warning' }
    const action = mkAction({ confirm: () => cfg })
    const ctx = mkCtx({ confirmGate: vi.fn().mockResolvedValue(false) })
    await runAction('noop', { id: 1 }, ctx, { noop: action })
    expect(ctx.confirmGate).toHaveBeenCalledWith(cfg)
    expect(action.run).not.toHaveBeenCalled()
  })

  it('runs action when confirmGate resolves true', async () => {
    const action = mkAction({ confirm: () => ({ title: 'x', message: 'y', confirmText: 'OK', variant: 'info' }) })
    const ctx = mkCtx({ confirmGate: vi.fn().mockResolvedValue(true) })
    await runAction('noop', { id: 1 }, ctx, { noop: action })
    expect(action.run).toHaveBeenCalled()
  })

  it('calls ctx.refresh after success when triggersRefresh is true', async () => {
    const action = mkAction({ triggersRefresh: true })
    const ctx = mkCtx()
    await runAction('noop', { id: 1 }, ctx, { noop: action })
    expect(ctx.refresh).toHaveBeenCalledTimes(1)
  })

  it('does NOT call ctx.refresh when run() throws', async () => {
    const action = mkAction({ triggersRefresh: true, run: vi.fn().mockRejectedValue(new Error('boom')) })
    const ctx = mkCtx()
    await runAction('noop', { id: 1 }, ctx, { noop: action })
    expect(ctx.refresh).not.toHaveBeenCalled()
    expect(ctx.toast.errorFromException).toHaveBeenCalled()
  })

  it('does NOT call ctx.refresh when triggersRefresh is falsy', async () => {
    const action = mkAction({ triggersRefresh: false })
    const ctx = mkCtx()
    await runAction('noop', { id: 1 }, ctx, { noop: action })
    expect(ctx.refresh).not.toHaveBeenCalled()
  })
})
