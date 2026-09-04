import { useWorkBoardAI } from '../../../../hooks/useWorkBoardAI'
import { useTrackedRepos } from '../../../../hooks/useTrackedRepos'
import { useToast } from '../../../../hooks/useToast'
import { AIAssistantToggle } from './AIAssistantToggle'
import { AIActivityCard } from './AIActivityCard'
import { SuggestionsPanel } from './SuggestionsPanel'
import { ConversationalEdit } from './ConversationalEdit'
import { WorkBoardCapReachedBanner } from './WorkBoardCapReachedBanner'

export function WorkBoardAISection() {
    const ai = useWorkBoardAI()
    const { prefs, bulkUpdate, undo } = useTrackedRepos()
    const { toast } = useToast()

    const aiEnabled = prefs?.ai_assistant_enabled === 1 && ai.enabled

    const handleApplySuggestion = async (s) => {
        // MVP: apply as bulkUpdate mute of all repos in the suggestion (works for both BotPrefix and StaleNoActivity)
        try {
            const result = await bulkUpdate(s.repos, 'mute')
            if (result?.operation_id) {
                toast.success(`Applied: ${result.updated} repos muted`, {
                    action: 'Undo',
                    onAction: async () => {
                        await undo(result.operation_id)
                        toast.success('Reverted')
                    },
                })
            }
            await ai.reload()
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Apply failed' })
        }
    }

    const handleDismissSuggestion = async (pattern_key, dismissKey) => {
        try {
            await ai.dismiss(pattern_key, dismissKey)
            toast.success('Suggestion dismissed')
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Dismiss failed' })
        }
    }

    const handleApplyDiff = async (validity_token) => {
        try {
            const result = await ai.apply(validity_token)
            if (result.operation_id) {
                toast.success(`Applied: ${result.applied} actions`, {
                    action: 'Undo',
                    onAction: async () => {
                        await undo(result.operation_id)
                        toast.success('Reverted')
                    },
                })
            }
            return result
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Could not apply the suggestion' })
            throw e
        }
    }

    const capReached = ai.reason === 'AI_COST_CAP_REACHED'

    return (
        <div className="space-y-3">
            <AIAssistantToggle />
            {capReached && (
                <WorkBoardCapReachedBanner
                    spentCents={ai.activity?.spent_cents}
                    capCents={ai.activity?.cap_cents}
                />
            )}
            {aiEnabled && !capReached && (
                <>
                    <AIActivityCard activity={ai.activity} />
                    <SuggestionsPanel
                        suggestions={ai.suggestions}
                        onApply={handleApplySuggestion}
                        onDismiss={handleDismissSuggestion}
                    />
                    <ConversationalEdit
                        onInterpret={ai.interpret}
                        onApply={handleApplyDiff}
                    />
                </>
            )}
        </div>
    )
}
