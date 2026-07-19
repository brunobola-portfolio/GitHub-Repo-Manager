import { useCallback, useState } from 'react'
import { Info, ExternalLink, Sparkles, CheckCircle2 } from 'lucide-react'
import { apiCall } from '../../utils/api'
import { useTabData } from '../../hooks/useTabData.js'
import { PanelHeader } from '../ui/PanelHeader'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'

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
    const { data } = useTabData(() => apiCall('/api/system/update-check'), [])
    const [dismissedVersion, setDismissedVersion] = useState(() => safeGetItem(DISMISS_KEY))

    const dismiss = useCallback((version) => {
        safeSetItem(DISMISS_KEY, version)
        setDismissedVersion(version)
    }, [])

    const disabled = data?.disabled === true
    const updateAvailable = !disabled && data?.updateAvailable === true
    const upToDate = !disabled && data?.updateAvailable === false
    const showBanner = updateAvailable && data.latest !== dismissedVersion

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
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => dismiss(data.latest)}
                            className="ds-text-meta text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        >
                            Dismiss
                        </button>
                    </div>
                </Card>
            )}
        </div>
    )
}
