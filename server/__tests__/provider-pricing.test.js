// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { estimateCallCostCents, getPricingForModel, computeCostUSD, PROVIDER_PRICING } from '../lib/provider-pricing.js';
import { PROVIDER_PRICING as FRONTEND_PRICING } from '../../src/utils/providerPricing.js';
import { COMPLETION_MODELS } from '../../src/utils/providerModels.js';

describe('getPricingForModel', () => {
    it('returns the exact entry when the model id matches', () => {
        expect(getPricingForModel('gemini-2.5-flash')).toEqual(PROVIDER_PRICING['gemini-2.5-flash']);
    });

    it('falls back to the longest matching prefix', () => {
        const p = getPricingForModel('gemini-2.5-flash-002');
        expect(p).toEqual(PROVIDER_PRICING['gemini-2.5-flash']);
    });

    it('returns the conservative fallback for unknown models', () => {
        const p = getPricingForModel('made-up-model-id');
        expect(p.input).toBeGreaterThan(0);
    });

    it('handles null/undefined gracefully', () => {
        expect(getPricingForModel(null).input).toBeGreaterThan(0);
        expect(getPricingForModel(undefined).input).toBeGreaterThan(0);
    });

    it('strips a leading <vendor>/ prefix when the bare model is known (OpenRouter)', () => {
        // OpenRouter exposes models as `anthropic/claude-sonnet-4-6` — the
        // PROVIDER_PRICING table is keyed by the bare model id, so without
        // the vendor-prefix strip we'd fall back to the conservative
        // estimate and under-report cost ~6×.
        expect(getPricingForModel('anthropic/claude-sonnet-4-6'))
            .toEqual(PROVIDER_PRICING['claude-sonnet-4-6']);
        expect(getPricingForModel('openai/gpt-4o-mini'))
            .toEqual(PROVIDER_PRICING['gpt-4o-mini']);
    });
});

describe('computeCostUSD with OpenRouter vendor prefixes', () => {
    it('normalises OpenRouter vendor prefix when computing cost', () => {
        const cost = computeCostUSD({
            modelName: 'anthropic/claude-sonnet-4-6',
            inputTokens: 1000,
            outputTokens: 500,
        });
        const fallback = computeCostUSD({
            modelName: 'totally-unknown-model',
            inputTokens: 1000,
            outputTokens: 500,
        });
        expect(cost).toBeGreaterThan(0);
        expect(cost).not.toBe(fallback);
        // Sanity: should match the bare claude pricing exactly.
        const bare = computeCostUSD({
            modelName: 'claude-sonnet-4-6',
            inputTokens: 1000,
            outputTokens: 500,
        });
        expect(cost).toBe(bare);
    });
});

describe('estimateCallCostCents', () => {
    it('always tick at least 1 cent so tiny prompts cannot free-ride the cap', () => {
        const cost = estimateCallCostCents({
            modelName: 'gemini-2.5-flash',
            promptChars: 10,
            responseChars: 5,
        });
        expect(cost).toBe(1);
    });

    it('scales linearly with prompt + response size', () => {
        const small = estimateCallCostCents({
            modelName: 'gemini-2.5-pro',
            promptChars: 4_000_000,    // 1M tokens
            responseChars: 0,
        });
        const big = estimateCallCostCents({
            modelName: 'gemini-2.5-pro',
            promptChars: 8_000_000,    // 2M tokens
            responseChars: 0,
        });
        expect(big).toBeGreaterThanOrEqual(small * 2 - 1);
    });

    it('prefers exact tokens when the SDK supplies them', () => {
        // 1M input tokens at $0.30/M → 30 cents.
        const cost = estimateCallCostCents({
            modelName: 'gemini-2.5-flash',
            inputTokens: 1_000_000,
            outputTokens: 0,
        });
        expect(cost).toBe(30);
    });

    it('adds output cost when the model has output pricing', () => {
        // 1M output tokens at $2.50/M → 250 cents (Flash output).
        const cost = estimateCallCostCents({
            modelName: 'gemini-2.5-flash',
            inputTokens: 0,
            outputTokens: 1_000_000,
        });
        expect(cost).toBe(250);
    });

    it('skips output for embedding-only models without crashing', () => {
        const cost = estimateCallCostCents({
            modelName: 'text-embedding-3-small',
            inputTokens: 1_000_000,
        });
        // 1M tokens × $0.02 = 2 cents.
        expect(cost).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Server ↔ frontend pricing parity (P1.4)
//
// This file (server/lib/provider-pricing.js) is a hand-maintained mirror of
// src/utils/providerPricing.js, kept independent so server code never imports
// from src/. That independence is exactly how they drifted before: this
// suite previously missed gpt-5.4*/5.5*, claude-opus-4-7/4-6, and
// gemini-2.5-flash-lite entirely, and had gemini-2.5-pro's output priced at
// $5.00 instead of $10.00 — a real metering hole (BYOK claude-opus-4-7 fell
// through to FALLBACK_PRICING, undercounting spend ~10x against the cap).
// ---------------------------------------------------------------------------
describe('server/frontend pricing parity', () => {
    it('every model id present in BOTH pricing tables has equal input/output pricing', () => {
        const sharedIds = Object.keys(PROVIDER_PRICING).filter((id) => id in FRONTEND_PRICING);
        // Sanity: the intersection should not be trivially small — otherwise this
        // assertion would pass vacuously while the two tables silently diverge.
        expect(sharedIds.length).toBeGreaterThan(15);

        for (const id of sharedIds) {
            expect(PROVIDER_PRICING[id].input, `${id} input mismatch`).toBe(FRONTEND_PRICING[id].input);
            expect(PROVIDER_PRICING[id].output, `${id} output mismatch`).toBe(FRONTEND_PRICING[id].output);
        }
    });

    it('every id in the frontend model catalog (COMPLETION_MODELS) resolves to non-FALLBACK server pricing', () => {
        const FALLBACK_INPUT = 0.50;
        const FALLBACK_OUTPUT = 2.00;

        for (const [provider, models] of Object.entries(COMPLETION_MODELS)) {
            for (const model of models) {
                // OpenRouter/local ids are aggregator-namespaced or user-defined —
                // getPricingForModel strips a leading vendor/ prefix for OpenRouter,
                // but local has no fixed catalogue to hold to a real-pricing bar.
                if (provider === 'local') continue;

                const pricing = getPricingForModel(model.id);
                const isFallback = pricing.input === FALLBACK_INPUT && pricing.output === FALLBACK_OUTPUT;
                expect(isFallback, `${provider}/${model.id} resolved to FALLBACK_PRICING — add it to server/lib/provider-pricing.js`).toBe(false);

                // The resolved price must also match what the frontend catalog itself
                // claims for this exact model — not just "some" non-fallback number.
                if (model.pricing && typeof model.pricing.output === 'number') {
                    expect(pricing.input, `${provider}/${model.id} input diverges from its own catalog entry`).toBe(model.pricing.input);
                    expect(pricing.output, `${provider}/${model.id} output diverges from its own catalog entry`).toBe(model.pricing.output);
                }
            }
        }
    });
});
