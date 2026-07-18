// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Security Posture — deterministic 10-check report card (zero AI cost).
 *
 * Pure functions only: given a normalized `signals` object (already fetched
 * by the route handler in server/routes/v1/repos-security.js), `buildChecks`
 * returns the 10 check rows and `scoreChecks` folds them into a top-line
 * score. Kept framework-free so the honesty-critical unknown-vs-fail logic
 * can be unit tested with plain objects, no HTTP/GitHub API mocking.
 *
 * Every admin-gated check (secret scanning / push protection / Dependabot
 * security updates / workflow permissions / org 2FA, plus branch protection)
 * renders `'unknown'` — never `'fail'` — when the caller's token can't see
 * the underlying signal. Checks 3 (alerts), 7 (code scanning) and 8
 * (SECURITY.md) never need admin access and are always 'pass' or 'fail'.
 *
 * Spec: docs/specs/2026-07-18-community-wow-wave6.md (Feature 4).
 */

// Status vocabulary every check row renders as. 'informational' is a fifth,
// UI-only nuance layered on top of 'fail' for the GHAS-unavailable-on-private
// case (§ Honesty constraints) — it is NOT counted as a failure in scoring.
export const CHECK_STATUS = Object.freeze({
    PASS: 'pass',
    FAIL: 'fail',
    UNKNOWN: 'unknown',
    NOT_APPLICABLE: 'not_applicable',
    INFORMATIONAL: 'informational',
});

/**
 * @typedef {object} SecurityCheck
 * @property {string} id
 * @property {string} label
 * @property {'pass'|'fail'|'unknown'|'not_applicable'|'informational'} status
 * @property {'critical'|'high'|'medium'|'low'|'informational'|null} severity — only set when status is 'fail' or 'informational'
 * @property {string} why — one-line "why it matters"
 * @property {string|null} fixHint — short machine-readable hint the UI maps to a fix link ('branch-protection' | 'security-md' | null)
 */

function checkRow(id, label, status, severity, why, fixHint = null) {
    return { id, label, status, severity: status === 'fail' || status === 'informational' ? severity : null, why, fixHint };
}

/**
 * Build the 10 deterministic checks from already-fetched signals.
 *
 * @param {object} signals
 * @param {{status:'protected'|'unprotected'|'unknown', requiresReview?:boolean, allowsForcePush?:boolean, allowsDeletion?:boolean}} signals.branchProtection
 * @param {{critical:number, high:number, medium:number, low:number, total:number}} signals.alerts
 * @param {{status:'enabled'|'disabled'|'unknown'}} signals.secretScanning
 * @param {{status:'enabled'|'disabled'|'unknown'}} signals.secretScanningPushProtection
 * @param {{status:'enabled'|'disabled'|'unknown'}} signals.dependabotSecurityUpdates
 * @param {{configured:boolean}} signals.codeScanning
 * @param {{exists:boolean}} signals.securityMd
 * @param {{status:'read'|'write'|'unknown'|'not_applicable'}} signals.workflowPermissions
 * @param {{applicable:boolean, twoFactorRequired:boolean|null}} signals.org
 * @param {'public'|'private'} signals.visibility
 * @returns {SecurityCheck[]}
 */
