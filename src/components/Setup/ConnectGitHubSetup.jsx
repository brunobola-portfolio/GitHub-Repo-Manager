import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    ExternalLink, KeyRound, ShieldCheck, ArrowRight, ArrowLeft,
    Eye, EyeOff, ServerCog, BookOpen,
} from 'lucide-react'
import { Github } from '../icons/GithubIcon'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/form'
import { AnimatedCheck } from '../ui/AnimatedCheck'
import { AnimatedCopyIcon } from '../ui/AnimatedCopyIcon'
import { Spinner } from '../ui/Spinner'
import { TRANSITION } from '../ui/motion'
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard'
import { getAuthSetupStatus, submitOAuthSetup } from '../../api/authSetup'
import { AUTH_ENDPOINTS } from '../../config'

const DOCS_URL = 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/docs/windows.md#connecting-to-github--ai'

const STEP_MOTION = {
    initial: { opacity: 0, x: 16 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -16 },
    transition: TRANSITION.entrance,
}

/** Read-only value row with a copy affordance — the URLs the user must
 *  paste into GitHub's OAuth App form, always exact for THIS install. */
function CopyRow({ label, value }) {
    const { copied, copy } = useCopyToClipboard()
    return (
        <div>
            <p className="ds-text-meta font-semibold text-slate-500 dark:text-slate-400 mb-1">{label}</p>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 pl-3 pr-1.5 py-1.5">
                <code className="flex-1 min-w-0 truncate text-xs text-slate-700 dark:text-slate-300">{value}</code>
                <button
                    type="button"
                    onClick={() => copy(value)}
                    aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors ds-focus-ring"
                >
                    <AnimatedCopyIcon copied={copied} checkClassName="text-emerald-500" />
                </button>
            </div>
        </div>
    )
}

/**
 * ConnectGitHubSetup — guided first-run GitHub OAuth configuration.
 *
 * Shown instead of the OAuth redirect when the server reports that
 * GITHUB_CLIENT_ID/SECRET are missing (fresh desktop/self-host install).
 * Walks the user through creating an OAuth App with the exact URLs for this
 * install (pre-filled GitHub form), then persists the credentials via
 * POST /api/auth/setup-oauth — no .env hand-editing, no restart.
 *
 * When the server refuses web setup (hosted deployment / non-loopback),
 * falls back to an operator-instructions panel.
 */
