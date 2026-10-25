import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Minus, Search } from 'lucide-react'
import { EASE, DURATION } from '../ui/motion'
import { TabBar } from '../ui/TabBar'
import { Input } from '../ui/form'

const TIERS = ['Free', 'Pro', 'Enterprise']

const CATEGORIES = [
  {
    name: 'Repository Management',
    rows: [
      {
        feature: 'Repositories managed',
        values: ['Unlimited', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'API keys',
        values: ['25', '50', '100'],
      },
      {
        feature: 'Basic bulk on own repos',
        values: [true, true, true],
      },
      {
        feature: 'Advanced bulk (transfer, mirror, cross-org)',
        values: [true, true, true],
      },
      {
        feature: 'Sync Repository (mirror sync)',
        values: ['10 / month', 'Unlimited', 'Unlimited'],
      },
    ],
  },
  {
    name: 'AI Features',
    rows: [
      {
        feature: 'Repo Advisor (conversational)†',
        values: [true, true, true],
      },
      {
        feature: 'AI queries / month (total)',
        values: ['1,000', '10,000', 'Unlimited'],
      },
      {
        feature: 'Semantic Search',
        values: ['375 / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'Migration Risk Analysis (AI)',
        values: ['25 / month', 'Unlimited', 'Unlimited'],
      },
      {
        // Enforced at ai/migration.js:360,410 since it shipped, and advertised
        // nowhere until now — a Free user met "AI limit reached (25/25)" for a
        // feature no pricing surface had ever named.
        feature: 'Migration Assistant (AI)',
        values: ['25 / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'Repo Insights / Quality Report',
        values: ['75 / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'README Generator (AI)',
        values: ['25 / month, shared with Studio', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'README Studio (AI improve)',
        values: ['Shares the 25 / month above', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'Commit Generator (AI)',
        values: ['250 / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'AI Deep Review (walkthrough + comments + publish)',
        values: ['10 / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'Prompt Studio (custom presets + test runs)',
        values: ['10 presets · 30 tests / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'PR Chat (streaming Q&A)',
        values: ['100 messages / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'PR slash commands (/describe, /test_plan, /improve)',
        values: ['30 / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'AI Diagram Generator',
        values: ['15 / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'Agent Rules Generator (AGENTS.md / CLAUDE.md)',
        values: ['20 / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'Security Posture AI Summary',
        values: ['75 / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'AI Image Generation (social / hero / logo)',
        values: ['5 / month', 'Unlimited', 'Unlimited'],
      },
    ],
  },
  {
    name: 'Migration',
    rows: [
      {
        feature: 'Dry-Run migration (simulate)',
        values: [true, true, true],
      },
      {
        feature: 'Export Metadata (JSON)',
        values: [true, true, true],
      },
      {
        feature: 'Azure DevOps Cloud migration',
        values: ['5 / month', 'Unlimited', 'Unlimited'],
      },
    ],
  },
  {
    name: 'Community & Insights',
    rows: [
      {
        feature: 'Community Health Dashboard',
        values: [true, true, true],
      },
      {
        feature: 'Basic Search & Filters',
        values: [true, true, true],
      },
      {
        feature: 'PR Review Experience',
        values: ['Full + write-back', 'Full + write-back', 'Full + write-back'],
      },
      {
        feature: 'DORA metrics (deployment frequency, change lead time, change fail rate, recovery time)',
        values: [true, true, true],
      },
    ],
  },
  {
    name: 'Teams',
    rows: [
      {
        feature: 'Team collaboration',
        values: ['Unlimited', 'Unlimited', 'Unlimited'],
      },
    ],
  },
  {
    name: 'Security & Compliance',
    rows: [
      {
        feature: 'Audit Logs',
        values: [false, false, true],
      },
      {
        feature: 'SSO / SAML',
        values: [false, false, 'Roadmap'],
      },
    ],
  },
  {
    name: 'Support & Services',
    rows: [
      {
        feature: 'Support level',
        values: ['Community', 'Email', 'Priority'],
      },
      // Priority support and White-glove migration services are manual,
      // service-based deliverables (support ticket + contract) — they have no
      // getFeatures() key to compare against, unlike every other row above.
      // See tests/pricing-feature-parity.test.js for the explicit exemption.
      // Neither carries a response-time SLA — "Priority" means the ticket is
      // triaged ahead of Community/Email queue, not a contracted time bound.
      {
        feature: 'Priority support',
        values: [false, false, true],
      },
      {
        feature: 'White-glove migration services',
        values: [false, false, true],
      },
    ],
  },
]


const PLAN_TABS = TIERS.map((tier, i) => ({
  id: tier.toLowerCase(),
  label: tier,
  badge: i === 1 ? (
    /* --ds-badge-brand-*, not bg-brand-500: white on brand-500 measured
       4.58:1, and brand-500 is the fill the badge pair keeps off text. */
    <span className="ml-1 px-1.5 py-0.5 rounded ds-text-micro font-bold bg-[color:var(--ds-badge-brand-fill)] text-[color:var(--ds-badge-brand-text)]">
      Popular
    </span>
  ) : null,
}))

const sameOnEveryPlan = (row) => row.values.every((v) => v === row.values[0])

/** Plain words for a cell, so a value reads the same in a sentence and in a hint. */
function describe(value) {
  if (value === true) return 'Included'
  if (value === false) return 'Not included'
  return value
}

// Split once: most of the product is identical on every plan, and showing it
// as three equal columns hid the handful of rows that actually differ.
const EVERY_PLAN = CATEGORIES.flatMap((cat) => cat.rows.filter((row) => sameOnEveryPlan(row) && row.values[0] !== false))
const BY_PLAN = CATEGORIES
  .map((cat) => ({ name: cat.name, rows: cat.rows.filter((row) => !sameOnEveryPlan(row)) }))
  .filter((cat) => cat.rows.length > 0)

function matches(row, query) {
  return !query || row.feature.toLowerCase().includes(query)
}

function PlanValue({ row, planIndex }) {
  const value = row.values[planIndex]
  // The comparison a reader is making: on a paid plan, what Free gives; on
  // Free, what the first upgrade gives.
  const refIndex = planIndex === 0 ? 1 : 0
  const ref = row.values[refIndex]
  const hint = ref !== value ? `${TIERS[refIndex]}: ${describe(ref)}` : null
  return (
    <div className="text-right shrink-0 max-w-[55%]">
      <p className={`text-sm font-semibold inline-flex items-center gap-1.5 justify-end ${
        value === false
          ? 'text-slate-500 dark:text-slate-400'
          : planIndex === 0
            ? 'text-slate-800 dark:text-slate-100'
            : 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]'
      }`}>
        {value === true && <Check className="w-4 h-4 ds-text-success" strokeWidth={2.5} aria-hidden="true" />}
        {value === false && <Minus className="w-4 h-4" aria-hidden="true" />}
        {describe(value)}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  )
}

export function FeatureComparison() {
  const [plan, setPlan] = useState('pro')
  const [rawQuery, setRawQuery] = useState('')
  const query = rawQuery.trim().toLowerCase()
  const planIndex = TIERS.findIndex((t) => t.toLowerCase() === plan)

  const everyPlan = useMemo(() => EVERY_PLAN.filter((row) => matches(row, query)), [query])
  const byPlan = useMemo(
    () => BY_PLAN.map((cat) => ({ ...cat, rows: cat.rows.filter((row) => matches(row, query)) })).filter((cat) => cat.rows.length),
    [query],
  )
  const nothing = everyPlan.length === 0 && byPlan.length === 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: DURATION.ambient, ease: EASE.emphasized }}
      className="w-full max-w-4xl mx-auto"
    >
      <div className="mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-white ds-font-display mb-3">
          Compare plans
        </h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base max-w-2xl">
          Most of the product is the same on every plan. Pick a plan to see what changes.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <TabBar
          tabs={PLAN_TABS}
          activeTab={plan}
          onTabChange={setPlan}
          layoutId="plan-compare"
          ariaLabel="Plan to show"
          className="self-start"
        />
        <div className="sm:ml-auto sm:w-64">
          <Input
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Find a feature"
            aria-label="Find a feature"
            leadingIcon={Search}
            size="sm"
          />
        </div>
      </div>

      {nothing ? (
        <div className="rounded-2xl border border-[color:var(--ds-elevation-border)] bg-white dark:bg-slate-900 px-6 py-10 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-300">No feature matches “{rawQuery.trim()}”.</p>
          <button
            type="button"
            onClick={() => setRawQuery('')}
            className="mt-3 text-sm font-semibold text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline ds-focus-ring rounded"
          >
            Clear the search
          </button>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr] items-start">
          {byPlan.length > 0 && (
            <section
              role="tabpanel"
              id={`tabpanel-plan-compare-${plan}`}
              aria-labelledby={`tab-plan-compare-${plan}`}
              className="rounded-2xl border border-[color:var(--ds-elevation-border)] bg-white dark:bg-slate-900 p-5 sm:p-6"
            >
              <h3 className="text-base font-semibold text-slate-800 dark:text-white">
                {planIndex === 0 ? 'Limits on Free' : `What ${TIERS[planIndex]} adds`}
              </h3>
              {(() => {
                const rows = byPlan.flatMap((cat) => cat.rows)
                // On a paid plan most differences are the same answer, "no cap";
                // one block of them reads faster than a column repeating it.
                const lifted = planIndex > 0
                  ? rows.filter((row) => row.values[planIndex] === 'Unlimited')
                  : rows.filter((row) => row.values[1] === 'Unlimited' && row.values[0] !== false)
                const missing = rows.filter((row) => row.values[planIndex] === false)
                const rest = rows.filter((row) => !lifted.includes(row) && !missing.includes(row))
                const higher = TIERS.findIndex((_, i) => i > planIndex && missing.some((row) => row.values[i] !== false))
                return (
                  <>
                    {rest.length > 0 && (
                      <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/[0.06]">
                        {rest.map((row) => (
                          <li key={row.feature} className="flex items-start justify-between gap-4 py-2.5">
                            <span className="text-sm text-slate-700 dark:text-slate-200 min-w-0 break-words">{row.feature}</span>
                            <PlanValue row={row} planIndex={planIndex} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {lifted.length > 0 && (
                      <div className="mt-4 rounded-xl bg-brand-50/60 dark:bg-brand-500/[0.07] p-4">
                        <h4 className="text-sm font-semibold text-slate-800 dark:text-white">
                          {planIndex > 0 ? `Unlimited on ${TIERS[planIndex]}` : 'Monthly caps on Free'}
                        </h4>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {planIndex > 0 ? 'The Free limit is shown under each one.' : 'Each one is unlimited on Pro.'}
                        </p>
                        <ul className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                          {lifted.map((row) => (
                            <li key={row.feature} className="min-w-0">
                              <p className="text-sm text-slate-700 dark:text-slate-200 break-words">{row.feature}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">{planIndex > 0 ? `Free: ${describe(row.values[0])}` : describe(row.values[0])}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {missing.length > 0 && (
                      <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                        Not on {TIERS[planIndex]}: {missing.map((row) => row.feature).join(', ')}.
                        {higher > -1 && (
                          <>
                            {' '}
                            <button
                              type="button"
                              onClick={() => setPlan(TIERS[higher].toLowerCase())}
                              className="font-semibold text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline ds-focus-ring rounded"
                            >
                              See {TIERS[higher]}
                            </button>
                          </>
                        )}
                      </p>
                    )}
                  </>
                )
              })()}
            </section>
          )}

          {everyPlan.length > 0 && (
            <section
              aria-labelledby="cmp-every-plan"
              className="rounded-2xl border border-[color:var(--ds-elevation-border)] bg-white dark:bg-slate-900 p-5 sm:p-6"
            >
              <h3 id="cmp-every-plan" className="text-base font-semibold text-slate-800 dark:text-white">
                On every plan, Free included
              </h3>
              <ul className="mt-4 space-y-2.5">
                {everyPlan.map((row) => (
                  <li key={row.feature} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200">
                    <Check className="w-4 h-4 mt-0.5 shrink-0 ds-text-success" strokeWidth={2.5} aria-hidden="true" />
                    <span className="min-w-0">
                      {row.feature}
                      {typeof row.values[0] === 'string' && (
                        <span className="text-slate-500 dark:text-slate-400"> · {row.values[0]}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* AI usage is metered per person even inside a team; teams themselves
          are unlimited on every plan. */}
      <p className="mt-5 text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
        Teams are unlimited on every plan. AI quotas are metered per individual account, even within a team.
      </p>
      {/* "Repo Advisor" names two surfaces: the conversational assistant (no
          deployment flag) and the Work Board card behind WORK_BOARD_AI_ENABLED. */}
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
        &dagger; The conversational Repo Advisor works out of the box — a BYOK key is all it
        needs. The separate Repo Advisor card inside the Work Board is operator-enabled:
        self-hosted deployments need{' '}
        <code className="font-mono">WORK_BOARD_AI_ENABLED=true</code> plus a per-user opt-in.
      </p>
    </motion.div>
  )
}
