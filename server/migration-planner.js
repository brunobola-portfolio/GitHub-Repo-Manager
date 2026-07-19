import logger from './lib/logger.js';

// A repo only counts as a *size* risk above this. Below it, "this repo is large"
// is noise that trains users to ignore the whole panel (a 300 MB repo is not a risk).
const SIZE_RISK_THRESHOLD_BYTES = 1_000_000_000; // 1 GB

// Phrases that mean the model is speculating about data it was never given
// (LFS status, CI/CD presence, blob sizes, commit history). A premium advisor
// states known facts or stays silent — it never shows the user "unconfirmed…".
const HEDGING_PATTERNS = [
  /\bunconfirmed\b/i,
  /\b(?:not|un)\s*specified\b/i,
  /\bnot been specified\b/i,
  /\bit is (?:not )?(?:un)?clear\b/i,
  /\bunclear (?:whether|if)\b/i,
  /\bcannot (?:be )?determined?\b/i,
  /\bunable to determine\b/i,
  /\bno information\b/i,
  /\bnot provided\b/i,
  /\bit is not known\b/i,
  /\bif (?:git )?lfs is (?:being )?used\b/i,
];

const SIZE_WORDS = /\b(?:size|large|larger|big|bigger|huge|gb|gigabyte|transfer duration)\b/i;

function isHedging(text) {
  const s = String(text || '');
  return HEDGING_PATTERNS.some((re) => re.test(s));
}

function normalizeSeverity(severity) {
  const v = String(severity || '').toLowerCase();
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'low';
}

/**
 * Enforce honesty on a migration analysis (from AI or fallback) before it
 * reaches the user. Pure function — given the same analysis + context it always
 * returns the same result. It:
 *  - drops risks/suggestions/warnings that hedge about ungiven data,
 *  - drops "this repo is large" risks when no selected repo actually is,
 *  - normalizes severities to high|medium|low,
 *  - de-duplicates risks (by title) and suggestions (by text).
 *
 * @param {Object} analysis - { executionOrder, risks, suggestions, estimatedMinutes, warnings }
 * @param {Object} [context] - migration context; uses context.repos[].size
 * @returns {{ executionOrder, risks, suggestions, estimatedMinutes, warnings }}
 */
export function sanitizeAnalysis(analysis = {}, context = {}) {
  const repos = context.repos || [];
  const anyRepoIsLarge = repos.some((r) => (r?.size || 0) >= SIZE_RISK_THRESHOLD_BYTES);

  const isUngroundedSizeRisk = (risk) => {
    const text = `${risk.title || ''} ${risk.description || ''}`;
    return SIZE_WORDS.test(text) && !anyRepoIsLarge;
  };

  const seenRisk = new Set();
  const risks = [];
  for (const raw of analysis.risks || []) {
    if (!raw || typeof raw !== 'object') continue;
    const blob = `${raw.title || ''} ${raw.description || ''} ${raw.mitigation || ''}`;
    if (isHedging(blob)) continue;
    const risk = { ...raw, severity: normalizeSeverity(raw.severity) };
    if (isUngroundedSizeRisk(risk)) continue;
    const key = String(risk.title || '').trim().toLowerCase();
    if (key && seenRisk.has(key)) continue;
    if (key) seenRisk.add(key);
    risks.push(risk);
  }

  const seenSug = new Set();
  const suggestions = [];
  for (const raw of analysis.suggestions || []) {
    if (!raw || typeof raw !== 'object') continue;
    if (isHedging(raw.text)) continue;
    const key = String(raw.text || '').trim().toLowerCase();
    if (!key || seenSug.has(key)) continue;
    seenSug.add(key);
    suggestions.push(raw);
  }

  const warnings = (analysis.warnings || []).filter(
    (w) => typeof w === 'string' && w.trim() && !isHedging(w)
  );

  return {
    executionOrder: analysis.executionOrder || [],
    risks,
    suggestions,
    estimatedMinutes: analysis.estimatedMinutes || 0,
    warnings,
  };
}

/**
 * Fallback (non-AI) analysis for migration plans.
 * Provides programmatic risk assessment, ordering, and duration estimates.
 *
 * @param {Object} context
 * @param {Array} context.repos - Array of { name, size, hasLfs, ... }
 * @param {Object} [context.workItems] - { counts: { Bug: 10, ... } }
 * @param {Array}  [context.wikis] - Array of { pageCount }
 * @param {Object} context.target - { existingRepos: [...] }
 * @returns {{ executionOrder, risks, suggestions, estimatedMinutes, warnings }}
 */
