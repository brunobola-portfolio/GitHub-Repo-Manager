// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from 'react'
import { DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'
import { motion } from 'framer-motion'
import { Sparkles, CheckCircle, ExternalLink, AlertTriangle, ArrowLeft, BookOpen } from 'lucide-react'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'
import { SectionSpinner } from '../ui/Spinner'
import { AIErrorState } from '../ui/AIErrorState'
import { Select } from '../ui/Select'
import { Field } from '../ui/form/Field'
import { Input } from '../ui/form/Input'
import { Switch } from '../ui/form/Switch'
import { STAGGER, TRANSITION } from '../ui/motion'
import { useTheme } from '../../hooks/useTheme'
import { useResponsiveDiffMode } from '../../hooks/useResponsiveDiffMode'
import { commitCommunityHealthFix } from '../../api/repos'
import { aiApi } from '../../api/ai'
import { useToast } from '../../hooks/useToast'

// Mirrors server/lib/ai-features/license-detect.js's SUPPORTED_LICENSES —
// duplicated client-side since it's a tiny, stable list and pulling the
// server module into the frontend bundle isn't worth it.
const SUPPORTED_LICENSES = ['MIT', 'BSD-3-Clause', 'Apache-2.0', 'GPL-3.0', 'MPL-2.0']

const TONE_OPTIONS = [
    { value: 'professional', label: 'Professional' },
    { value: 'concise', label: 'Concise' },
    { value: 'enthusiastic', label: 'Enthusiastic' },
]

const MODE_OPTIONS = [
    { value: 'missing-sections', label: 'Generate missing sections only' },
    { value: 'full-rewrite', label: 'Full rewrite (grounded)' },
]

const OPTIONAL_SECTIONS = ['Badges', 'Table of Contents', 'Background', 'API', 'Security', 'Acknowledgments']

const PRIORITY_TONE = { high: 'danger', medium: 'warning', low: 'neutral' }

function ScoreRing({ score }) {
    const clamped = Math.max(0, Math.min(100, score ?? 0))
    const tone = clamped >= 75 ? 'success' : clamped >= 50 ? 'warning' : 'danger'
    const ringColor = tone === 'success' ? 'text-emerald-500' : tone === 'warning' ? 'text-amber-500' : 'text-rose-500'
    const circumference = 2 * Math.PI * 26
    const offset = circumference - (clamped / 100) * circumference
    return (
        <div className="relative w-16 h-16 shrink-0" role="img" aria-label={`README quality score: ${clamped} out of 100`}>
            <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
                <circle cx="32" cy="32" r="26" strokeWidth="6" fill="none" className="stroke-slate-200 dark:stroke-slate-700" />
                <circle
                    cx="32" cy="32" r="26" strokeWidth="6" fill="none" strokeLinecap="round"
                    strokeDasharray={circumference} strokeDashoffset={offset}
                    className={`${ringColor} transition-[stroke-dashoffset] duration-500`}
                    stroke="currentColor"
                />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-sm font-bold ds-font-display text-slate-900 dark:text-slate-100">
                {clamped}
            </div>
        </div>
    )
}

function deriveDefaultSections(patterns) {
    if (!patterns) return []
    const picked = []
    if (patterns.hasBadges) picked.push('Badges')
    if (patterns.hasTableOfContents) picked.push('Table of Contents')
    if (patterns.hasAPI) picked.push('API')
    return picked
}

/**
 * README Studio — two-stage modal: a free, instant, deterministic score
 * (§quality-metrics.js) followed by an optional, quota-gated, grounded
 * "improve" flow with a mandatory diff preview before any write.
 *
 * Apply/Open PR reuse the existing community-health/commit-fix write path
 * (generic over filePath/content/commitMessage/mode) — no second commit
 * mechanism is introduced here.
 */
export function ReadmeStudioModal({ isOpen, onClose, repo, onApplied }) {
    const { isDark } = useTheme()
    const { toast } = useToast()
    const diffViewMode = useResponsiveDiffMode()

    const [step, setStep] = useState('score') // score | configure | preview | committed
    const [scoreLoading, setScoreLoading] = useState(true)
    const [scoreError, setScoreError] = useState(null)
    const [scoreData, setScoreData] = useState(null)

    const [mode, setMode] = useState('missing-sections')
    const [tone, setTone] = useState('professional')
    const [sections, setSections] = useState([])
    const [license, setLicense] = useState('')
    const [stackOverride, setStackOverride] = useState('')
    const [badges, setBadges] = useState(false)

    const [generating, setGenerating] = useState(false)
    const [improveError, setImproveError] = useState(null)
    const [improveResult, setImproveResult] = useState(null)
    const [fallbackLoading, setFallbackLoading] = useState(false)

    const [commitMessage, setCommitMessage] = useState('')
    const [committing, setCommitting] = useState(false)
    const [commitError, setCommitError] = useState(null)
    const [committedResult, setCommittedResult] = useState(null)

    const owner = repo?.owner?.login || repo?.full_name?.split('/')?.[0]
    const repoName = repo?.name || repo?.full_name?.split('/')?.[1]

    const reset = useCallback(() => {
        setStep('score')
        setScoreLoading(true)
        setScoreError(null)
        setScoreData(null)
        setMode('missing-sections')
        setTone('professional')
        setSections([])
        setLicense('')
        setStackOverride('')
        setBadges(false)
        setGenerating(false)
        setImproveError(null)
        setImproveResult(null)
        setFallbackLoading(false)
        setCommitMessage('')
        setCommitting(false)
        setCommitError(null)
        setCommittedResult(null)
    }, [])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- isOpen→false reset
        if (!isOpen) reset()
    }, [isOpen, reset])

    const loadScore = useCallback(async () => {
        if (!owner || !repoName) return
        setScoreLoading(true)
        setScoreError(null)
        try {
            const res = await aiApi.readmeStudio.getScore(owner, repoName)
            setScoreData(res)
            const detected = res?.report?.patterns?.licenseDetected
            setLicense(detected?.matched ? detected.spdxId : '')
            setSections(deriveDefaultSections(res?.report?.patterns))
            setMode(res?.hasReadme ? 'missing-sections' : 'full-rewrite')
        } catch (e) {
            setScoreError(e)
        } finally {
            setScoreLoading(false)
        }
    }, [owner, repoName])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- modal-open kicks off the score fetch
        if (isOpen) loadScore()
    }, [isOpen, loadScore])

    const toggleSection = (name) => {
        setSections((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]))
    }

    const generate = useCallback(async () => {
        if (!repo?.full_name) return
        setGenerating(true)
        setImproveError(null)
        try {
            const res = await aiApi.readmeStudio.improve(
                { full_name: repo.full_name, language: repo.language, topics: repo.topics },
                { mode, tone, sections, license: license || undefined, stackOverride: stackOverride || undefined, badges },
            )
            if (res?.mock) {
                const message = res.aiConfigured === false
                    ? 'Connect an AI provider in Settings → AI Configuration to use the improve flow.'
                    : 'AI provider is temporarily unavailable — please try again in a moment.'
                const err = new Error(message)
                err.code = res.aiConfigured === false ? 'AI_NOT_CONFIGURED' : 'AI_UNAVAILABLE'
                setImproveError(err)
                return
            }
            setImproveResult(res)
            setCommitMessage(res.mode === 'full-rewrite' ? 'docs: rewrite README with AI' : 'docs: add missing README sections')
            setStep('preview')
        } catch (e) {
            setImproveError(e)
        } finally {
            setGenerating(false)
        }
    }, [repo, mode, tone, sections, license, stackOverride, badges])

    // Addendum 6b.2 fallback — reachable from the improve-stage error banner
    // whenever the AI attempt above failed: no provider configured, a
    // provider error, or the readmeGenPerMonth quota is exhausted (429).
    // Builds the License/Install/TOC sections deterministically instead, so
    // README Studio's improve stage never hard-blocks on AI availability.
    const useDeterministicFallback = useCallback(async () => {
        if (!repo?.full_name) return
        setFallbackLoading(true)
        try {
            const res = await aiApi.readmeStudio.deterministic({ full_name: repo.full_name, language: repo.language }, { mode })
            setImproveResult(res)
            setCommitMessage(res.mode === 'full-rewrite' ? 'docs: add README skeleton (deterministic)' : 'docs: add missing README sections (deterministic)')
            setImproveError(null)
            setStep('preview')
        } catch (e) {
            toast.error(e?.message || 'Failed to build a deterministic README patch')
        } finally {
            setFallbackLoading(false)
        }
    }, [repo, mode, toast])

    const finalContent = improveResult
        ? (improveResult.mode === 'full-rewrite'
            ? (improveResult.markdown || '')
            : `${improveResult.currentReadme || ''}${improveResult.currentReadme ? '\n\n' : ''}${improveResult.markdown || ''}`)
        : ''

    const doCommit = useCallback(async (commitMode) => {
        if (!owner || !repoName || !finalContent || !commitMessage) return
        setCommitting(true)
        setCommitError(null)
        try {
            const json = await commitCommunityHealthFix({
                owner, repo: repoName, fileType: 'readme_stub', content: finalContent, commitMessage, mode: commitMode,
            })
            setCommittedResult(json)
            setStep('committed')
            onApplied?.(json)
        } catch (e) {
            setCommitError(e)
        } finally {
            setCommitting(false)
        }
    }, [owner, repoName, finalContent, commitMessage, onApplied])

    const renderScoreStage = () => {
        if (scoreLoading) return <SectionSpinner label="Scoring README…" padding="py-12" />
        if (scoreError) return <AIErrorState error={scoreError} onRetry={loadScore} context="README Studio score" />
        if (!scoreData) return null

        const { report, hasReadme, readmeTruncated } = scoreData
        if (!hasReadme) {
            return (
                <div className="space-y-4">
                    <EmptyState
                        icon={readmeTruncated ? AlertTriangle : BookOpen}
                        title={readmeTruncated ? 'README could not be read' : 'No README found'}
                        description={readmeTruncated
                            ? "A README exists but is too large or binary for GitHub to read — scoring can't inspect its content. Generating will treat it as a full rewrite grounded in your repo's other signals."
                            : "This is the top recommendation — generate a full README grounded in your repo's real signals."}
                    />
                </div>
            )
        }

        return (
            <motion.div
                data-testid="readme-studio-score"
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: STAGGER.normal } } }}
                className="space-y-5"
            >
                <div className="flex items-center gap-4">
                    <ScoreRing score={report.score} />
                    <div>
                        <div className="text-sm font-semibold ds-font-display text-slate-900 dark:text-slate-100">
                            README quality score
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{report.summary}</p>
                    </div>
                </div>

                {report.recommendations?.length > 0 && (
                    <div>
                        <h4 className="ds-eyebrow text-slate-500 dark:text-slate-400 mb-2">
                            Recommendations
                        </h4>
                        <ul className="space-y-1.5">
                            {report.recommendations.map((rec, i) => (
                                <motion.li
                                    key={`${rec.priority}-${i}`}
                                    variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: TRANSITION.entrance } }}
                                    className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300"
                                >
                                    <Badge tone={PRIORITY_TONE[rec.priority] || 'neutral'} size="xs" className="mt-0.5 shrink-0 uppercase">
                                        {rec.priority}
                                    </Badge>
                                    <span>{rec.action}</span>
                                </motion.li>
                            ))}
                        </ul>
                    </div>
                )}
            </motion.div>
        )
    }

    const renderConfigureStage = () => {
        const hint = scoreData?.readmeTruncated
            ? { level: 'low', text: 'The existing README is too large or binary to read — grounding will rely on manifest/entrypoint signals only.' }
            : !scoreData?.hasReadme
                ? { level: 'low', text: 'No README was found — grounding will rely on manifest/entrypoint signals only.' }
                : !scoreData?.hasLicense
                    ? { level: 'medium', text: 'No LICENSE file was found — the license section will note it as unspecified rather than guessing.' }
                    : null

        return (
            <div className="space-y-4">
                {hint && (
                    <div
                        role="status"
                        className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm ${hint.level === 'low'
                            ? 'bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-400'
                            : 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400'}`}
                    >
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{hint.text}</span>
                    </div>
                )}

                {improveError && (
                    <>
                        <AIErrorState error={improveError} onRetry={generate} context="README Studio improve" variant="banner" />
                        <Button variant="secondary" size="sm" onClick={useDeterministicFallback} disabled={fallbackLoading}>
                            {fallbackLoading ? 'Building…' : 'Use deterministic version instead'}
                        </Button>
                    </>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Scope">
                        <Select label="Scope" value={mode} onChange={setMode} options={MODE_OPTIONS} disabled={generating} />
                    </Field>
                    <Field label="Tone">
                        <Select label="Tone" value={tone} onChange={setTone} options={TONE_OPTIONS} disabled={generating} />
                    </Field>
                    <Field label="License" hint={scoreData?.report?.patterns?.licenseDetected?.matched ? `Detected: ${scoreData.report.patterns.licenseDetected.spdxId}` : 'No license detected'}>
                        <Select
                            label="License"
                            value={license}
                            onChange={setLicense}
                            placeholder="Unspecified"
                            disabled={generating}
                            options={SUPPORTED_LICENSES.map((id) => ({ value: id, label: id }))}
                        />
                    </Field>
                    <Field label="Stack override" hint="Only if auto-detection is wrong">
                        <Input
                            size="sm"
                            value={stackOverride}
                            onChange={(e) => setStackOverride(e.target.value)}
                            placeholder="e.g. Python + Poetry"
                            disabled={generating}
                        />
                    </Field>
                </div>

                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Include badges</span>
                    <Switch checked={badges} onChange={setBadges} label="Include badges" disabled={generating} size="sm" />
                </div>

                <div>
                    <h4 className="ds-eyebrow text-slate-500 dark:text-slate-400 mb-2">
                        Optional sections
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        {OPTIONAL_SECTIONS.map((name) => {
                            const checked = sections.includes(name)
                            return (
                                <button
                                    key={name}
                                    type="button"
                                    disabled={generating}
                                    onClick={() => toggleSection(name)}
                                    aria-pressed={checked}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ds-focus-ring ${checked
                                        ? 'bg-brand-100 dark:bg-brand-900/40 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-300'
                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-brand-300'}`}
                                >
                                    {name}
                                </button>
                            )
                        })}
                    </div>
                </div>

                {generating && (
                    <div className="flex items-center justify-center py-4">
                        <SectionSpinner label="Generating grounded README content…" padding="py-2" />
                    </div>
                )}
            </div>
        )
    }

    const renderPreviewStage = () => (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                {improveResult?.deterministic ? (
                    <Badge tone="warning" size="xs">Deterministic (no AI)</Badge>
                ) : (
                    <Badge tone={improveResult?.confidence === 'high' ? 'success' : improveResult?.confidence === 'medium' ? 'warning' : 'danger'} size="xs">
                        {(improveResult?.confidence || 'low').toUpperCase()} CONFIDENCE
                    </Badge>
                )}
                <Badge tone="neutral" size="xs">{improveResult?.mode === 'full-rewrite' ? 'Full rewrite' : 'Missing sections'}</Badge>
            </div>

            {improveResult?.deterministic && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Deterministic skeleton patch — sections that can&apos;t be derived from repo signals are left as TODO placeholders. Enable an AI provider for richer, prose-polished content.</span>
                </div>
            )}

            {improveResult?.warnings?.length > 0 && (
                <div className="space-y-1.5">
                    {improveResult.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>{w}</span>
                        </div>
                    ))}
                </div>
            )}

            {commitError && (
                <AIErrorState error={commitError} context="Commit" variant="inline" />
            )}

            <Field label="Commit message">
                <Input
                    size="sm"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    disabled={committing}
                    aria-label="Commit message"
                />
            </Field>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden" data-testid="readme-studio-diff">
                <DiffView
                    data={{
                        oldFile: { fileName: 'README.md', content: improveResult?.currentReadme || '' },
                        newFile: { fileName: 'README.md (improved)', content: finalContent },
                        hunks: [],
                    }}
                    diffViewMode={diffViewMode}
                    diffViewTheme={isDark ? 'dark' : 'light'}
                />
            </div>
        </div>
    )

    const renderCommittedStage = () => (
        <div className="flex flex-col items-center text-center gap-4 py-8">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-700 dark:text-emerald-400" />
            </div>
            <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">
                    {committedResult?.mode === 'pr-fallback' || committedResult?.mode === 'pr' ? 'Pull request opened' : 'README updated'}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {committedResult?.mode === 'pr-fallback'
                        ? `Default branch is protected — opened a PR on ${committedResult?.branch}.`
                        : committedResult?.mode === 'pr'
                            ? `PR opened on ${committedResult?.branch}.`
                            : `Committed to ${committedResult?.branch}.`}
                </p>
            </div>
            {committedResult?.prUrl && (
                <a
                    href={committedResult.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--ds-accent-brand)] hover:underline"
                >
                    View PR <ExternalLink className="w-3.5 h-3.5" />
                </a>
            )}
        </div>
    )

    const renderFooter = () => {
        if (step === 'score') {
            if (scoreLoading || scoreError || !scoreData) return <ModalFooter align="right"><Button variant="ghost" onClick={onClose}>Close</Button></ModalFooter>
            return (
                <ModalFooter align="right">
                    <Button variant="ghost" onClick={onClose}>Close</Button>
                    <Button onClick={() => setStep('configure')}>
                        <Sparkles className="w-4 h-4" /> Improve with AI
                    </Button>
                </ModalFooter>
            )
        }
        if (step === 'configure') {
            return (
                <ModalFooter align="right">
                    <Button variant="ghost" onClick={() => setStep('score')} disabled={generating}>
                        <ArrowLeft className="w-4 h-4" /> Back
                    </Button>
                    <Button onClick={generate} disabled={generating}>
                        {generating ? 'Generating…' : 'Generate'}
                    </Button>
                </ModalFooter>
            )
        }
        if (step === 'preview') {
            return (
                <ModalFooter align="right">
                    <Button variant="ghost" onClick={() => setStep('configure')} disabled={committing}>
                        <ArrowLeft className="w-4 h-4" /> Back
                    </Button>
                    <Button variant="secondary" onClick={() => doCommit('pr')} disabled={committing || !commitMessage}>
                        {committing ? 'Working…' : 'Open PR'}
                    </Button>
                    <Button onClick={() => doCommit('direct')} disabled={committing || !commitMessage}>
                        {committing ? 'Working…' : 'Apply'}
                    </Button>
                </ModalFooter>
            )
        }
        if (step === 'committed') {
            return <ModalFooter align="right"><Button onClick={onClose}>Done</Button></ModalFooter>
        }
        return null
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={committing ? undefined : onClose}
            title="README Studio"
            subtitle={repo?.full_name}
            icon={Sparkles}
            iconGradient="primary"
            size="xl"
            footer={renderFooter()}
            closeOnBackdrop={!committing} disableEscape={committing}
        >
            {step === 'score' && renderScoreStage()}
            {step === 'configure' && renderConfigureStage()}
            {step === 'preview' && renderPreviewStage()}
            {step === 'committed' && renderCommittedStage()}
        </Modal>
    )
}
