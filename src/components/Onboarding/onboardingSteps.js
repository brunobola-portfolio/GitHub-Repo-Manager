import { Search, Sparkles, Layers, Rocket } from 'lucide-react'

export const ONBOARDING_STEPS = [
    {
        id: 'cmdk',
        icon: Search,
        title: 'Press Ctrl+K (⌘K on Mac) from anywhere',
        body: 'The command palette finds repos, opens settings, and runs AI searches. Try it now or later.',
    },
    {
        id: 'ai-config',
        icon: Sparkles,
        title: 'Connect your AI provider',
        body: 'Add your own key below to power Deep Review, semantic search, README enhance, and commit AI. Free tier works without it, but most AI features need a key — you can always finish this later in Settings → AI Configuration.',
        // Renders <ProviderKeyForm /> inline beneath the body text (see
        // OnboardingTour.jsx) instead of just describing where to find it.
        hasForm: true,
    },
    {
        id: 'work-board',
        icon: Layers,
        title: 'Cross-repo Work Board',
        body: 'One inbox for all your reviews, stale PRs, and DORA metrics across every repo you track. Open from the sidebar.',
    },
    {
        id: 'launch-features',
        icon: Rocket,
        title: 'README Studio, diagrams, Agent Rules & Security Posture',
        body: "From a repo's Overview tab: generate a polished README, an architecture diagram, or AGENTS.md/CLAUDE.md rules. Right-click a repo for a Security Posture scan.",
    },
]
