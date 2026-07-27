import { motion } from 'framer-motion'
import { EASE } from '../ui/motion'
import { Check, Zap, Crown } from 'lucide-react'

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Full Repo Advisor, Deep Review, Prompt Studio, bulk ops, and mirror sync — no credit card required.',
    cta: 'Get started free',
    ctaStyle: 'secondary',
    popular: false,
    enterprise: false,
    features: [
      'Repo Advisor — 1,000 queries / month',
      'Semantic Search (375 / month)',
      'README, Commit, Insights & Deep Review AI',
      'Bulk ops (transfer, mirror, cross-org) + Mirror Sync',
      'Unlimited teams + 5 cloud migrations / month',
    ],
  },
  {
    name: 'Pro',
    price: '$19',
    period: 'per month',
    description: 'More AI headroom and priority support for power users.',
    cta: 'Upgrade to Pro',
    ctaStyle: 'primary',
    popular: true,
    enterprise: false,
    features: [
      '10,000 AI queries / month',
      'Unlimited monthly caps on every AI feature',
      'Unlimited README, Commit, Insights, Search & Deep Review',
      'Unlimited Prompt Studio presets',
      '50 API keys + email support',
    ],
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: 'contact sales',
    description: 'For organizations with advanced security and migration needs.',
    cta: 'Contact sales',
    ctaStyle: 'secondary',
    popular: false,
    enterprise: true,
    features: [
      'Everything in Pro',
      'Unlimited AI queries',
      'Unlimited team members',
      'Audit logs (SSO / SAML coming soon)',
      '100 API keys',
      'White-glove migration + priority support & SLA',
    ],
  },
]

const cardVariants = {
  hidden: { opacity: 0, y: 36 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.65, delay: i * 0.12, ease: EASE.emphasized },
  }),
}

const SALES_EMAIL = 'bruno@bolalabs.pt'

function PreviewCard({ plan, i, onSignIn }) {
	return (
		<motion.div
			custom={i}
			variants={cardVariants}
			initial="hidden"
			whileInView="visible"
			viewport={{ once: true, margin: '-60px' }}
			className={`relative ${plan.popular ? 'scale-[1.03] md:scale-[1.05]' : ''}`}
		>
			{/* Badges — absolute on outer wrapper so they can float above the card body (overflow-visible here) */}
			{plan.popular && (
				<div className="absolute -top-4 left-1/2 -translate-x-1/2 z-20">
					<div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] shadow-md">
						<Zap className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
						<span className="text-xs font-bold text-white tracking-wide">Most Popular</span>
					</div>
				</div>
			)}

			{plan.enterprise && (
				<div className="absolute -top-4 left-1/2 -translate-x-1/2 z-20">
					<div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-amber-500 shadow-lg">
						<Crown className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
						<span className="text-xs font-bold text-white tracking-wide">Enterprise</span>
					</div>
				</div>
			)}

			{/* Card body — hover treatment is CSS-only (bg/border/shadow), matching
				the in-app Pricing/PricingCard.jsx contract: no translate/scale. */}
			<div
				className={`relative rounded-2xl p-7 flex flex-col gap-6 h-full transition-colors duration-200 overflow-hidden
					${plan.popular
						? 'bg-indigo-700 dark:bg-indigo-600 border-2 border-indigo-400/30 shadow-2xl'
						: plan.enterprise
							? 'bg-white/60 dark:bg-white/[0.04] border border-amber-400/30 dark:border-amber-500/20 backdrop-blur-sm shadow-lg shadow-amber-500/5 hover:shadow-amber-500/30'
							: 'bg-white/60 dark:bg-white/[0.04] border border-slate-200/60 dark:border-white/[0.08] backdrop-blur-sm hover:border-slate-300 dark:hover:border-slate-600'
					}`}
			>
				<div className="flex flex-col gap-6 h-full">
					{/* Plan header */}
					<div>
						<p className={`text-sm font-semibold mb-1 ds-font-display ${plan.popular ? 'text-indigo-200' : plan.enterprise ? 'text-amber-700 dark:text-amber-400' : 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]'}`}>
							{plan.name}
						</p>
						<div className="flex items-end gap-2 mb-2">
							<span
								className={`text-4xl font-bold tracking-tight ds-font-display ${plan.popular ? 'text-white' : 'text-slate-900 dark:text-slate-100'}`}
							>
								{plan.price}
							</span>
							<span className={`text-sm pb-1.5 ds-font-display ${plan.popular ? 'text-indigo-200/80' : 'text-slate-500 dark:text-slate-400'}`}>
								/{plan.period}
							</span>
						</div>
						<p className={`text-sm leading-relaxed ds-font-display ${plan.popular ? 'text-indigo-100/90' : 'text-slate-500 dark:text-slate-400'}`}>
							{plan.description}
						</p>
					</div>

					{/* Feature list */}
					<ul className="flex flex-col gap-3 flex-1">
						{plan.features.map((feat) => (
							<li key={feat} className="flex items-start gap-2.5">
								<div
									className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0
										${plan.popular
											? 'bg-white/20'
											: plan.enterprise
												? 'bg-amber-500/10 dark:bg-amber-500/20'
												: 'bg-indigo-500/10 dark:bg-indigo-500/20'
										}`}
								>
									<Check className={`w-3 h-3 ${plan.popular ? 'text-white' : plan.enterprise ? 'text-amber-600 dark:text-amber-400' : 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]'}`} strokeWidth={2.5} />
								</div>
								<span className={`text-sm ds-font-display ${plan.popular ? 'text-indigo-50' : 'text-slate-600 dark:text-slate-300'}`}>
									{feat}
								</span>
							</li>
						))}
					</ul>

					{/* CTA */}
					<button
						onClick={() => {
							if (plan.enterprise) {
								window.open(`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('GitHub Repo Manager — Enterprise inquiry')}`, '_self')
							} else if (onSignIn) {
								onSignIn()
							}
						}}
						className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
							${plan.popular
								? 'bg-white text-indigo-700 hover:bg-indigo-50 shadow-lg shadow-white/20 focus-visible:ring-white focus-visible:ring-offset-indigo-600'
								: plan.enterprise
									? 'bg-amber-500/10 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 dark:hover:bg-amber-500/25 border border-amber-400/40 dark:border-amber-500/30 focus-visible:ring-amber-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950'
									: 'bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20 dark:hover:bg-indigo-500/25 border border-indigo-300/40 dark:border-indigo-500/30 focus-visible:ring-indigo-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950'
							}`}
					>
						{plan.cta}
					</button>
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
          transition={{ duration: 0.7, ease: EASE.emphasized }}
          className="text-center mb-14 sm:mb-16"
        >
          <p className="text-xs font-semibold tracking-widest uppercase text-indigo-500 dark:text-[color:var(--ds-accent-brand-dark)] mb-3 ds-font-display">
            Pricing
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 dark:text-slate-100 tracking-tight ds-font-display mb-4">
            Simple,{' '}
            <span className="text-slate-900 dark:text-slate-100 font-semibold">transparent pricing</span>
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
          className="text-center mt-10 text-sm text-slate-500 dark:text-slate-400 ds-font-display"
        >
          Prefer to self-host? The full app is free and open-source on GitHub — forever.
        </motion.p>
      </div>
    </section>
  )
}
