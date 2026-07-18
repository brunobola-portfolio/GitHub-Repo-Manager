// Per-type migration task runners, extracted verbatim from MigrationEngine.
// _executeTask's switch. Each is a pure async function of (task, ctx) where ctx
// carries the resolved execution context the engine builds once:
//   { config, resolvedCredentials, callbacks, targetOwner, targetRepo,
//     azureHost, buildAzureCloneUrl }
// `callbacks` = { onProgress, isCancelled }. buildAzureCloneUrl is passed in
// (rather than imported) to avoid a circular import back into migration-engine.
//
// Behavior is identical to the inlined cases; this isolates per-type logic so
// each runner is unit-testable without monkey-patching the engine, and new task
// types can be added without editing the engine core.
import { importRepository } from '../../import-service.js'
import { defaultRepoDescription } from '../repo-description.js'
import { migrateWorkItems } from '../../work-item-service.js'
import { migrateWiki } from '../../wiki-service.js'
import * as azureService from '../../azure-service.js'
import logger from '../logger.js'

/** case 'repo' — Azure Git → GitHub import. */
export async function runRepo(task, ctx) {
  const { config, resolvedCredentials, callbacks, targetOwner, targetRepo, azureHost, buildAzureCloneUrl } = ctx
  // Parse source_ref: "org/project/repoName"
  const parts = task.source_ref.split('/')
  const azureOrg = parts[0]
  const azureProject = parts[1]
  const azureRepo = parts.slice(2).join('/')

  const result = await importRepository({
    sourceUrl: buildAzureCloneUrl(azureHost, azureOrg, azureProject, azureRepo),
    credentials: resolvedCredentials.azurePat ? { type: 'pat', token: resolvedCredentials.azurePat } : undefined,
    targetOwner,
    targetName: targetRepo,
    isPrivate: config.makePrivate ?? true,
    description: config.description || defaultRepoDescription({
      repoName: azureRepo,
      source: { org: azureOrg, project: azureProject, isTfvc: false },
    }),
    sizeStrategy: config.sizeStrategy,
    onConflict: config.onConflict,
    githubToken: resolvedCredentials.githubToken,
    onProgress: (status, message, pct) => callbacks.onProgress(pct, message),
    isCancelled: callbacks.isCancelled
  })

  // importRepository catches errors and returns {success:false} instead of throwing —
  // we must check the result and throw so the engine marks the task as failed
  // (or, for a cancelled run, so executeOne's isCancelled() check short-circuits
  // it to a terminal 'cancelled' status instead of 'failed').
  if (!result.success) {
    throw new Error(result.error || 'GitHub import failed')
  }
  return result
}

