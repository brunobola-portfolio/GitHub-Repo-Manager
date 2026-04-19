# AI Eval Harness

Unit-test-style evaluation framework for AI handler parse/validation logic.

## What this is (and isn't)

**IS:** A framework that tests whether our AI handler code correctly parses
and validates whatever a model returns. It uses a **mock provider** that
returns a pre-configured string — no real LLM is called.

**IS NOT:** A framework for testing prompt quality, model accuracy, or
comparing model versions. Real-model eval mode is deliberately deferred to
a future phase (see "Future: --real mode" below).

The value: every time handler parse logic changes, the golden datasets catch
regressions instantly in CI without needing API keys.

## Quick start

```bash
# Run all golden datasets
npm run test:evals

# Run a specific dataset
node server/evals/run.js --dataset=migration-size-strategy.json

# Filter by tag (both forms work)
node server/evals/run.js --tag=happy-path
node server/evals/run.js --tag happy-path

# Compare against a saved baseline
node server/evals/run.js --baseline=server/evals/baseline.json

# Generate a markdown summary file
node server/evals/run.js --output-md=.dev/evals-last-run.md

# Verbose (shows unchanged cases in baseline diff)
node server/evals/run.js --verbose
```

Exit code: `0` if all cases pass (and no regressions vs baseline), `1` otherwise.

## Architecture

```
server/
  lib/ai-evals.js          — Framework: scorers, runEval, diffAgainstBaseline
  evals/
    run.js                 — CLI entry point
    adapters/
      migration-size-strategy.js  — Feature adapter
      migration-description.js    — Feature adapter
    data/
      migration-size-strategy.json  — Golden dataset (10 cases)
      migration-description.json    — Golden dataset (8 cases)
    README.md              — This file
  __tests__/
    ai-evals.test.js       — Unit tests for the framework itself
```

## How the mock provider works

Each eval case has a `mockResponse` string. The runner creates a mock
provider that always returns that string, regardless of the prompt:

```js
// Internal to server/lib/ai-evals.js
function createMockProvider(response) {
    return {
        async generate() { return { text: response, parsed: tryParseJson(response) } },
        async embed() { throw new Error('embed not supported in mock eval mode') },
        async *generateStream() { yield response },
    }
}
```

This matches the real `AIProvider` interface (see `server/lib/ai-provider.js`).
The actual prompt the adapter builds is irrelevant for scoring — what matters
is that the **parse logic** in the adapter correctly handles `mockResponse`.

## Golden dataset format

```json
{
  "feature": "migration-size-strategy",
  "version": 1,
  "cases": [
    {
      "id": "small-lfs-binary-happy",
      "input": { ... },
      "mockResponse": "{\"strategy\":\"lfs-migrate\",\"rationale\":\"binary assets present\",\"confidence\":0.8}",
      "expected": [
        { "scorer": "jsonShape", "args": { "strategy": "string", "rationale": "string", "confidence": "number" } },
        { "scorer": "enumMatch", "path": "strategy", "args": ["exclude", "lfs-migrate"] },
        { "scorer": "numberRange", "path": "confidence", "args": { "min": 0, "max": 1 } },
        { "scorer": "lengthBounds", "path": "rationale", "args": { "min": 5, "max": 500 } }
      ],
      "tags": ["lfs", "happy-path"]
    }
  ]
}
```

- `path` — dot-notation path into the adapter output (e.g. `"strategy"`, `"meta.confidence"`). Omit to score the whole output.
- `tags` — optional array for filtering with `--tag=xyz`.
- `_note` — optional human-readable note (ignored by runner).

## Available scorers

| Scorer | Args | Description |
|--------|------|-------------|
| `exactMatch` | `expected: any` | Deep equality |
| `jsonShape` | `{ key: 'type', ... }` | All keys exist with correct types |
| `enumMatch` | `allowedValues: []` | Value is in the allowed list |
| `lengthBounds` | `{ min?, max? }` | String length within bounds |
| `regexMatch` | `pattern: string\|RegExp` | Regex match on string |
| `numberRange` | `{ min?, max? }` | Numeric value within bounds |

Combinators (used in code, not in JSON datasets):
- `allOf(scorerFns)` — all must pass
- `anyOf(scorerFns)` — at least one must pass

## How to add a new golden dataset

1. Create `server/evals/data/your-feature.json` following the format above.
   - Use the same `feature` string as returned by the adapter.
   - Aim for a mix: happy-path cases, edge cases, error/malformed-response cases.
   - Include at least one error-path case to verify the parse fallback is tested.

2. Create `server/evals/adapters/your-feature.js` with this shape:

```js
export const feature = 'your-feature';

// Build the prompt (same as in server/routes/ai.js handler)
export function buildPrompt(input) { ... }

// Parse the response (same as in server/routes/ai.js handler)
// If logic isn't a pure function, duplicate it here with a comment:
// Mirrors server/routes/ai.js:LINE-LINE parse logic. Keep in sync.
export function parseResponse(text, input) { ... }

// Entry point called by the runner
export async function runCase({ input, mockResponse, provider }) {
    buildPrompt(input);  // validates prompt doesn't throw
    const { text } = await provider.generate({ prompt: 'eval-prompt' });
    return parseResponse(text, input);
}
```

3. Run `npm run test:evals` — your new cases should appear in the output.

## How to integrate a new feature handler

The adapter's `runCase` function must mirror the route handler's parse path.
If the route handler parses the response inline (not as a pure function),
duplicate the parse logic into the adapter and add this comment:

```js
// Mirrors server/routes/ai.js:1382-1430 parse logic. Keep in sync.
```

When the route handler changes, update the adapter to match.

## Baseline regression guard

To save a baseline — no hand-editing required:

```bash
node server/evals/run.js > server/evals/baseline.local.json
```

The runner emits `featureResults` directly in its JSON output, so the file is
immediately usable as a baseline. The shape is stable: an array of
`{ feature, cases: [{ id, pass }] }` objects.

Note: use `node server/evals/run.js` directly (not `npm run test:evals`) when
redirecting stdout to a file — npm adds a header line that would corrupt the JSON.

To compare against a saved baseline:

```bash
node server/evals/run.js --baseline=server/evals/baseline.local.json
```

- **Regressions** (passed → failed): cause exit 1 — these are bugs.
- **Improvements** (failed → passed): reported as info only.
- **Unchanged**: suppressed unless `--verbose`.

Per-developer baselines can be saved to `server/evals/baseline.local.json`
(gitignored). Shared baselines can be committed at any path outside that name.

## Future: --real mode

The framework is structured to support real-model evaluation as a follow-up.
The `createMockProvider` in `ai-evals.js` can be replaced with the actual
`GeminiProvider` from `server/lib/ai-provider.js`.

A future `--real` flag would:
1. Load the real provider from env (requires `GEMINI_API_KEY`).
2. Pass the actual prompt to the model and score the real response.
3. Run on a subset of cases tagged `real` to control API cost.

**This is not implemented in MVP.** Prompt quality and model accuracy are
out of scope for the eval harness until real-model mode is added.
