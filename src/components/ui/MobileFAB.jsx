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
 * `shiftAboveBottomBar` lifts the FAB above the bottom nav (Header.jsx)
 * AND above the MobileQuickActionsFab (which sits at bottom-[~72px]),
 * stacking it at ~140px from viewport bottom so both FABs stay visible.
 * Pages without that secondary FAB still get the lift to clear the nav.
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

	// Stacked positioning: MobileQuickActionsFab sits at bottom-72px (56px nav + 16px gap),
	// so this FAB sits at 72 + 56 (its own height) + 12 = 140px to clear it.
	const bottomClass = shiftAboveBottomBar
		? 'bottom-[calc(140px+env(safe-area-inset-bottom,0px))]'
		: 'bottom-6'

	return (
		<motion.button
			type="button"
			onClick={onClick}
			whileHover={{ scale: 1.05 }}
			whileTap={{ scale: 0.95 }}
			aria-label={label}
			title={label}
			className={`fixed right-4 ${bottomClass} z-[var(--ds-z-composer)] w-14 h-14 rounded-full bg-indigo-500 text-white shadow-2xl flex items-center justify-center md:hidden`}
		>
			<Icon className="w-6 h-6" aria-hidden="true" />
		</motion.button>
	)
}
