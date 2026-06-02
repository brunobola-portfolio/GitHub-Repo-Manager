// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Open the shared `showConfirm` modal and resolve the user's decision as a
 * boolean. Single source of truth for "ask, then branch" confirmations — both
 * the action-registry `confirmGate` (src/actions/repoActionContext.jsx) and the
 * `useDangerAction` hook (src/hooks/useDangerAction.js) delegate here, so the
 * modal contract — settle-once, close on every path, reject on a throwing
 * onConfirm — lives in exactly one place instead of two near-duplicates.
 *
 * Two modes, selected by whether `cfg.onConfirm` is supplied:
 *   - Pure gate (no onConfirm): resolves `true` on confirm / `false` on
 *     dismiss; the caller performs the work afterwards.
 *   - Embedded action (onConfirm present): the modal stays open while
 *     onConfirm awaits, closes on completion, and resolves `true`; if onConfirm
 *     throws, the modal closes and the Promise rejects with that error.
 *
 * @param {{ openModalWithData: Function, closeModal: Function }} modal - modal API
 * @param {object} cfg - showConfirm display config (title/message/variant/…);
 *   may include an optional `onConfirm` action to run inside the confirm handler
 * @returns {Promise<boolean>} `true` on confirm, `false` on dismiss
 */
export function openConfirm({ openModalWithData, closeModal }, cfg) {
  const { onConfirm, ...modalCfg } = cfg
  return new Promise((resolve, reject) => {
    // A double-fire (e.g. user taps confirm twice before the modal unmounts)
    // must settle the Promise exactly once.
    let settled = false
    const settle = (fn) => {
      if (settled) return
      settled = true
      fn()
    }

    openModalWithData('showConfirm', {
      ...modalCfg,
      onConfirm: async () => {
        try {
          await onConfirm?.()
          closeModal('showConfirm')
          settle(() => resolve(true))
        } catch (err) {
          closeModal('showConfirm')
          settle(() => reject(err))
        }
      },
      onClose: () => {
        closeModal('showConfirm')
        settle(() => resolve(false))
      },
    })
  })
}
