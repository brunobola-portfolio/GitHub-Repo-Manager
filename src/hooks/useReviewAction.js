import { useCallback } from 'react'
import { useToast } from '@/hooks/useToast'

async function call(url, { method = 'POST', body } = {}) {
    const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
        const err = new Error(json.error || `status ${res.status}`)
        err.status = res.status
        err.code = json.code
        throw err
    }
    return json.data
}

const SUCCESS_LABEL = {
    approve: 'Approved',
    request_changes: 'Changes requested',
    comment: 'Comment posted',
    snooze: 'Snoozed',
    unsnooze: 'Unsnoozed',
}

export function useReviewAction({ onOptimistic, onRollback } = {}) {
    const { toast } = useToast()

    const runReview = useCallback(async (action, args, extraBody = {}) => {
        onOptimistic?.(action, args)
        try {
            await call('/api/v1/work-board/review-action', {
                method: 'POST',
                body: { repoFullName: args.repoFullName, prNumber: args.prNumber, action, ...extraBody },
            })
            toast.success(SUCCESS_LABEL[action] || 'Done')
        } catch (e) {
            onRollback?.(action, args, e)
            if (e.code === 'scope_required') {
                toast.error('Re-authorize this app with the repo scope to submit reviews.')
            } else {
                toast.error(e.message || 'Action failed')
            }
        }
    }, [onOptimistic, onRollback, toast])

    const approve = useCallback((args) => runReview('approve', args), [runReview])
    const requestChanges = useCallback((args) => runReview('request_changes', args, { body: args.body }), [runReview])
    const comment = useCallback((args) => runReview('comment', args, { body: args.body }), [runReview])

    const snooze = useCallback(async (args) => {
        onOptimistic?.('snooze', args)
        try {
            const itemNumber = args.prNumber ?? args.issueNumber
            const itemType = args.itemType || (args.prNumber ? 'pr' : 'issue')
            await call('/api/v1/work-board/snooze', {
                method: 'POST',
                body: { repoFullName: args.repoFullName, itemType, itemNumber, hours: args.hours || 24 },
            })
            toast.success(SUCCESS_LABEL.snooze)
        } catch (e) {
            onRollback?.('snooze', args, e)
            toast.error(e.message || 'Snooze failed')
        }
    }, [onOptimistic, onRollback, toast])

    const unsnooze = useCallback(async (args) => {
        onOptimistic?.('unsnooze', args)
        try {
            const itemNumber = args.prNumber ?? args.issueNumber
            const itemType = args.itemType || (args.prNumber ? 'pr' : 'issue')
            await call('/api/v1/work-board/snooze', {
                method: 'DELETE',
                body: { repoFullName: args.repoFullName, itemType, itemNumber },
            })
            toast.success(SUCCESS_LABEL.unsnooze)
        } catch (e) {
            onRollback?.('unsnooze', args, e)
            toast.error(e.message || 'Unsnooze failed')
        }
    }, [onOptimistic, onRollback, toast])

    return { approve, requestChanges, comment, snooze, unsnooze }
}
