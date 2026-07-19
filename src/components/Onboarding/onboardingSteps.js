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
        title: 'Add your AI key in Settings → AI',
        body: 'Power semantic search, README enhance, commit AI, and topic suggestions with your own AI provider key (Gemini, Anthropic, OpenAI, OpenRouter, or local). Free tier works without it but most AI features need a key.',
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
        title: 'New: README Studio, diagrams, Agent Rules & Security Posture',
        body: "From a repo's Overview tab: generate a polished README, an architecture diagram, or AGENTS.md/CLAUDE.md rules. Right-click a repo for a Security Posture scan.",
    },
]
