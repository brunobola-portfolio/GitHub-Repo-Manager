import { motion } from 'framer-motion'
import { Check, X } from 'lucide-react'

const TIERS = ['Free', 'Pro', 'Enterprise']

const CATEGORIES = [
  {
    name: 'Repository Management',
    rows: [
      {
        feature: 'Repositories',
        values: ['20', 'Unlimited', 'Unlimited'],
      },
      {
        feature: 'API keys',
        values: ['1', '5', '20'],
      },
      {
        feature: 'Bulk operations',
        values: [true, true, true],
      },
    ],
  },
  {
    name: 'AI Features',
    rows: [
      {
        feature: 'AI queries / month',
        values: ['50', '500', 'Unlimited'],
      },
      {
        feature: 'Semantic search',
        values: [false, true, true],
      },
      {
        feature: 'AI migration planner',
        values: [false, true, true],
      },
    ],
  },
  {
    name: 'Migration',
    rows: [
      {
        feature: 'Import from Git URLs',
        values: [true, true, true],
      },
      {
        feature: 'Azure DevOps migration',
        values: [false, 'Basic', 'Full'],
      },
      {
        feature: 'GitLab migration',
        values: [false, false, true],
      },
      {
        feature: 'TFVC → Git conversion',
        values: [false, false, true],
      },
    ],
  },
  {
    name: 'Teams',
    rows: [
      {
        feature: 'Team management',
        values: [false, '3 members', 'Unlimited'],
      },
      {
        feature: 'Role-based access control',
        values: [false, true, true],
      },
      {
        feature: 'Org-level policies',
        values: [false, false, true],
      },
    ],
  },
  {
    name: 'Security & Compliance',
    rows: [
      {
        feature: 'Audit log',
        values: [false, false, true],
      },
      {
        feature: 'Audit log export',
        values: [false, false, true],
      },
      {
        feature: 'SSO / SAML',
        values: [false, false, true],
      },
      {
        feature: 'Webhook signature verification',
        values: [false, true, true],
      },
    ],
  },
  {
    name: 'Support',
    rows: [
      {
        feature: 'Support level',
        values: ['Community', 'Email', 'Priority'],
      },
      {
        feature: 'SLA guarantee',
        values: [false, false, true],
      },
    ],
  },
]

function CellValue({ value, colIndex }) {
  if (typeof value === 'boolean') {
    return value ? (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/10 dark:bg-emerald-500/15">
        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
      </span>
    ) : (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 dark:bg-white/[0.04]">
        <X className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600" strokeWidth={2.5} />
      </span>
    )
  }
  const highlightCol = colIndex === 1 // Pro column = highlighted
  return (
    <span
      className={`text-sm font-semibold
        ${highlightCol
          ? 'text-indigo-600 dark:text-indigo-400'
          : 'text-slate-700 dark:text-slate-200'
        }`}
    >
      {value}
    </span>
  )
}

export function FeatureComparison() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="w-full"
    >
      <div className="text-center mb-10">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-white ds-font-display mb-3">
          Compare all <span className="ds-gradient-text">features</span>
        </h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base max-w-lg mx-auto">
          A full breakdown of what's included in each plan.
        </p>
      </div>

      {/* Horizontal scroll on mobile */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200/60 dark:border-white/[0.08]
        bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl shadow-xl shadow-slate-200/50 dark:shadow-black/30">

        <table className="w-full min-w-[600px] border-collapse">
          {/* Sticky header */}
          <thead>
            <tr className="border-b border-slate-200/60 dark:border-white/[0.08]">
              <th className="sticky top-0 left-0 z-20 w-1/2 px-6 py-5 text-left text-sm font-semibold text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
                Feature
              </th>
              {TIERS.map((tier, i) => (
                <th
                  key={tier}
                  className={`sticky top-0 z-10 w-1/6 px-4 py-5 text-center text-sm font-bold backdrop-blur-md
                    ${i === 1
                      ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/80 dark:bg-indigo-500/[0.08]'
                      : 'text-slate-700 dark:text-slate-200 bg-white/80 dark:bg-slate-900/80'
                    }`}
                >
                  {tier}
                  {i === 1 && (
                    <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500 text-white align-middle">
                      Popular
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {CATEGORIES.map((cat, catIdx) => (
              <>
                {/* Category header row */}
                <tr key={`cat-${catIdx}`} className="border-b border-slate-100 dark:border-white/[0.04]">
                  <td
                    colSpan={4}
                    className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 bg-slate-50/70 dark:bg-white/[0.02]"
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
              </>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
