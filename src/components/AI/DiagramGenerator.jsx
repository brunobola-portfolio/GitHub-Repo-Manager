// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'
import { Workflow, Copy, Download, RotateCcw, ArrowLeft, AlertTriangle, GitBranch, CheckCircle, ExternalLink, Lock } from 'lucide-react'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { SectionSpinner } from '../ui/Spinner'
import { AIErrorState } from '../ui/AIErrorState'
import { Select } from '../ui/Select'
import { Field } from '../ui/form/Field'
import { Input } from '../ui/form/Input'
import { TRANSITION } from '../ui/motion'
import { aiApi } from '../../api/ai'
import { copyToClipboard } from '../../utils/clipboard'
import { parseAndSanitizeSvg } from '../../utils/sanitizeSvg'
import { useToast } from '../../hooks/useToast'

// v1 ships architecture/module diagrams only (2026-07-18-community-wow-wave6.md
// explicitly cuts sequence/flow from scope). The selector is still a real
// dropdown — not a static label — so adding the other two later is a
// one-line options-array change, not a rework.
const DIAGRAM_TYPE_OPTIONS = [
    { value: 'architecture', label: 'Architecture / module graph' },
]

const EMBED_TARGET_OPTIONS = [
    { value: 'readme-mermaid', label: 'README mermaid fence (recommended)' },
    { value: 'svg-file', label: 'Committed SVG file (docs/diagrams/)' },
]

const PLACEMENT_OPTIONS = [
    { value: 'after-intro', label: 'After the intro (default)' },
    { value: 'top', label: 'At the very top' },
    { value: 'end', label: 'At the end of the README' },
    { value: 'custom', label: 'After a specific heading…' },
]

/**
 * AI Diagram Generator — generates a Mermaid architecture diagram grounded in
 * the repo's real file tree/contents/README, renders it client-side (adapted
 * from WalkthroughTab.jsx's render pipeline: lazy mermaid import, strict
 * security level, parseAndSanitizeSvg defence-in-depth), and offers Copy
 * Mermaid / Copy SVG / Download SVG export plus — Addendum 6b.1 — an embed
 * flow that writes the diagram INTO the repo (README mermaid fence or a
 * committed SVG file) behind a mandatory preview and commitOrOpenPR.
 *
 * Honesty constraint: the diagram is a persistent, labelled AI approximation
 * (or, after the deterministic fallback, a clearly-labelled structure
 * diagram), never presented as a verified static-analysis dependency graph.
 *
 * Retry-once self-repair: when mermaid.render() rejects (a syntax error the
 * model produced), we silently re-request generation exactly once with the
 * failed source + parser error appended server-side. If the repaired diagram
 * also fails to render, we stop auto-retrying and offer either a manual
 * "Regenerate" (a fresh, normally-metered request) or "Use a deterministic
 * diagram instead" (zero-AI-cost fallback, Addendum 6b.2) so the embed flow
 * is never blocked by a persistently-broken AI diagram.
 */