export function buildChecks(signals) {
    const bp = signals?.branchProtection || { status: 'unknown' };
    const alerts = signals?.alerts || { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
    const secretScanning = signals?.secretScanning?.status || 'unknown';
    const pushProtection = signals?.secretScanningPushProtection?.status || 'unknown';
    const dependabotUpdates = signals?.dependabotSecurityUpdates?.status || 'unknown';
    const codeScanningConfigured = !!signals?.codeScanning?.configured;
    const securityMdExists = !!signals?.securityMd?.exists;
    const workflowPerm = signals?.workflowPermissions?.status || 'unknown';
    const org = signals?.org || { applicable: false, twoFactorRequired: null };
    const isPrivate = signals?.visibility === 'private';

    const checks = [];

    // 1. Default branch requires PR review before merge.
    if (bp.status === 'unknown') {
        checks.push(checkRow('branch_protection_review', 'Default branch requires PR review before merge',
            CHECK_STATUS.UNKNOWN, null,
            'Unreviewed changes can reach the default branch undetected.', 'branch-protection'));
    } else if (bp.status === 'unprotected' || !bp.requiresReview) {
        checks.push(checkRow('branch_protection_review', 'Default branch requires PR review before merge',
            CHECK_STATUS.FAIL, 'critical',
            'Unreviewed changes can reach the default branch undetected.', 'branch-protection'));
    } else {
        checks.push(checkRow('branch_protection_review', 'Default branch requires PR review before merge',
            CHECK_STATUS.PASS, null,
            'Unreviewed changes can reach the default branch undetected.', 'branch-protection'));
    }

    // 2. Default branch disallows force-push and deletion.
    if (bp.status === 'unknown') {
        checks.push(checkRow('branch_protection_force_push', 'Default branch disallows force-push and deletion',
            CHECK_STATUS.UNKNOWN, null,
            'Force-push or deletion of the default branch can destroy history irrecoverably.', 'branch-protection'));
    } else if (bp.status === 'unprotected' || bp.allowsForcePush || bp.allowsDeletion) {
        checks.push(checkRow('branch_protection_force_push', 'Default branch disallows force-push and deletion',
            CHECK_STATUS.FAIL, 'high',
            'Force-push or deletion of the default branch can destroy history irrecoverably.', 'branch-protection'));
    } else {
        checks.push(checkRow('branch_protection_force_push', 'Default branch disallows force-push and deletion',
            CHECK_STATUS.PASS, null,
            'Force-push or deletion of the default branch can destroy history irrecoverably.', 'branch-protection'));
    }

    // 3. Zero open critical/high alerts. Never admin-gated — the existing
    // alerts endpoint already degrades unavailable sources to a 0 contribution.
    if (alerts.critical > 0) {
        checks.push(checkRow('alerts_clear', 'Zero open critical/high security alerts',
            CHECK_STATUS.FAIL, 'critical',
            'Open critical alerts are the most direct, actionable security risk on a repo.'));
    } else if (alerts.high > 0) {
        checks.push(checkRow('alerts_clear', 'Zero open critical/high security alerts',
            CHECK_STATUS.FAIL, 'high',
            'Open critical alerts are the most direct, actionable security risk on a repo.'));
    } else {
        checks.push(checkRow('alerts_clear', 'Zero open critical/high security alerts',
            CHECK_STATUS.PASS, null,
            'Open critical alerts are the most direct, actionable security risk on a repo.'));
    }

    // 4. Secret scanning enabled. GHAS-unavailable nuance: disabled + private
    // renders informational (plan limitation), not a same-severity fail as a
    // public repo owner forgetting to flip the toggle.
    if (secretScanning === 'unknown') {
        checks.push(checkRow('secret_scanning', 'Secret scanning enabled',
            CHECK_STATUS.UNKNOWN, null,
            'Secret scanning catches committed credentials before they leak.'));
    } else if (secretScanning === 'enabled') {
        checks.push(checkRow('secret_scanning', 'Secret scanning enabled',
            CHECK_STATUS.PASS, null,
            'Secret scanning catches committed credentials before they leak.'));
    } else if (isPrivate) {
        checks.push(checkRow('secret_scanning', 'Secret scanning enabled',
            CHECK_STATUS.INFORMATIONAL, 'informational',
            'Secret scanning requires GitHub Advanced Security on private repos — not a toggle you forgot.'));
    } else {
        checks.push(checkRow('secret_scanning', 'Secret scanning enabled',
            CHECK_STATUS.FAIL, 'high',
            'Secret scanning catches committed credentials before they leak.'));
    }

    // 5. Secret scanning push protection enabled.
    if (pushProtection === 'unknown') {
        checks.push(checkRow('secret_scanning_push_protection', 'Secret scanning push protection enabled',
            CHECK_STATUS.UNKNOWN, null,
            'Push protection blocks a secret from ever being committed, not just after the fact.'));
    } else if (pushProtection === 'enabled') {
        checks.push(checkRow('secret_scanning_push_protection', 'Secret scanning push protection enabled',
            CHECK_STATUS.PASS, null,
            'Push protection blocks a secret from ever being committed, not just after the fact.'));
    } else {
        checks.push(checkRow('secret_scanning_push_protection', 'Secret scanning push protection enabled',
            CHECK_STATUS.FAIL, 'medium',
            'Push protection blocks a secret from ever being committed, not just after the fact.'));
    }

    // 6. Dependabot security updates (auto-fix PRs) enabled.
    if (dependabotUpdates === 'unknown') {
        checks.push(checkRow('dependabot_security_updates', 'Dependabot security updates enabled',
            CHECK_STATUS.UNKNOWN, null,
            'Auto-generated fix PRs close known vulnerable-dependency windows faster.'));
    } else if (dependabotUpdates === 'enabled') {
        checks.push(checkRow('dependabot_security_updates', 'Dependabot security updates enabled',
            CHECK_STATUS.PASS, null,
            'Auto-generated fix PRs close known vulnerable-dependency windows faster.'));
    } else {
        checks.push(checkRow('dependabot_security_updates', 'Dependabot security updates enabled',
            CHECK_STATUS.FAIL, 'medium',
            'Auto-generated fix PRs close known vulnerable-dependency windows faster.'));
    }

    // 7. Code scanning configured. Never admin-gated.
    checks.push(checkRow('code_scanning', 'Code scanning configured',
        codeScanningConfigured ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        codeScanningConfigured ? null : 'medium',
        'Static analysis catches vulnerable patterns before they ship.'));

    // 8. SECURITY.md present. Never admin-gated.
    checks.push(checkRow('security_md', 'SECURITY.md present',
        securityMdExists ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        securityMdExists ? null : 'medium',
        'A SECURITY.md tells researchers how to report a vulnerability responsibly.', 'security-md'));

    // 9. Default Actions workflow token permissions not read/write.
    if (workflowPerm === 'unknown') {
        checks.push(checkRow('workflow_permissions', 'Default Actions workflow token permissions are read-only',
            CHECK_STATUS.UNKNOWN, null,
            'A read/write default token over-privileges every workflow run, including ones triggered by untrusted PRs.'));
    } else if (workflowPerm === 'not_applicable') {
        checks.push(checkRow('workflow_permissions', 'Default Actions workflow token permissions are read-only',
            CHECK_STATUS.NOT_APPLICABLE, null,
            'A read/write default token over-privileges every workflow run, including ones triggered by untrusted PRs.'));
    } else if (workflowPerm === 'read') {
        checks.push(checkRow('workflow_permissions', 'Default Actions workflow token permissions are read-only',
            CHECK_STATUS.PASS, null,
            'A read/write default token over-privileges every workflow run, including ones triggered by untrusted PRs.'));
    } else {
        checks.push(checkRow('workflow_permissions', 'Default Actions workflow token permissions are read-only',
            CHECK_STATUS.FAIL, 'medium',
            'A read/write default token over-privileges every workflow run, including ones triggered by untrusted PRs.'));
    }

    // 10. Org requires 2FA for members (org repos only).
    if (!org.applicable) {
        checks.push(checkRow('org_two_factor', 'Organization requires two-factor authentication',
            CHECK_STATUS.NOT_APPLICABLE, null,
            'Personal-account repos have no organization-wide 2FA policy to check.'));
    } else if (org.twoFactorRequired === null || org.twoFactorRequired === undefined) {
        checks.push(checkRow('org_two_factor', 'Organization requires two-factor authentication',
            CHECK_STATUS.UNKNOWN, null,
            'Org-wide 2FA reduces the risk of a compromised member account reaching this repo.'));
    } else if (org.twoFactorRequired) {
        checks.push(checkRow('org_two_factor', 'Organization requires two-factor authentication',
            CHECK_STATUS.PASS, null,
            'Org-wide 2FA reduces the risk of a compromised member account reaching this repo.'));
    } else {
        checks.push(checkRow('org_two_factor', 'Organization requires two-factor authentication',
            CHECK_STATUS.FAIL, 'low',
            'Org-wide 2FA reduces the risk of a compromised member account reaching this repo.'));
    }

    return checks;
}

/**
 * Fold the 10 checks into a top-line score. 'not_applicable' checks are
 * excluded from the denominator (a personal-account repo isn't penalized for
 * an org-2FA check that structurally cannot apply); 'unknown' checks are
 * excluded from both the numerator AND the denominator so a fully-locked-out
 * non-admin collaborator doesn't see a misleadingly low OR high score —
 * `visibilityComplete` tells the UI whether to caveat the number at all.
 */
export function scoreChecks(checks) {
    let passing = 0, failing = 0, unknown = 0, notApplicable = 0, informational = 0;
    for (const c of checks || []) {
        switch (c.status) {
            case CHECK_STATUS.PASS: passing++; break;
            case CHECK_STATUS.FAIL: failing++; break;
            case CHECK_STATUS.UNKNOWN: unknown++; break;
            case CHECK_STATUS.NOT_APPLICABLE: notApplicable++; break;
            case CHECK_STATUS.INFORMATIONAL: informational++; break;
            default: break;
        }
    }
    const total = (checks || []).length;
    // Informational checks count as neither pass nor fail in the numerator,
    // but ARE part of the "visible" denominator (they're not a visibility gap
    // — the caller genuinely knows the state, it's just not actionable).
    const visible = total - unknown - notApplicable;
    const score = visible > 0 ? Math.round((passing / visible) * 100) : null;
    return {
        passing,
        failing,
        unknown,
        notApplicable,
        informational,
        total,
        visible,
        score,
        partialVisibility: unknown > 0,
    };
}
