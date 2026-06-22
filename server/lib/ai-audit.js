// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Build PII-safe audit metadata for an AI call.
 *
 * Records only counts / model / cost — NEVER the prompt or reply content — so
 * the audit trail is a forensic + cost record (and an exfiltration tripwire)
 * without persisting user data. Building the object here (allow-list of fields)
 * guarantees no caller can accidentally log content through it.
 *
 * @param {object} [input]
 * @param {string} [input.feature]        — e.g. 'chat'
 * @param {string} [input.model]          — resolved model id
 * @param {{inputTokens?:number|null, outputTokens?:number|null}|null} [input.usage]
 * @param {number|null} [input.costUSD]
 * @param {number} [input.messageLength]
 * @returns {object} PII-safe metadata
 */
export function buildAIAuditMeta({ feature, model, usage, costUSD, messageLength } = {}) {
    const meta = {};
    if (feature) meta.feature = feature;
    if (typeof model === 'string' && model) meta.model = model;
    if (usage && typeof usage === 'object') {
        if (Number.isFinite(usage.inputTokens)) meta.inputTokens = usage.inputTokens;
        if (Number.isFinite(usage.outputTokens)) meta.outputTokens = usage.outputTokens;
    }
    if (Number.isFinite(costUSD)) meta.costCents = Math.max(0, Math.round(costUSD * 100));
    if (Number.isFinite(messageLength)) meta.messageLength = messageLength;
    return meta;
}
