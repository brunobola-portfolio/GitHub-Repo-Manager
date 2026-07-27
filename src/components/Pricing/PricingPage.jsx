import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ArrowRight, Sparkles, GitBranch, Shield, Cpu } from 'lucide-react'
import { PricingCard } from './PricingCard'
import { FeatureComparison } from './FeatureComparison'
import { API_BASE_URL } from '../../config'
import { getCsrfToken } from '../../utils/api'
import { ServiceUnavailable, FeatureError } from '../states'
import { EASE, SPRING } from '../ui/motion'

/* ─── Tier definitions ─── */
const TIERS_MONTHLY = [
  {
    tier: 'Free',
    price: 0,
    highlighted: false,
    enterprise: false,
    ctaText: 'Get Started',
    features: [
      { label: 'Repositories managed', included: 'Unlimited' },
      { label: 'Repo Advisor (conversational)', included: true },
      { label: 'Semantic Search (AI)', included: '375 / month' },
      { label: 'Migration Risk Analysis (AI)', included: '25 / month' },
      { label: 'Repo Insights / Quality Report', included: '75 / month' },
      { label: 'README Generator (AI)', included: '25 / month' },
      { label: 'README Studio (AI improve)', included: '25 / month' },
      { label: 'Commit Generator (AI)', included: '250 / month' },
      { label: 'AI Deep Review (walkthrough + comments)', included: '10 / month' },
      { label: 'Prompt Studio (custom presets)', included: '10 presets · 30 tests / month' },
      { label: 'PR Chat (streaming Q&A)', included: '100 messages / month' },
      { label: 'PR slash commands (/describe, /test_plan, /improve)', included: '30 / month' },
      { label: 'PR Review Experience', included: true },
      { label: 'PR Review with write-back comments', included: true },
      { label: 'AI Diagram Generator', included: '15 / month' },
      { label: 'Agent Rules Generator (AGENTS.md / CLAUDE.md)', included: '20 / month' },
      { label: 'Security Posture AI Summary', included: '75 / month' },
      { label: 'AI Image Generation (social / hero / logo)', included: '5 / month' },
      { label: 'AI queries / month (total)', included: '1,000' },
      { label: 'Community Health Dashboard', included: true },
      { label: 'Work Board dashboards + DORA metrics', included: true },
      { label: 'Teams — unlimited', included: true },
      { label: 'Azure DevOps Cloud migration', included: '5 / month' },
      { label: 'Mirror Sync (apply)', included: '10 / month' },
      { label: 'Dry-Run migration', included: true },
      { label: 'Export Metadata (JSON)', included: true },
      { label: 'Bulk ops incl. transfer, mirror, cross-org', included: true },
      { label: 'API keys', included: '25' },
      { label: 'Community support', included: true },
    ],
  },
  {
    tier: 'Pro',
    price: 19,
    highlighted: true,
    enterprise: false,
    ctaText: 'Upgrade to Pro',
    features: [
      { label: 'Everything in Free, unlimited', included: true },
      { label: 'AI queries / month', included: '10,000' },
      { label: 'Unlimited monthly caps on every AI feature', included: true },
      { label: 'Unlimited README / Commit / Insights / Deep Review / PR Chat', included: true },
      { label: 'Unlimited Prompt Studio presets', included: true },
      { label: 'Azure DevOps Cloud migration', included: true },
      { label: 'Teams — unlimited', included: true },
      { label: 'API keys', included: '50' },
      { label: 'Email support', included: true },
    ],
  },
  {
    tier: 'Enterprise',
    price: 0,
    customPrice: 'Custom',
    highlighted: false,
    enterprise: true,
    ctaText: 'Contact Sales',
    features: [
      { label: 'Everything in Pro, unlimited', included: true },
      { label: 'Unlimited AI queries', included: true },
      { label: 'Unlimited team members', included: true },
      { label: 'Audit Logs', included: true },
      { label: 'SSO / SAML (coming soon)', included: false },
      { label: 'API keys', included: '100' },
      { label: 'White-glove migration services', included: true },
      { label: 'Priority Support + SLA', included: true },
    ],
  },
]

const YEARLY_DISCOUNT = 0.8 // 20% off

function applyYearly(tier, isYearly) {
  if (!isYearly || tier.price === 0 || tier.customPrice != null) return tier
  return {
    ...tier,
    originalPrice: tier.price,
    price: Math.round(tier.price * YEARLY_DISCOUNT),
  }
}

