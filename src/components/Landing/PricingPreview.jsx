import { motion, useMotionValue, useSpring } from 'framer-motion'
import { Check, Zap, Crown } from 'lucide-react'
import { usePricingCardHover, PricingCardHoverLayers } from '@/hooks/usePricingCardHover'

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Perfect for personal projects and open-source exploration.',
    cta: 'Get started free',
    ctaStyle: 'secondary',
    popular: false,
    enterprise: false,
    features: [
      'Up to 20 repositories',
      '50 AI queries / month',
      'GitHub OAuth login',
      'Repository dashboard',
      'Community support',
      '1 API key',
    ],
  },
  {
    name: 'Pro',
    price: '$19',
    period: 'per month',
    description: 'For developers and teams who need the full power of AI.',
    cta: 'Start 14-day free trial',
    ctaStyle: 'primary',
    popular: true,
    enterprise: false,
    features: [
      'Unlimited repositories',
      '500 AI queries / month',
      'Semantic search + AI suite',
      'Azure DevOps migration',
      'Team management (3 members)',
      'Email support',
    ],
  },
  {
    name: 'Enterprise',
    price: '$49',
    period: 'per month',
    description: 'For organizations with advanced security and migration needs.',
    cta: 'Contact sales',
    ctaStyle: 'secondary',
    popular: false,
    enterprise: true,
    features: [
      'Everything in Pro',
      'Unlimited AI queries',
      'Full Azure DevOps migration suite',
      'SSO / SAML + audit logs',
      'Unlimited team members',
      'Priority support + SLA',
    ],
  },
]

const cardVariants = {
  hidden: { opacity: 0, y: 36 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.65, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] },
  }),
}

const SALES_EMAIL = 'bruno@bolalabs.pt'

