// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from 'react'
import { Sparkles, CheckCircle, ExternalLink, Settings as SettingsIcon } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { AIErrorState } from '../ui/AIErrorState'
import { Input, Textarea } from '../ui/form'
import { RowIconBadge } from '../ui/RowIconBadge'
import { getCsrfToken } from '../../utils/api'
import { emitAppEvent, APP_EVENTS } from '../../utils/appEvents'

/**
 * State machine: idle | generating | preview | committing | committed | error
 *
 * - idle: just opened, waiting to call /generate
 * - generating: /generate in flight
 * - preview: content arrived; user can edit and Commit
 * - committing: /commit-fix in flight
 * - committed: success; show commit/PR URL
 * - error: friendly error rendered with Retry CTA
 */

const SUPPORTED_LICENSES = ['MIT', 'BSD-3-Clause']

export function CommunityHealthFixModal({ isOpen, onClose, repo, fileType, onCommitted }) {
	const [state, setState] = useState('idle')
	const [content, setContent] = useState('')
	const [filePath, setFilePath] = useState('')
	const [commitMessage, setCommitMessage] = useState('')
	const [licenseId, setLicenseId] = useState('MIT')
	const [committedResult, setCommittedResult] = useState(null)
	const [error, setError] = useState(null)
	const [aiNotConfigured, setAiNotConfigured] = useState(false)

	const reset = useCallback(() => {
		setState('idle')
		setContent('')
		setFilePath('')
		setCommitMessage('')
		setCommittedResult(null)
		setError(null)
		setAiNotConfigured(false)
	}, [])

	const callGenerate = useCallback(async (overrides = {}) => {
		if (!repo?.owner?.login || !repo?.name || !fileType) return
		setState('generating')
		setError(null)
		setAiNotConfigured(false)
		try {
			const csrf = await getCsrfToken()
			const res = await fetch(`/api/repos/${repo.owner.login}/${repo.name}/community-health/generate`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
				body: JSON.stringify({ fileType, overrides }),
			})
			const json = await res.json().catch(() => ({}))
			if (!res.ok) {
				if (json.code === 'ai_not_configured') {
					setAiNotConfigured(true)
					setState('error')
					return
				}
				const err = new Error(json.error || `status ${res.status}`)
				err.status = res.status
				err.code = json.code
				err.data = json
				setError(err)
				setState('error')
				return
			}
			setContent(json.content || '')
			setFilePath(json.filePath || '')
			setCommitMessage(json.suggestedCommitMessage || `chore: add ${fileType}`)
			setState('preview')
		} catch (e) {
			setError(e)
			setState('error')
		}
	}, [repo, fileType])

	// Reset on close in its own effect so the generation effect can have a
	// clean dep list (no stale-state guard needed).
	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- isOpen→false reset
		if (!isOpen) reset()
	}, [isOpen, reset])

	// Auto-generate when modal opens. For the license picker, also re-generate
	// when the user switches license — that's the desired behaviour.
	useEffect(() => {
		if (!isOpen) return
		// eslint-disable-next-line react-hooks/set-state-in-effect -- modal-open kicks off fetch
		if (fileType === 'license') callGenerate({ licenseId })
		else callGenerate()
	}, [isOpen, fileType, licenseId, callGenerate])

	const callCommit = useCallback(async () => {
		if (!content || !filePath || !commitMessage) return
		setState('committing')
		try {
			const csrf = await getCsrfToken()
			const res = await fetch(`/api/repos/${repo.owner.login}/${repo.name}/community-health/commit-fix`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
				body: JSON.stringify({ filePath, content, commitMessage, mode: 'direct' }),
			})
			const json = await res.json().catch(() => ({}))
			if (!res.ok) {
				const err = new Error(json.error || `status ${res.status}`)
				err.status = res.status
				err.code = json.code
				err.data = json
				setError(err)
				setState('error')
				return
			}
			setCommittedResult(json)
			setState('committed')
			onCommitted?.(json)
		} catch (e) {
			setError(e)
			setState('error')
		}
	}, [content, filePath, commitMessage, repo, onCommitted])

	const renderBody = () => {
		if (state === 'generating') {
			return (
				<div className="flex flex-col items-center justify-center py-12 gap-3">
					<Spinner />
					<p className="text-sm text-slate-500 dark:text-slate-400">Generating with AI…</p>
				</div>
			)
		}

		if (state === 'error' && aiNotConfigured) {
			return (
				<div role="alert" className="flex flex-col items-center text-center gap-4 py-8">
					<RowIconBadge icon={Sparkles} tone="indigo" size="xl" surface="soft" />
					<div>
						<h3 className="font-semibold text-slate-900 dark:text-slate-100 text-lg">AI is not configured</h3>
						<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
							Add a provider key in Settings to use AI-backed file generation.
						</p>
					</div>
					<Button
						as="a"
						href="#"
						onClick={(e) => {
							e.preventDefault()
							onClose?.()
							emitAppEvent(APP_EVENTS.OPEN_SETTINGS, { section: 'ai' })
						}}
					>
						<SettingsIcon className="w-4 h-4" /> Configure AI
					</Button>
				</div>
			)
		}

		if (state === 'error') {
			return (
				<AIErrorState
					error={error}
					onRetry={() => callGenerate(fileType === 'license' ? { licenseId } : {})}
					context="Community health"
					variant="card"
				/>
			)
		}

		if (state === 'committed') {
			return (
				<div className="flex flex-col items-center text-center gap-4 py-8">
					<RowIconBadge icon={CheckCircle} tone="emerald" size="xl" surface="soft" />
					<div>
						<h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">
							{committedResult?.mode === 'pr-fallback' || committedResult?.mode === 'pr'
								? 'Pull request opened'
								: 'Committed'}
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
							className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline"
						>
							View PR <ExternalLink className="w-3.5 h-3.5" />
						</a>
					)}
				</div>
			)
		}

		// preview / committing — show editor.
		return (
			<div className="flex flex-col gap-3">
				{fileType === 'license' && (
					<label className="flex items-center gap-2">
						<span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">License:</span>
						<select
							value={licenseId}
							onChange={(e) => setLicenseId(e.target.value)}
							disabled={state === 'committing'}
							className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
						>
							{SUPPORTED_LICENSES.map((id) => <option key={id} value={id}>{id}</option>)}
						</select>
					</label>
				)}
				<div className="flex items-center justify-between gap-2">
					<span className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate" title={filePath}>{filePath}</span>
					<div className="flex-1 max-w-xs">
						<Input
							type="text"
							size="sm"
							value={commitMessage}
							onChange={(e) => setCommitMessage(e.target.value)}
							disabled={state === 'committing'}
							placeholder="Commit message"
							aria-label="Commit message"
						/>
					</div>
				</div>
				<Textarea
					value={content}
					onChange={(e) => setContent(e.target.value)}
					disabled={state === 'committing'}
					rows={14}
					className="font-mono text-xs leading-relaxed"
					spellCheck={false}
					aria-label={`${filePath} preview`}
				/>
			</div>
		)
	}

	const renderFooter = () => {
		if (state === 'committed') {
			return <Button onClick={onClose}>Done</Button>
		}
		if (state === 'error' && !aiNotConfigured) {
			return (
				<>
					<Button variant="ghost" onClick={onClose}>Cancel</Button>
					<Button onClick={() => callGenerate(fileType === 'license' ? { licenseId } : {})}>Retry</Button>
				</>
			)
		}
		if (state === 'preview') {
			return (
				<>
					<Button variant="ghost" onClick={onClose}>Cancel</Button>
					<Button onClick={callCommit} disabled={!content || !filePath || !commitMessage}>Commit</Button>
				</>
			)
		}
		if (state === 'committing') {
			return <Button disabled>Committing…</Button>
		}
		return null
	}

	return (
		<Modal
			isOpen={isOpen}
			onClose={state === 'committing' ? undefined : onClose}
			title="Fix with AI"
			subtitle={fileType ? `Generate ${filePath || fileType.replace(/_/g, ' ')}` : undefined}
			icon={Sparkles}
			iconGradient="primary"
			size="lg"
			footer={renderFooter()}
			closeOnBackdrop={state !== 'committing'}
		>
			{renderBody()}
		</Modal>
	)
}
