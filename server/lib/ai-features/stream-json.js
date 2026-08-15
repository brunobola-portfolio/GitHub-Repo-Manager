// SPDX-License-Identifier: Apache-2.0
/**
 * Progressive extraction of the chat `reply` string from a (possibly
 * incomplete) JSON buffer.
 *
 * The Repo Advisor chat model streams a JSON envelope `{"reply": "...",
 * "actions": [...]}`. We can't render raw JSON token-by-token, so the streaming
 * route extracts just the `reply` string *as it grows* and forwards clean prose
 * deltas to the client; `actions` are parsed once at completion from the full
 * buffer. This keeps a single prompt/response contract for the streaming and
 * non-streaming paths (and the eval) — the partial-JSON handling lives here,
 * pure and unit-tested, instead of in the client.
 */

const ESCAPE_MAP = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f' };

/**
 * Extract the decoded `reply` string seen so far from a partial JSON buffer.
 * Returns '' until the `"reply":"` opener has streamed in. Stops at the first
 * unescaped closing quote; a trailing incomplete escape (the chunk boundary
 * landed mid-`\x` or mid-`\uXXXX`) is dropped rather than mis-decoded.
 *
 * @param {string} raw — accumulated raw model output (may be incomplete JSON)
 * @returns {string} the reply text decoded up to this point
 */
export function extractReplyText(raw) {
    if (typeof raw !== 'string' || !raw) return '';

    // Strip a leading ```json / ``` fence + BOM/whitespace the model may prepend.
    const s = raw.replace(/^\s*```(?:json)?\s*/i, '');

    // Locate the `reply` key's opening quote: "reply" : "
    const opener = s.match(/"reply"\s*:\s*"/);
    if (!opener) return '';

    let i = opener.index + opener[0].length;
    let out = '';
    while (i < s.length) {
        const ch = s[i];

        if (ch === '\\') {
            // Incomplete escape at the buffer boundary — drop it (next chunk completes it).
            if (i + 1 >= s.length) break;
            const esc = s[i + 1];
            if (esc === 'u') {
                if (i + 6 > s.length) break; // incomplete \uXXXX
                const hex = s.slice(i + 2, i + 6);
                if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                    out += String.fromCharCode(parseInt(hex, 16));
                    i += 6;
                    continue;
                }
                // Malformed unicode escape — emit the char best-effort and move on.
                out += esc;
                i += 2;
                continue;
            }
            out += Object.prototype.hasOwnProperty.call(ESCAPE_MAP, esc) ? ESCAPE_MAP[esc] : esc;
            i += 2;
            continue;
        }

        if (ch === '"') break; // unescaped closing quote — end of the reply value
        out += ch;
        i += 1;
    }
    return out;
}
