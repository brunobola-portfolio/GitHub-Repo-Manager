// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/*
 * Apply a set of regex strips until the input stops changing.
 *
 * A one-shot `String.replace` guarantees nothing about its own output: the
 * text a rule leaves behind can match that same rule again, and whether it
 * does depends on the exact pattern rather than on anything the call site can
 * see. Removing a substring is the clearest case — stripping 'script' from
 * 'scrscriptipt' hands back 'script' — and interleaved-tag payloads are
 * written specifically to find that behaviour in whatever pattern a sanitizer
 * happens to use. Iterating to a fixed point makes the property hold for the
 * rule as written, so it survives someone editing the regex later.
 *
 * Every strip here that runs over content someone else wrote — SVG from a
 * model, a README, an Azure work-item body — goes through this, so the
 * property lives in one place instead of being re-derived per call site.
 *
 * The iteration cap is what stops the repetition from becoming the denial of
 * service it was meant to prevent. Input still changing after MAX_PASSES is
 * adversarial by construction: callers that are a security boundary check
 * `ok` and reject, callers that are merely tidying text take `value` and move
 * on with the best available result.
 */

export const MAX_PASSES = 8;

/**
 * @param {string} input
 * @param {(current: string) => string} apply  One full round of strips.
 * @returns {{ ok: boolean, value: string }}  `ok` is false only when the input
 *   was still changing at the cap — i.e. `value` may still hold a payload.
 */
export function stripUntilStable(input, apply) {
    let current = input;
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
        const next = apply(current);
        if (next === current) return { ok: true, value: current };
        current = next;
    }
    return { ok: apply(current) === current, value: current };
}
