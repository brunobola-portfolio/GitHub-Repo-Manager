/**
 * runAction — single dispatcher for all repo actions.
 *
 * @param {string} actionId          snake_case ID present in the registry
 * @param {object|object[]} target   single repo or array of repos for batch
 * @param {object} ctx               from useRepoActionContext()
 * @param {Record<string, object>} registry  pass repoActions; injected for testability
 */
export async function runAction(actionId, target, ctx, registry) {
  const action = registry[actionId]
  if (!action) {
    ctx.toast.error(`Unknown action: ${actionId}`)
    return
  }

  const isBatch = Array.isArray(target)
  if (isBatch && !action.isBatchSafe) {
    ctx.toast.error(`${action.id} cannot run in batch mode`)
    return
  }

  if (typeof action.confirm === 'function') {
    const cfg = action.confirm(target)
    if (cfg) {
      const ok = await ctx.confirmGate(cfg)
      if (!ok) return
    }
  }

  try {
    await action.run(target, ctx)
    if (action.triggersRefresh) ctx.refresh?.()
  } catch (err) {
    ctx.toast.errorFromException(err, { fallbackTitle: `${action.id} failed` })
  }
}
