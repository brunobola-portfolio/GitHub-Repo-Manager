import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Modal } from '../ui/Modal'
import { SectionPanel } from '../ui/SectionPanel'
import { reposApi } from '../../api/repos'
import { ShieldCheck, CheckCircle2, XCircle, Lock, MinusCircle, Info, Sparkles, RotateCcw } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'
import { SectionSpinner, Spinner } from '../ui/Spinner'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { riskFillClass, riskTextClass, riskTintClass, riskRingClass, normalizeRiskLevel } from '../../utils/riskTokens'
import { listContainer, listItem, fadeRise } from '../ui/motion'

/**
 * SecurityScanModal — "Security Posture" report card.
 *
 * Layout (top to bottom, per docs/specs/2026-07-18-community-wow-wave6.md
 * Feature 4): score header -> 10 deterministic check rows -> AI summary
 * footer (progressive enhancement, own load state) -> the original 3
 * alert-source sections, collapsed by default.
 *
 * Honesty contract: the deterministic checks (from GET .../security) render
 * fully and correctly on their own. The AI summary is fetched separately and
 * NEVER blocks or replaces the report card — a failed/quota-exceeded summary
 * call degrades to a quiet "unavailable" note, not an error banner and not a
 * fabricated/hedged summary.
 *
 * Fix-path copy is static text, not a cross-modal navigation action — this
 * modal doesn't have access to ModalContext today (see ModalSurfaces.jsx),
 * and spec explicitly rules out inventing new fix actions in v1.
 */

const FIX_HINTS = {
    branch_protection_review: 'Fix from the repo’s Branches tab → Protection.',
    branch_protection_force_push: 'Fix from the repo’s Branches tab → Protection.',
    security_md: 'Generate one from the Community Health panel.',
}

const STATUS_LABEL = {
    pass: 'Pass',
    fail: 'Fail',
    unknown: 'Unknown — admin required',
    not_applicable: 'Not applicable',
    informational: 'Informational',
}

const STATUS_ICON = {
    pass: CheckCircle2,
    fail: XCircle,
    unknown: Lock,
    not_applicable: MinusCircle,
    informational: Info,
}

/** Map a check row onto the shared ds-risk-* vocabulary. Pass reads as 'low'
 * (green) — there's no dedicated "good" token, and green already carries
 * that meaning everywhere else risk tokens are used. Every non-fail,
 * non-pass state (unknown / not_applicable / informational) reads neutral —
 * they are deliberately NOT colored as risk, only 'fail' is. */
function levelForCheck(check) {
    if (check.status === 'fail') return normalizeRiskLevel(check.severity)
    if (check.status === 'pass') return 'low'
    return 'neutral'
}

