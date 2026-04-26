import { Search, Sparkles, Layers } from 'lucide-react'

export const ONBOARDING_STEPS = [
    {
        id: 'cmdk',
        icon: Search,
        title: 'Press Cmd+K from anywhere',
        body: 'The command palette finds repos, opens settings, and runs AI searches. Try it now or later.',
        gradient: 'from-indigo-500 to-purple-600',
    },
    {
        id: 'ai-config',
        icon: Sparkles,
        title: 'Add your AI key in Settings → AI',
        body: 'Power semantic search, README enhance, commit AI, and topic suggestions with your own Gemini key. Free tier works without it but most AI features need a key.',
        gradient: 'from-amber-500 to-rose-500',
    },
    {
        id: 'work-board',
        icon: Layers,
        title: 'Cross-repo Work Board',
        body: 'One inbox for all your reviews, stale PRs, and DORA metrics across every repo you track. Open from the sidebar.',
        gradient: 'from-emerald-500 to-cyan-500',
    },
]
