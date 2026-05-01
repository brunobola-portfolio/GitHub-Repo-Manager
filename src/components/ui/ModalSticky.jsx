// SPDX-License-Identifier: AGPL-3.0-only
import { useMobileBreakpoint } from '../../hooks/useMobileBreakpoint'
import { useViewportSafeHeight } from '../../hooks/useViewportSafeHeight'
import { Modal } from './Modal'

/**
 * ModalSticky — wraps `<Modal>` with mobile-aware layout: full-height
 * container, scrolling body, sticky footer pushed to the bottom edge.
 *
 * Backwards-compatible: at `>= md` viewports, renders the same DOM as `<Modal>`
 * with `footer` in normal flow — no visual change for desktop callers. The
 * sticky behaviour kicks in only on mobile, where action rows otherwise
 * scroll off-screen on long modal bodies.
 *
 * @example
 *   <ModalSticky
 *     isOpen={open}
 *     onClose={close}
 *     title="Edit settings"
 *     footer={<><Button variant="ghost">Cancel</Button><Button onClick={save}>Save</Button></>}
 *   >
 *     <p>body…</p>
 *   </ModalSticky>
 */
export function ModalSticky({
	isOpen,
	onClose,
	title,
	subtitle,
	footer,
	children,
	size = 'md',
	variant = 'default',
	icon,
	closeOnBackdrop = true,
	showCloseButton = true,
}) {
	const isMobile = useMobileBreakpoint()
	const safeH = useViewportSafeHeight()

	const innerStyle = isMobile
		? { maxHeight: Math.max(0, safeH - 80), display: 'flex', flexDirection: 'column' }
		: undefined

	const bodyClass = isMobile ? 'flex-1 overflow-y-auto pb-4' : ''
	const footerClass = isMobile
		? 'sticky bottom-0 left-0 right-0 -mx-4 px-4 py-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-2'
		: 'mt-4 flex items-center justify-end gap-2'

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={title}
			subtitle={subtitle}
			size={size}
			variant={variant}
			icon={icon}
			closeOnBackdrop={closeOnBackdrop}
			showCloseButton={showCloseButton}
		>
			<div style={innerStyle}>
				<div className={bodyClass}>{children}</div>
				{footer && (
					<div className={footerClass} data-testid="modal-sticky-footer">
						{footer}
					</div>
				)}
			</div>
		</Modal>
	)
}