function CheckStatusPill({ check }) {
    const level = levelForCheck(check)
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full ds-text-micro font-semibold uppercase tracking-wide ${riskTintClass(level)} ${riskTextClass(level)} ${riskRingClass(level)}`}>
            {STATUS_LABEL[check.status] || check.status}
        </span>
    )
}

function CheckRow({ check }) {
    const level = levelForCheck(check)
    const Icon = STATUS_ICON[check.status] || Info
    const fixHint = FIX_HINTS[check.id]
    return (
        <motion.li
            variants={listItem}
            className="flex items-start gap-3 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0"
            data-testid={`security-check-${check.id}`}
        >
            <span className={`shrink-0 mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full ${riskTintClass(level)}`}>
                <Icon className={`w-3.5 h-3.5 ${riskTextClass(level)}`} aria-hidden="true" />
            </span>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{check.label}</span>
                    <CheckStatusPill check={check} />
                </div>
                {check.why ? <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{check.why}</p> : null}
                {check.status === 'fail' && fixHint ? (
                    <p className="text-xs text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] mt-1">{fixHint}</p>
                ) : null}
            </div>
        </motion.li>
    )
}

function ScoreHeader({ score }) {
    if (!score) return null
    const { passing, failing, unknown, notApplicable, informational, total, score: pct, partialVisibility } = score
    return (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
            <div className="shrink-0 text-center sm:text-left">
                <div className="text-3xl font-bold text-slate-900 dark:text-slate-100 ds-font-display">
                    {pct === null ? '—' : `${pct}%`}
                </div>
                <div className="ds-text-micro uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {passing}/{total} checks passing
                </div>
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-1.5">
                    {passing > 0 && <Badge tone="success" size="xs">{passing} pass</Badge>}
                    {failing > 0 && <Badge tone="danger" size="xs">{failing} fail</Badge>}
                    {unknown > 0 && <Badge tone="neutral" size="xs">{unknown} unknown</Badge>}
                    {notApplicable > 0 && <Badge tone="neutral" size="xs">{notApplicable} n/a</Badge>}
                    {informational > 0 && <Badge tone="neutral" size="xs">{informational} info</Badge>}
                </div>
                {partialVisibility ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                        You don&apos;t have admin access to see every check — this score reflects only what&apos;s visible to you, not the full picture.
                    </p>
                ) : null}
            </div>
        </div>
    )
}

/** AI summary footer — its own load lifecycle, independent of the checks
 * above. Never renders an error state; a failed/quota-exceeded call just
 * shows a quiet "unavailable" note (see file header honesty contract). */
function AISummaryFooter({ repo, checks }) {
    const [state, setState] = useState('loading') // loading | ready | unavailable
    const [summary, setSummary] = useState(null)

    useEffect(() => {
        if (!repo || !checks || checks.length === 0) return
        let cancelled = false
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before the async fetch
        setState('loading')
        const payload = checks.map(({ id, label, status, severity }) => ({ id, label, status, severity: severity ?? null }))
        reposApi.getSecurityPostureSummary(repo.owner.login, repo.name, { full_name: repo.full_name, private: !!repo.private }, payload)
            .then((data) => { if (!cancelled) { setSummary(data); setState('ready') } })
            .catch(() => { if (!cancelled) setState('unavailable') })
        return () => { cancelled = true }
        // repo/checks are read-only inputs re-derived from the parent's single
        // GET /security fetch — the check array identity is stable per fetch.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [repo?.full_name, checks])

    if (state === 'loading') {
        return (
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 py-1" aria-live="polite">
                <Spinner size="sm" /> Summarizing top actions…
            </div>
        )
    }
    if (state === 'unavailable' || !summary) {
        return (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-1 italic" data-testid="security-ai-summary-unavailable">
                AI summary unavailable right now — the checks above are unaffected.
            </p>
        )
    }
    return (
        <motion.div {...fadeRise} className="space-y-2" data-testid="security-ai-summary">
            {summary.summary ? <p className="text-sm text-slate-700 dark:text-slate-300">{summary.summary}</p> : null}
            {summary.topActions?.length > 0 ? (
                <ul className="space-y-1.5">
                    {summary.topActions.map((a, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs">
                            <span className={`mt-1 shrink-0 inline-block w-1.5 h-1.5 rounded-full ${riskFillClass(normalizeRiskLevel(a.severity))}`} aria-hidden="true" />
                            <span>
                                <span className="font-medium text-slate-700 dark:text-slate-300">{a.title}</span>
                                {a.why ? <span className="text-slate-500 dark:text-slate-400"> — {a.why}</span> : null}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </motion.div>
    )
}

function AlertSeverityPill({ level, count }) {
    if (!count) return null
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${riskTintClass(level)} ${riskTextClass(level)} ${riskRingClass(level)}`}>
            <span className={`w-2 h-2 rounded-full ${riskFillClass(level)}`} aria-hidden="true" />
            {count} {level}
        </span>
    )
}

function SourceSection({ title, source }) {
    if (!source.available) {
        return (
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-slate-500 mt-1">{source.reason}</p>
            </div>
        )
    }
    return (
        <details className="group rounded-lg border border-slate-200 dark:border-slate-800">
            <summary className="p-4 cursor-pointer flex justify-between items-center">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                    {source.alerts.length} open
                </span>
            </summary>
            <ul className="px-4 pb-4 space-y-2">
                {source.alerts.slice(0, 20).map(a => (
                    <li key={a.number} className="text-xs p-2 rounded bg-slate-50 dark:bg-slate-900">
                        #{a.number} — {a.rule?.description || a.security_advisory?.summary || a.state || 'Open'}
                    </li>
                ))}
            </ul>
        </details>
    )
}