/* ─── FAQ data ─── */
const FAQS = [
  {
    q: 'Can I switch plans later?',
    a: "Yes — you can upgrade or downgrade at any time. When upgrading, you'll be charged a prorated amount for the remainder of your billing period. Downgrades take effect at the next renewal.",
  },
  {
    q: 'What counts as an AI query?',
    a: 'Each call to Repo Advisor, Semantic Search, Migration Risk Analysis, README Generator, Commit Generator, Repo Insights, Deep Review, Prompt Studio, or PR Chat counts as one query against your monthly total. Free-tier users also get per-feature caps (e.g. 25 READMEs/month) so no single feature drains your whole budget. Cached responses and read-only dashboard views are free.',
  },
  {
    q: 'Is my data secure?',
    a: 'Traffic is encrypted in transit over HTTPS/TLS, and the credentials you store — your GitHub and Azure PATs plus any bring-your-own-key AI provider keys — are encrypted at rest with AES-256-GCM. The stack is security-hardened (Content-Security-Policy, rate limiting, and an append-only, SHA-256 hash-chained audit log), and because the app is self-hostable under AGPL you can run it on your own infrastructure so your data never leaves it. We never access your code without explicit permission.',
  },
  {
    q: 'Do you offer a free trial for Pro or Enterprise?',
    a: 'The Free plan is generous enough to evaluate the product with no credit card, and Pro is month-to-month — cancel anytime. Enterprise plans include a guided proof-of-concept period. Contact sales for details.',
  },
]

/* ─── FAQ accordion item ─── */
function FaqItem({ q, a, index }) {
  const [open, setOpen] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, delay: index * 0.08, ease: EASE.emphasized }}
      className="rounded-xl border border-slate-200/60 dark:border-white/[0.08]
        bg-white/60 dark:bg-white/[0.04] backdrop-blur-sm overflow-hidden"
    >
      <button
        onClick={() => setOpen(v => !v)}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) setOpen(false) }}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-6 py-5 text-left group ds-focus-ring rounded-xl"
      >
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-200">
          {q}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.25 }}
          className="flex-shrink-0 ml-4 text-slate-400 dark:text-slate-500 group-hover:text-indigo-500 transition-colors duration-200"
        >
          <ChevronDown className="w-5 h-5" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE.emphasized }}
            className="overflow-hidden"
          >
            <p className="px-6 pb-5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              {a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ─── Main page ─── */
const SALES_EMAIL = 'bruno@bolalabs.pt'

