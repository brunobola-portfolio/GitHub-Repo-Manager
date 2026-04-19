/**
 * server/lib/ai-evals.js
 *
 * Unit-test-style eval harness for AI handler parse/validation logic.
 *
 * This file is NOT about calling a real LLM. It tests that our handler code
 * correctly parses and validates whatever a model returns, using a mock provider
 * that returns a pre-configured response string.
 *
 * Exports:
 *  - createMockProvider(response)   — mock AIProvider returning a fixed string
 *  - defineEval(opts)               — declare an eval suite
 *  - runEval(evalDef, adapter)      — run an eval and return a result object
 *  - diffAgainstBaseline(results, baseline) — compare results to a saved baseline
 *
 * Scorers (pure functions → { pass: boolean, reason: string }):
 *  - exactMatch(actual, expected)
 *  - jsonShape(actual, expectedShape)
 *  - enumMatch(actual, allowedValues)
 *  - lengthBounds(actual, { min, max })
 *  - regexMatch(actual, pattern)
 *  - numberRange(actual, { min, max })
 *  - allOf(scorerFns)               — combinator: all must pass
 *  - anyOf(scorerFns)               — combinator: at least one must pass
 */

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

/**
 * Creates a mock AIProvider that always returns the given response string.
 * Shape matches the real AIProvider contract (generate, embed, generateStream).
 *
 * @param {string} response
 * @returns {{ generate: Function, embed: Function, generateStream: AsyncGeneratorFunction }}
 */
export function createMockProvider(response) {
    return {
        async generate() {
            let parsed = null;
            try { parsed = JSON.parse(response); } catch { /* not JSON */ }
            return { text: response, parsed };
        },
        async embed() {
            throw new Error('embed not supported in mock eval mode');
        },
        async *generateStream() {
            yield response;
        },
    };
}

// ---------------------------------------------------------------------------
// Scorers — pure functions
// ---------------------------------------------------------------------------

/**
 * Deep equality check.
 * @param {any} actual
 * @param {any} expected
 * @returns {{ pass: boolean, reason: string }}
 */
