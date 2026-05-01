// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useRef } from 'react'
import { useModal } from './useModal'

/**
 * useDangerAction — wraps the imperative `openModalWithData('showConfirm', …)`
 * boilerplate into a Promise-returning `run()` function.
 *
 * Slice 2 (Intent affordances audit) introduces this hook so every destructive
 * call site outside the repo action registry (Settings, Teams, Migration, etc.)
 * can adopt a consistent confirmation flow with a one-line API.
 *
 * @example
 *   const { run } = useDangerAction({
 *     title: 'Delete account?',
 *     message: 'This permanently deletes your account…',
 *     variant: 'danger',
 *     requiresInput: 'delete my account',
 *     onConfirm: () => api.deleteAccount(),
 *   })
 *   <button onClick={run}>Delete</button>
 *
 * Contract:
 *   - run() returns Promise<boolean>
 *   - resolves `true` when the user confirms (and onConfirm completed)
 *   - resolves `false` when the user dismisses (Escape / X / Cancel)
 *   - rejects with the same error if onConfirm throws — so callers can react
 *
 * @param {object} cfg
 * @param {string} cfg.title
 * @param {string} cfg.message
 * @param {'info'|'warning'|'danger'} [cfg.variant]
 * @param {string} [cfg.requiresInput] — type-name verification string
 * @param {string} [cfg.confirmText]
 * @param {() => Promise<void>|void} cfg.onConfirm
 * @returns {{ run: () => Promise<boolean> }}
 */
export function useDangerAction({ title, message, variant = 'danger', requiresInput, confirmText, onConfirm }) {
	const { openModalWithData, closeModal } = useModal()
	// Use a ref so the run() callback never closes over a stale onConfirm.
	const onConfirmRef = useRef(onConfirm)
	onConfirmRef.current = onConfirm

	const run = useCallback(() => new Promise((resolve, reject) => {
		// Idempotent settle so a quick double-fire (e.g. user taps confirm
		// twice) doesn't resolve the Promise twice — Promises ignore later
		// calls but explicit guarding keeps reasoning simple.
		let settled = false
		const settle = (fn) => { if (settled) return; settled = true; fn() }

		openModalWithData('showConfirm', {
			title,
			message,
			variant,
			requiresInput,
			confirmText,
			onConfirm: async () => {
				try {
					await onConfirmRef.current?.()
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
	}), [title, message, variant, requiresInput, confirmText, openModalWithData, closeModal])

	return { run }
}
