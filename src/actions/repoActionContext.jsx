/*
 * GitHub Repo Manager
 * useRepoActionContext — DI hook for the registry-driven action surface.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useMemo } from 'react'
import { useToast } from '../hooks/useToast'
import { useModal } from '../hooks/useModal'
import { useGitHub } from '../hooks/useGitHub'
import { reposApi } from '../api/repos'

/**
 * useRepoActionContext — DI hook for action runners.
 *
 * NOTE: see DOUBLE-REFRESH RULE below before authoring archive/delete/visibility actions.
 *
 * Packages every dependency a registry action's run() may need. Surfaces
 * call useRepoActionContext() and pass the result as ctx to
 * runAction(actionId, target, ctx, registry).
 *
 * Returned shape:
 *   {
 *     api,            // reposApi (sync, security, codeowners, contents, …)
 *     toast,          // { success, error, info, warning, custom, errorFromException }
 *     openModal, openModalWithData, closeModal,
 *     refresh,        // useRepos.refresh — re-fetches the current page
 *     performAction,  // useRepos.performAction wrapper (see WARNING below)
 *     archiveRepos,   // useRepos.archiveRepos wrapper (see WARNING below)
 *     deleteRepos,    // useRepos.deleteRepos wrapper (see WARNING below)
 *     confirmGate,    // (cfg) => Promise<boolean>, see CONFIRM GATE below
 *   }
 *
 * CONFIRM GATE:
 *   confirmGate wraps the existing showConfirm modal contract — the modal's
 *   own onConfirm/onClose still close the modal; this just resolves a
 *   Promise so runAction can `await ctx.confirmGate({...})` and branch on
 *   the user's decision. Resolves true on confirm, false on close/cancel.
 *
 * WARNING — DOUBLE-REFRESH RULE (Tasks 5 / 6 / 9):
 *   archiveRepos / deleteRepos / performAction here are the React hook
 *   wrappers from src/hooks/useRepos.js. Those wrappers ALREADY call
 *   fetchRepos(page, perPage) on success and update App-level message /
 *   results state. Therefore, registry actions whose run() delegates to
 *   ctx.archiveRepos / ctx.deleteRepos / ctx.performAction MUST NOT also
 *   declare `triggersRefresh: true` in their action definition — runAction
 *   would then refresh the list a second time, causing a visible flicker
 *   and a wasted round-trip. Specifically: the `archive`,
 *   `archive_selected`, `delete`, `delete_selected`, `visibility`, and
 *   `visibility_selected` actions go through the wrappers and must leave
 *   triggersRefresh unset (or false). Actions that bypass these wrappers
 *   (e.g. sync via ctx.api.syncMirror, transfer via the modal flow) MAY
 *   declare triggersRefresh: true to opt back in to runAction's refresh.
 */
export function useRepoActionContext() {
  const { toast } = useToast()
  const { openModal, openModalWithData, closeModal } = useModal()
  const { refresh, performAction, archiveRepos, deleteRepos } = useGitHub()

  return useMemo(() => ({
    api: reposApi,
    toast,
    openModal,
    openModalWithData,
    closeModal,
    refresh,
    performAction,  // see DOUBLE-REFRESH RULE in JSDoc — do NOT pair with triggersRefresh:true
    archiveRepos,   // see DOUBLE-REFRESH RULE in JSDoc — do NOT pair with triggersRefresh:true
    deleteRepos,    // see DOUBLE-REFRESH RULE in JSDoc — do NOT pair with triggersRefresh:true
    confirmGate: (cfg) => new Promise((resolve) => {
      openModalWithData('showConfirm', {
        ...cfg,
        onConfirm: () => { closeModal('showConfirm'); resolve(true) },
        onClose:   () => { closeModal('showConfirm'); resolve(false) },
      })
    }),
  }), [toast, openModal, openModalWithData, closeModal, refresh, performAction, archiveRepos, deleteRepos])
}
