import { Sparkles, Wand2 } from 'lucide-react'
import { Button } from './Button'
import { Spinner } from './Spinner'
import { useAIStatus } from '../../hooks/useAIStatus'

/**
 * AI-aware action button used by every "Run with AI" surface.
 *
 * Adapts label and tone to the user's AI configuration:
 *   - configured + ready          → "Run with AI" (indigo gradient)
 *   - not configured              → "<heuristicLabel>" with tooltip pointing
 *                                   the user at the Settings → AI Configuration tab. The
 *                                   button stays clickable when a heuristic
 *                                   fallback exists (`heuristicAvailable`),
 *                                   otherwise it's disabled.
 *   - configured + key invalid    → label unchanged, tooltip explains the
 *                                   provider key is failing auth probes.
 *
 * Props:
 *   onClick                - handler.
 *   loading                - boolean; show spinner inside the button.
 *   disabled               - extra disabled state (e.g. quota gating).
 *   label                  - text shown when AI is configured. Default: "Run with AI".
 *   heuristicLabel         - text shown when AI is off. Default: same as label.
 *   heuristicAvailable     - whether the surface has a non-AI fallback path.
 *                            When true, the button stays clickable on AI-off.
 *   variant, size          - forwarded to <Button>.
 */
export function AIRunButton({
    onClick,
    loading = false,
    disabled = false,
    label = 'Run with AI',
    heuristicLabel,
    heuristicAvailable = false,
    variant = 'primary',
    size,
    icon: IconOverride,
    ...rest
}) {
    const status = useAIStatus()
    const aiOff = !status.loading && !status.configured
    const keyInvalid = !status.loading && status.keyInvalid

    const effectiveLabel = aiOff
        ? (heuristicLabel || label)
        : keyInvalid
            ? `${label} (key invalid)`
            : label

    let title
    if (status.loading) title = undefined
    else if (aiOff) title = heuristicAvailable
        ? 'AI is not configured. Will use the heuristic fallback. Configure AI in Settings → AI Configuration for smarter results.'
        : 'AI is not configured. Configure it in Settings → AI Configuration to enable.'
    else if (keyInvalid) title = 'The configured AI provider key is failing authentication probes. Check your key in Settings → AI Configuration.'

    const isDisabled = disabled || loading || (aiOff && !heuristicAvailable)
    const Icon = IconOverride || (aiOff ? Wand2 : Sparkles)

    return (
        <Button
            variant={variant}
            size={size}
            onClick={onClick}
            disabled={isDisabled}
            aria-busy={loading}
            title={title}
            {...rest}
        >
            {loading ? <Spinner size="md" tone={variant === 'primary' ? 'onPrimary' : 'primary'} className="mr-1" /> : <Icon className="w-4 h-4 mr-1" />}
            {effectiveLabel}
        </Button>
    )
}
