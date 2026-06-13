/*
 * GitHub Repo Manager
 * Offline mutation retry queue
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the GNU AGPL v3.0 only (SPDX: AGPL-3.0-only). See LICENSE in the project root.
 *
 * Captures failed mutations (POST/PUT/PATCH/DELETE) that failed due to
 * network errors while the browser is offline or the backend is
 * unreachable. Replays them in order on the `online` window event.
 *
 * Design constraints:
 *  - Time-bounded: entries older than `MAX_AGE_MS` are discarded (stale
 *    state would do more harm than good).
 *  - Size-capped at `MAX_QUEUE_SIZE` to prevent memory leaks.
 *  - Bounded retries per entry (`MAX_REPLAY_ROUNDS`) — on final failure
 *    the original caller's promise rejects with the network error.
 *  - Pure data structure: fetch is injected at replay time so this
 *    module is easy to test and doesn't pull in `api.js`.
 */

export const MAX_QUEUE_SIZE = 50
export const MAX_AGE_MS = 10 * 60 * 1000 // 10 minutes
export const MAX_REPLAY_ROUNDS = 3

// Listeners receive one of:
//   { type: 'enqueued', entry }      — a new request was just queued
//   { type: 'replay-start', count }  — replay batch beginning
//   { type: 'replay-success', count } — at least one entry replayed OK
//   { type: 'replay-failed', entry } — final give-up for one entry
const listeners = new Set()

export function onRetryQueueEvent(cb) {
    listeners.add(cb)
    return () => listeners.delete(cb)
}

function emit(event) {
    listeners.forEach(cb => {
        try { cb(event) } catch (e) { console.error('retry-queue listener error', e) }
    })
}

// Module-level queue. Not exported directly — manipulation goes through
// the helpers so invariants (cap, expiry, unique ids) are enforced.
const queue = []
let nextId = 1

function now() { return Date.now() }

function pruneExpired() {
    const cutoff = now() - MAX_AGE_MS
    while (queue.length && queue[0].timestamp < cutoff) {
        const entry = queue.shift()
        try { entry.reject(new Error('Queued request expired before reconnect')) } catch { /* ignore */ }
    }
}

/**
 * Append a mutation to the retry queue. Returns a promise that resolves
 * with the eventual fetch Response (on successful replay) or rejects
 * with the final error (on expiry / max rounds reached / non-retryable
 * error on replay).
 */
export function enqueueMutation({ url, options }) {
    pruneExpired()
    return new Promise((resolve, reject) => {
        if (queue.length >= MAX_QUEUE_SIZE) {
            reject(new Error('Retry queue is full — request dropped'))
            return
        }
        const entry = {
            id: nextId++,
            url,
            options,
            resolve,
            reject,
            timestamp: now(),
            rounds: 0,
        }
        queue.push(entry)
        emit({ type: 'enqueued', entry })
    })
}

/**
 * Replay every currently-queued entry using the provided fetch fn.
 * Entries that fail again with a network-ish error are re-queued up to
 * MAX_REPLAY_ROUNDS. 4xx/5xx client/server errors cause the original
 * promise to reject with the Response (callers can categorize it).
 *
 * `isNetworkError(err)` tells us whether to re-queue vs give up.
 */
export async function replayQueue({ fetchFn, isNetworkError }) {
    pruneExpired()
    if (queue.length === 0) return { replayed: 0, failed: 0 }

    const batch = queue.splice(0, queue.length)
    emit({ type: 'replay-start', count: batch.length })

    let replayed = 0
    let failed = 0

    for (const entry of batch) {
        entry.rounds += 1
        try {
            const res = await fetchFn(entry.url, entry.options)
            entry.resolve(res)
            replayed += 1
        } catch (err) {
            if (isNetworkError(err) && entry.rounds < MAX_REPLAY_ROUNDS) {
                // Re-queue for next `online` event, if we still have room.
                if (queue.length < MAX_QUEUE_SIZE) {
                    queue.push(entry)
                } else {
                    try { entry.reject(err) } catch { /* ignore */ }
                    failed += 1
                    emit({ type: 'replay-failed', entry })
                }
            } else {
                try { entry.reject(err) } catch { /* ignore */ }
                failed += 1
                emit({ type: 'replay-failed', entry })
            }
        }
    }

    if (replayed > 0) emit({ type: 'replay-success', count: replayed })
    return { replayed, failed }
}

// ============ Test / introspection helpers ============

export function _getQueueLengthForTests() { return queue.length }
export function _resetQueueForTests() {
    queue.splice(0, queue.length)
    nextId = 1
}
export function _peekQueueForTests() { return queue.slice() }
