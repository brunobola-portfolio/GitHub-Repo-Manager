/**
 * AI commands for the palette. Gated on the AI Assistant being enabled
 * (checked at the call site via useTrackedRepos().prefs.ai_assistant_enabled).
 */

const AI_COMMANDS = [
    {
        id: 'ai-cmd-open-edit',
        label: 'AI: Open conversational edit',
        searchValue: 'ai open edit conversational',
        actionType: 'ai-open-settings',
        icon: 'Sparkles',
    },
]

export function buildAICommands({ enabled }) {
    if (!enabled) return []
    return AI_COMMANDS
}
