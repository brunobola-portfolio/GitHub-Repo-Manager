// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ImagePlus, AlertTriangle, ArrowLeft, RotateCcw, CheckCircle, ExternalLink, Settings, Workflow } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { SectionSpinner } from '../ui/Spinner'
import { AIErrorState } from '../ui/AIErrorState'
import { Select } from '../ui/Select'
import { Field } from '../ui/form/Field'
import { Input } from '../ui/form/Input'
import { aiApi } from '../../api/ai'
import { openAISettings } from '../../utils/appEvents'

const PROMPT_EXTRAS_MAX = 150

function formatCost(cost) {
    if (!cost || cost.costCents == null) return 'pricing unavailable'
    const dollars = (cost.costCents / 100).toFixed(2)
    return cost.estimated ? `~$${dollars} (estimated)` : `~$${dollars}`
}

/**
 * AI Image Generator — repo-grounded raster banners/logos (social preview /
 * README hero / logo draft), gated behind server-side capability detection
 * (r5 §4.1): none of Gemini/OpenAI/OpenRouter/Anthropic/local support image
 * output uniformly, so this modal ALWAYS checks GET .../capability first and
 * shows a static "not available" state rather than a spinner-then-fail.
 *
 * Preview-before-commit (r5 §4.5, mirrors DiagramGenerator / AgentRulesModal):
 * generate() never writes to the repo — the client renders the returned
 * base64 PNG inline, and only an explicit "Apply" / "Open PR" writes it, via
 * the binary-safe commit endpoint (server/lib/ai-features/community-health-fix.js's
 * `encoding: 'base64'` mode).
 *
 * `promptExtras` is a short, additive style/color-hint field — not a
 * free-text prompt replacement (r5 §4.6); the server always appends its
 * content-safety constraints after it so they can't be overridden.
 */
