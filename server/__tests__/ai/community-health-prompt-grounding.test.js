// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The generated SECURITY.md invented commitments the project never made.
 *
 * The prompt asked for "supported versions … expected response time" from
 * nothing but a repository name and a contact email, so the model produced a
 * version-support policy and a response-time SLA out of thin air — then
 * `commitOrOpenPR` published it under the user's name, in `direct` mode by
 * default. A fabricated security SLA is the most expensive kind of invented
 * claim this product can ship.
 *
 * `grounded-prompts.js` already solved this and exports NEVER_INVENT_RULE;
 * none of the five PROMPT_TEMPLATES carried it.
 */
import { describe, it, expect } from 'vitest';
import { PROMPT_TEMPLATES } from '../../lib/ai-features/community-health-fix.js';
import { NEVER_INVENT_RULE } from '../../lib/ai-features/grounded-prompts.js';

describe('community-health prompts are grounded', () => {
    it('exposes the five templates', () => {
        expect(Object.keys(PROMPT_TEMPLATES).sort()).toEqual(
            ['contributing', 'issueTemplate', 'prTemplate', 'readmeStub', 'security'].sort(),
        );
    });

    it('every template carries the anti-invention rule', () => {
        const missing = Object.entries(PROMPT_TEMPLATES)
            .filter(([, tpl]) => !tpl.includes(NEVER_INVENT_RULE.trim()))
            .map(([name]) => name);
        expect(missing, 'these publish model-invented claims under the user name').toEqual([]);
    });

    it('the SECURITY.md prompt does not ask the model to state a response time', () => {
        // There is no SLA to state. Asking for one guarantees a fabricated one.
        expect(PROMPT_TEMPLATES.security).not.toMatch(/expected response time/i);
    });

    it('the SECURITY.md prompt tells the model to leave unknown commitments as placeholders', () => {
        expect(PROMPT_TEMPLATES.security).toMatch(/TODO/);
    });
});