export function DiagramGenerator({ isOpen, onClose, repo }) {
    const { toast } = useToast()
    const [step, setStep] = useState('configure') // configure | result | embed-config | embed-preview | embed-committed
    const [diagramType, setDiagramType] = useState('architecture')
    const [focus, setFocus] = useState('')

    const [generating, setGenerating] = useState(false)
    const [selfRepairing, setSelfRepairing] = useState(false)
    const [generateError, setGenerateError] = useState(null)
    const [fallbackLoading, setFallbackLoading] = useState(false)

    const [mermaidSource, setMermaidSource] = useState(null)
    const [truncated, setTruncated] = useState(false)
    const [isDeterministic, setIsDeterministic] = useState(false)
    const [renderError, setRenderError] = useState(null)
    const [svgMarkup, setSvgMarkup] = useState(null)

    // Embed flow state (Addendum 6b.1)
    const [embedTarget, setEmbedTarget] = useState('readme-mermaid')
    const [embedPlacement, setEmbedPlacement] = useState('after-intro')
    const [embedCustomAnchor, setEmbedCustomAnchor] = useState('')
    const [embedPreviewing, setEmbedPreviewing] = useState(false)
    const [embedError, setEmbedError] = useState(null)
    const [embedPreviewData, setEmbedPreviewData] = useState(null)
    const [readmeCommitMessage, setReadmeCommitMessage] = useState('')
    const [svgCommitMessage, setSvgCommitMessage] = useState('')
    const [committing, setCommitting] = useState(false)
    const [commitError, setCommitError] = useState(null)
    const [committedResult, setCommittedResult] = useState(null)

    const mermaidRef = useRef(null)
    const retriedRef = useRef(false)
    const [theme, setTheme] = useState(() =>
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'default'
    )

    const reset = useCallback(() => {
        setStep('configure')
        setDiagramType('architecture')
        setFocus('')
        setGenerating(false)
        setSelfRepairing(false)
        setGenerateError(null)
        setFallbackLoading(false)
        setMermaidSource(null)
        setTruncated(false)
        setIsDeterministic(false)
        setRenderError(null)
        setSvgMarkup(null)
        setEmbedTarget('readme-mermaid')
        setEmbedPlacement('after-intro')
        setEmbedCustomAnchor('')
        setEmbedPreviewing(false)
        setEmbedError(null)
        setEmbedPreviewData(null)
        setReadmeCommitMessage('')
        setSvgCommitMessage('')
        setCommitting(false)
        setCommitError(null)
        setCommittedResult(null)
        retriedRef.current = false
    }, [])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- isOpen→false reset
        if (!isOpen) reset()
    }, [isOpen, reset])

    // Observe <html class="dark"> so the diagram re-renders on theme toggle —
    // same approach as WalkthroughTab.jsx.
    useEffect(() => {
        if (typeof MutationObserver === 'undefined') return undefined
        const root = document.documentElement
        const observer = new MutationObserver(() => {
            const next = root.classList.contains('dark') ? 'dark' : 'default'
            setTheme((current) => (current === next ? current : next))
        })
        observer.observe(root, { attributes: true, attributeFilter: ['class'] })
        return () => observer.disconnect()
    }, [])

    const handleRenderFailure = useCallback(async (message, failedSource) => {
        if (retriedRef.current) {
            setRenderError(message)
            return
        }
        retriedRef.current = true
        setSelfRepairing(true)
        try {
            const res = await aiApi.diagrams.generate(repo, {
                diagramType, focus: focus.trim() || undefined,
                retry: true, failedSource, parseError: message,
            })
            if (res?.mock || !res?.mermaid) {
                setRenderError(message)
                return
            }
            setTruncated(!!res.truncated)
            setIsDeterministic(false)
            setMermaidSource(res.mermaid) // triggers the render effect again
        } catch {
            setRenderError(message)
        } finally {
            setSelfRepairing(false)
        }
    }, [repo, diagramType, focus])

    // Render the diagram — structurally the same effect as WalkthroughTab.jsx.
    useEffect(() => {
        let cancelled = false
        const src = mermaidSource?.trim()
        if (!src || !mermaidRef.current) return undefined

        import('mermaid').then((mod) => {
            if (cancelled) return
            const mermaid = mod.default || mod
            // htmlLabels:false forces SVG <text> labels instead of <foreignObject>
            // HTML — parseAndSanitizeSvg strips foreignObject as an XSS defence,
            // which would otherwise erase every flowchart node label.
            mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: true } })
            const id = `diagram-${Math.random().toString(36).slice(2)}`
            mermaid.render(id, src).then(({ svg }) => {
                if (cancelled || !mermaidRef.current) return
                const node = parseAndSanitizeSvg(svg)
                if (!node) {
                    // Sanitization failure is a distinct client-side defence
                    // tripping, not a model mistake — never retry this.
                    setRenderError('Diagram failed to render safely')
                    return
                }
                setRenderError(null)
                mermaidRef.current.replaceChildren(document.importNode(node, true))
                setSvgMarkup(new XMLSerializer().serializeToString(node))
            }).catch((err) => {
                if (cancelled) return
                handleRenderFailure(err?.message || 'Failed to render diagram', src)
            })
        }).catch((err) => {
            if (!cancelled) setRenderError(err?.message || 'Failed to load mermaid')
        })

        return () => { cancelled = true }
    }, [mermaidSource, theme, handleRenderFailure])

    const generate = useCallback(async () => {
        if (!repo?.full_name) return
        setGenerating(true)
        setGenerateError(null)
        setRenderError(null)
        setSvgMarkup(null)
        setIsDeterministic(false)
        retriedRef.current = false
        try {
            const res = await aiApi.diagrams.generate(repo, { diagramType, focus: focus.trim() || undefined })
            if (res?.mock) {
                const message = res.aiConfigured === false
                    ? 'Connect an AI provider in Settings → AI Configuration to generate diagrams.'
                    : 'AI provider is temporarily unavailable — please try again in a moment.'
                const err = new Error(message)
                err.code = res.aiConfigured === false ? 'AI_NOT_CONFIGURED' : 'AI_UNAVAILABLE'
                setGenerateError(err)
                return
            }
            setTruncated(!!res.truncated)
            setMermaidSource(res.mermaid)
            setStep('result')
        } catch (e) {
            setGenerateError(e)
        } finally {
            setGenerating(false)
        }
    }, [repo, diagramType, focus])

    // Addendum 6b.2 fallback: a zero-AI-cost structure diagram, reachable
    // from two places — (1) the configure-stage error banner whenever the
    // initial generate call fails (no provider configured, a provider
    // error, or a 429 quota-exceeded), and (2) the result-stage error once
    // the retry-once self-repair has also failed to render. Either way this
    // never blocks the embed flow on AI availability.
    const useDeterministicFallback = useCallback(async () => {
        if (!repo?.full_name) return
        setFallbackLoading(true)
        try {
            const res = await aiApi.diagrams.deterministic(repo, { diagramType })
            setTruncated(!!res.truncated)
            setIsDeterministic(true)
            setRenderError(null)
            setGenerateError(null)
            setMermaidSource(res.mermaid)
            setStep('result')
        } catch (e) {
            toast.error(e?.message || 'Failed to build a deterministic diagram')
        } finally {
            setFallbackLoading(false)
        }
    }, [repo, diagramType, toast])

    const copyMermaid = useCallback(async () => {
        const ok = await copyToClipboard(mermaidSource || '')
        toast[ok ? 'success' : 'error'](ok ? 'Mermaid source copied' : 'Copy failed — select and copy manually')
    }, [mermaidSource, toast])

    const copySvg = useCallback(async () => {
        const ok = await copyToClipboard(svgMarkup || '')
        toast[ok ? 'success' : 'error'](ok ? 'SVG copied' : 'Copy failed — select and copy manually')
    }, [svgMarkup, toast])

    const downloadSvg = useCallback(() => {
        if (!svgMarkup) return
        const blob = new Blob([svgMarkup], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'diagram.svg'
        a.click()
        URL.revokeObjectURL(url)
    }, [svgMarkup])

    // ---- Embed flow (Addendum 6b.1) ---------------------------------------

    const openEmbedConfig = useCallback(() => {
        setEmbedError(null)
        setEmbedPreviewData(null)
        setStep('embed-config')
    }, [])

    const previewEmbed = useCallback(async () => {
        if (!repo?.full_name) return
        setEmbedPreviewing(true)
        setEmbedError(null)
        try {
            const payload = {
                repo: { full_name: repo.full_name },
                diagramType,
                target: embedTarget,
                placement: embedPlacement,
                truncated,
                ...(embedPlacement === 'custom' ? { customAnchor: embedCustomAnchor.trim() } : {}),
                ...(embedTarget === 'readme-mermaid' ? { mermaid: mermaidSource } : { svg: svgMarkup }),
            }
            const res = await aiApi.diagrams.embedPreview(payload)
            setEmbedPreviewData(res)
            setReadmeCommitMessage(res.readme?.commitMessage || '')
            setSvgCommitMessage(res.svg?.commitMessage || '')
            setStep('embed-preview')
        } catch (e) {
            setEmbedError(e)
        } finally {
            setEmbedPreviewing(false)
        }
    }, [repo, diagramType, embedTarget, embedPlacement, embedCustomAnchor, truncated, mermaidSource, svgMarkup])

    const doEmbedCommit = useCallback(async (mode) => {
        if (!embedPreviewData || !repo?.full_name) return
        setCommitting(true)
        setCommitError(null)
        try {
            const payload = {
                repo: { full_name: repo.full_name },
                diagramType,
                target: embedTarget,
                mode,
                ...(embedPreviewData.readme ? {
                    readme: { path: embedPreviewData.readme.path, content: embedPreviewData.readme.after, commitMessage: readmeCommitMessage },
                } : {}),
                ...(embedPreviewData.svg ? {
                    svg: { path: embedPreviewData.svg.path, content: embedPreviewData.svg.content, commitMessage: svgCommitMessage },
                } : {}),
            }
            const res = await aiApi.diagrams.embedCommit(payload)
            setCommittedResult(res)
            setStep('embed-committed')
        } catch (e) {
            setCommitError(e)
        } finally {
            setCommitting(false)
        }
    }, [embedPreviewData, repo, diagramType, embedTarget, readmeCommitMessage, svgCommitMessage])

    const canEmbed = !!mermaidSource && !renderError && !selfRepairing

    const renderConfigureStage = () => (
        <div className="space-y-4">
            {generateError && (
                <>
                    <AIErrorState error={generateError} onRetry={generate} context="Diagram generator" variant="banner" />
                    <Button variant="secondary" size="sm" onClick={useDeterministicFallback} disabled={fallbackLoading}>
                        {fallbackLoading ? 'Building…' : 'Use deterministic diagram instead'}
                    </Button>
                </>
            )}

            <div className="grid grid-cols-1 gap-3">
                <Field label="Diagram type" hint="Sequence and flow diagrams are planned for a future release">
                    <Select
                        label="Diagram type"
                        value={diagramType}
                        onChange={setDiagramType}
                        options={DIAGRAM_TYPE_OPTIONS}
                        disabled={generating}
                    />
                </Field>
                <Field label="Focus (optional)" hint="e.g. &quot;focus on the auth flow&quot;">
                    <Input
                        size="sm"
                        value={focus}
                        onChange={(e) => setFocus(e.target.value)}
                        placeholder="Leave blank for a general overview"
                        disabled={generating}
                    />
                </Field>
            </div>

            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>AI-generated approximation — not a verified static-analysis dependency graph. Relationships are the model&apos;s best-effort inference from file/folder names, not real dependency analysis.</span>
            </div>

            {(generating || selfRepairing) && (
                <div className="flex items-center justify-center py-4">
                    <SectionSpinner label="Generating diagram from your repo's structure…" padding="py-2" />
                </div>
            )}
        </div>
    )

    const renderResultStage = () => (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral" size="xs">Architecture</Badge>
                {truncated && (
                    <Badge tone="warning" size="xs">Based on a partial (truncated) file listing</Badge>
                )}
                {isDeterministic && (
                    <Badge tone="warning" size="xs">Deterministic (no AI)</Badge>
                )}
            </div>

            <div
                role="note"
                className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400"
            >
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                    {isDeterministic
                        ? 'Deterministic structure diagram — enable an AI provider for a richer, inference-based diagram.'
                        : 'AI-generated approximation — not a verified static-analysis dependency graph.'}
                </span>
            </div>

            {(selfRepairing || generating) && (
                <div className="flex items-center justify-center py-4">
                    <SectionSpinner
                        label={selfRepairing ? 'Diagram failed to parse — attempting one automatic repair…' : 'Regenerating diagram…'}
                        padding="py-2"
                    />
                </div>
            )}

            {!selfRepairing && !generating && renderError && (
                <div role="alert" className="px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-sm text-red-600 dark:text-red-400">
                    Diagram failed to render: {renderError}
                </div>
            )}

            {!selfRepairing && !generating && !renderError && (
                <div
                    ref={mermaidRef}
                    data-testid="diagram-mermaid-output"
                    className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900 min-h-[160px]"
                />
            )}
        </div>
    )

    const renderEmbedConfigStage = () => (
        <div className="space-y-4">
            {embedError && (
                <AIErrorState error={embedError} onRetry={previewEmbed} context="Diagram embed" variant="banner" />
            )}

            <div className="grid grid-cols-1 gap-3">
                <Field label="Embed as">
                    <Select label="Embed as" value={embedTarget} onChange={setEmbedTarget} options={EMBED_TARGET_OPTIONS} disabled={embedPreviewing} />
                </Field>
                <Field label="Placement in README" hint="Only used when the README has no existing diagram markers to replace">
                    <Select label="Placement" value={embedPlacement} onChange={setEmbedPlacement} options={PLACEMENT_OPTIONS} disabled={embedPreviewing} />
                </Field>
                {embedPlacement === 'custom' && (
                    <Field label="Insert after the line containing…">
                        <Input
                            size="sm"
                            value={embedCustomAnchor}
                            onChange={(e) => setEmbedCustomAnchor(e.target.value)}
                            placeholder='e.g. "## Architecture"'
                            disabled={embedPreviewing}
                        />
                    </Field>
                )}
            </div>

            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                <span>Regenerating later replaces this exact block (marker-based) instead of duplicating it. Nothing is written until you review the diff and confirm on the next screen.</span>
            </div>

            {embedPreviewing && (
                <div className="flex items-center justify-center py-4">
                    <SectionSpinner label="Building preview…" padding="py-2" />
                </div>
            )}
        </div>
    )

    const renderEmbedPreviewStage = () => {
        const data = embedPreviewData
        if (!data) return null

        if (data.hasReadme === false && data.target === 'readme-mermaid') {
            return (
                <div className="space-y-3">
                    <div role="status" className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{data.notice}</span>
                    </div>
                    <Button variant="secondary" onClick={() => { setEmbedTarget('svg-file'); setStep('embed-config') }}>
                        Switch to committed SVG file
                    </Button>
                </div>
            )
        }

        return (
            <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral" size="xs">{data.target === 'svg-file' ? 'Committed SVG file' : 'README mermaid fence'}</Badge>
                    {data.action === 'replaced' && <Badge tone="success" size="xs">Replaces existing block</Badge>}
                    {data.readOnly && (
                        <Badge tone="danger" size="xs">
                            <Lock className="w-3 h-3 mr-1 inline" /> Read-only access
                        </Badge>
                    )}
                </div>

                {data.readOnly && (
                    <div role="alert" className="px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-sm text-red-600 dark:text-red-400">
                        You don&apos;t have push access to this repository — embedding requires push rights (opening a pull request from a fork isn&apos;t supported yet).
                    </div>
                )}

                {(data.notice || data.readme?.notice) && !data.readOnly && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{data.notice || data.readme?.notice}</span>
                    </div>
                )}

                {commitError && (
                    <div role="alert" className="px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-sm text-red-600 dark:text-red-400">
                        {commitError.message || 'Failed to commit. Please retry.'}
                    </div>
                )}

                {data.svg && (
                    <div className="space-y-2">
                        <Field label="SVG commit message">
                            <Input size="sm" value={svgCommitMessage} onChange={(e) => setSvgCommitMessage(e.target.value)} disabled={committing} aria-label="SVG commit message" />
                        </Field>
                        <div className="text-xs text-slate-500 dark:text-slate-400" data-testid="diagram-embed-svg-path">
                            New file: <span className="font-mono">{data.svg.path}</span>
                        </div>
                    </div>
                )}

                {data.readme && (
                    <div className="space-y-2">
                        <Field label="README commit message">
                            <Input size="sm" value={readmeCommitMessage} onChange={(e) => setReadmeCommitMessage(e.target.value)} disabled={committing} aria-label="README commit message" />
                        </Field>
                        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                            <DiffView
                                data={{
                                    oldFile: { fileName: data.readme.path, content: data.readme.before || '' },
                                    newFile: { fileName: `${data.readme.path} (with diagram)`, content: data.readme.after },
                                    hunks: [],
                                }}
                                diffViewMode={DiffModeEnum.Split}
                                diffViewTheme={theme === 'dark' ? 'dark' : 'light'}
                            />
                        </div>
                    </div>
                )}
            </div>
        )
    }

    const renderEmbedCommittedStage = () => (
        <div className="flex flex-col items-center text-center gap-4 py-8">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="space-y-1">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">Diagram embedded</h3>
                {committedResult?.svg && (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        SVG: {committedResult.svg.mode === 'pr-fallback' || committedResult.svg.mode === 'pr'
                            ? `pull request opened on ${committedResult.svg.branch}`
                            : `committed to ${committedResult.svg.branch}`}
                    </p>
                )}
                {committedResult?.readme && (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        README: {committedResult.readme.mode === 'pr-fallback' || committedResult.readme.mode === 'pr'
                            ? `pull request opened on ${committedResult.readme.branch}`
                            : `committed to ${committedResult.readme.branch}`}
                    </p>
                )}
            </div>
            {(committedResult?.svg?.prUrl || committedResult?.readme?.prUrl) && (
                <a
                    href={committedResult.svg?.prUrl || committedResult.readme?.prUrl}
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
        if (step === 'result') {
            return (
                <ModalFooter align="right">
                    <Button variant="ghost" onClick={() => setStep('configure')} disabled={selfRepairing || generating}>
                        <ArrowLeft className="w-4 h-4" /> Back
                    </Button>
                    {(renderError || generating) && (
                        <Button variant="secondary" onClick={generate} disabled={generating}>
                            <RotateCcw className="w-4 h-4" /> {generating ? 'Regenerating…' : 'Regenerate'}
                        </Button>
                    )}
                    {renderError && !generating && (
                        <Button variant="secondary" onClick={useDeterministicFallback} disabled={fallbackLoading}>
                            {fallbackLoading ? 'Building…' : 'Use deterministic diagram instead'}
                        </Button>
                    )}
                    <Button variant="secondary" onClick={copyMermaid} disabled={!mermaidSource}>
                        <Copy className="w-4 h-4" /> Copy Mermaid
                    </Button>
                    <Button variant="secondary" onClick={copySvg} disabled={!svgMarkup}>
                        <Copy className="w-4 h-4" /> Copy SVG
                    </Button>
                    <Button variant="secondary" onClick={downloadSvg} disabled={!svgMarkup}>
                        <Download className="w-4 h-4" /> Download SVG
                    </Button>
                    <Button onClick={openEmbedConfig} disabled={!canEmbed}>
                        <GitBranch className="w-4 h-4" /> Embed in repo
                    </Button>
                </ModalFooter>
            )
        }
        if (step === 'embed-config') {
            return (
                <ModalFooter align="right">
                    <Button variant="ghost" onClick={() => setStep('result')} disabled={embedPreviewing}>
                        <ArrowLeft className="w-4 h-4" /> Back
                    </Button>
                    <Button onClick={previewEmbed} disabled={embedPreviewing || (embedPlacement === 'custom' && !embedCustomAnchor.trim())}>
                        {embedPreviewing ? 'Building…' : 'Preview'}
                    </Button>
                </ModalFooter>
            )
        }
        if (step === 'embed-preview') {
            const noReadmeForMermaid = embedPreviewData?.hasReadme === false && embedPreviewData?.target === 'readme-mermaid'
            const missingCommitMessage = (embedPreviewData?.readme && !readmeCommitMessage.trim())
                || (embedPreviewData?.svg && !svgCommitMessage.trim())
            const blocked = embedPreviewData?.readOnly || noReadmeForMermaid || missingCommitMessage
            return (
                <ModalFooter align="right">
                    <Button variant="ghost" onClick={() => setStep('embed-config')} disabled={committing}>
                        <ArrowLeft className="w-4 h-4" /> Back
                    </Button>
                    <Button variant="secondary" onClick={() => doEmbedCommit('pr')} disabled={committing || blocked}>
                        {committing ? 'Working…' : 'Open PR'}
                    </Button>
                    <Button onClick={() => doEmbedCommit('direct')} disabled={committing || blocked}>
                        {committing ? 'Working…' : 'Apply'}
                    </Button>
                </ModalFooter>
            )
        }
        if (step === 'embed-committed') {
            return <ModalFooter align="right"><Button onClick={onClose}>Done</Button></ModalFooter>
        }
        return null
    }

    const stageContent = useMemo(() => {
        if (step === 'configure') return renderConfigureStage()
        if (step === 'result') return renderResultStage()
        if (step === 'embed-config') return renderEmbedConfigStage()
        if (step === 'embed-preview') return renderEmbedPreviewStage()
        if (step === 'embed-committed') return renderEmbedCommittedStage()
        return null
        // eslint-disable-next-line react-hooks/exhaustive-deps -- render* helpers close over current state deliberately, re-derived every render
    }, [step, generating, generateError, diagramType, focus, selfRepairing, truncated, isDeterministic, renderError,
        embedError, embedTarget, embedPlacement, embedCustomAnchor, embedPreviewing, embedPreviewData,
        readmeCommitMessage, svgCommitMessage, committing, commitError, committedResult, fallbackLoading, theme])

    return (
        <Modal
            isOpen={isOpen}
            onClose={committing ? undefined : onClose}
            title="AI Diagram Generator"
            subtitle={repo?.full_name}
            icon={Workflow}
            iconGradient="primary"
            size="xl"
            footer={renderFooter()}
            closeOnBackdrop={!committing}
        >
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TRANSITION.fast}>
                {stageContent}
            </motion.div>
        </Modal>
    )
}