export function fallbackAnalysis(context) {
  const repos = context.repos || [];
  const workItems = context.workItems || {};
  const wikis = context.wikis || [];
  const existingRepos = context.target?.existingRepos || [];

  const risks = [];
  const suggestions = [];
  const warnings = [];

  // --- Risks ---

  // Large repos (> 1 GB)
  for (const repo of repos) {
    const sizeBytes = repo.size || 0;
    if (sizeBytes > 1_000_000_000) {
      const sizeGB = (sizeBytes / 1_000_000_000).toFixed(1);
      risks.push({
        severity: 'high',
        title: `Large repository: ${repo.name}`,
        description: `Repository is ${sizeGB} GB. Large repos may timeout or require special handling.`,
        mitigation: 'Consider cleaning up large files or using Git LFS before migration.',
      });
    }
  }

  // LFS detection
  for (const repo of repos) {
    if (repo.hasLfs) {
      risks.push({
        severity: 'medium',
        title: `LFS detected: ${repo.name}`,
        description: 'Repository uses Git LFS. LFS objects are migrated automatically, but the target needs enough LFS storage quota to receive them.',
        mitigation: 'Confirm the destination has available Git LFS storage before migrating.',
      });
    }
  }

  // TFVC conversion risks
  const tfvcRepos = repos.filter(r => r.isTfvc);
  if (tfvcRepos.length > 0) {
    risks.push({
      severity: 'medium',
      title: `TFVC conversion required (${tfvcRepos.length} ${tfvcRepos.length === 1 ? 'folder' : 'folders'})`,
      description: 'TFVC repositories must be converted to Git before migration. Conversion preserves up to 180 days of history. If conversion fails, a snapshot without history will be used as fallback.',
      mitigation: 'Ensure your PAT has Code (Read) permissions and the TFVC content is under 1 GB per folder.',
    });

    if (tfvcRepos.length > 3) {
      suggestions.push({
        id: 'tfvc-batch-warning',
        text: `${tfvcRepos.length} TFVC folders selected. Each conversion takes 2-10 minutes. Consider migrating in smaller batches.`,
      });
    }
  }

  // Name conflicts
  for (const repo of repos) {
    const targetName = repo.targetName || repo.name;
    if (existingRepos.includes(targetName)) {
      risks.push({
        severity: 'low',
        title: `Name conflict: ${targetName}`,
        description: `A repository named "${targetName}" already exists in the target organization.`,
        mitigation: 'Rename the target repository or archive the existing one.',
      });
    }
  }

  // --- Execution order (alphabetical) ---
  const executionOrder = repos
    .map(r => r.name)
    .sort((a, b) => a.localeCompare(b));

  // --- Duration estimate ---
  // 1 min per 100 MB of repo size
  const totalRepoBytes = repos.reduce((sum, r) => sum + (r.size || 0), 0);
  const repoMinutes = Math.ceil(totalRepoBytes / 100_000_000);

  // 1 min per 50 work items
  const totalWorkItems = Object.values(workItems.counts || {}).reduce((sum, c) => sum + c, 0);
  const workItemMinutes = Math.ceil(totalWorkItems / 50);

  // 1 min per 20 wiki pages
  const totalWikiPages = wikis.reduce((sum, w) => sum + (w.pageCount || 0), 0);
  const wikiMinutes = Math.ceil(totalWikiPages / 20);

  // TFVC conversion adds ~5 minutes per folder
  const tfvcMinutes = tfvcRepos.length * 5;

  const estimatedMinutes = Math.max(1, repoMinutes + workItemMinutes + wikiMinutes + tfvcMinutes);

  // --- Suggestions ---
  if (repos.length > 5) {
    suggestions.push({
      id: 'batch-size',
      text: `Consider migrating in smaller batches (${repos.length} repos selected). This reduces risk if something fails.`,
    });
  }

  if (totalWorkItems > 500) {
    suggestions.push({
      id: 'work-items-large',
      text: `${totalWorkItems} work items will be migrated. Consider filtering to essential types only.`,
    });
  }

  // --- Warnings ---
  if (repos.some(r => (r.size || 0) > 500_000_000)) {
    warnings.push('Some repositories exceed 500 MB. Migration may take longer than estimated.');
  }

  return {
    executionOrder,
    risks,
    suggestions,
    estimatedMinutes,
    warnings,
  };
}

/**
 * Build the grounded AI prompt for a migration context. Pure — no I/O, no
 * provider call. Extracted so the route layer (server/routes/migration.js)
 * owns the actual generation call through `guardedGenerate` (spend cap +
 * audit + output-token cap), the same way server/routes/ai/core.js wraps
 * `buildReadmeEnhancePrompt()` around its own `guardedGenerate` call instead
 * of letting a nested lib function reach the provider directly.
 *
 * @param {Object} context - Migration context from the wizard
 * @returns {string}
 */