export function PricingPage({ onGetStarted } = {}) {
  const [isYearly, setIsYearly] = useState(false)
  // Feature-detect yearly billing. The toggle stays hidden until the server
  // confirms a yearly Stripe price is actually configured, so we never show
  // "Save 20%" and then charge the monthly price at checkout. Defaults to
  // false (hidden) so an unavailable/failed probe errs on the honest side.
  const [yearlyAvailable, setYearlyAvailable] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState(null)
  // Stays on Pricing when checkout is unavailable so the user actually sees
  // the explanation (previously we navigated home and the banner never showed).
  // 'unavailable' = Stripe missing (503); 'error' = network / unexpected.
  const [checkoutState, setCheckoutState] = useState(null)

  // On mount, ask the backend whether yearly billing is wired. If the probe
  // is unreachable we leave the toggle hidden rather than advertise a discount
  // the checkout can't honour.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/billing/config`, { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setYearlyAvailable(!!data?.yearlyBillingAvailable)
      } catch { /* keep yearly hidden when we can't confirm it's configured */ }
    })()
    return () => { cancelled = true }
  }, [])

  const handleCheckout = useCallback(async (tier, billingPeriod = 'monthly') => {
    setCheckoutLoading(tier)
    setCheckoutState(null)
    try {
      const headers = { 'Content-Type': 'application/json' }
      try { headers['X-CSRF-Token'] = await getCsrfToken() } catch { /* server will 403 */ }
      const res = await fetch(`${API_BASE_URL}/api/v1/billing/checkout`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ tier, billingPeriod }),
      })
      if (res.status === 503) {
        setCheckoutState({ kind: 'unavailable' })
        return
      }
      if (!res.ok) {
        let msg = `Checkout failed (HTTP ${res.status}).`
        try { const body = await res.json(); if (body?.error) msg = body.error } catch { /* keep default */ }
        setCheckoutState({ kind: 'error', message: msg })
        return
      }
      const data = await res.json()
      if (data?.url) {
        window.location.href = data.url
      } else {
        setCheckoutState({ kind: 'error', message: 'Checkout session did not return a redirect URL.' })
      }
    } catch {
      setCheckoutState({ kind: 'error', message: 'Network error — please try again.' })
    } finally {
      setCheckoutLoading(null)
    }
  }, [])

  const handleTierAction = useCallback((tier) => {
    if (tier === 'Enterprise') {
      window.location.href = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent('GitHub Repo Manager — Enterprise inquiry')}&body=${encodeURIComponent('Hi Bruno,\n\nI\'m interested in the Enterprise plan for GitHub Repo Manager.\n\nOrganization: \nTeam size: \nUse case: \n\nThanks!')}`
      return
    }
    if (tier === 'Pro') {
      handleCheckout('pro', isYearly ? 'yearly' : 'monthly')
      return
    }
    // Free tier — go to dashboard
    if (onGetStarted) onGetStarted('free')
  }, [handleCheckout, onGetStarted, isYearly])

  const tiers = TIERS_MONTHLY.map(t => applyYearly(t, isYearly))

  return (
    <div data-testid="pricing-page" className="relative min-h-screen overflow-x-hidden">

      {/* Background orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute rounded-full blur-3xl bg-indigo-500 opacity-10 dark:opacity-15"
          style={{ width: 500, height: 500, left: '-8%', top: '-5%' }}
          animate={{ y: [0, -30, 0], x: [0, 20, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full blur-3xl bg-purple-600 opacity-10 dark:opacity-15"
          style={{ width: 400, height: 400, right: '-6%', top: '10%' }}
          animate={{ y: [0, 30, 0], x: [0, -20, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />
        <motion.div
          className="absolute rounded-full blur-3xl bg-cyan-500 opacity-[0.08] dark:opacity-[0.12]"
          style={{ width: 300, height: 300, left: '40%', top: '55%' }}
          animate={{ y: [0, -20, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 4 }}
        />

        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.025] dark:opacity-[0.05]"
          style={{
            backgroundImage: 'linear-gradient(rgba(99,102,241,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">

        {/* ── Checkout-blocked banner (Stripe missing or network error) ── */}
        <AnimatePresence>
          {checkoutState?.kind === 'unavailable' && (
            <ServiceUnavailable
              key="checkout-unavailable"
              variant="banner"
              service="Stripe checkout"
              reason="This self-hosted deployment doesn't have Stripe configured. Continue on Free, or contact us for a Pro license key."
              contactEmail={SALES_EMAIL}
              contactSubject="GitHub Repo Manager — Pro license inquiry"
              onDismiss={() => setCheckoutState(null)}
              className="mb-8"
            />
          )}
          {checkoutState?.kind === 'error' && (
            <FeatureError
              key="checkout-error"
              tone="error"
              title="Checkout couldn't start"
              hint={checkoutState.message}
              onRetry={() => setCheckoutState(null)}
              className="mb-8"
            />
          )}
        </AnimatePresence>

        {/* ── Hero ── */}
        <div className="text-center mb-14 sm:mb-20">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-7
              bg-indigo-500/10 dark:bg-indigo-500/15 border border-indigo-500/20 dark:border-indigo-500/25"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-500 dark:text-[color:var(--ds-accent-brand-dark)]" />
            <span className="text-xs font-semibold text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] tracking-wide">
              Simple, transparent pricing
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.1, ease: EASE.emphasized }}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight ds-font-display mb-5"
          >
            <span className="text-slate-800 dark:text-white">Plans that</span>{' '}
            <span className="text-slate-900 dark:text-slate-100 font-semibold">grow with you</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: EASE.emphasized }}
            className="text-slate-500 dark:text-slate-400 text-lg max-w-xl mx-auto mb-10 leading-relaxed"
          >
            Start for free and upgrade only when you need more power.
            No hidden fees, no surprise bills.
          </motion.p>

          {/* Monthly / Yearly toggle — only shown when the backend confirms a
              yearly Stripe price is configured, so the discount always maps to
              a real yearly checkout. */}
          {yearlyAvailable && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="inline-flex items-center gap-3"
          >
            <span className={`text-sm font-medium transition-colors duration-200 ${!isYearly ? 'text-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
              Monthly
            </span>

            <button
              onClick={() => setIsYearly(v => !v)}
              className={`relative w-12 h-6 rounded-full transition-colors duration-[var(--ds-duration)] ds-focus-ring
                ${isYearly ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-white/10'}`}
              aria-label="Toggle yearly billing"
            >
              <motion.span
                layout
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md"
                animate={{ left: isYearly ? 26 : 2 }}
                transition={SPRING.knob}
              />
            </button>

            <span className={`text-sm font-medium transition-colors duration-200 ${isYearly ? 'text-slate-800 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>
              Yearly
            </span>

            <AnimatePresence>
              {isYearly && (
                <motion.span
                  key="badge"
                  initial={{ opacity: 0, scale: 0.8, x: -6 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.8, x: -6 }}
                  transition={{ duration: 0.2 }}
                  className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                >
                  Save 20%
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
          )}
        </div>

        {/* ── Social proof strip ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 mb-12 sm:mb-16"
        >
          {[
            // Capability statements only — never usage-stat claims ("X repos
            // managed", "Y active users"): we don't aggregate that number
            // anywhere, so advertising it would be unverified.
            { icon: GitBranch, text: 'Scales to thousands of repos per workspace' },
            { icon: Cpu, text: 'Multi-provider AI (Gemini, Claude, GPT, OpenRouter)' },
            // Substantiated in code: helmet CSP + express-rate-limit +
            // append-only SHA-256 hash-chained audit log. No SOC 2 attestation
            // exists, so we advertise the hardening measures, not a certification.
            { icon: Shield, text: 'Hardened stack — CSP, rate limiting, tamper-evident audit log' },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Icon className="w-4 h-4 text-indigo-500/60 dark:text-indigo-400/50" />
              <span>{text}</span>
            </div>
          ))}
        </motion.div>

        {/* ── Pricing cards ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.4, ease: EASE.emphasized }}
          className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 mb-20 sm:mb-28 items-start pt-5"
        >
          {tiers.map((tier) => (
            <PricingCard
              key={tier.tier}
              {...tier}
              period={isYearly ? 'year' : 'month'}
              ctaText={checkoutLoading === tier.tier.toLowerCase() ? 'Redirecting...' : tier.ctaText}
              ctaAction={() => handleTierAction(tier.tier)}
            />
          ))}
        </motion.div>

        {/* ── Feature comparison table ── */}
        <div className="mb-20 sm:mb-28">
          <FeatureComparison />
        </div>

        {/* ── FAQ ── */}
        <div className="mb-20 sm:mb-28">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.6, ease: EASE.emphasized }}
            className="text-center mb-10"
          >
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-white ds-font-display mb-3">
              Frequently asked <span className="text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">questions</span>
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base max-w-lg mx-auto">
              Can't find the answer? Reach us at{' '}
              <a href="mailto:bruno@bolalabs.pt" className="text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline">
                bruno@bolalabs.pt
              </a>
            </p>
          </motion.div>

          <div className="max-w-2xl mx-auto flex flex-col gap-3">
            {FAQS.map((faq, i) => (
              <FaqItem key={faq.q} index={i} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>

        {/* ── Bottom CTA banner ── */}
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.65, ease: EASE.emphasized }}
          className="relative overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-700"
        >
          <div className="relative rounded-3xl px-8 py-14 text-center bg-slate-900 dark:bg-slate-900 overflow-hidden">
            <div className="relative z-10">
              <h2 className="text-3xl sm:text-4xl font-bold text-white ds-font-display mb-4">
                Start for free,{' '}
                <span className="text-white font-semibold">upgrade when ready</span>
              </h2>
              <p className="text-slate-300 text-base max-w-md mx-auto mb-8 leading-relaxed">
                No credit card required. Move to Pro or Enterprise when your team needs more power.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => handleTierAction('Free')}
                  className="group px-8 py-3.5 rounded-xl font-semibold text-sm text-white
                    bg-[color:var(--ds-cta)] hover:bg-[color:var(--ds-cta-hover)]
                    shadow-md transition-colors duration-200 ds-focus-ring"
                >
                  <span className="flex items-center gap-2">
                    Get started free
                    <ArrowRight className="w-4 h-4 transition-transform duration-[var(--ds-duration)] group-hover:translate-x-1" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTierAction('Enterprise')}
                  className="px-8 py-3.5 rounded-xl font-semibold text-sm text-slate-200
                    border border-white/15 hover:border-white/30
                    hover:bg-white/[0.07]
                    transition-colors duration-200 ds-focus-ring"
                >
                  Talk to sales
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Roadmap footer link ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5, ease: EASE.emphasized }}
          className="mt-12 text-center"
        >
          <button
            type="button"
            onClick={() => typeof onGetStarted === 'function' && onGetStarted('roadmap')}
            className="inline-flex items-center gap-2 px-2 py-1 rounded text-sm font-medium text-indigo-500 dark:text-[color:var(--ds-accent-brand-dark)] hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors duration-200 ds-focus-ring"
          >
            See what&apos;s next on our Roadmap
            <ArrowRight className="w-4 h-4" />
          </button>
        </motion.div>

      </div>
    </div>
  )
}
