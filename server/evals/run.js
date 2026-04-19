#!/usr/bin/env node
/**
 * server/evals/run.js — Eval harness CLI runner
 *
 * Reads all golden datasets in server/evals/data/*.json, runs each eval
 * against the corresponding adapter with a mock provider, and outputs a
 * JSON report to stdout (plus an optional markdown summary file).
 *
 * Usage:
 *   node server/evals/run.js
 *   node server/evals/run.js --tag=happy-path
 *   node server/evals/run.js --tag happy-path
 *   node server/evals/run.js --dataset=migration-size-strategy.json
 *   node server/evals/run.js --baseline=server/evals/baseline.json
 *   node server/evals/run.js --output-md=server/evals/last-run.md
 *   node server/evals/run.js --verbose
 *
 * Exit codes:
 *   0 — all cases pass (or baseline comparison has no regressions)
 *   1 — one or more cases fail (or regressions detected vs baseline)
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { join, dirname, basename } from 'path';
import { runEval, diffAgainstBaseline } from '../lib/ai-evals.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const ADAPTERS_DIR = join(__dirname, 'adapters');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse argv supporting both --key=value and --key value forms.
 * Boolean flags (--verbose) are set to true when no value follows.
 *
 * @param {string[]} argv  — typically process.argv (includes node + script)
 * @returns {Record<string, string|boolean>}
 */
function parseArgs(argv) {
    const args = {};
    const tokens = argv.slice(2);
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!token.startsWith('--')) continue;
        const eq = token.indexOf('=');
        if (eq >= 0) {
            // --key=value form
            args[token.slice(2, eq)] = token.slice(eq + 1);
        } else {
            const key = token.slice(2);
            const next = tokens[i + 1];
            if (next && !next.startsWith('--')) {
                // --key value form
                args[key] = next;
                i++;
            } else {
                // boolean flag
                args[key] = true;
            }
        }
    }
    return args;
}

const args = parseArgs(process.argv);

// Reject string flags given without a value (e.g. --tag alone)
for (const flag of ['tag', 'dataset', 'baseline', 'output-md']) {
    if (args[flag] === true) {
        console.error(`[eval] --${flag} requires a value (e.g. --${flag}=happy-path or --${flag} happy-path)`);
        process.exit(1);
    }
}

const filterTag = args.tag || null;
const filterDataset = args.dataset || null;
const baselinePath = args.baseline || null;
const outputMd = args['output-md'] || null;
const verbose = args.verbose === true || args.verbose === 'true';

// ---------------------------------------------------------------------------
// Discover and load datasets
// ---------------------------------------------------------------------------

function loadDatasets() {
    let files;
    try {
        files = readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    } catch {
        console.error(`[eval] No data directory found at ${DATA_DIR}`);
        process.exit(1);
    }

    if (filterDataset) {
        const target = filterDataset.endsWith('.json') ? filterDataset : `${filterDataset}.json`;
        files = files.filter(f => f === target);
        if (files.length === 0) {
            console.error(`[eval] Dataset not found: ${target}`);
            process.exit(1);
        }
    }

    return files.map(file => {
        const raw = readFileSync(join(DATA_DIR, file), 'utf8');
        const dataset = JSON.parse(raw);

        // M6: warn when dataset.feature disagrees with filename
        const expectedFeature = file.replace(/\.json$/, '');
        if (dataset.feature && dataset.feature !== expectedFeature) {
            console.error(
                `[eval] Dataset file ${file} declares feature "${dataset.feature}"; ` +
                `expected "${expectedFeature}". Using declared feature.`
            );
        }

        return { file, dataset };
    });
}

// ---------------------------------------------------------------------------
// Load adapter for a feature
// ---------------------------------------------------------------------------

async function loadAdapter(feature) {
    const adapterPath = join(ADAPTERS_DIR, `${feature}.js`);
    const adapterUrl = pathToFileURL(adapterPath).href;
    const mod = await import(adapterUrl);
    if (typeof mod.runCase !== 'function') {
        throw new Error(`Adapter for feature "${feature}" must export a runCase function`);
    }
    return mod.runCase;
}

// ---------------------------------------------------------------------------
// Run all datasets
// ---------------------------------------------------------------------------