export function buildMigrationAnalysisPrompt(context) {
  const repos = context.repos || [];
  const workItems = context.workItems || {};
  const wikis = context.wikis || [];

  const tfvcInfo = repos.some(r => r.isTfvc)
    ? `\n\nTFVC Note: Some repositories use Team Foundation Version Control (TFVC) and must be converted to Git before migration. TFVC conversion preserves up to 180 days of history and takes 2-10 minutes per folder. If conversion fails (>1GB or timeout), a snapshot without history is used as fallback. TFVC folders: ${repos.filter(r => r.isTfvc).map(r => r.name).join(', ')}`
    : '';

  // Every fact the model needs is supplied below. The repo line states LFS and
  // TFVC status explicitly, so the model must NEVER say these are "unconfirmed".
  return `You are a migration expert reviewing a plan to move repositories from Azure DevOps to GitHub. Produce a grounded, specific analysis a professional engineer would trust.

KNOWN FACTS (this is the complete picture — anything not listed here is unknown to you):
Repositories to migrate:
${repos.map(r => `- ${r.name}: ${((r.size || 0) / 1_000_000).toFixed(1)} MB, Git LFS: ${r.hasLfs ? 'YES' : 'NO'}, type: ${r.isTfvc ? 'TFVC' : 'Git'}`).join('\n')}
${tfvcInfo}
Work Items: ${JSON.stringify(workItems.counts || {}, null, 2)}
Wikis: ${wikis.length} wikis, ${wikis.reduce((s, w) => s + (w.pageCount || 0), 0)} total pages
Target org existing repos: ${(context.target?.existingRepos || []).join(', ') || 'none'}

RULES — follow strictly:
1. Use ONLY the facts above. NEVER speculate, hedge, or raise a risk about data you were not given (e.g. CI/CD pipelines, branch counts, individual file/blob sizes, commit history). If you don't have a fact, do not invent a risk about it.
2. NEVER use words like "unconfirmed", "not specified", "unclear", or "if LFS is used". LFS and TFVC status are given per repo above — state them as facts.
3. Only raise a SIZE risk if a repo is at least 1 GB (1000 MB). Repos under 1 GB are normal — do not flag their size.
4. Severity means: "high" = will likely fail or block the migration; "medium" = needs a manual step or a decision; "low" = informational. Do not inflate severity.
5. Every risk and suggestion must reference a specific repo, count, or fact above. No generic git advice that isn't tied to this plan.
6. If nothing in the facts warrants a risk, return an empty "risks" array. An empty, honest result is better than a padded one.

Return a JSON object with exactly this structure (no markdown, raw JSON only):
{
  "executionOrder": ["repo1", "repo2"],
  "risks": [{"severity": "high|medium|low", "title": "...", "description": "...", "mitigation": "..."}],
  "suggestions": [{"id": "...", "text": "...", "repo": "optional-repo-name"}],
  "estimatedMinutes": number,
  "warnings": ["string"]
}`;
}

/**
 * Analyze a migration context using AI if a `generate` function is supplied,
 * or fall back to programmatic analysis otherwise.
 *
 * `generate` is injected by the caller (server/routes/migration.js binds it to
 * `guardedGenerate`, which enforces the monthly AI spend cap + output-token
 * cap + spend/audit recording — see server/routes/ai/shared.js) so this
 * module never talks to a provider directly. Any failure from `generate()`
 * degrades gracefully to the deterministic fallback (unchanged reliability
 * behavior) EXCEPT a spend-cap denial, which is rethrown so the route can
 * surface the standard 429 rather than silently absorbing a cap hit into a
 * free 200 response.
 *
 * @param {Object} context - Migration context from the wizard
 * @param {(opts: { prompt: string }) => Promise<{ text: string }>} [generate]
 * @returns {Promise<Object & { aiUsed: boolean }>} Analysis result; `aiUsed`
 *   tells the route whether a real provider call happened (and thus whether
 *   to charge the ai_migration_risk quota) — callers must strip it before
 *   sending the analysis to the client.
 */
export async function analyzeMigration(context, generate) {
  // No provider available — deterministic-only, same as before this call
  // accepted an injected `generate`. Still run it through the sanitizer so
  // both paths return analyses with the same honesty guarantees.
  if (!generate) {
    return { ...sanitizeAnalysis(fallbackAnalysis(context), context), aiUsed: false };
  }

  try {
    const prompt = buildMigrationAnalysisPrompt(context);
    const { text } = await generate({ prompt });

    try {
      const parsed = JSON.parse(text);
      return {
        ...sanitizeAnalysis({
          executionOrder: parsed.executionOrder || [],
          risks: parsed.risks || [],
          suggestions: (parsed.suggestions || []).map((s, i) => ({ ...s, id: s.id || `ai-${i}` })),
          estimatedMinutes: parsed.estimatedMinutes || 0,
          warnings: parsed.warnings || [],
        }, context),
        aiUsed: true,
      };
    } catch {
      // If AI returns unparseable response, fall back. The provider call
      // still happened (and was billed), so this counts as a used attempt.
      logger.warn('Migration planner: AI response was not valid JSON, using fallback');
      return { ...sanitizeAnalysis(fallbackAnalysis(context), context), aiUsed: true };
    }
  } catch (err) {
    // A spend-cap denial must reach the caller as a real error (OWASP LLM10)
    // — everything else (timeout, rate limit, provider outage) degrades to
    // the deterministic fallback exactly as before this route was metered.
    if (err?.code === 'AI_SPEND_CAP_REACHED') throw err;
    logger.error({ err }, 'Migration planner: AI analysis failed, using fallback');
    return { ...sanitizeAnalysis(fallbackAnalysis(context), context), aiUsed: false };
  }
}
