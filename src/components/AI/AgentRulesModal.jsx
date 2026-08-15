// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from 'react'
import { DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'
import { motion } from 'framer-motion'
import { Bot, CheckCircle, ExternalLink, AlertTriangle, ArrowLeft, Info } from 'lucide-react'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { SectionSpinner } from '../ui/Spinner'
import { AIErrorState } from '../ui/AIErrorState'
import { Select } from '../ui/Select'
import { Field } from '../ui/form/Field'
import { Input } from '../ui/form/Input'
import { STAGGER, TRANSITION } from '../ui/motion'
import { useTheme } from '../../hooks/useTheme'
import { useResponsiveDiffMode } from '../../hooks/useResponsiveDiffMode'
import { aiApi } from '../../api/ai'

const TARGET_OPTIONS = [
    { value: 'agents', label: 'AGENTS.md only' },
    { value: 'both', label: 'AGENTS.md + CLAUDE.md' },
    { value: 'claude', label: 'CLAUDE.md only' },
]
const TARGET_TO_FILES = {
    agents: ['AGENTS.md'],
    both: ['AGENTS.md', 'CLAUDE.md'],
    claude: ['CLAUDE.md'],
}

const MODE_OPTIONS = [
    { value: 'create', label: 'Create new' },
    { value: 'refresh', label: 'Refresh existing (diff-aware)' },
]

const STRICTNESS_OPTIONS = [
    { value: 'concise', label: 'Concise (< 150 lines)' },
    { value: 'detailed', label: 'Detailed' },
]

// Mirrors server/lib/ai-features/agent-rules.js's SECTION_KEYS/DEFAULT_SECTIONS.
const SECTION_TOGGLES = [
    { key: 'setup', label: 'Setup commands' },
    { key: 'codeStyle', label: 'Code style' },
    { key: 'testing', label: 'Testing instructions' },
    { key: 'devEnv', label: 'Dev environment tips' },
    { key: 'prInstructions', label: 'PR instructions' },
    { key: 'security', label: 'Security constraints' },
    { key: 'repoLayout', label: 'Repo layout map' },
]
const DEFAULT_SECTIONS = { setup: true, codeStyle: true, testing: true, devEnv: true, prInstructions: true, security: false, repoLayout: true }

const REASON_COPY = {
    ai_not_configured: 'AI is not configured — showing a deterministic template built directly from your repo\'s detected signals. Connect a provider in Settings for a richer, prose-polished version.',
    ai_error: 'The AI provider failed to generate a response — showing a deterministic template built directly from your repo\'s detected signals instead.',
    spend_cap_reached: 'The monthly AI spend cap was reached — showing a deterministic template built directly from your repo\'s detected signals instead.',
}

/**
 * Agent Rules Generator — grounded AGENTS.md / CLAUDE.md generation. Same
 * three-stage shape as ReadmeStudioModal (configure → preview/diff →
 * committed), reusing the community-health commit-fix write path's sibling
 * (`agent-rules/commit`, itself `commitOrOpenPR()` per file).
 *
 * Never blocks on AI availability: `generate` always returns a usable
 * document — either AI-grounded or, per Addendum 6b.2, a deterministic
 * template built straight from detected repo signals when no provider is
 * configured, the provider errors, or the spend cap is hit. The `deterministic`
 * flag on the response drives a persistent, honest banner — never presented
 * as AI-written when it isn't.
 */
export function AgentRulesModal({ isOpen, onClose, repo, hasExistingAgents = false, onCommitted }) {
    const { isDark } = useTheme()
    const diffViewMode = useResponsiveDiffMode()

    const [step, setStep] = useState('configure') // configure | preview | committed
    const [target, setTarget] = useState('agents')
    const [mode, setMode] = useState(hasExistingAgents ? 'refresh' : 'create')
    const [sections, setSections] = useState(DEFAULT_SECTIONS)
    const [strictness, setStrictness] = useState('concise')

    const [generating, setGenerating] = useState(false)
    const [generateError, setGenerateError] = useState(null)
    const [result, setResult] = useState(null) // { deterministic, reason, files, existing, notes, quotaExceeded }
    // Quota-exceeded (429) responses still carry a usable deterministic
    // fallback in the error body (Addendum 6b.2). Rather than silently
    // auto-advancing past the failure, stash it here and require the same
    // explicit "Use deterministic version instead" click README Studio /
    // Diagram Generator require on their 429s — one 429 UX across all three.
    const [pendingFallback, setPendingFallback] = useState(null)

    const [commitMessage, setCommitMessage] = useState('')
    const [committing, setCommitting] = useState(false)
    const [commitError, setCommitError] = useState(null)
    const [committedResult, setCommittedResult] = useState(null)

    const owner = repo?.owner?.login || repo?.full_name?.split('/')?.[0]
    const repoName = repo?.name || repo?.full_name?.split('/')?.[1]

    const reset = useCallback(() => {
        setStep('configure')
        setTarget('agents')
        setMode(hasExistingAgents ? 'refresh' : 'create')
        setSections(DEFAULT_SECTIONS)
        setStrictness('concise')
        setGenerating(false)
        setGenerateError(null)
        setResult(null)
        setPendingFallback(null)
        setCommitMessage('')
        setCommitting(false)
        setCommitError(null)
        setCommittedResult(null)
    }, [hasExistingAgents])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- isOpen→false reset
        if (!isOpen) reset()
    }, [isOpen, reset])

    const toggleSection = (key) => setSections((prev) => ({ ...prev, [key]: !prev[key] }))

    const generate = useCallback(async () => {
        if (!owner || !repoName) return
        setGenerating(true)
        setGenerateError(null)
        setPendingFallback(null)
        try {
            const res = await aiApi.agentRules.generate(owner, repoName, {
                targetFiles: TARGET_TO_FILES[target], mode, sections, strictness,
            })
            setResult({
                deterministic: !!res.deterministic, reason: res.reason || null,
                files: res.files || {}, existing: res.existing || {}, notes: res.notes || [],
                quotaExceeded: false,
            })
            setCommitMessage(mode === 'refresh' ? 'chore: refresh agent rules (AGENTS.md/CLAUDE.md)' : 'chore: add agent rules (AGENTS.md/CLAUDE.md)')
            setStep('preview')
        } catch (e) {
            if (e?.status === 429 && e?.files) {
                // Quota exceeded, but the server still shipped a deterministic
                // fallback in the error body (Addendum 6b.2). Surface the same
                // error-banner-then-manual-fallback step README Studio and
                // Diagram Generator use for their 429s, instead of silently
                // auto-advancing past the failure.
                setPendingFallback({
                    deterministic: true, reason: 'quota_exceeded',
                    files: e.files, existing: e.existing || {}, notes: e.notes || [],
                    quotaExceeded: true,
                })
                setGenerateError(e)
                return
            }
            setGenerateError(e)
        } finally {
            setGenerating(false)
        }
    }, [owner, repoName, target, mode, sections, strictness])

    const useDeterministicFallback = useCallback(() => {
        if (!pendingFallback) return
        setResult(pendingFallback)
        setCommitMessage(mode === 'refresh' ? 'chore: refresh agent rules (AGENTS.md/CLAUDE.md)' : 'chore: add agent rules (AGENTS.md/CLAUDE.md)')
        setGenerateError(null)
        setPendingFallback(null)
        setStep('preview')
    }, [pendingFallback, mode])

    const doCommit = useCallback(async (commitMode) => {
        if (!owner || !repoName || !result?.files || !commitMessage) return
        setCommitting(true)
        setCommitError(null)
        try {
            const files = Object.entries(result.files).map(([filePath, content]) => ({ filePath, content, commitMessage }))
            const res = await aiApi.agentRules.commit(owner, repoName, { files, mode: commitMode })
            setCommittedResult(res)
            setStep('committed')
            onCommitted?.(res)
        } catch (e) {
            setCommitError(e)
        } finally {
            setCommitting(false)
        }
    }, [owner, repoName, result, commitMessage, onCommitted])

    const targetFiles = TARGET_TO_FILES[target]

    const renderConfigureStage = () => (
        <div className="space-y-4">
            {generateError && (
                <>
                    <AIErrorState error={generateError} onRetry={generate} context="Agent Rules Generator" variant="banner" />
                    {pendingFallback && (
                        <Button variant="secondary" size="sm" onClick={useDeterministicFallback}>
                            Use deterministic version instead
                        </Button>
                    )}
                </>
            )}

            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Grounded in your repo&apos;s real build/test/lint/CI signals — a command that wasn&apos;t detected is never invented, it&apos;s flagged so you can fill it in.</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Target file(s)">
                    <Select label="Target file(s)" value={target} onChange={setTarget} options={TARGET_OPTIONS} disabled={generating} />
                </Field>
                <Field label="Mode" hint={hasExistingAgents ? 'AGENTS.md already exists in this repo' : 'No AGENTS.md detected yet'}>
                    <Select label="Mode" value={mode} onChange={setMode} options={MODE_OPTIONS} disabled={generating} />
                </Field>
                <Field label="Strictness">
                    <Select label="Strictness" value={strictness} onChange={setStrictness} options={STRICTNESS_OPTIONS} disabled={generating} />
                </Field>
            </div>

            <div>
                <h4 className="ds-text-meta uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-2">
                    Sections
                </h4>
                <div className="flex flex-wrap gap-2">
                    {SECTION_TOGGLES.map(({ key, label }) => {
                        const checked = !!sections[key]
                        return (
                            <button
                                key={key}
                                type="button"
                                disabled={generating}
                                onClick={() => toggleSection(key)}
                                aria-pressed={checked}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ds-focus-ring ${checked
                                    ? 'bg-brand-100 dark:bg-brand-900/40 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-300'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-brand-300'}`}
                            >
                                {label}
                            </button>
                        )
                    })}
                </div>
            </div>

            {generating && (
                <div className="flex items-center justify-center py-4">
                    <SectionSpinner label="Detecting repo signals and generating…" padding="py-2" />
                </div>
            )}
        </div>
    )

    const renderPreviewStage = () => (
        <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: STAGGER.fast } } }}
            className="space-y-4"
        >
            <div className="flex flex-wrap items-center gap-2">
                {result?.deterministic ? (
                    <Badge tone="warning" size="xs">Deterministic (no AI)</Badge>
                ) : (
                    <Badge tone="success" size="xs">AI-grounded</Badge>
                )}
                <Badge tone="neutral" size="xs">{mode === 'refresh' ? 'Refresh (diff)' : 'Create'}</Badge>
            </div>

            {result?.deterministic && result?.reason && (
                <div role="status" className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{REASON_COPY[result.reason] || 'AI generation was unavailable — showing a deterministic template instead.'}</span>
                </div>
            )}

            {result?.notes?.length > 0 && (
                <div className="space-y-1.5">
                    {result.notes.map((n, i) => (
                        <motion.div
                            key={i}
                            variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: TRANSITION.entrance } }}
                            className="flex items-start gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-600 dark:text-slate-400"
                        >
                            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>{n}</span>
                        </motion.div>
                    ))}
                </div>
            )}

            {commitError && (
                <div role="alert" className="px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-sm text-red-600 dark:text-red-400">
                    {commitError.message || 'Failed to commit. Please retry.'}
                </div>
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

            {targetFiles.map((filePath) => {
                const content = result?.files?.[filePath] || ''
                const existing = result?.existing?.[filePath]
                return (
                    <div key={filePath} className="space-y-1.5">
                        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{filePath}</span>
                        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden" data-testid={`agent-rules-diff-${filePath}`}>
                            <DiffView
                                data={{
                                    oldFile: { fileName: filePath, content: existing || '' },
                                    newFile: { fileName: `${filePath} (generated)`, content },
                                    hunks: [],
                                }}
                                diffViewMode={diffViewMode}
                                diffViewTheme={isDark ? 'dark' : 'light'}
                            />
                        </div>
                    </div>
                )
            })}
        </motion.div>
    )

    const renderCommittedStage = () => (
        <div className="flex flex-col items-center text-center gap-4 py-8">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">Agent rules updated</h3>
                <div className="text-sm text-slate-500 dark:text-slate-400 mt-1 space-y-1">
                    {(committedResult?.results || []).map((r) => (
                        <p key={r.filePath}>
                            {r.filePath}: {r.mode === 'pr-fallback'
                                ? `default branch is protected — opened a PR on ${r.branch}.`
                                : r.mode === 'pr'
                                    ? `PR opened on ${r.branch}.`
                                    : `committed to ${r.branch}.`}
                        </p>
                    ))}
                </div>
            </div>
            {(committedResult?.results || []).filter((r) => r.prUrl).map((r) => (
                <a
                    key={r.filePath}
                    href={r.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--ds-accent-brand)] hover:underline"
                >
                    View PR ({r.filePath}) <ExternalLink className="w-3.5 h-3.5" />
                </a>
            ))}
        </div>
    )

    const renderFooter = () => {
        if (step === 'configure') {
            return (
                <ModalFooter align="right">
                    <Button variant="ghost" onClick={onClose}>Close</Button>
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
            title="Agent Rules Generator"
            subtitle={repo?.full_name}
            icon={Bot}
            iconGradient="primary"
            size="xl"
            footer={renderFooter()}
            closeOnBackdrop={!committing}
        >
            {step === 'configure' && renderConfigureStage()}
            {step === 'preview' && renderPreviewStage()}
            {step === 'committed' && renderCommittedStage()}
        </Modal>
    )
}