export function ConnectGitHubSetup({ isOpen, onClose, status: statusProp }) {
    const [status, setStatus] = useState(statusProp ?? null)
    const [step, setStep] = useState('create') // 'create' | 'credentials' | 'done'
    const [clientId, setClientId] = useState('')
    const [clientSecret, setClientSecret] = useState('')
    const [showSecret, setShowSecret] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState(null)

    // (Re)fetch on open — the prop may be stale or absent (deep link via
    // ?error=oauth_not_configured before the landing fetch resolved).
    useEffect(() => {
        if (!isOpen) return
        let cancelled = false
        getAuthSetupStatus()
            .then((s) => { if (!cancelled) setStatus(s) })
            .catch(() => { /* keep whatever we had — the panel degrades gracefully */ })
        return () => { cancelled = true }
    }, [isOpen])

    const origin = status?.homepageUrl || window.location.origin
    const callbackUrl = status?.callbackUrl || `${origin}/api/auth/callback`
    const canConfigure = Boolean(status?.canConfigure)

    // GitHub supports pre-filling the "New OAuth App" form via query params —
    // the user just reviews and clicks "Register application".
    const newAppUrl = 'https://github.com/settings/applications/new'
        + `?oauth_application[name]=${encodeURIComponent('GitHub Repo Manager (local)')}`
        + `&oauth_application[url]=${encodeURIComponent(origin)}`
        + `&oauth_application[callback_url]=${encodeURIComponent(callbackUrl)}`

    const handleSubmit = async (e) => {
        e?.preventDefault()
        if (submitting) return
        setSubmitting(true)
        setSubmitError(null)
        try {
            await submitOAuthSetup({ clientId: clientId.trim(), clientSecret: clientSecret.trim() })
            setStep('done')
        } catch (err) {
            setSubmitError(err?.data?.error || 'Could not save the configuration. Please try again.')
        } finally {
            setSubmitting(false)
        }
    }

    const handleSignIn = () => {
        window.location.href = AUTH_ENDPOINTS.login
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Connect GitHub"
            subtitle={canConfigure ? 'One-time setup · about 2 minutes' : 'Configuration required'}
            icon={Github}
            size="lg"
            footer={
                step === 'create' && canConfigure ? (
                    <ModalFooter align="between">
                        <a
                            href={DOCS_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                        >
                            <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                            Setup guide
                        </a>
                        <Button variant="primary" onClick={() => setStep('credentials')}>
                            I created the app
                            <ArrowRight className="w-4 h-4" aria-hidden="true" />
                        </Button>
                    </ModalFooter>
                ) : step === 'credentials' ? (
                    <ModalFooter align="between">
                        <Button variant="ghost" onClick={() => setStep('create')} disabled={submitting}>
                            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                            Back
                        </Button>
                        <Button
                            variant="primary"
                            onClick={handleSubmit}
                            disabled={submitting || !clientId.trim() || !clientSecret.trim()}
                        >
                            {submitting ? <Spinner size="sm" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />}
                            {submitting ? 'Saving…' : 'Save & connect'}
                        </Button>
                    </ModalFooter>
                ) : step === 'done' ? (
                    <ModalFooter align="right">
                        <Button variant="primary" onClick={handleSignIn}>
                            <Github className="w-4 h-4" aria-hidden="true" />
                            Sign in with GitHub
                        </Button>
                    </ModalFooter>
                ) : null
            }
        >
            <div className="p-5 md:p-6">
                <AnimatePresence mode="wait" initial={false}>
                    {!canConfigure && step !== 'done' ? (
                        /* Hosted / non-loopback: web setup is locked — tell the
                           user exactly what the operator must do instead. */
                        <motion.div key="operator" {...STEP_MOTION} className="space-y-4">
                            <div className="flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4">
                                <ServerCog className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                                <div className="text-sm text-amber-800 dark:text-amber-200">
                                    <p className="font-semibold mb-1">GitHub sign-in isn&apos;t configured on this server yet.</p>
                                    <p className="text-amber-700 dark:text-amber-300/90">
                                        Whoever operates this deployment needs to create a GitHub OAuth App and set
                                        {' '}<code className="text-xs">GITHUB_CLIENT_ID</code> and{' '}
                                        <code className="text-xs">GITHUB_CLIENT_SECRET</code> in the server&apos;s{' '}
                                        <code className="text-xs">.env</code> file, using this callback URL:
                                    </p>
                                </div>
                            </div>
                            <CopyRow label="Authorization callback URL" value={callbackUrl} />
                            <a
                                href={DOCS_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
                            >
                                <BookOpen className="w-4 h-4" aria-hidden="true" />
                                Read the setup guide
                            </a>
                        </motion.div>
                    ) : step === 'create' ? (
                        <motion.div key="create" {...STEP_MOTION} className="space-y-5">
                            <p className="text-sm text-slate-600 dark:text-slate-300">
                                This app talks to GitHub on your behalf, so it needs its own{' '}
                                <span className="font-semibold">OAuth App</span> under your GitHub account.
                                Everything stays on this machine — no third-party service is involved.
                            </p>

                            <ol className="space-y-3">
                                <li className="flex items-start gap-3">
                                    <span className="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm text-slate-700 dark:text-slate-200">
                                            Open GitHub&apos;s <span className="font-semibold">New OAuth App</span> form —
                                            we pre-filled every field with the exact values for this install:
                                        </p>
                                        <a
                                            href={newAppUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-2 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold ds-brand-solid transition-colors shadow-md ds-focus-ring"
                                        >
                                            <Github className="w-4 h-4" aria-hidden="true" />
                                            Open GitHub — create OAuth App
                                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                                        </a>
                                    </div>
                                </li>
                                <li className="flex items-start gap-3">
                                    <span className="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                                    <p className="text-sm text-slate-700 dark:text-slate-200 flex-1">
                                        Click <span className="font-semibold">Register application</span>, then{' '}
                                        <span className="font-semibold">Generate a new client secret</span> on the page that opens.
                                    </p>
                                </li>
                            </ol>

                            <div className="space-y-3 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/40 p-4">
                                <p className="ds-text-meta font-semibold text-slate-500 dark:text-slate-400">
                                    If GitHub asks for these values, they must match exactly:
                                </p>
                                <CopyRow label="Homepage URL" value={origin} />
                                <CopyRow label="Authorization callback URL" value={callbackUrl} />
                            </div>
                        </motion.div>
                    ) : step === 'credentials' ? (
                        <motion.form key="credentials" {...STEP_MOTION} className="space-y-5" onSubmit={handleSubmit}>
                            <p className="text-sm text-slate-600 dark:text-slate-300">
                                Copy both values from your new OAuth App&apos;s page on GitHub. They are stored{' '}
                                <span className="font-semibold">only in this install&apos;s configuration file</span> and
                                applied immediately — no restart needed.
                            </p>

                            <Field label="Client ID" required>
                                <Input
                                    value={clientId}
                                    onChange={(e) => setClientId(e.target.value)}
                                    leadingIcon={KeyRound}
                                    placeholder="e.g. Ov23liAbCdEf12345678"
                                    autoComplete="off"
                                    spellCheck={false}
                                    status={submitError ? 'error' : 'idle'}
                                />
                            </Field>

                            <Field
                                label="Client Secret"
                                required
                                hint="Generate it with the “Generate a new client secret” button — GitHub only shows it once."
                                error={submitError || undefined}
                            >
                                <Input
                                    type={showSecret ? 'text' : 'password'}
                                    value={clientSecret}
                                    onChange={(e) => setClientSecret(e.target.value)}
                                    leadingIcon={ShieldCheck}
                                    placeholder="••••••••••••••••••••••••••••••••••••••••"
                                    autoComplete="off"
                                    spellCheck={false}
                                    status={submitError ? 'error' : 'idle'}
                                    trailing={
                                        <button
                                            type="button"
                                            onClick={() => setShowSecret((v) => !v)}
                                            aria-label={showSecret ? 'Hide client secret' : 'Show client secret'}
                                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors ds-focus-ring"
                                        >
                                            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    }
                                />
                            </Field>
                        </motion.form>
                    ) : (
                        <motion.div key="done" {...STEP_MOTION} className="py-6 flex flex-col items-center text-center gap-4">
                            <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                                <AnimatedCheck size={28} />
                            </div>
                            <div>
                                <h3 className="text-base font-semibold text-slate-900 dark:text-white ds-font-display">
                                    GitHub connected
                                </h3>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                                    Your OAuth App is configured. Sign in to load your repositories —
                                    GitHub will ask you to authorize the app the first time.
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </Modal>
    )
}
