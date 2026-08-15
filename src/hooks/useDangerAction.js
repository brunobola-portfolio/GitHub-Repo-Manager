// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef } from 'react'
import { useModal } from './useModal'
import { openConfirm } from '../utils/openConfirm'

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
	// Latest-ref so the stable run() callback never closes over a stale
	// onConfirm. Written in an effect (run() only fires from event handlers,
	// well after commit) rather than during render.
	const onConfirmRef = useRef(onConfirm)
	useEffect(() => { onConfirmRef.current = onConfirm }, [onConfirm])

	// Delegates to the shared openConfirm primitive (settle-once + close-on-every-
	// path live there). The onConfirm wrapper reads the ref at call time so run()
	// never invokes a stale handler.
	const run = useCallback(
		() => openConfirm(
			{ openModalWithData, closeModal },
			{ title, message, variant, requiresInput, confirmText, onConfirm: () => onConfirmRef.current?.() },
		),
		[title, message, variant, requiresInput, confirmText, openModalWithData, closeModal],
	)

	return { run }
}
