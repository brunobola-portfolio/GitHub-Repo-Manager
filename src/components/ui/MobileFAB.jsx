// SPDX-License-Identifier: AGPL-3.0-only
import { motion } from 'framer-motion'
import { useMobileBreakpoint } from '../../hooks/useMobileBreakpoint'

/**
 * MobileFAB — floating action button rendered only on mobile (`< md`).
 *
 * Slice 5 introduces this so flows that are keyboard-only on desktop (most
 * notably the command palette) gain a touch entry-point on phones. The FAB
 * is hidden on `>= md` so it never overlaps desktop UI.
 *
 * `shiftAboveBottomBar` lifts the FAB to `bottom-20` for pages that already
 * have a fixed bottom bar (e.g. WorkBoard mobile tabs) — caller's
 * responsibility to know when that's the case.
 *
 * @param {object} props
 * @param {React.ComponentType} props.icon — lucide-react icon component
 * @param {string} props.label — accessible label / tooltip
 * @param {() => void} props.onClick
 * @param {boolean} [props.shiftAboveBottomBar]
 */
export function MobileFAB({ icon: Icon, label, onClick, shiftAboveBottomBar = false }) {
	const isMobile = useMobileBreakpoint()
	if (!isMobile) return null

	return (
		<motion.button
			type="button"
			onClick={onClick}
			whileHover={{ scale: 1.05 }}
			whileTap={{ scale: 0.95 }}
			aria-label={label}
			title={label}
			className={`fixed right-4 ${shiftAboveBottomBar ? 'bottom-20' : 'bottom-6'} z-40 w-14 h-14 rounded-full bg-indigo-500 text-white shadow-2xl flex items-center justify-center md:hidden`}
		>
			<Icon className="w-6 h-6" aria-hidden="true" />
		</motion.button>
	)
}