export function SecurityScanModal({ isOpen, onClose, repo }) {
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)

    // Shared by the mount effect below AND the error state's Retry button —
    // both need to (re)kick off the same fetch, resetting loading/error
    // synchronously first so a retry doesn't flash stale content.
    const loadScan = useCallback(() => {
        if (!repo) return undefined
        let cancelled = false
        setLoading(true)
        setError(null)
        reposApi.getSecurityScan(repo.owner.login, repo.name)
            .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
            .catch(err => { if (!cancelled) { setError(err); setLoading(false) } })
        return () => { cancelled = true }
    }, [repo])

    useEffect(() => {
        if (!isOpen) return undefined
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: loadScan resets loading/error synchronously before the async fetch to avoid stale UI (it's also called directly from the Retry button, outside any effect)
        return loadScan()
    }, [isOpen, loadScan])

    const checks = data?.checks || []

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Security Posture" subtitle={repo?.full_name} size="lg" data-testid="security-scan-modal">
            <div>
                {loading ? (
                    <SectionSpinner label="Scanning…" />
                ) : error ? (
                    // Security & Secrets Scan moved off the Pro paywall to Free
                    // (2026-07-18 rebalance) — the backend no longer 403s for tier, so
                    // any error here is a genuine failure (network/GitHub API), not an
                    // upsell signal. Kept as a raw message (not AIErrorState) since this
                    // isn't an AI surface and the message is a real GitHub/network error,
                    // not something to hide behind a generic code-mapped string — but it
                    // still needs a way out other than closing the whole modal.
                    <div role="alert" className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-300 text-sm space-y-2">
                        <p>{error.message || String(error)}</p>
                        <Button variant="secondary" size="sm" onClick={loadScan}>
                            <RotateCcw className="w-3.5 h-3.5" /> Retry
                        </Button>
                    </div>
                ) : data ? (
                    <div className="space-y-6">
                        <ScoreHeader score={data.score} />

                        {checks.length > 0 ? (
                            <motion.ul
                                initial="hidden"
                                animate="show"
                                variants={listContainer}
                                className="divide-y-0"
                                data-testid="security-check-list"
                            >
                                {checks.map((check) => <CheckRow key={check.id} check={check} />)}
                            </motion.ul>
                        ) : (
                            <EmptyState
                                icon={ShieldCheck}
                                title="No posture checks available"
                                description="Could not compute the security posture report card for this repository."
                            />
                        )}

                        {checks.length > 0 ? (
                            <SectionPanel eyebrow="AI" title="Summary" icon={Sparkles} tone="muted">
                                <AISummaryFooter repo={repo} checks={checks} />
                            </SectionPanel>
                        ) : null}

                        <SectionPanel title="Alert details" subtitle="Raw secret-scanning, code-scanning, and Dependabot alerts" collapsible defaultOpen={false}>
                            <div className="space-y-4">
                                {data.summary.total === 0 ? (
                                    <p className="text-xs text-slate-500 dark:text-slate-400">No open alerts from any source.</p>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        <AlertSeverityPill level="critical" count={data.summary.critical} />
                                        <AlertSeverityPill level="high" count={data.summary.high} />
                                        <AlertSeverityPill level="medium" count={data.summary.medium} />
                                        <AlertSeverityPill level="low" count={data.summary.low} />
                                    </div>
                                )}
                                <div className="space-y-3">
                                    <SourceSection title="Secret Scanning" source={data.secretScanning} />
                                    <SourceSection title="Code Scanning" source={data.codeScanning} />
                                    <SourceSection title="Dependabot" source={data.dependabot} />
                                </div>
                            </div>
                        </SectionPanel>
                    </div>
                ) : null}
            </div>
        </Modal>
    )
}
