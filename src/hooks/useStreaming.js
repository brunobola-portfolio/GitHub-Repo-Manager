import { useState, useCallback, useRef, useEffect } from 'react'

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_INITIAL_DELAY = 1000
const DEFAULT_MAX_DELAY = 15000
const BACKOFF_MULTIPLIER = 2

export function useStreaming({ maxRetries = DEFAULT_MAX_RETRIES } = {}) {
    const [streamingText, setStreamingText] = useState('')
    const [isStreaming, setIsStreaming] = useState(false)
    const [error, setError] = useState(null)
    const [result, setResult] = useState(null)
    const [retryCount, setRetryCount] = useState(0)
    const abortRef = useRef(null)
    const retryTimerRef = useRef(null)

    const doStream = useCallback(async (url, body, retriesLeft, accumulatedText) => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        if (retriesLeft === maxRetries) {
            // First attempt — reset state
            setStreamingText('')
            setError(null)
            setResult(null)
            setRetryCount(0)
        }

        setIsStreaming(true)

        try {
            const separator = url.includes('?') ? '&' : '?'
            const streamUrl = `${url}${separator}stream=true`

            const res = await fetch(streamUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
                signal: controller.signal,
            })

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}))
                const httpErr = new Error(errData.message || errData.error || `Request failed: ${res.status}`)
                httpErr.isHttpError = true
                throw httpErr
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let finalResult = null
            let currentText = accumulatedText

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue
                    try {
                        const data = JSON.parse(line.slice(6))
                        if (data.error) {
                            setError(data.message || 'Stream error')
                            setIsStreaming(false)
                            return null
                        }
                        if (data.done) {
                            finalResult = data.full
                            setResult(data.full)
                            setIsStreaming(false)
                            setRetryCount(0)
                            return data.full
                        }
                        if (data.text) {
                            currentText += data.text
                            setStreamingText(currentText)
                        }
                    } catch { /* skip malformed chunks */ }
                }
            }

            setIsStreaming(false)
            setRetryCount(0)
            return finalResult
        } catch (err) {
            if (err.name === 'AbortError') {
                setIsStreaming(false)
                return null
            }

            // Retry with exponential backoff on network errors only (not HTTP errors)
            const attempt = maxRetries - retriesLeft
            if (retriesLeft > 0 && !err.isHttpError) {
                const delay = Math.min(
                    DEFAULT_INITIAL_DELAY * Math.pow(BACKOFF_MULTIPLIER, attempt),
                    DEFAULT_MAX_DELAY
                )
                setRetryCount(attempt + 1)
                setError(`Connection lost. Retrying in ${Math.round(delay / 1000)}s...`)

                return new Promise((resolve) => {
                    retryTimerRef.current = setTimeout(async () => {
                        const result = await doStream(url, body, retriesLeft - 1, accumulatedText)
                        resolve(result)
                    }, delay)
                })
            }

            setError(err.message || 'Streaming failed')
            setIsStreaming(false)
            setRetryCount(0)
            return null
        }
    }, [maxRetries])

    // Cleanup on unmount — cancel pending retries and abort in-flight requests
    useEffect(() => {
        return () => {
            clearTimeout(retryTimerRef.current)
            abortRef.current?.abort()
        }
    }, [])

    const startStream = useCallback(async (url, body) => {
        clearTimeout(retryTimerRef.current)
        return doStream(url, body, maxRetries, '')
    }, [doStream, maxRetries])

    const cancelStream = useCallback(() => {
        clearTimeout(retryTimerRef.current)
        abortRef.current?.abort()
        setIsStreaming(false)
        setRetryCount(0)
        setError(null)
    }, [])

    const reset = useCallback(() => {
        clearTimeout(retryTimerRef.current)
        setStreamingText('')
        setIsStreaming(false)
        setError(null)
        setResult(null)
        setRetryCount(0)
    }, [])

    return { streamingText, isStreaming, error, result, retryCount, startStream, cancelStream, reset }
}
