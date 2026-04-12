import { useState, useCallback, useRef } from 'react'

export function useStreaming() {
    const [streamingText, setStreamingText] = useState('')
    const [isStreaming, setIsStreaming] = useState(false)
    const [error, setError] = useState(null)
    const [result, setResult] = useState(null)
    const abortRef = useRef(null)

    const startStream = useCallback(async (url, body) => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setStreamingText('')
        setIsStreaming(true)
        setError(null)
        setResult(null)

        try {
            const separator = url.includes('?') ? '&' : '?'
            const streamUrl = `${url}${separator}stream=true`

            const res = await fetch(streamUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            })

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}))
                throw new Error(errData.message || errData.error || `Request failed: ${res.status}`)
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let finalResult = null

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
                            return data.full
                        }
                        if (data.text) {
                            setStreamingText(prev => prev + data.text)
                        }
                    } catch { /* skip malformed chunks */ }
                }
            }

            setIsStreaming(false)
            return finalResult
        } catch (err) {
            if (err.name === 'AbortError') {
                setIsStreaming(false)
                return null
            }
            setError(err.message || 'Streaming failed')
            setIsStreaming(false)
            return null
        }
    }, [])

    const cancelStream = useCallback(() => {
        abortRef.current?.abort()
        setIsStreaming(false)
    }, [])

    const reset = useCallback(() => {
        setStreamingText('')
        setIsStreaming(false)
        setError(null)
        setResult(null)
    }, [])

    return { streamingText, isStreaming, error, result, startStream, cancelStream, reset }
}