export function exactMatch(actual, expected) {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    return {
        pass,
        reason: pass ? 'Exact match' : `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    };
}

/**
 * Structural shape check — verifies that all keys in expectedShape exist in actual
 * with matching types. Values are not checked unless specified as a nested object.
 *
 * expectedShape is a flat object where values are type-name strings:
 *   { strategy: 'string', confidence: 'number', tags: 'object' }
 *
 * @param {any} actual
 * @param {Record<string, string>} expectedShape
 * @returns {{ pass: boolean, reason: string }}
 */
export function jsonShape(actual, expectedShape) {
    if (actual === null || typeof actual !== 'object') {
        return { pass: false, reason: `Expected an object, got ${typeof actual}` };
    }
    const failures = [];
    for (const [key, expectedType] of Object.entries(expectedShape)) {
        if (!(key in actual)) {
            failures.push(`Missing key "${key}"`);
        } else {
            const actualType = actual[key] === null ? 'null' : typeof actual[key];
            if (actualType !== expectedType) {
                failures.push(`Key "${key}": expected ${expectedType}, got ${actualType}`);
            }
        }
    }
    if (failures.length === 0) return { pass: true, reason: 'Shape matches' };
    return { pass: false, reason: failures.join('; ') };
}

/**
 * Enum membership check — verifies actual is one of the allowed values.
 * @param {any} actual
 * @param {Array} allowedValues
 * @returns {{ pass: boolean, reason: string }}
 */
export function enumMatch(actual, allowedValues) {
    const pass = allowedValues.includes(actual);
    return {
        pass,
        reason: pass
            ? `${JSON.stringify(actual)} is an allowed value`
            : `${JSON.stringify(actual)} is not in [${allowedValues.map(v => JSON.stringify(v)).join(', ')}]`,
    };
}

/**
 * String length bounds check.
 * @param {any} actual
 * @param {{ min?: number, max?: number }} bounds
 * @returns {{ pass: boolean, reason: string }}
 */
export function lengthBounds(actual, { min = 0, max = Infinity } = {}) {
    if (typeof actual !== 'string') {
        return { pass: false, reason: `Expected a string, got ${typeof actual}` };
    }
    const len = actual.length;
    if (len < min) return { pass: false, reason: `Length ${len} is below min ${min}` };
    if (len > max) return { pass: false, reason: `Length ${len} exceeds max ${max}` };
    return { pass: true, reason: `Length ${len} is within [${min}, ${max}]` };
}

/**
 * Regex match on string.
 * @param {any} actual
 * @param {string|RegExp} pattern
 * @returns {{ pass: boolean, reason: string }}
 */
export function regexMatch(actual, pattern) {
    if (typeof actual !== 'string') {
        return { pass: false, reason: `Expected a string, got ${typeof actual}` };
    }
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    const pass = re.test(actual);
    return {
        pass,
        reason: pass ? `Matches pattern ${re}` : `Does not match pattern ${re}`,
    };
}

/**
 * Numeric bounds check.
 * @param {any} actual
 * @param {{ min?: number, max?: number }} bounds
 * @returns {{ pass: boolean, reason: string }}
 */
export function numberRange(actual, { min = -Infinity, max = Infinity } = {}) {
    if (typeof actual !== 'number' || isNaN(actual)) {
        return { pass: false, reason: `Expected a number, got ${typeof actual} (${actual})` };
    }
    if (actual < min) return { pass: false, reason: `${actual} is below min ${min}` };
    if (actual > max) return { pass: false, reason: `${actual} exceeds max ${max}` };
    return { pass: true, reason: `${actual} is within [${min}, ${max}]` };
}

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

/**
 * All-of combinator — all scorer functions must pass.
 * @param {Array<Function>} scorerFns  — each is () => { pass, reason }
 * @returns {{ pass: boolean, reason: string }}
 */
export function allOf(scorerFns) {
    const results = scorerFns.map(fn => fn());
    const failures = results.filter(r => !r.pass);
    if (failures.length === 0) return { pass: true, reason: `All ${results.length} checks passed` };
    return { pass: false, reason: `${failures.length} of ${results.length} failed: ${failures.map(r => r.reason).join(' | ')}` };
}

/**
 * Any-of combinator — at least one scorer function must pass.
 * @param {Array<Function>} scorerFns  — each is () => { pass, reason }
 * @returns {{ pass: boolean, reason: string }}
 */
export function anyOf(scorerFns) {
    const results = scorerFns.map(fn => fn());
    const passes = results.filter(r => r.pass);
    if (passes.length > 0) return { pass: true, reason: `${passes.length} of ${results.length} checks passed` };
    return { pass: false, reason: `All ${results.length} checks failed: ${results.map(r => r.reason).join(' | ')}` };
}

// ---------------------------------------------------------------------------
// Scorer registry — maps string names from dataset JSON to scorer functions
// ---------------------------------------------------------------------------

const SCORER_REGISTRY = { exactMatch, jsonShape, enumMatch, lengthBounds, regexMatch, numberRange };

/**
 * Resolve a dot-notation path into a value.
 * @param {any} obj
 * @param {string|undefined} path  — e.g. "strategy" or "meta.confidence"
 * @returns {any}
 */
function resolvePath(obj, path) {
    if (!path) return obj;
    return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/**
 * Run a single scorer descriptor against an actual value.
 *
 * Descriptor shape:
 *   { scorer: 'enumMatch', path?: 'strategy', args: ['exclude', 'lfs-migrate'] }
 *
 * @param {{ scorer: string, path?: string, args: any }} descriptor
 * @param {any} actualOutput  — the handler output object
 * @returns {{ scorer: string, path?: string, pass: boolean, reason: string }}
 */
function runScorerDescriptor(descriptor, actualOutput) {
    const { scorer: scorerName, path, args } = descriptor;
    const scorerFn = SCORER_REGISTRY[scorerName];
    if (!scorerFn) {
        return { scorer: scorerName, path, pass: false, reason: `Unknown scorer "${scorerName}"` };
    }
    const value = resolvePath(actualOutput, path);
    const result = scorerFn(value, args);
    return { scorer: scorerName, path, ...result };
}

// ---------------------------------------------------------------------------
// defineEval / runEval
// ---------------------------------------------------------------------------

/**
 * Declare an eval suite. Returns the definition unchanged (identity function).
 * The purpose is documentation and future type-checking.
 *
 * @param {{ name: string, feature: string, cases: Array, scoring?: object }} opts
 * @returns {object}
 */
export function defineEval(opts) {
    return opts;
}

/**
 * Run a single eval case. Returns a result object.
 *
 * @param {object} evalCase  — { id, input, mockResponse, expected, tags? }
 * @param {Function} adapter — async ({ input, mockResponse, provider }) => actualOutput
 * @returns {Promise<{ id: string, pass: boolean, scorerResults: Array, error?: string }>}
 */
async function runCase(evalCase, adapter) {
    const { id, input, mockResponse, expected } = evalCase;
    const provider = createMockProvider(mockResponse);

    let actualOutput;
    try {
        actualOutput = await adapter({ input, mockResponse, provider });
    } catch (err) {
        return {
            id,
            pass: false,
            scorerResults: [],
            error: `Adapter threw: ${err.message}`,
        };
    }

    const scorerResults = expected.map(descriptor => runScorerDescriptor(descriptor, actualOutput));
    const pass = scorerResults.every(r => r.pass);

    return { id, pass, scorerResults };
}

/**
 * Run a full eval definition against an adapter function.
 *
 * @param {{ name: string, feature: string, cases: Array }} evalDef
 * @param {Function} adapter  — async ({ input, mockResponse, provider }) => actualOutput
 * @param {{ tags?: string[] }} [opts]  — filter options
 * @returns {Promise<{ feature: string, cases: Array, passed: number, failed: number }>}
 */
export async function runEval(evalDef, adapter, { tags } = {}) {
    let cases = evalDef.cases;

    if (tags && tags.length > 0) {
        cases = cases.filter(c => c.tags && tags.some(t => c.tags.includes(t)));
    }

    const results = await Promise.all(cases.map(c => runCase(c, adapter)));

    const passed = results.filter(r => r.pass).length;
    const failed = results.length - passed;

    return {
        feature: evalDef.feature,
        name: evalDef.name,
        cases: results,
        passed,
        failed,
    };
}

// ---------------------------------------------------------------------------
// Baseline diff
// ---------------------------------------------------------------------------

/**
 * Compare current eval results against a saved baseline.
 *
 * @param {Array<{ feature: string, cases: Array }>} currentResults
 * @param {Array<{ feature: string, cases: Array }>} baselineResults
 * @returns {{ regressions: Array, improvements: Array, unchanged: Array }}
 */
export function diffAgainstBaseline(currentResults, baselineResults) {
    // Build lookup: feature+caseId → pass
    const baselineMap = new Map();
    for (const featureResult of baselineResults) {
        for (const c of featureResult.cases) {
            baselineMap.set(`${featureResult.feature}::${c.id}`, c.pass);
        }
    }

    const regressions = [];
    const improvements = [];
    const unchanged = [];

    for (const featureResult of currentResults) {
        for (const c of featureResult.cases) {
            const key = `${featureResult.feature}::${c.id}`;
            const baselinePass = baselineMap.get(key);

            if (baselinePass === undefined) {
                // New case not in baseline — treat as unchanged (not a regression)
                unchanged.push({ feature: featureResult.feature, caseId: c.id, note: 'new case' });
            } else if (baselinePass && !c.pass) {
                regressions.push({ feature: featureResult.feature, caseId: c.id });
            } else if (!baselinePass && c.pass) {
                improvements.push({ feature: featureResult.feature, caseId: c.id });
            } else {
                unchanged.push({ feature: featureResult.feature, caseId: c.id });
            }
        }
    }

    return { regressions, improvements, unchanged };
}
