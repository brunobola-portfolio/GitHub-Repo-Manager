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
        // nginx and any proxy that honours it (Cloudflare, some ingress
        // controllers) buffer proxied responses by default, which turns a
        // token-by-token stream into one delayed blob and defeats the
        // abort-on-disconnect handling below. IIS/ARR ignores this header —
        // there, buffering is switched off with responseBufferThreshold=0
        // (see docs/guides/deploy-iis-windows.md).
        'X-Accel-Buffering': 'no',
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

/**
 * Like {@link streamToSSE}, but also surfaces the stream's post-completion
 * usage so callers can record spend + emit a cost audit (OWASP LLM10).
 *
 * Provider `generateStream()` generators *return* `{ usage, costUSD }` once the
 * stream drains (token counts only become available after the final SSE event).
 * A plain `for await` discards a generator's return value, so we drive the
 * iterator manually to capture it. Streams that don't report usage (e.g. a
 * local model) yield `{ usage: null, costUSD: null }` — `recordAISpend` no-ops
 * on null cost, so this degrades safely.
 *
 * `partial` is true when the client disconnected before the stream drained: the
 * usage is then what was measured up to that point, so the cost is a floor
 * rather than a total.
 *
 * @param {AsyncIterable<string>} textChunks
 * @param {ReturnType<initSSE>} sse
 * @returns {Promise<{ text: string, usage: object|null, costUSD: number|null, partial: boolean }>}
 */
export async function streamToSSEWithUsage(textChunks, sse) {
    let accumulated = '';
    let usage = null;
    let costUSD = null;
    let partial = false;

    const iterator = typeof textChunks[Symbol.asyncIterator] === 'function'
        ? textChunks[Symbol.asyncIterator]()
        : textChunks;

    try {
        while (true) {
            const { value, done } = await iterator.next();
            if (done) {
                // Generator return value carries the post-stream usage metadata.
                if (value && typeof value === 'object') {
                    usage = value.usage ?? null;
                    costUSD = value.costUSD ?? null;
                    partial = !!value.partial;
                }
                break;
            }
            // `continue`, never `break`. The generator's return value is the
            // only carrier for the usage the provider measured, and breaking
            // abandons the generator mid-flight — which is how an aborted
            // stream came to record ZERO spend while the operator was billed
            // for every token. The provider watches the same signal, so it
            // winds itself down within a chunk or two; all we owe it is to stop
            // writing to a socket that is already gone.
            if (sse.isAborted) continue;
            if (value) {
                accumulated += value;
                sse.sendChunk(value);
            }
        }
    } finally {
        // A throw out of the loop leaves the generator suspended; closing it
        // runs its `finally` (e.g. reader.releaseLock). On a stream that
        // already finished this is a harmless no-op. Note this no longer fires
        // on a plain disconnect — that path now drains to `done` instead.
        if (typeof iterator.return === 'function') {
            try { await iterator.return(); } catch { /* generator already settled */ }
        }
    }

    return { text: accumulated, usage, costUSD, partial };
}

/**
 * Stream a JSON-envelope generation as clean reply DELTAS.
 *
 * The Repo Advisor chat model streams a `{"reply": "...", "actions": [...]}`
 * envelope. Raw JSON tokens can't be rendered as prose, so this accumulates the
 * raw output, runs `extractReply(rawSoFar)` after each chunk, and forwards only
 * the newly-revealed reply suffix to the client (which appends it like any text
 * stream). `actions` are parsed by the caller from the returned `raw` once the
 * stream finishes. Like {@link streamToSSEWithUsage}, it captures the
 * generator's post-stream `{ usage, costUSD, partial }` return value.
 *
 * @param {AsyncIterable<string>} rawChunks — provider.generateStream() output
 * @param {ReturnType<initSSE>} sse
 * @param {(rawSoFar: string) => string} extractReply — partial-JSON reply extractor
 * @returns {Promise<{ raw: string, reply: string, usage: object|null, costUSD: number|null, partial: boolean }>}
 */
export async function streamReplyDeltasToSSE(rawChunks, sse, extractReply) {
    let raw = '';
    let sentLen = 0;
    let usage = null;
    let costUSD = null;
    let partial = false;

    const iterator = typeof rawChunks[Symbol.asyncIterator] === 'function'
        ? rawChunks[Symbol.asyncIterator]()
        : rawChunks;

    try {
        while (true) {
            const { value, done } = await iterator.next();
            if (done) {
                if (value && typeof value === 'object') {
                    usage = value.usage ?? null;
                    costUSD = value.costUSD ?? null;
                    partial = !!value.partial;
                }
                break;
            }
            // See streamToSSEWithUsage: draining rather than breaking is what
            // keeps the provider's usage reachable on a client disconnect.
            if (sse.isAborted) continue;
            if (!value) continue;
            raw += value;
            const reply = extractReply(raw);
            if (reply.length > sentLen) {
                sse.sendChunk(reply.slice(sentLen));
                sentLen = reply.length;
            }
        }
    } finally {
        if (typeof iterator.return === 'function') {
            try { await iterator.return(); } catch { /* generator already settled */ }
        }
    }

    return { raw, reply: extractReply(raw), usage, costUSD, partial };
}

