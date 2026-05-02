// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Convenience wrapper around `enqueueAndExecute` for route handlers.
 *
 * Derives a stable idempotency key from `(method, url, sha256(body))`,
 * invokes the outbox, and returns a normalized two-shape result so the
 * route owner controls response framing:
 *   { queued: true, outboxId }   — emit 202 + your hint payload
 *   { data }                      — emit your usual 200 / 201 with data
 *
 * Why a hash and not a random token: clicking "Submit comment" twice
 * during a flaky GitHub should NOT post two duplicate comments. Same
 * payload posted twice resolves to the same outbox row, second call
 * returns the already-applied response. Distinct payloads (real second
 * comment) hash differently → distinct rows → both delivered.
 */
import crypto from 'crypto'
import { enqueueAndExecute, makeIdempotencyKey } from './gh-outbox.js'

export async function executeViaOutbox(req, { method, url, body = null, githubOptions = {} }) {
    const bodyHash = body
        ? crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)
        : ''
    const idempotencyKey = makeIdempotencyKey(method, url, bodyHash)
    const result = await enqueueAndExecute({
        userId: req.session.userId,
        method,
        url,
        body,
        idempotencyKey,
        token: req.session.accessToken,
        githubOptions,
    })
    if (result.queued) {
        return { queued: true, outboxId: result.outboxId }
    }
    return { data: result.data }
}
