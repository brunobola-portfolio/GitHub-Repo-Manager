// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Workflow, Copy, Download, RotateCcw, ArrowLeft, AlertTriangle } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { SectionSpinner } from '../ui/Spinner'
import { AIErrorState } from '../ui/AIErrorState'
import { Select } from '../ui/Select'
import { Field } from '../ui/form/Field'
import { Input } from '../ui/form/Input'
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

/**
 * AI Diagram Generator — generates a Mermaid architecture diagram grounded in
 * the repo's real file tree/contents/README, renders it client-side (adapted
 * from WalkthroughTab.jsx's render pipeline: lazy mermaid import, strict
 * security level, parseAndSanitizeSvg defence-in-depth), and offers Copy
 * Mermaid / Copy SVG / Download SVG export. No auto-commit — export only.
 *
 * Honesty constraint: the diagram is a persistent, labelled AI approximation,
 * never presented as a verified static-analysis dependency graph.
 *
 * Retry-once self-repair: when mermaid.render() rejects (a syntax error the
 * model produced), we silently re-request generation exactly once with the
 * failed source + parser error appended server-side. If the repaired diagram
 * also fails to render, we stop auto-retrying and show an inline error with
 * a manual "Regenerate" button (a fresh, normally-metered request).
 */
export function DiagramGenerator({ isOpen, onClose, repo }) {
    const { toast } = useToast()
    const [step, setStep] = useState('configure') // configure | result
    const [diagramType, setDiagramType] = useState('architecture')
    const [focus, setFocus] = useState('')

    const [generating, setGenerating] = useState(false)
    const [selfRepairing, setSelfRepairing] = useState(false)
    const [generateError, setGenerateError] = useState(null)

    const [mermaidSource, setMermaidSource] = useState(null)
    const [truncated, setTruncated] = useState(false)
    const [renderError, setRenderError] = useState(null)
    const [svgMarkup, setSvgMarkup] = useState(null)

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
        setMermaidSource(null)
        setTruncated(false)
        setRenderError(null)
        setSvgMarkup(null)
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
            mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' })
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

    const renderConfigureStage = () => (
        <div className="space-y-4">
            {generateError && (
                <AIErrorState error={generateError} onRetry={generate} context="Diagram generator" variant="banner" />
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
            </div>

            <div
                role="note"
                className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400"
            >
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>AI-generated approximation — not a verified static-analysis dependency graph.</span>
            </div>

            {selfRepairing && (
                <div className="flex items-center justify-center py-4">
                    <SectionSpinner label="Diagram failed to parse — attempting one automatic repair…" padding="py-2" />
                </div>
            )}

            {!selfRepairing && renderError && (
                <div role="alert" className="px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-sm text-red-600 dark:text-red-400">
                    Diagram failed to render: {renderError}
                </div>
            )}

            {!selfRepairing && !renderError && (
                <div
                    ref={mermaidRef}
                    data-testid="diagram-mermaid-output"
                    className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900 min-h-[160px]"
                />
            )}
        </div>
    )

    const renderFooter = () => {
        if (step === 'configure') {
            return (
                <>
                    <Button variant="ghost" onClick={onClose}>Close</Button>
                    <Button onClick={generate} disabled={generating}>
                        {generating ? 'Generating…' : 'Generate'}
                    </Button>
                </>
            )
        }
        // result stage
        return (
            <>
                <Button variant="ghost" onClick={() => setStep('configure')} disabled={selfRepairing}>
                    <ArrowLeft className="w-4 h-4" /> Back
                </Button>
                {renderError && (
                    <Button variant="secondary" onClick={generate} disabled={generating}>
                        <RotateCcw className="w-4 h-4" /> Regenerate
                    </Button>
                )}
                <Button variant="secondary" onClick={copyMermaid} disabled={!mermaidSource}>
                    <Copy className="w-4 h-4" /> Copy Mermaid
                </Button>
                <Button variant="secondary" onClick={copySvg} disabled={!svgMarkup}>
                    <Copy className="w-4 h-4" /> Copy SVG
                </Button>
                <Button onClick={downloadSvg} disabled={!svgMarkup}>
                    <Download className="w-4 h-4" /> Download SVG
                </Button>
            </>
        )
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="AI Diagram Generator"
            subtitle={repo?.full_name}
            icon={Workflow}
            iconGradient="primary"
            size="xl"
            footer={renderFooter()}
        >
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
                {step === 'configure' ? renderConfigureStage() : renderResultStage()}
            </motion.div>
        </Modal>
    )
}
