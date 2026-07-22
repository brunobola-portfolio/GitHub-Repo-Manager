import { useCallback, useEffect, useRef, useState } from 'react'
import { Info, ExternalLink, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react'
import { apiCall, ErrorType } from '../../utils/api'
import { useTabData } from '../../hooks/useTabData.js'
import { PanelHeader } from '../ui/PanelHeader'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { SpinnerIcon } from '../ui/Spinner'

const CHANGELOG_URL = 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/CHANGELOG.md'
const UPDATE_GUIDE_URL = 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/docs/windows.md#updating'
// Raw version string, not JSON — mirrors the useOnboarding.js localStorage
// convention (grm.<feature>.<key>). Storing the dismissed *version* (not a
// boolean) is what makes the banner reappear automatically on the next release.
const DISMISS_KEY = 'grm.about.dismissedUpdateVersion'

function safeGetItem(key) {
    try { return window.localStorage.getItem(key) } catch { return null }
}
function safeSetItem(key, value) {
    try { window.localStorage.setItem(key, value) } catch { /* fail silent — dismiss just won't persist */ }
}

// One-click self-update state machine (managed Windows installs only —
// gated by data.canSelfUpdate, see server/routes/system.js isManaged()).
//   idle       — nothing in flight; Update now / Dismiss both available
//   starting   — POST /api/system/update in flight; returns fast (202) once
//                preconditions pass, before the download starts — see
//                server/lib/updater.js's split preconditions/background split
//   progress   — polling /api/system/update/status every 1s
//   restarting — the server has reported (or stopped responding during)
//                the file-swap handoff; polling /api/health/ready instead
//   error      — a failure the user can see, with Update now offered again
const UPDATE_PHASE = {
    IDLE: 'idle',
    STARTING: 'starting',
    PROGRESS: 'progress',
    RESTARTING: 'restarting',
    ERROR: 'error',
}

const STATUS_POLL_INTERVAL_MS = 1000
const HEALTH_POLL_INTERVAL_MS = 2000
const HEALTH_POLL_TIMEOUT_MS = 3 * 60 * 1000

// Matches the primary-CTA button convention used across Settings sections
// (e.g. AzureCredentialsSection, AzureHostsAllowlistSection) — no new class
// combination invented for this one button.
const UPDATE_BUTTON_CLASS = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg bg-[color:var(--ds-accent-brand)] text-white hover:bg-[color:var(--ds-accent-brand-hover)] disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors'

// Renders the server's phase/percent verbatim ("downloading 42%",
// "verifying") — no cosmetic reformatting, so the label a user sees stays
// literally traceable to the server-side progress object during support.
function updateStatusLabel({ phase, percent }) {
    return phase === 'downloading' ? `${phase} ${percent}%` : phase
}

// A connection drop mid-update is expected — the server tears itself down
// for the file swap and the port goes dark for a few seconds. err.userMessage
// for BACKEND_UNAVAILABLE is the hardcoded dev string ("...npm run
// dev:server..."), which is actively wrong/confusing for an end user mid
// self-update, so these types are never shown verbatim — see
// NEUTRAL_CONNECTION_DROP_MESSAGE below instead.
const CONNECTION_DROP_ERROR_TYPES = new Set([ErrorType.BACKEND_UNAVAILABLE, ErrorType.TIMEOUT, ErrorType.NETWORK])
const NEUTRAL_CONNECTION_DROP_MESSAGE = "Lost connection to the server while updating — it may be restarting; this page will reload when it's back."

function isConnectionDropError(err) {
    return CONNECTION_DROP_ERROR_TYPES.has(err?.type)
}

function extractErrorMessage(err, fallback) {
    if (isConnectionDropError(err)) return NEUTRAL_CONNECTION_DROP_MESSAGE
    return err?.data?.error || err?.userMessage || err?.message || fallback
}

/**
 * Settings → About: current version + an honest, notify-only update signal.
 *
 * Every state here is deliberately conservative — a disabled or failed check
 * shows nothing about updates rather than a fake "up to date" claim. Only a
 * check that actually completed (updateAvailable is a real boolean) renders
 * either the "available" banner or the "Up to date" badge.
 */
export function AboutSection() {
    const currentVersion = import.meta.env.VITE_APP_VERSION
    const { data } = useTabData(async () => {
        // Mock mode has no authenticated session, so the real endpoint 401s
        // and this section's update banner/badge never renders — inline
        // guard (never aliased, see Vite DCE note in AGENTS.md) so prod
        // bundles never carry the mock branch.
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { getMockUpdateCheck } = await import('../../__mocks__/mockSystem.js')
            return getMockUpdateCheck()
        }
        return apiCall('/api/system/update-check')
    }, [])
    const [dismissedVersion, setDismissedVersion] = useState(() => safeGetItem(DISMISS_KEY))

    const dismiss = useCallback((version) => {
        safeSetItem(DISMISS_KEY, version)
        setDismissedVersion(version)
    }, [])

    const disabled = data?.disabled === true
    const updateAvailable = !disabled && data?.updateAvailable === true
    const upToDate = !disabled && data?.updateAvailable === false
    const showBanner = updateAvailable && data.latest !== dismissedVersion

    const [updatePhase, setUpdatePhase] = useState(UPDATE_PHASE.IDLE)
    const [updateProgress, setUpdateProgress] = useState(null)
    const [updateErrorMessage, setUpdateErrorMessage] = useState(null)

    const mountedRef = useRef(true)
    const statusPollRef = useRef(null)
    const healthPollRef = useRef(null)
    const healthDeadlineRef = useRef(0)
    // Last phase actually observed from a successful status poll. Disambiguates
    // a poll rejection: expected (server tearing itself down for the handoff,
    // once we've already seen 'restarting') vs. a genuine failure mid
    // download/verify, which must surface as an error rather than silently
    // being treated as the start of a restart.
    const lastObservedPhaseRef = useRef(null)
    // Bumped every time clearStatusPoll() runs (a fresh poll session
    // starting, a terminal transition, or unmount). setInterval doesn't wait
    // for a slow tick's promise before scheduling the next one, so two ticks
    // can be in flight together; a tick captures this value when it starts
    // and re-checks it after its await settles, bailing out (no state
    // mutation at all) if a newer tick or transition already moved things on
    // in the meantime — otherwise a slow tick's stale result could clobber
    // state a faster, later tick already set correctly.
    const pollEpochRef = useRef(0)

    const clearStatusPoll = useCallback(() => {
        pollEpochRef.current += 1
        if (statusPollRef.current) {
            clearInterval(statusPollRef.current)
            statusPollRef.current = null
        }
    }, [])
    const clearHealthPoll = useCallback(() => {
        if (healthPollRef.current) {
            clearInterval(healthPollRef.current)
            healthPollRef.current = null
        }
    }, [])

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            clearStatusPoll()
            clearHealthPoll()
        }
    }, [clearStatusPoll, clearHealthPoll])

    const enterRestarting = useCallback(() => {
        clearStatusPoll()
        if (!mountedRef.current) return
        setUpdatePhase(UPDATE_PHASE.RESTARTING)
        healthDeadlineRef.current = Date.now() + HEALTH_POLL_TIMEOUT_MS
        const pollHealth = async () => {
            try {
                // Plain fetch, no credentials/auth — /api/health/ready is an
                // unauthenticated liveness probe, and by the time this fires
                // the very session cookie may belong to a process that no
                // longer exists.
                const res = await fetch('/api/health/ready')
                if (res.ok) {
                    clearHealthPoll()
                    window.location.reload()
                    return
                }
            } catch {
                // Expected mid-restart — the server is down for the file swap.
            }
            if (Date.now() >= healthDeadlineRef.current) {
                clearHealthPoll()
                if (mountedRef.current) {
                    setUpdatePhase(UPDATE_PHASE.ERROR)
                    setUpdateErrorMessage('The app did not come back after restarting. Reopen it manually if this page does not reload on its own.')
                }
            }
        }
        clearHealthPoll()
        healthPollRef.current = setInterval(pollHealth, HEALTH_POLL_INTERVAL_MS)
        pollHealth()
    }, [clearStatusPoll, clearHealthPoll])

    const startStatusPoll = useCallback(() => {
        lastObservedPhaseRef.current = null
        setUpdatePhase(UPDATE_PHASE.PROGRESS)
        setUpdateProgress(null)
        setUpdateErrorMessage(null)
        const pollStatus = async () => {
            const epoch = pollEpochRef.current
            try {
                const status = await apiCall('/api/system/update/status')
                // A newer tick (or a transition triggered independently, e.g.
                // by that newer tick) already moved state on — this result is
                // stale, apply none of it.
                if (pollEpochRef.current !== epoch) return
                lastObservedPhaseRef.current = status.phase
                if (status.phase === 'restarting') {
                    enterRestarting()
                    return
                }
                if (status.phase === 'error') {
                    clearStatusPoll()
                    if (mountedRef.current) {
                        setUpdatePhase(UPDATE_PHASE.ERROR)
                        setUpdateErrorMessage(status.error || 'The update failed on the server.')
                    }
                    return
                }
                if (mountedRef.current) setUpdateProgress(status)
            } catch (err) {
                // Checked before the epoch guard below: once "restarting" has
                // been observed, a stale/overlapping tick failing is exactly
                // the expected handoff (the server going dark for the file
                // swap), not a new failure — re-entering is a harmless no-op
                // if another tick already got there first.
                if (lastObservedPhaseRef.current === 'restarting') {
                    enterRestarting()
                    return
                }
                if (pollEpochRef.current !== epoch) return
                clearStatusPoll()
                if (mountedRef.current) {
                    setUpdatePhase(UPDATE_PHASE.ERROR)
                    setUpdateErrorMessage(extractErrorMessage(err, 'Lost connection to the server while updating.'))
                }
            }
        }
        clearStatusPoll()
        statusPollRef.current = setInterval(pollStatus, STATUS_POLL_INTERVAL_MS)
        pollStatus()
    }, [clearStatusPoll, enterRestarting])

    const handleUpdateClick = useCallback(async () => {
        setUpdateErrorMessage(null)
        setUpdatePhase(UPDATE_PHASE.STARTING)
        try {
            await apiCall('/api/system/update', { method: 'POST' })
            if (mountedRef.current) startStatusPoll()
        } catch (err) {
            if (err?.status === 409) {
                // Another caller already kicked off an update (a retry from
                // this tab or a second tab) — join its progress instead of
                // reporting a false failure.
                if (mountedRef.current) startStatusPoll()
                return
            }
            if (mountedRef.current) {
                setUpdatePhase(UPDATE_PHASE.ERROR)
                setUpdateErrorMessage(extractErrorMessage(err, 'Failed to start the update.'))
            }
        }
    }, [startStatusPoll])

    const canOfferUpdate = updatePhase === UPDATE_PHASE.IDLE || updatePhase === UPDATE_PHASE.ERROR

    return (
        <div className="space-y-4">
            <PanelHeader
                eyebrowIcon={Info}
                eyebrow="About"
                title="GitHub Repo Manager"
                description="Version and release information for this install."
            />

            <Card glass={false} shadow="sm" className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Version</span>
                    <Badge tone="neutral" size="sm">v{currentVersion}</Badge>
                    {upToDate && (
                        <Badge tone="success" size="xs" icon={<CheckCircle2 className="w-3 h-3" aria-hidden="true" />}>
                            Up to date
                        </Badge>
                    )}
                </div>
                <a
                    href={CHANGELOG_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline"
                >
                    Changelog <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
            </Card>

            {showBanner && (
                <Card
                    glass={false}
                    shadow="sm"
                    className="p-4 border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20"
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                            <Sparkles className="w-4 h-4 mt-0.5 text-indigo-500 shrink-0" aria-hidden="true" />
                            <div>
                                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                    v{data.latest} available
                                </p>
                                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                                    {data.releaseUrl && (
                                        <a
                                            href={data.releaseUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="hover:underline text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]"
                                        >
                                            Release notes
                                        </a>
                                    )}
                                    <a
                                        href={UPDATE_GUIDE_URL}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:underline text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]"
                                    >
                                        Update guide
                                    </a>
                                </p>
                                {updatePhase === UPDATE_PHASE.PROGRESS && updateProgress && (
                                    <p className="mt-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                                        <SpinnerIcon className="w-3 h-3" />
                                        Update: {updateStatusLabel(updateProgress)}
                                    </p>
                                )}
                                {updatePhase === UPDATE_PHASE.RESTARTING && (
                                    <p className="mt-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                                        <SpinnerIcon className="w-3 h-3" />
                                        Restarting — this page will reload automatically
                                    </p>
                                )}
                                {updatePhase === UPDATE_PHASE.ERROR && updateErrorMessage && (
                                    <p role="alert" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-1.5">
                                        <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                                        {updateErrorMessage}
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {data.canSelfUpdate === true && canOfferUpdate && (
                                <button type="button" onClick={handleUpdateClick} className={UPDATE_BUTTON_CLASS}>
                                    Update now
                                </button>
                            )}
                            {updatePhase === UPDATE_PHASE.STARTING && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                                    <SpinnerIcon className="w-3.5 h-3.5" /> Starting…
                                </span>
                            )}
                            {canOfferUpdate && (
                                <button
                                    type="button"
                                    onClick={() => dismiss(data.latest)}
                                    className="ds-text-meta text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                                >
                                    Dismiss
                                </button>
                            )}
                        </div>
                    </div>
                </Card>
            )}
        </div>
    )
}