export function ImageGeneratorModal({ isOpen, onClose, repo, onFallbackToDiagram }) {
    const [capability, setCapability] = useState(null)
    const [capabilityLoading, setCapabilityLoading] = useState(true)
    const [capabilityError, setCapabilityError] = useState(null)

    const [step, setStep] = useState('configure') // configure | result | committed
    const [preset, setPreset] = useState('social')
    const [promptExtras, setPromptExtras] = useState('')

    const [generating, setGenerating] = useState(false)
    const [generateError, setGenerateError] = useState(null)
    const [imageResult, setImageResult] = useState(null)

    const [commitMessage, setCommitMessage] = useState('')
    const [committing, setCommitting] = useState(false)
    const [commitError, setCommitError] = useState(null)
    const [committedResult, setCommittedResult] = useState(null)

    const reset = useCallback(() => {
        setCapability(null)
        setCapabilityLoading(true)
        setCapabilityError(null)
        setStep('configure')
        setPreset('social')
        setPromptExtras('')
        setGenerating(false)
        setGenerateError(null)
        setImageResult(null)
        setCommitMessage('')
        setCommitting(false)
        setCommitError(null)
        setCommittedResult(null)
    }, [])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- isOpen→false reset
        if (!isOpen) { reset(); return undefined }

        let cancelled = false
        setCapabilityLoading(true)
        setCapabilityError(null)
        aiApi.images.capability()
            .then((res) => { if (!cancelled) setCapability(res) })
            .catch((e) => { if (!cancelled) setCapabilityError(e) })
            .finally(() => { if (!cancelled) setCapabilityLoading(false) })
        return () => { cancelled = true }
    }, [isOpen, reset])

    const fetchCapability = useCallback(() => {
        setCapabilityLoading(true)
        setCapabilityError(null)
        aiApi.images.capability()
            .then((res) => setCapability(res))
            .catch((e) => setCapabilityError(e))
            .finally(() => setCapabilityLoading(false))
    }, [])

    const presetOptions = useMemo(() => {
        const presets = capability?.presets || {}
        return ['social', 'hero', 'logo'].map((key) => ({
            value: key,
            label: presets[key] ? `${presets[key].label} (${presets[key].dimensions})` : key,
        }))
    }, [capability])

    const activePreset = capability?.presets?.[preset]

    const generate = useCallback(async () => {
        if (!repo?.full_name) return
        setGenerating(true)
        setGenerateError(null)
        try {
            const res = await aiApi.images.generate(repo, { preset, promptExtras: promptExtras.trim() || undefined })
            setImageResult({ ...res, preset })
            setCommitMessage(`docs: add AI-generated ${(activePreset?.label || 'image').toLowerCase()}`)
            setStep('result')
        } catch (e) {
            setGenerateError(e)
        } finally {
            setGenerating(false)
        }
    }, [repo, preset, promptExtras, activePreset])

    const doCommit = useCallback(async (mode) => {
        if (!imageResult || !repo?.full_name) return
        setCommitting(true)
        setCommitError(null)
        try {
            const res = await aiApi.images.commit({
                repo: { full_name: repo.full_name },
                preset: imageResult.preset,
                base64: imageResult.base64,
                commitMessage: commitMessage.trim() || undefined,
                mode,
            })
            setCommittedResult(res)
            setStep('committed')
        } catch (e) {
            setCommitError(e)
        } finally {
            setCommitting(false)
        }
    }, [imageResult, repo, commitMessage])

    const backToConfigure = useCallback(() => {
        setGenerateError(null)
        setStep('configure')
    }, [])

    const useDiagramInstead = useCallback(() => {
        onClose?.()
        onFallbackToDiagram?.()
    }, [onClose, onFallbackToDiagram])

    // ---- Render stages -----------------------------------------------------

    const renderUnavailableStage = () => (
        <div className="flex flex-col items-center text-center gap-4 py-6" data-testid="image-generator-unavailable">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <ImagePlus className="w-7 h-7 text-slate-400 dark:text-slate-500" />
            </div>
            <div className="space-y-1 max-w-sm">
                <h3 className="font-bold text-slate-900 dark:text-slate-100">Image generation isn&apos;t available with the current AI provider</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    {capability?.provider
                        ? `Your configured provider (${capability.provider}) doesn't support image output. Switch to Gemini, OpenAI, or OpenRouter in Settings → AI to use this feature.`
                        : 'No AI provider is configured. Set one up in Settings → AI to use this feature.'}
                </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="secondary" onClick={openAISettings}>
                    <Settings className="w-4 h-4" /> Open AI Settings
                </Button>
                {onFallbackToDiagram && (
                    <Button variant="ghost" onClick={useDiagramInstead}>
                        <Workflow className="w-4 h-4" /> Generate a diagram instead
                    </Button>
                )}
            </div>
        </div>
    )

    const renderConfigureStage = () => (
        <div className="space-y-4">
            {generateError && (
                <AIErrorState error={generateError} onRetry={generate} context="Image generator" variant="banner" />
            )}

            <div className="grid grid-cols-1 gap-3">
                <Field label="Image type">
                    <Select
                        label="Image type"
                        value={preset}
                        onChange={setPreset}
                        options={presetOptions}
                        disabled={generating}
                    />
                </Field>
                <Field label="Style hints (optional)" hint="A short additive hint — e.g. colors or mood. Content-safety rules always apply.">
                    <Input
                        size="sm"
                        value={promptExtras}
                        onChange={(e) => setPromptExtras(e.target.value.slice(0, PROMPT_EXTRAS_MAX))}
                        placeholder='e.g. "teal and navy palette, minimalist"'
                        disabled={generating}
                        maxLength={PROMPT_EXTRAS_MAX}
                    />
                </Field>
            </div>

            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                <span>Estimated cost for this generation</span>
                <Badge tone="neutral" size="xs">{formatCost(activePreset?.cost)}</Badge>
            </div>

            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>No real people, no third-party logos or brand imitation — the AI provider may still decline prompts it judges unsafe.</span>
            </div>

            {generating && (
                <div className="flex items-center justify-center py-4">
                    <SectionSpinner label="Generating image…" padding="py-2" />
                </div>
            )}
        </div>
    )

    const renderResultStage = () => {
        if (!imageResult) return null
        return (
            <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral" size="xs">{activePreset?.label || imageResult.preset}</Badge>
                    <Badge tone="neutral" size="xs">{formatCost({ costCents: imageResult.costCents, estimated: imageResult.estimatedCost })}</Badge>
                </div>

                {commitError && (
                    <div role="alert" className="px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-sm text-red-600 dark:text-red-400">
                        {commitError.message || 'Failed to commit. Please retry.'}
                    </div>
                )}

                <div className="flex justify-center rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
                    <img
                        src={`data:${imageResult.mimeType};base64,${imageResult.base64}`}
                        alt={`AI-generated ${activePreset?.label || imageResult.preset} preview`}
                        className="max-w-full max-h-80 rounded-md object-contain"
                        data-testid="image-generator-preview"
                    />
                </div>

                <Field label="Commit message">
                    <Input size="sm" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} disabled={committing} aria-label="Commit message" />
                </Field>
                <div className="text-xs text-slate-500 dark:text-slate-400" data-testid="image-generator-path">
                    New file: <span className="font-mono">{imageResult.path}</span>
                </div>
            </div>
        )
    }

    const renderCommittedStage = () => (
        <div className="flex flex-col items-center text-center gap-4 py-8">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="space-y-1">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">Image committed</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    {committedResult?.mode === 'pr-fallback' || committedResult?.mode === 'pr'
                        ? `Pull request opened on ${committedResult.branch}`
                        : `Committed to ${committedResult?.branch}`}
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
        if (capabilityLoading || capabilityError || capability?.available === false) return (
            <Button variant="ghost" onClick={onClose}>Close</Button>
        )
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
        if (step === 'result') {
            return (
                <>
                    <Button variant="ghost" onClick={backToConfigure} disabled={committing}>
                        <ArrowLeft className="w-4 h-4" /> Back
                    </Button>
                    <Button variant="secondary" onClick={generate} disabled={generating || committing}>
                        <RotateCcw className="w-4 h-4" /> Regenerate
                    </Button>
                    <Button variant="secondary" onClick={() => doCommit('pr')} disabled={committing || !commitMessage.trim()}>
                        {committing ? 'Working…' : 'Open PR'}
                    </Button>
                    <Button onClick={() => doCommit('direct')} disabled={committing || !commitMessage.trim()}>
                        {committing ? 'Working…' : 'Apply'}
                    </Button>
                </>
            )
        }
        if (step === 'committed') {
            return <Button onClick={onClose}>Done</Button>
        }
        return null
    }

    const body = capabilityLoading ? (
        <div className="flex items-center justify-center py-8">
            <SectionSpinner label="Checking image generation availability…" padding="py-2" />
        </div>
    ) : capabilityError ? (
        <AIErrorState error={capabilityError} onRetry={fetchCapability} context="Image generator" variant="banner" />
    ) : capability?.available === false ? (
        renderUnavailableStage()
    ) : step === 'configure' ? (
        renderConfigureStage()
    ) : step === 'result' ? (
        renderResultStage()
    ) : (
        renderCommittedStage()
    )

    return (
        <Modal
            isOpen={isOpen}
            onClose={committing ? undefined : onClose}
            title="AI Image Generator"
            subtitle={repo?.full_name}
            icon={ImagePlus}
            iconGradient="primary"
            size="lg"
            footer={renderFooter()}
            closeOnBackdrop={!committing}
        >
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
                {body}
            </motion.div>
        </Modal>
    )
}