async function runAll() {
    const datasets = loadDatasets();
    const runAt = new Date().toISOString();
    const featureResults = [];
    const allFailures = [];

    for (const { file, dataset } of datasets) {
        const { feature, cases } = dataset;

        let adapter;
        try {
            adapter = await loadAdapter(feature);
        } catch (err) {
            console.error(`[eval] Failed to load adapter for "${feature}": ${err.message}`);
            process.exit(1);
        }

        const evalDef = { name: file, feature, cases };
        const opts = filterTag ? { tags: [filterTag] } : {};
        const result = await runEval(evalDef, adapter, opts);

        featureResults.push(result);

        // Collect failures for report
        for (const c of result.cases) {
            if (!c.pass) {
                allFailures.push({
                    feature,
                    caseId: c.id,
                    error: c.error || null,
                    scorers: c.error
                        ? []
                        : c.scorerResults.filter(r => !r.pass).map(r => ({
                            scorer: r.scorer,
                            path: r.path,
                            pass: false,
                            reason: r.reason,
                        })),
                });
            }
        }
    }

    const totalCases = featureResults.reduce((s, r) => s + r.cases.length, 0);
    const totalPassed = featureResults.reduce((s, r) => s + r.passed, 0);
    const totalFailed = featureResults.reduce((s, r) => s + r.failed, 0);

    // I1: exit 1 when a filter produces zero cases (prevents silent all-green on typo'd tags)
    if (totalCases === 0 && (filterTag || filterDataset)) {
        const filters = [
            filterTag ? `--tag=${filterTag}` : null,
            filterDataset ? `--dataset=${filterDataset}` : null,
        ].filter(Boolean).join(' ');
        console.error(`[eval] No cases matched filter(s): ${filters}`);
        console.error('[eval] Check the filter values are correct.');
        process.exit(1);
    }

    const byFeature = {};
    for (const r of featureResults) {
        byFeature[r.feature] = { passed: r.passed, failed: r.failed };
    }

    // C1: emit featureResults directly so `npm run test:evals > baseline.json`
    // produces a usable baseline without hand-editing.
    const report = {
        runAt,
        totalCases,
        passed: totalPassed,
        failed: totalFailed,
        byFeature,
        featureResults: featureResults.map(r => ({
            feature: r.feature,
            cases: r.cases.map(c => ({ id: c.id, pass: c.pass })),
        })),
        failures: allFailures,
    };

    // ---------------------------------------------------------------------------
    // Baseline diff (optional)
    // ---------------------------------------------------------------------------

    let baselineDiff = null;
    let hasRegressions = false;

    if (baselinePath) {
        if (!existsSync(baselinePath)) {
            console.error(`[eval] Baseline file not found: ${baselinePath}`);
            process.exit(1);
        }
        const baselineRaw = readFileSync(baselinePath, 'utf8');
        const baseline = JSON.parse(baselineRaw);
        const baselineFeatureResults = baseline.featureResults || [];

        baselineDiff = diffAgainstBaseline(featureResults, baselineFeatureResults);
        hasRegressions = baselineDiff.regressions.length > 0;

        report.baselineDiff = {
            regressions: baselineDiff.regressions,
            improvements: baselineDiff.improvements,
            ...(verbose ? { unchanged: baselineDiff.unchanged } : {}),
        };
    }

    // ---------------------------------------------------------------------------
    // Output
    // ---------------------------------------------------------------------------

    // JSON report to stdout
    console.log(JSON.stringify(report, null, 2));

    // Markdown summary file (optional)
    if (outputMd) {
        const md = buildMarkdownSummary(report, featureResults, baselineDiff, verbose);
        writeFileSync(outputMd, md, 'utf8');
        console.error(`[eval] Markdown summary written to ${outputMd}`);
    }

    // Exit code
    const exitCode = (totalFailed > 0 || hasRegressions) ? 1 : 0;
    process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Markdown summary builder
// ---------------------------------------------------------------------------

function buildMarkdownSummary(report, featureResults, baselineDiff, verbose) {
    const lines = [];
    const status = report.failed === 0 ? 'PASS' : 'FAIL';
    lines.push(`# Eval Run — ${status}`);
    lines.push('');
    lines.push(`**Run at:** ${report.runAt}`);
    lines.push(`**Total:** ${report.totalCases} cases | **Passed:** ${report.passed} | **Failed:** ${report.failed}`);
    lines.push('');
    lines.push('## By Feature');
    lines.push('');
    lines.push('| Feature | Passed | Failed |');
    lines.push('|---------|--------|--------|');
    for (const [feat, counts] of Object.entries(report.byFeature)) {
        const icon = counts.failed > 0 ? 'FAIL' : 'PASS';
        lines.push(`| ${feat} | ${counts.passed} | ${counts.failed} (${icon}) |`);
    }
    lines.push('');

    if (report.failures.length > 0) {
        lines.push('## Failures');
        lines.push('');
        for (const f of report.failures) {
            lines.push(`### ${f.feature} / ${f.caseId}`);
            if (f.error) {
                lines.push(`- **Error:** ${f.error}`);
            }
            for (const s of f.scorers) {
                lines.push(`- **${s.scorer}**${s.path ? ` (path: ${s.path})` : ''}: ${s.reason}`);
            }
            lines.push('');
        }
    }

    if (baselineDiff) {
        lines.push('## Baseline Diff');
        lines.push('');
        if (baselineDiff.regressions.length > 0) {
            lines.push('### Regressions (used to pass, now fail)');
            for (const r of baselineDiff.regressions) {
                lines.push(`- ${r.feature} / ${r.caseId}`);
            }
            lines.push('');
        }
        if (baselineDiff.improvements.length > 0) {
            lines.push('### Improvements (used to fail, now pass)');
            for (const r of baselineDiff.improvements) {
                lines.push(`- ${r.feature} / ${r.caseId}`);
            }
            lines.push('');
        }
    }

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

runAll().catch(err => {
    console.error('[eval] Unexpected error:', err);
    process.exit(1);
});