/** case 'repo-tfvc' — TFVC → Git, in-place (stay in Azure) or via temp + push to GitHub. */
export async function runTfvc(task, ctx) {
  const { config, resolvedCredentials, callbacks, targetOwner, targetRepo, azureHost } = ctx
  const tfvcParts = task.source_ref.split('/')
  const tfvcOrg = tfvcParts[0]
  const tfvcProject = tfvcParts[1]
  const tfvcFolder = tfvcParts.slice(2).join('/')
  const tfvcPath = `$/${tfvcProject}/${tfvcFolder}`
  const azurePat = resolvedCredentials.azurePat
  const inPlace = !!config.inPlace

  // Sanitize repo name for Azure DevOps regardless of mode.
  const safeName = targetRepo.replace(/[/:~&%;@'"?<>|#$*\[\]\\]/g, '-').replace(/^[_.]/, 't') // eslint-disable-line no-useless-escape

  if (inPlace) {
    // ── In-place flow — create the FINAL repo directly, no GitHub push.
    // Two sub-modes:
    //   - existing empty repo: skip create, validate emptiness, use its id
    //   - new repo: create with safeName (default)
    // Destination project may differ from the TFVC source project on the
    // same org (config.targetProject); falls back to the source project.
    // Note: no try/catch — on failure we leave the partially-converted
    // repo for forensic inspection rather than silently deleting it.
    const destProject = (config.targetProject || tfvcProject).toString()
    const existingRepoId = config.existingRepoId || null

    let finalRepo
    if (existingRepoId) {
      callbacks.onProgress(3, `Validating existing repo in ${tfvcOrg}/${destProject}...`)
      const existing = await azureService.getRepoDetails(tfvcOrg, destProject, existingRepoId, azurePat, azureHost)
      const isEmpty = !existing.defaultBranch && (!existing.size || existing.size === 0)
      if (!isEmpty) {
        throw new Error(`Existing repo "${existing.name}" is not empty — cannot import TFVC into a repo that already has commits`)
      }
      finalRepo = existing
      callbacks.onProgress(8, `Using existing empty repo "${existing.name}"...`)
    } else {
      callbacks.onProgress(5, `Creating Git repo "${safeName}" in ${tfvcOrg}/${destProject}...`)
      finalRepo = await azureService.createGitRepo(tfvcOrg, destProject, safeName, azurePat, azureHost)
    }

    callbacks.onProgress(10, 'Starting TFVC → Git conversion (Import API)...')
    const importReq = await azureService.importTfvcToGit(tfvcOrg, destProject, finalRepo.id, tfvcPath, azurePat, true, azureHost)
    let done = false
    for (let i = 0; i < 120 && !done; i++) {
      if (callbacks.isCancelled()) throw new Error('Migration cancelled')
      await new Promise(r => setTimeout(r, 5000))
      const status = await azureService.getImportStatus(tfvcOrg, destProject, finalRepo.id, importReq.importRequestId, azurePat, azureHost)
      callbacks.onProgress(10 + Math.floor((i / 120) * 85), `Converting TFVC to Git... (${status.status})`)
      if (status.status === 'completed') done = true
      else if (status.status === 'failed' || status.status === 'abandoned') {
        throw new Error(`TFVC conversion failed: ${status.detailedStatus?.errorMessage || status.status}`)
      }
    }
    if (!done) throw new Error('TFVC conversion timed out')
    callbacks.onProgress(100, 'TFVC converted in-place ✓')
    const fresh = await azureService.getRepoDetails(tfvcOrg, destProject, finalRepo.name, azurePat, azureHost)
    return {
      success: true,
      targetFullName: `${tfvcOrg}/${destProject}/${finalRepo.name}`,
      repoUrl: fresh.webUrl,
      cloneUrl: fresh.remoteUrl,
      branchCount: 1,
      inPlace: true,
    }
  }

  // ── Default flow — convert in a temp repo, push to GitHub, clean up.
  callbacks.onProgress(5, 'Creating temporary Git repo in Azure DevOps...')
  const tempRepoName = `tfvc-import-${safeName}-${Date.now()}`.slice(0, 64)
  const tempRepo = await azureService.createGitRepo(tfvcOrg, tfvcProject, tempRepoName, azurePat, azureHost)

  try {
    callbacks.onProgress(10, 'Converting TFVC to Git...')
    const importReq = await azureService.importTfvcToGit(tfvcOrg, tfvcProject, tempRepo.id, tfvcPath, azurePat, true, azureHost)

    // Poll for completion
    let done = false
    for (let i = 0; i < 120 && !done; i++) {
      if (callbacks.isCancelled()) throw new Error('Migration cancelled')
      await new Promise(r => setTimeout(r, 5000))
      const status = await azureService.getImportStatus(tfvcOrg, tfvcProject, tempRepo.id, importReq.importRequestId, azurePat, azureHost)
      callbacks.onProgress(10 + Math.floor((i / 120) * 30), `Converting TFVC to Git... (${status.status})`)
      if (status.status === 'completed') done = true
      else if (status.status === 'failed' || status.status === 'abandoned') {
        throw new Error(`TFVC conversion failed: ${status.detailedStatus?.errorMessage || status.status}`)
      }
    }
    if (!done) throw new Error('TFVC conversion timed out')

    callbacks.onProgress(45, 'Cloning converted repository...')
    const repoDetails = await azureService.getRepoDetails(tfvcOrg, tfvcProject, tempRepoName, azurePat, azureHost)
    logger.debug({ remoteUrl: repoDetails.remoteUrl?.replace(/\/\/[^@]*@/, '//***@') }, 'TFVC temp repo created')

    const result = await importRepository({
      sourceUrl: repoDetails.remoteUrl,
      credentials: azurePat ? { type: 'pat', token: azurePat } : undefined,
      targetOwner,
      targetName: targetRepo,
      isPrivate: config.makePrivate ?? true,
      description: config.description || defaultRepoDescription({
        repoName: targetRepo,
        source: { org: tfvcOrg, project: tfvcProject, isTfvc: true, tfvcPath },
      }),
      sizeStrategy: config.sizeStrategy,
      onConflict: config.onConflict,
      githubToken: resolvedCredentials.githubToken,
      onProgress: (status, message, pct) => callbacks.onProgress(45 + Math.floor((pct / 100) * 50), message),
      isCancelled: callbacks.isCancelled
    })

    if (!result.success) {
      throw new Error(result.error || 'GitHub import failed after TFVC conversion')
    }

    try { await azureService.deleteGitRepo(tfvcOrg, tfvcProject, tempRepo.id, azurePat, azureHost) } catch (cleanupErr) {
      logger.warn({ err: cleanupErr, tempRepoName }, 'Failed to cleanup temp repo')
    }
    return result
  } catch (err) {
    try { await azureService.deleteGitRepo(tfvcOrg, tfvcProject, tempRepo.id, azurePat, azureHost) } catch (cleanupErr) {
      logger.warn({ err: cleanupErr, tempRepoName }, 'Failed to cleanup temp repo after error')
    }
    throw err
  }
}

/** case 'work-items' — Azure Boards work items → GitHub issues. */
export async function runWorkItems(task, ctx) {
  const { config, resolvedCredentials, callbacks, targetOwner, targetRepo, azureHost } = ctx
  return await migrateWorkItems(
    { ...config, host: azureHost, org: resolvedCredentials.azureOrg, project: resolvedCredentials.azureProject },
    { pat: resolvedCredentials.azurePat },
    resolvedCredentials.githubToken,
    targetOwner,
    targetRepo,
    callbacks
  )
}

/** case 'wiki' — Azure DevOps wiki → GitHub wiki/repo. */
export async function runWiki(task, ctx) {
  const { config, resolvedCredentials, callbacks, targetOwner, targetRepo, azureHost } = ctx
  return await migrateWiki(
    { ...config, host: azureHost, org: resolvedCredentials.azureOrg, project: resolvedCredentials.azureProject },
    { pat: resolvedCredentials.azurePat },
    resolvedCredentials.githubToken,
    targetOwner,
    targetRepo,
    { onProgress: (status, message, pct) => callbacks.onProgress(pct, message) }
  )
}
