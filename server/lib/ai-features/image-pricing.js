// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-provider/per-model/per-quality flat-cents pricing for AI raster image
 * generation (Wave 6c). Deliberately **not** a mirror of `provider-pricing.js`
 * — that module is token-based (input/output tokens × per-million pricing)
 * and cannot represent flat- or tiered-per-image pricing; shoehorning image
 * cost through it would produce silently wrong numbers.
 *
 * Why not one flat constant for everything? OpenAI's `gpt-image-1` pricing
 * varies ~20x across quality × resolution tiers ($0.011–$0.25/image). The
 * 2026-06-05 audit's "pricing lies the gate missed" remediation already
 * established that this codebase does not ship flattened/averaged pricing
 * for a genuinely tiered cost — the same bar applies here. `getImageCostCents`
 * therefore throws on any (provider, model, quality, size) combination it
 * doesn't have an exact entry for, rather than silently guessing a nearby
 * number.
 *
 * OpenRouter is the one deliberate exception: it fronts 30+ third-party
 * image models with pass-through pricing that changes independently of this
 * codebase, so enumerating every model/quality/size combo isn't tractable.
 * Known OpenRouter model ids get an exact entry when we have one; anything
 * else falls back to a documented flat estimate, and the return value always
 * flags `estimated: true` for OpenRouter so callers (spend recording, UI)
 * can be honest about the uncertainty instead of presenting it as a real price.
 */

/**
 * Cents per image, keyed `provider -> model -> ...`.
 *
 * - Gemini: flat per-image price (no quality/resolution tiers as of the
 *   models below) under a synthetic `standard` quality key so the lookup
 *   shape stays uniform across providers.
 * - OpenAI: `quality -> size -> cents`, mirroring gpt-image-1's real tiered
 *   pricing (Low/Medium/High × 1024x1024/1024x1536/1536x1024).
 *
 * Update alongside any provider pricing change; these are picked from the
 * published per-image rates in docs/specs research, not derived from token
 * pricing.
 */
export const IMAGE_PRICING = Object.freeze({
	gemini: {
		'gemini-2.5-flash-image': { standard: 4 }, // ~$0.039/image -> 4c (rounded up)
		'gemini-3.1-flash-image-preview': { standard: 4 }, // same generation-token pricing as 2.5 flash image at time of writing
	},
	openai: {
		'gpt-image-1': {
			low: { '1024x1024': 1.1, '1024x1536': 1.6, '1536x1024': 1.6 },
			medium: { '1024x1024': 4.2, '1024x1536': 6.3, '1536x1024': 6.3 },
			high: { '1024x1024': 16.7, '1024x1536': 25.0, '1536x1024': 25.0 },
		},
	},
});

// OpenRouter is a pass-through marketplace (30+ image models, third-party
// pricing that can change without a deploy here) — this is a documented
// estimate, not a real price. Every OpenRouter cost result is flagged
// `estimated: true` regardless of whether the model id below matched.
const OPENROUTER_FALLBACK_ESTIMATE_CENTS = 4;

// A handful of OpenRouter model ids that route to a model we already price
// exactly elsewhere in this table — still flagged `estimated: true` because
// OpenRouter's own margin/pass-through pricing isn't guaranteed to match the
// upstream provider's list price.
const OPENROUTER_KNOWN_MODEL_CENTS = Object.freeze({
	'google/gemini-2.5-flash-image': 4,
});

/**
 * Resolve the flat cents cost of generating one image.
 *
 * @param {string} provider 'gemini' | 'openai' | 'openrouter'
 * @param {string} model provider-specific model id
 * @param {{ quality?: string, size?: string }} [opts]
 *   `quality` defaults to `'standard'` (Gemini has no quality tiers; OpenAI
 *   requires an explicit 'low'|'medium'|'high'). `size` defaults to
 *   `'1024x1024'`.
 * @returns {{ cents: number, estimated: boolean }}
 * @throws {Error} when the provider is not image-capable, or when the
 *   (model, quality, size) combination has no known price — callers must
 *   not fall back to a guessed number for gemini/openai.
 */
export function getImageCostCents(provider, model, { quality = 'standard', size = '1024x1024' } = {}) {
	if (!provider) throw new Error('getImageCostCents: provider is required')
	if (!model) throw new Error('getImageCostCents: model is required')

	if (provider === 'openrouter') {
		const known = OPENROUTER_KNOWN_MODEL_CENTS[model]
		return { cents: known ?? OPENROUTER_FALLBACK_ESTIMATE_CENTS, estimated: true }
	}

	const providerMap = IMAGE_PRICING[provider]
	if (!providerMap) {
		throw new Error(`getImageCostCents: provider "${provider}" is not image-capable (no pricing table)`)
	}

	const modelMap = providerMap[model]
	if (!modelMap) {
		throw new Error(`getImageCostCents: unknown model "${model}" for provider "${provider}"`)
	}

	if (provider === 'gemini') {
		const cents = modelMap.standard
		if (cents == null) {
			throw new Error(`getImageCostCents: no "standard" price for gemini model "${model}"`)
		}
		return { cents, estimated: false }
	}

	if (provider === 'openai') {
		const qualityMap = modelMap[quality]
		if (!qualityMap) {
			throw new Error(`getImageCostCents: unknown quality "${quality}" for openai model "${model}"`)
		}
		const cents = qualityMap[size]
		if (cents == null) {
			throw new Error(`getImageCostCents: unknown size "${size}" for openai model "${model}" quality "${quality}"`)
		}
		return { cents, estimated: false }
	}

	// Should be unreachable given IMAGE_PRICING's current keys, but guards
	// against a future provider being added to the table without a matching
	// branch here (silent fallthrough would otherwise return undefined).
	throw new Error(`getImageCostCents: provider "${provider}" has a pricing table but no cost-resolution branch`)
}
