import { motion } from 'framer-motion'
import { Map } from 'lucide-react'
import { RoadmapStage } from './RoadmapStage'

/* ─── Roadmap data ─── */
const STAGES = [
  {
    id: 'now',
    items: [
      { title: 'Azure DevOps Server (On-Premise)', tier: 'Enterprise' },
      { title: 'GitLab Migration Importer', tier: 'Pro + Enterprise' },
      { title: 'Advanced Analytics Dashboard', tier: 'Enterprise' },
      { title: 'Dependency Graph Visualizer', tier: 'Pro' },
      { title: 'CODEOWNERS Generator', tier: 'Free' },
      { title: 'Compare with Existing', description: 'Side-by-side diff before overwriting a repo', tier: 'Pro' },
      { title: 'Security & Secrets Scan', description: 'Detect exposed tokens and keys before migration', tier: 'Pro' },
      { title: 'README Enhance (AI diff)', description: 'AI-suggested improvements over your current README', tier: 'Pro' },
      { title: 'Batch Indexing', description: 'Index multiple repos in one operation for semantic search', tier: 'Pro' },
    ],
  },
  {
    id: 'next',
    items: [
      { title: 'Bitbucket Migration Importer', tier: 'Pro + Enterprise' },
      { title: 'SSO / SAML', description: 'Single sign-on via your identity provider', tier: 'Enterprise' },
      { title: 'Backup & Restore System', description: 'Scheduled snapshots with point-in-time restore', tier: 'Enterprise' },
      { title: 'Security Alerts Dashboard', description: 'Aggregated Dependabot and secret scanning alerts', tier: 'Pro' },
      { title: 'SBOM Export', description: 'Software Bill of Materials in SPDX / CycloneDX format', tier: 'Enterprise' },
      { title: 'Release Notes Generator', description: 'AI-generated changelogs from commit history', tier: 'Pro' },
    ],
  },
  {
    id: 'later',
    items: [
      { title: 'GitHub Enterprise Server', description: 'Self-hosted GitHub Enterprise support', tier: 'Enterprise' },
      { title: 'Plugin / Extension System', description: 'Third-party integrations via a public plugin API', tier: 'Pro' },
      { title: 'Mobile App (React Native)', description: 'iOS and Android companion app', tier: 'All' },
      { title: 'Custom AI Model Selection', description: 'Bring your own OpenAI / Anthropic key', tier: 'Pro + Enterprise' },
      { title: 'Org Permissions Sync', description: 'Mirror team memberships across orgs automatically', tier: 'Enterprise' },
      { title: 'Dependabot Aggregation', description: 'Unified view of all dependency alerts across repos', tier: 'Pro' },
      { title: 'Custom Workflow Templates', description: 'Reusable GitHub Actions templates per org', tier: 'Pro' },
    ],
  },
]

export function RoadmapPage({ onNavigatePricing } = {}) {
  return (
    <div data-testid="roadmap-page" className="relative min-h-screen overflow-x-hidden">

      {/* Background orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute rounded-full blur-3xl bg-emerald-500 opacity-[0.07] dark:opacity-[0.10]"
          style={{ width: 500, height: 500, left: '-8%', top: '-5%' }}
          animate={{ y: [0, -25, 0], x: [0, 15, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full blur-3xl bg-blue-500 opacity-[0.07] dark:opacity-[0.10]"
          style={{ width: 400, height: 400, right: '-6%', top: '15%' }}
          animate={{ y: [0, 25, 0], x: [0, -15, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
        />
        <div
          className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04]"
          style={{
            backgroundImage: 'linear-gradient(rgba(16,185,129,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">

        {/* ── Hero ── */}
        <div className="text-center mb-14 sm:mb-20">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-7
              bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/20"
          >
            <Map className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 tracking-wide">
              Public Roadmap
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight ds-font-display mb-5"
          >
            <span className="text-slate-800 dark:text-white">What we&apos;re</span>{' '}
            <span className="ds-gradient-text">building next</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="text-slate-500 dark:text-slate-400 text-lg max-w-xl mx-auto leading-relaxed"
          >
            Our public roadmap. Everything here is planned — nothing is promised.
            We ship features when they&apos;re genuinely ready.
          </motion.p>
        </div>

        {/* ── Three-column stage grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-16 sm:mb-24">
          {STAGES.map((stage, i) => (
            <RoadmapStage
              key={stage.id}
              stage={stage.id}
              items={stage.items}
              index={i}
            />
          ))}
        </div>

        {/* ── Pricing footer link ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="text-center"
        >
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            Ready to get started with what&apos;s available today?
          </p>
          {onNavigatePricing && (
            <button
              onClick={onNavigatePricing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm
                bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400
                border border-indigo-500/20 hover:border-indigo-500/40
                hover:bg-indigo-500/15 dark:hover:bg-indigo-500/20
                transition-all duration-200"
            >
              View Pricing
            </button>
          )}
        </motion.div>

      </div>
    </div>
  )
}
