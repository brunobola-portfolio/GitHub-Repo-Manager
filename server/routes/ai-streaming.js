/**
 * SSE streaming helpers for AI endpoints.
 *
 * `initSSE` returns an object with `sendChunk` / `sendDone` / `sendError` and
 * an `aborted` AbortSignal that flips when the client disconnects. Callers
 * should pass the signal into long-running model calls and bail out of streams
 * promptly to avoid wasting tokens / compute on a vanished client.
 */

/**
 * Initialize an SSE response.
 * @param {import('express').Response} res
 * @param {import('express').Request} [req] - optional, lets us hook into client disconnect
 */
export function initSSE(res, req) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });

    const controller = new AbortController();
    let closed = false;

    const safeWrite = (payload) => {
        if (closed) return false;
        try {
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
            return true;
        } catch {
            // Underlying socket gone — flag closed so we stop trying
            closed = true;
            controller.abort();
            return false;
        }
    };

    let cleanup = () => {};
    if (req) {
        const onClose = () => {
            if (!closed) {
                closed = true;
                controller.abort();
            }
        };
        req.on('close', onClose);
        req.on('aborted', onClose);
        cleanup = () => {
            req.removeListener('close', onClose);
            req.removeListener('aborted', onClose);
        };
    }

    return {
        signal: controller.signal,
        get isAborted() { return closed; },
        sendChunk(text) { safeWrite({ text }); },
        sendDone(full) {
            if (closed) return;
            // Write first, THEN flip closed — safeWrite short-circuits when closed
            safeWrite({ done: true, full });
            closed = true;
            cleanup();
            try { res.end(); } catch { /* socket already gone */ }
        },
        sendError(message) {
            if (closed) return;
            safeWrite({ error: true, message });
            closed = true;
            cleanup();
            try { res.end(); } catch { /* socket already gone */ }
        },
    };
}

/**
 * Stream any AsyncIterable<string> of text chunks through SSE.
 * Returns the full accumulated text. Stops promptly if the client disconnects.
 *
 * This is the canonical streaming helper going forward. Pass any async
 * iterable that yields string chunks — including GeminiProvider.generateStream()
 * or any future provider's stream method.
 *
 * @param {AsyncIterable<string>} textChunks
 * @param {ReturnType<initSSE>} sse
 * @returns {Promise<string>} accumulated full text
 */
export async function streamToSSE(textChunks, sse) {
    let accumulated = '';
    for await (const text of textChunks) {
        if (sse.isAborted) break;
        if (text) {
            accumulated += text;
            sse.sendChunk(text);
        }
    }
    return accumulated;
}