function PreviewCard({ plan, i, onSignIn }) {
	const tier = plan.popular ? 'pro' : plan.enterprise ? 'enterprise' : 'free'
	const { cardRef, isHovered, hoverKey, reducedMotion, accent, handlers } = usePricingCardHover({ tier })
	const rawX = useMotionValue(0)
	const rawY = useMotionValue(0)
	const springX = useSpring(rawX, { stiffness: 150, damping: 15 })
	const springY = useSpring(rawY, { stiffness: 150, damping: 15 })

	return (
		<motion.div
			ref={cardRef}
			custom={i}
			variants={cardVariants}
			initial="hidden"
			whileInView="visible"
			viewport={{ once: true, margin: '-60px' }}
			onMouseEnter={handlers.onMouseEnter}
			onMouseLeave={() => {
				handlers.onMouseLeave()
				rawX.set(0)
				rawY.set(0)
			}}
			onMouseMove={(e) => {
				handlers.onMouseMove(e)
				if (reducedMotion || !accent.hasMagneticButton) return
				const rect = cardRef.current?.getBoundingClientRect()
				if (!rect) return
				const dx = (e.clientX - (rect.left + rect.width / 2)) / rect.width
				const dy = (e.clientY - (rect.top + rect.height / 2)) / rect.height
				rawX.set(dx * 6)
				rawY.set(dy * 6)
			}}
			className={`relative ${plan.popular ? 'scale-[1.03] md:scale-[1.05]' : ''}`}
			style={{ '--mx': '50%', '--my': '50%' }}
		>
			{/* Badges — absolute on outer wrapper so they can float above the card body (overflow-visible here) */}
			{plan.popular && (
				<div className="absolute -top-4 left-1/2 -translate-x-1/2 z-20">
					<div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500 shadow-lg shadow-indigo-500/30">
						<Zap className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
						<span className="text-xs font-bold text-white tracking-wide">Most Popular</span>
					</div>
				</div>
			)}

			{plan.enterprise && (
				<div className="absolute -top-4 left-1/2 -translate-x-1/2 z-20">
					<div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 shadow-lg shadow-amber-500/30">
						<Crown className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
						<span className="text-xs font-bold text-white tracking-wide">Enterprise</span>
					</div>
				</div>
			)}

			{/* Card body — has overflow-hidden to clip the shimmer */}
			<div
				className={`relative rounded-2xl p-7 flex flex-col gap-6 h-full ds-hover-lift transition-all duration-300 overflow-hidden
					${plan.popular
						? 'bg-gradient-to-b from-indigo-600/90 to-purple-700/90 dark:from-indigo-600/80 dark:to-purple-700/80 border-2 border-indigo-400/30 shadow-2xl shadow-indigo-500/30 hover:shadow-violet-500/40'
						: plan.enterprise
							? 'bg-white/60 dark:bg-white/[0.04] border border-amber-400/30 dark:border-amber-500/20 backdrop-blur-sm shadow-lg shadow-amber-500/5 hover:shadow-amber-500/30'
							: 'bg-white/60 dark:bg-white/[0.04] border border-slate-200/60 dark:border-white/[0.08] backdrop-blur-sm hover:shadow-indigo-500/20 hover:shadow-xl'
					}`}
			>
				<PricingCardHoverLayers
					tier={tier}
					isHovered={isHovered}
					hoverKey={hoverKey}
					reducedMotion={reducedMotion}
				/>

				{/* Content wrapper above the absolute hover layers */}
				<div className="relative z-[1] flex flex-col gap-6 h-full">
					{/* Plan header */}
					<div>
						<p className={`text-sm font-semibold mb-1 ds-font-display ${plan.popular ? 'text-indigo-200' : plan.enterprise ? 'text-amber-600 dark:text-amber-400' : 'text-indigo-600 dark:text-indigo-400'}`}>
							{plan.name}
						</p>
						<div className="flex items-end gap-2 mb-2">
							<span
								className={`text-4xl font-extrabold tracking-tight ds-font-display transition-[background-image] duration-500 ${plan.popular ? 'text-white' : 'text-slate-900 dark:text-white'}`}
								style={isHovered && !reducedMotion ? {
									backgroundImage: `linear-gradient(135deg, ${accent.primary}, ${accent.secondary})`,
									backgroundClip: 'text',
									WebkitBackgroundClip: 'text',
									WebkitTextFillColor: 'transparent',
								} : undefined}
							>
								{plan.price}
							</span>
							<span className={`text-sm pb-1.5 ds-font-display ${plan.popular ? 'text-indigo-200/80' : 'text-slate-400'}`}>
								/{plan.period}
							</span>
						</div>
						<p className={`text-sm leading-relaxed ds-font-display ${plan.popular ? 'text-indigo-100/90' : 'text-slate-500 dark:text-slate-400'}`}>
							{plan.description}
						</p>
					</div>

					{/* Feature list — with stagger pop animation on hover (Layer 5) */}
					<motion.ul
						className="flex flex-col gap-3 flex-1"
						animate={isHovered && !reducedMotion ? 'hover' : 'rest'}
						variants={{
							hover: { transition: { staggerChildren: 0.03 } },
							rest: {},
						}}
					>
						{plan.features.map((feat) => (
							<li key={feat} className="flex items-start gap-2.5">
								<motion.div
									variants={{
										hover: { scale: [1, 1.15, 1], transition: { duration: 0.3 } },
										rest: { scale: 1 },
									}}
									className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0
										${plan.popular
											? 'bg-white/20'
											: plan.enterprise
												? 'bg-amber-500/10 dark:bg-amber-500/20'
												: 'bg-indigo-500/10 dark:bg-indigo-500/20'
										}`}
								>
									<Check className={`w-3 h-3 ${plan.popular ? 'text-white' : plan.enterprise ? 'text-amber-600 dark:text-amber-400' : 'text-indigo-600 dark:text-indigo-400'}`} strokeWidth={2.5} />
								</motion.div>
								<span className={`text-sm ds-font-display ${plan.popular ? 'text-indigo-50' : 'text-slate-600 dark:text-slate-300'}`}>
									{feat}
								</span>
							</li>
						))}
					</motion.ul>

					{/* CTA — magnetic wrapper for popular/enterprise */}
					<motion.div style={accent.hasMagneticButton ? { x: springX, y: springY } : undefined}>
						<button
							onClick={() => {
								if (plan.enterprise) {
									window.open(`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('GitHub Repo Manager — Enterprise inquiry')}`, '_self')
								} else if (onSignIn) {
									onSignIn()
								}
							}}
							className={`w-full py-3 rounded-xl font-semibold text-sm transition-all duration-300 ds-btn-shimmer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
								${plan.popular
									? 'bg-white text-indigo-700 hover:bg-indigo-50 shadow-lg shadow-white/20 hover:shadow-xl focus-visible:ring-white focus-visible:ring-offset-indigo-600'
									: plan.enterprise
										? 'bg-amber-500/10 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 dark:hover:bg-amber-500/25 border border-amber-400/40 dark:border-amber-500/30 focus-visible:ring-amber-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950'
										: 'bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20 dark:hover:bg-indigo-500/25 border border-indigo-300/40 dark:border-indigo-500/30 focus-visible:ring-indigo-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950'
								}`}
						>
							{plan.cta}
						</button>
					</motion.div>
				</div>
			</div>
		</motion.div>
	)
}

export function PricingPreview({ onSignIn }) {
  return (
    <section className="relative py-20 sm:py-28 px-4 overflow-hidden">

      {/* Background accent */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 100%, rgba(139,92,246,0.06) 0%, transparent 70%)',
        }}
      />

      <div className="relative max-w-6xl mx-auto">
        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-14 sm:mb-16"
        >
          <p className="text-xs font-semibold tracking-widest uppercase text-indigo-500 dark:text-indigo-400 mb-3 ds-font-display">
            Pricing
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight ds-font-display mb-4">
            Simple,{' '}
            <span className="ds-gradient-text">transparent pricing</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto text-lg ds-font-display">
            Start free, scale when you&apos;re ready. Or self-host for free forever.
          </p>
        </motion.div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start pt-5">
					{plans.map((plan, i) => (
						<PreviewCard key={plan.name} plan={plan} i={i} onSignIn={onSignIn} />
					))}
        </div>

        {/* Self-host note */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="text-center mt-10 text-sm text-slate-400 dark:text-slate-500 ds-font-display"
        >
          Prefer to self-host? The full app is free and open-source on GitHub — forever.
        </motion.p>
      </div>
    </section>
  )
}
