import { motion } from 'framer-motion'
import { Map } from 'lucide-react'
import { RoadmapStage } from './RoadmapStage'

/* ─── Roadmap data ─── */
const STAGES = [
  {
    id: 'now',
    items: [
      { title: 'Security & Secrets Scan', description: 'Aggregates GitHub Dependabot + secret scanning alerts', tier: 'Pro' },
    ],
  },
  {
    id: 'next',
    items: [
      { title: 'Pierre diff + tree primitives', description: 'Adopt @pierre/diffs (Apache-2.0, AGPL-compatible) as the canonical PR / commit diff renderer; @pierre/trees as the repo file-tree primitive', tier: 'All' },
      { title: 'Vercel AI Elements migration', description: 'Port AI Assistant, AI Issue Planner and the Dashboard AI narrative onto Vercel’s shadcn-shaped AI Elements (streaming, reasoning, tool calls)', tier: 'Pro' },
      { title: 'Premium Dashboard Phase 2 (DORA)', description: 'KPI cards + area charts on Tremor primitives, with sparklines, delta badges and CSV export', tier: 'Enterprise' },
      { title: 'Cross-repo Command Palette (⌘K v2)', description: 'Cross-repo jump, recent-PR / issue search, AI-driven action quick-fire', tier: 'All' },
      { title: 'Azure DevOps Server (On-Premise)', description: 'PAT + URL adaptation for self-hosted Azure DevOps', tier: 'Enterprise' },
      { title: 'GitLab Migration Importer', description: 'Clone GitLab repos with history + issues (best-effort)', tier: 'Pro + Enterprise' },
      { title: 'Bitbucket Migration Importer', tier: 'Pro + Enterprise' },
      { title: 'Advanced Analytics Dashboard', description: 'Commit heatmaps, contributor insights, dependency graph', tier: 'Enterprise' },
      { title: 'Dependency Graph Visualizer', description: 'Interactive graph of repo dependencies (SBOM-derived)', tier: 'Pro' },
      { title: 'SSO / SAML', description: 'Single sign-on via your identity provider (Okta, Entra ID, SAML 2.0)', tier: 'Enterprise' },
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
      { title: 'Org Permissions Sync', description: 'Mirror team memberships across orgs automatically', tier: 'Enterprise' },
      { title: 'Dependabot Aggregation', description: 'Unified view of all dependency alerts across repos', tier: 'Pro' },
      { title: 'Custom Workflow Templates', description: 'Reusable GitHub Actions templates per org', tier: 'Pro' },
    ],
  },
  {
    id: 'shipped',
    items: [
      { title: 'Premium non-LLM theme', description: 'GitHub-tasteful aesthetic across modals, toasts, banners, empty/error states — no rainbow gradients, no glow shadows, no shimmer', tier: 'All' },
      { title: 'Mobile peek FAB', description: 'Quick-actions trigger translated 55 % off-screen with breathing halo + edge stripe; reveals on hover/focus/touch with spring physics', tier: 'All' },
      { title: 'Hash deep-linking', description: 'Bidirectional sync between activeView and #/repos / #/work / #/teams / #/roadmap / #/pricing / #/ai/prompts — shareable URLs + browser back/forward', tier: 'All' },
      { title: 'Premium scrollbar', description: 'Transparent-by-default overlay on desktop (slate-400/50 on hover), fully hidden on mobile via (pointer: coarse)', tier: 'All' },
      { title: 'Lazy-loaded surfaces', description: 'RepoDetail tabs, WorkBoard tabs, SettingsModal sections, MigrationWizard late steps — ~91 KB gzip deferred from first paint', tier: 'All' },
      { title: 'BYOK multi-provider AI', description: 'Gemini, Anthropic, OpenAI, OpenRouter, LMStudio — per-user key config, AES-256-GCM encryption at rest', tier: 'All' },
      { title: 'Custom AI Model Selection', description: 'Choose provider + model per feature via Settings → AI Configuration (covered by BYOK)', tier: 'Pro + Enterprise' },
      { title: 'README Enhance (AI diff)', description: 'AI-suggested improvements over your current README', tier: 'Pro' },
      { title: 'Batch Indexing', description: 'Bulk AI indexing with progress modal', tier: 'Pro' },
      { title: 'Cross-Repo Work Board', description: 'My Reviews, Stale PRs, My Issues, Review Load, Tech Debt, DORA (deploy freq, lead time p50/p90, CFR, MTTR, CSV export)', tier: 'All' },
      { title: 'AI Issue-to-PR Planner', description: 'Plan-only mode — structured plan (approach, files, tests, risks, estimate) for any open issue', tier: 'Pro' },
      { title: 'Command Palette live GitHub search', description: 'PRs, issues, repos via the GitHub Search API with debounce + rate-limit awareness', tier: 'All' },
      { title: 'PR Review write-back tier gating', description: 'Free tier is strictly read-only; Pro+ required for approve / request-changes / comment / merge', tier: 'Pro + Enterprise' },
      { title: 'GitHub event ingestion pipeline', description: 'Real-time PR, issue and deployment webhook ingestion into the Work Board', tier: 'All' },
      { title: 'SOC 2 code hardening', description: 'Append-only audit log with SHA-256 hash chain, self-service data erasure, startup secrets check, retention pass', tier: 'Enterprise' },
      { title: 'Stripe billing + license key delivery', description: 'Ed25519-signed JWT license keys issued on checkout completion', tier: 'Pro + Enterprise' },
      { title: 'CODEOWNERS Parser + Generator', description: 'Parse existing CODEOWNERS OR suggest rules from recent commit authorship (hotspots + per-path owners + copy-to-clipboard preview)', tier: 'Free' },
      { title: 'Compare with Existing — side-by-side diff', description: 'From the Similar Repositories drawer, open a side-by-side README / package.json diff against any similar repo', tier: 'Pro' },
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
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight ds-font-display mb-5"
          >
            <span className="text-slate-800 dark:text-white">What we&apos;re</span>{' '}
            <span className="text-slate-800 dark:text-white font-semibold">building next</span>
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

        {/* ── Stage grid (Now / Next / Later) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-16">
          {STAGES.filter(s => s.id !== 'shipped').map((stage, i) => (
            <RoadmapStage
              key={stage.id}
              stage={stage.id}
              items={stage.items}
              index={i}
            />
          ))}
        </div>

        {/* ── Recently Shipped — full-width section ── */}
        {STAGES.filter(s => s.id === 'shipped').map((stage, i) => (
          <div key={stage.id} className="mb-16 sm:mb-24">
            <RoadmapStage
              stage={stage.id}
              items={stage.items}
              index={i}
            />
          </div>
        ))}

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
                bg-indigo-500/10 dark:bg-indigo-500/15 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]
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
