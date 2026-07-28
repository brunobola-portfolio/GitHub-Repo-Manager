import React, { useRef } from 'react'
import { motion } from 'framer-motion'
import { EASE } from '../ui/motion'
import { Check, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { useStickyHeaderShadow } from '../../hooks/useStickyHeaderShadow'
import { useBelowBreakpoint } from '../../hooks/useMediaQuery'

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
        feature: 'Repo Insights / Quality Report',
        values: ['75 / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'README Generator (AI)',
        values: ['25 / month', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'README Studio (AI improve)',
        values: ['25 / month', 'Unlimited', 'Unlimited'],
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
        feature: 'DORA metrics (deploy frequency, lead time, change failure rate, MTTR)',
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
        values: ['Community', 'Email', 'Priority + SLA'],
      },
      // Priority Support + SLA and White-glove migration services are manual,
      // service-based deliverables (support ticket + contract) — they have no
      // getFeatures() key to compare against, unlike every other row above.
      // See tests/pricing-feature-parity.test.js for the explicit exemption.
      {
        feature: 'Priority Support + SLA',
        values: [false, false, true],
      },
      {
        feature: 'White-glove migration services',
        values: [false, false, true],
      },
    ],
  },
]

function CellValue({ value, colIndex, compact = false }) {
  if (typeof value === 'boolean') {
    return value ? (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/10 dark:bg-emerald-500/15">
        <Check className="w-3.5 h-3.5 ds-text-success" strokeWidth={2.5} aria-label="Included" />
      </span>
    ) : (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 dark:bg-white/[0.04]">
        <X className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600" strokeWidth={2.5} aria-label="Not included" />
      </span>
    )
  }
  const highlightCol = colIndex === 1 // Pro column = highlighted
  return (
    <span
      className={`font-semibold ${compact ? 'ds-text-meta break-words' : 'text-sm'}
        ${highlightCol
          ? 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]'
          : 'text-slate-700 dark:text-slate-200'
        }`}
    >
      {value}
    </span>
  )
}

/**
 * Sub-`sm` layout: one block per feature with all three tier values labelled
 * inline.
 *
 * The desktop table is `min-w-[600px]` inside an `overflow-x-auto` Card. At
 * 375px that container measures 310px, so Free starts at x=327 — every plan
 * value sat entirely off-screen behind a hard vertical crop, with no edge fade,
 * no scroll hint and no visible scrollbar. On the pricing page, on a phone.
 * Horizontal scroll is the wrong primitive for a 4-column matrix at that width;
 * stacking is, so the two layouts are mutually exclusive (rendered by
 * `useBelowBreakpoint`, not `sm:hidden`) — a CSS-only swap would duplicate all
 * ~30 rows in the DOM and in the accessibility tree.
 */
