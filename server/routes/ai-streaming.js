/**
 * SSE streaming helpers for AI endpoints.
 */

/**
 * Initialize an SSE response.
 */
export function initSSE(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });

    return {
        sendChunk(text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
        },
        sendDone(full) {
            res.write(`data: ${JSON.stringify({ done: true, full })}\n\n`);
            res.end();
        },
        sendError(message) {
            res.write(`data: ${JSON.stringify({ error: true, message })}\n\n`);
            res.end();
        },
    };
}

/**
 * Stream a Gemini generateContentStream result through SSE.
 * Returns the full accumulated text.
 */
export async function streamGeminiToSSE(stream, sse) {
    let accumulated = '';
    for await (const chunk of stream.stream) {
        const text = chunk.text();
        if (text) {
            accumulated += text;
            sse.sendChunk(text);
        }
    }
    return accumulated;
}
