import { aiService } from './ai-service.js';
import logger from './lib/logger.js';

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
        description: 'Repository uses Git LFS. LFS objects need separate migration handling.',
        mitigation: 'Ensure LFS storage quota is available on the target.',
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
 * Analyze a migration context using AI (Gemini) if available, or fall back to
 * programmatic analysis.
 *
 * @param {Object} context - Migration context from the wizard
 * @returns {Promise<Object>} Analysis result
 */
export async function analyzeMigration(context) {
  // If AI is not configured, use fallback
  if (!aiService.provider) {
    return fallbackAnalysis(context);
  }

  try {
    const repos = context.repos || [];
    const workItems = context.workItems || {};
    const wikis = context.wikis || [];

    const tfvcInfo = repos.some(r => r.isTfvc)
      ? `\n\nTFVC Note: Some repositories use Team Foundation Version Control (TFVC) and must be converted to Git before migration. TFVC conversion preserves up to 180 days of history and takes 2-10 minutes per folder. If conversion fails (>1GB or timeout), a snapshot without history is used as fallback. TFVC folders: ${repos.filter(r => r.isTfvc).map(r => r.name).join(', ')}`
      : '';

    const prompt = `You are analyzing a migration plan from Azure DevOps to GitHub.
Analyze the following migration context and provide recommendations.

Repositories to migrate:
${repos.map(r => `- ${r.name} (${((r.size || 0) / 1_000_000).toFixed(1)} MB${r.hasLfs ? ', uses LFS' : ''}${r.isTfvc ? ', TFVC' : ''})`).join('\n')}
${tfvcInfo}
Work Items: ${JSON.stringify(workItems.counts || {}, null, 2)}
Wikis: ${wikis.length} wikis, ${wikis.reduce((s, w) => s + (w.pageCount || 0), 0)} total pages
Target org existing repos: ${(context.target?.existingRepos || []).join(', ') || 'none'}

Return a JSON object with exactly this structure (no markdown, raw JSON only):
{
  "executionOrder": ["repo1", "repo2"],
  "risks": [{"severity": "high|medium|low", "title": "...", "description": "...", "mitigation": "..."}],
  "suggestions": [{"id": "...", "text": "...", "repo": "optional-repo-name"}],
  "estimatedMinutes": number,
  "warnings": ["string"]
}

Consider: repo sizes, LFS usage, name conflicts, work item volume, optimal execution order${repos.some(r => r.isTfvc) ? ', TFVC conversion time and history limitations' : ''}.`;

    const { text } = await aiService.provider.generate({ prompt });

    try {
      const parsed = JSON.parse(text);
      return {
        executionOrder: parsed.executionOrder || [],
        risks: parsed.risks || [],
        suggestions: (parsed.suggestions || []).map((s, i) => ({ ...s, id: s.id || `ai-${i}` })),
        estimatedMinutes: parsed.estimatedMinutes || 0,
        warnings: parsed.warnings || [],
      };
    } catch {
      // If AI returns unparseable response, fall back
      logger.warn('Migration planner: AI response was not valid JSON, using fallback');
      return fallbackAnalysis(context);
    }
  } catch (err) {
    logger.error({ err }, 'Migration planner: AI analysis failed, using fallback');
    return fallbackAnalysis(context);
  }
}