function StackedComparison() {
  return (
    <div className="space-y-4" data-testid="feature-comparison-stacked">
      {CATEGORIES.map((cat) => (
        <section
          key={cat.name}
          className="rounded-2xl border border-[color:var(--ds-elevation-border)] bg-white dark:bg-slate-900 shadow-[var(--ds-shadow-sm)] overflow-hidden"
          aria-labelledby={`cmp-${cat.name.replace(/\W+/g, '-')}`}
        >
          <h3
            id={`cmp-${cat.name.replace(/\W+/g, '-')}`}
            className="px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-100 dark:border-white/[0.06]"
          >
            {cat.name}
          </h3>
          <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
            {cat.rows.map((row) => (
              <li key={row.feature} className="px-4 py-3">
                <p className="text-sm text-slate-700 dark:text-slate-200 mb-2 break-words">
                  {row.feature}
                </p>
                <dl className="grid grid-cols-3 gap-1.5">
                  {row.values.map((val, colIdx) => (
                    <div
                      key={colIdx}
                      className={`rounded-lg px-1.5 py-1.5 text-center min-w-0 ${colIdx === 1
                        ? 'bg-indigo-50 dark:bg-indigo-500/[0.10]'
                        : 'bg-slate-50 dark:bg-white/[0.03]'
                      }`}
                    >
                      <dt className="ds-text-micro font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {TIERS[colIdx]}
                      </dt>
                      <dd className="mt-1 leading-tight">
                        <CellValue value={val} colIndex={colIdx} compact />
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function FeatureComparison() {
  const tableScrollRef = useRef(null)
  const elevated = useStickyHeaderShadow(tableScrollRef)
  const isPhone = useBelowBreakpoint('sm')

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: EASE.emphasized }}
      className="w-full"
    >
      <div className="text-center mb-10">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-white ds-font-display mb-3">
          Compare all <span className="text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">features</span>
        </h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base max-w-lg mx-auto">
          A full breakdown of what's included in each plan.
        </p>
      </div>

      {isPhone ? <StackedComparison /> : (
      <Card className="overflow-x-auto">
        <div
          ref={tableScrollRef}
          className="overflow-y-auto max-h-[560px]"
        >
        <table className="w-full min-w-[600px] border-collapse">
          {/* Sticky header */}
          <thead className={`transition-shadow${elevated ? ' shadow-[0_1px_4px_0_rgba(0,0,0,0.08)]' : ''}`}>
            <tr className="border-b border-slate-200/60 dark:border-white/[0.08]">
              <th className="sticky top-0 left-0 z-20 w-1/2 px-6 py-5 text-left text-sm font-semibold text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
                Feature
              </th>
              {TIERS.map((tier, i) => (
                <th
                  key={tier}
                  className={`sticky top-0 z-10 w-1/6 px-4 py-5 text-center text-sm font-bold backdrop-blur-md
                    ${i === 1
                      ? 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] bg-indigo-50/80 dark:bg-indigo-500/[0.08]'
                      : 'text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-slate-900/80'
                    }`}
                >
                  {tier}
                  {i === 1 && (
                    /* --ds-badge-brand-*, not bg-indigo-500: white on
                       indigo-500 measured 4.58:1 here, and indigo-500 is the
                       exact fill the badge pair exists to keep off text. */
                    <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded ds-text-micro font-bold bg-[color:var(--ds-badge-brand-fill)] text-[color:var(--ds-badge-brand-text)] align-middle">
                      Popular
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {CATEGORIES.map((cat, catIdx) => (
              <React.Fragment key={catIdx}>
                {/* Category header row */}
                <tr className="border-b border-slate-100 dark:border-white/[0.04]">
                  <td
                    colSpan={4}
                    className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-white/[0.02]"
                  >
                    {cat.name}
                  </td>
                </tr>

                {/* Feature rows */}
                {cat.rows.map((row, rowIdx) => {
                  const isLast = rowIdx === cat.rows.length - 1
                  return (
                    <tr
                      key={`${catIdx}-${rowIdx}`}
                      className={`group transition-colors duration-150 hover:bg-slate-50/60 dark:hover:bg-white/[0.03]
                        ${!isLast ? 'border-b border-slate-100/70 dark:border-white/[0.04]' : ''}`}
                    >
                      <td className="px-6 py-3.5 text-sm text-slate-600 dark:text-slate-300">
                        {row.feature}
                      </td>
                      {row.values.map((val, colIdx) => (
                        <td
                          key={colIdx}
                          className={`px-4 py-3.5 text-center
                            ${colIdx === 1 ? 'bg-indigo-50/40 dark:bg-indigo-500/[0.05]' : ''}`}
                        >
                          <CellValue value={val} colIndex={colIdx} />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
      )}

      {/* Per-individual AI-quota disclaimer — Teams are unlimited-seat on every
          tier, but AI usage (queries, Deep Review, PR Chat, etc.) is metered
          against each person's own account/subscription, not pooled per team. */}
      <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
        Teams are unlimited on every plan. AI usage quotas above are metered per individual account, even within a team.
      </p>
      {/* "Repo Advisor" names two surfaces. This row is the floating
          conversational assistant (POST /api/ai/chat), which no deployment
          flag gates; only the Work Board's Repo Advisor card sits behind
          WORK_BOARD_AI_ENABLED. The earlier wording here was copied from the
          README, which had the same conflation, and sent self-hosters looking
          for a switch they never needed. */}
      <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
        &dagger; The conversational Repo Advisor works out of the box — a BYOK key is all it
        needs. The separate Repo Advisor card inside the Work Board is operator-enabled:
        self-hosted deployments need{' '}
        <code className="font-mono">WORK_BOARD_AI_ENABLED=true</code> plus a per-user opt-in.
      </p>
    </motion.div>
  )
}
