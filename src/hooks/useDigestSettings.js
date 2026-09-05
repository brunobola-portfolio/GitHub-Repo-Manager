import { useCallback, useEffect, useState } from 'react'
import { API_BASE_URL } from '../config'
import { apiCall } from '../utils/api'

const URL = `${API_BASE_URL}/api/v1/notifications/digest/settings`

/**
 * useDigestSettings — G7's per-user opt-in for the scheduled digest e-mail
 * (off | daily | weekly). Thin GET/PATCH pair against
 * server/routes/notifications.js's digest/settings routes; the actual
 * sending is a background job (server/lib/maintenance-janitors.js) that
 * never runs unless email delivery is configured.
 */
export function useDigestSettings() {
    const [frequency, setFrequency] = useState('off')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)

    const refresh = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await apiCall(URL, {}, { maxRetries: 0 })
            setFrequency(data.frequency || 'off')
        } catch (e) {
            setError(e)
        } finally {
            setLoading(false)
        }
    }, [])

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { refresh() }, [refresh])

    const update = useCallback(async (next) => {
        setSaving(true)
        setError(null)
        const previous = frequency
        setFrequency(next) // optimistic — Settings is a modal, not worth a spinner-per-keystroke
        try {
            // apiCall/fetchWithRetry injects the CSRF header for same-origin
            // mutations itself — no manual getCsrfToken() call needed here.
            await apiCall(URL, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frequency: next }),
            }, { maxRetries: 0 })
        } catch (e) {
            setFrequency(previous) // roll back on failure
            setError(e)
            throw e
        } finally {
            setSaving(false)
        }
    }, [frequency])

    return { frequency, setFrequency: update, loading, saving, error }
}
