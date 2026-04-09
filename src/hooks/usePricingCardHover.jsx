/* eslint-disable react-refresh/only-export-components */
import { useState, useRef, useCallback } from 'react'
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion'

/**
 * Per-tier visual accent tokens that feed the hover layers.
 */
export const TIER_ACCENTS = {
	free: {
		primary: 'rgba(129,140,248,1)',    // indigo-400
		secondary: 'rgba(59,130,246,1)',   // blue-500
		spotlight: 'rgba(99,102,241,0.18)',
		shadowClass: 'shadow-indigo-500/15',
		spotlightRadius: 350,
		borderGlowOpacity: 0.55,
		shimmerDuration: 0.7,
		hasMagneticButton: false,
	},
	pro: {
		primary: 'rgba(167,139,250,1)',    // violet-400
		secondary: 'rgba(217,70,239,1)',   // fuchsia-500
		spotlight: 'rgba(167,139,250,0.22)',
		shadowClass: 'shadow-violet-500/25',
		spotlightRadius: 400,
		borderGlowOpacity: 0.75,
		shimmerDuration: 0.7,
		hasMagneticButton: true,
	},
	enterprise: {
		primary: 'rgba(251,191,36,1)',     // amber-400
		secondary: 'rgba(249,115,22,1)',   // orange-500
		spotlight: 'rgba(251,191,36,0.18)',
		shadowClass: 'shadow-amber-500/20',
		spotlightRadius: 350,
		borderGlowOpacity: 0.6,
		shimmerDuration: 0.9,
		hasMagneticButton: true,
	},
}

/**
 * Shared hover behavior for pricing cards.
 *
 * @param {{ tier: 'free' | 'pro' | 'enterprise' }} args
 * @returns {{
 *   cardRef: React.MutableRefObject<HTMLElement|null>,
 *   isHovered: boolean,
 *   hoverKey: number,
 *   reducedMotion: boolean,
 *   accent: typeof TIER_ACCENTS[keyof typeof TIER_ACCENTS],
 *   handlers: {
 *     onMouseEnter: () => void,
 *     onMouseLeave: () => void,
 *     onMouseMove: (e: MouseEvent) => void,
 *   }
 * }}
 */
export function usePricingCardHover({ tier }) {
	const reducedMotion = useReducedMotion()
	const [isHovered, setIsHovered] = useState(false)
	const [hoverKey, setHoverKey] = useState(0)
	const cardRef = useRef(null)
	const accent = TIER_ACCENTS[tier] ?? TIER_ACCENTS.free

	const onMouseMove = useCallback((e) => {
		if (reducedMotion) return
		const el = cardRef.current
		if (!el) return
		const rect = el.getBoundingClientRect()
		const x = ((e.clientX - rect.left) / rect.width) * 100
		const y = ((e.clientY - rect.top) / rect.height) * 100
		el.style.setProperty('--mx', `${x}%`)
		el.style.setProperty('--my', `${y}%`)
	}, [reducedMotion])

	const onMouseEnter = useCallback(() => {
		setIsHovered(true)
		setHoverKey((k) => k + 1)
	}, [])

	const onMouseLeave = useCallback(() => {
		setIsHovered(false)
		const el = cardRef.current
		if (el) {
			el.style.setProperty('--mx', '50%')
			el.style.setProperty('--my', '50%')
		}
	}, [])

	return {
		cardRef,
		isHovered,
		hoverKey,
		reducedMotion,
		accent,
		handlers: { onMouseEnter, onMouseLeave, onMouseMove },
	}
}

/**
 * Renders the layered hover visuals (spotlight, border glow, shimmer)
 * inside the card. Must be rendered as a direct child of a `position: relative`
 * container (the pricing card body).
 */
export function PricingCardHoverLayers({ tier, isHovered, hoverKey, reducedMotion }) {
	const accent = TIER_ACCENTS[tier] ?? TIER_ACCENTS.free

	if (reducedMotion) return null

	return (
		<>
			{/* Layer 1: spotlight cursor-tracking */}
			<div
				data-pricing-hover-layer="spotlight"
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300"
				style={{
					background: `radial-gradient(${accent.spotlightRadius}px circle at var(--mx, 50%) var(--my, 50%), ${accent.spotlight}, transparent 55%)`,
					opacity: isHovered ? 1 : 0,
				}}
			/>

			{/* Layer 2: border glow (gradient border via mask) */}
			<div
				data-pricing-hover-layer="border-glow"
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300"
				style={{
					background: `radial-gradient(500px circle at var(--mx, 50%) var(--my, 50%), ${accent.primary}, transparent 40%)`,
					padding: '1px',
					WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
					WebkitMaskComposite: 'xor',
					mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
					maskComposite: 'exclude',
					opacity: isHovered ? accent.borderGlowOpacity : 0,
				}}
			/>

			{/* Layer 3: shimmer sweep — replayed via AnimatePresence keyed on hoverKey */}
			<AnimatePresence mode="wait">
				{isHovered && (
					<motion.div
						key={`shimmer-${hoverKey}`}
						data-pricing-hover-layer="shimmer"
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 rounded-2xl overflow-hidden"
					>
						<motion.div
							className="absolute inset-y-0"
							style={{
								width: '50%',
								background: 'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.12) 50%, transparent 70%)',
							}}
							initial={{ x: '-200%' }}
							animate={{ x: '250%' }}
							transition={{ duration: accent.shimmerDuration, ease: [0.16, 1, 0.3, 1] }}
						/>
					</motion.div>
				)}
			</AnimatePresence>
		</>
	)
}
