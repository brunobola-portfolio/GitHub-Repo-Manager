/**
 * Migration report builder + renderer.
 *
 * Turns the data MigrationHistory already stores — a plan's tasks (with their
 * config/metadata blobs) plus its provenance marks — into a single report
 * object, and renders that object as Markdown. Kept dependency-free (no
 * `db.js` import) so the renderer can be unit-tested against a fixture plan
 * without a database; `server/routes/migration.js` is the only caller that
 * touches the database, passing in `engine.getPlanStatus()`'s already-parsed
 * shape plus the plan's `migration_marks` rows.
 */

/**
 * Human-friendly suggestion for a failed migration task, tailored to the
 * error text, task type, and (for TFVC in-place conversions) whether the
 * task's config requested `inPlace`.
 * @param {string} errorMsg
 * @param {string} type
 * @param {string|object|null} [config]
 * @returns {string}
 */
export function getSuggestionForError(errorMsg, type, config = null) {
  if (!errorMsg) return '';
  const msg = errorMsg.toLowerCase();
  const cfg = (() => {
    try { return typeof config === 'string' ? JSON.parse(config) : (config || {}); } catch { return {}; }
  })();
  const isInPlace = !!cfg.inPlace;
  if (msg.includes('authentication') || msg.includes('401') || msg.includes('403') || msg.includes('pat is required')) {
    if (type === 'repo-tfvc' && isInPlace) {
      return 'The Azure DevOps PAT was rejected. For TFVC → Git in-place conversion the PAT must (1) come from the SAME Azure DevOps / TFS server as the destination, (2) be valid and not expired, and (3) include the "Code (Read, Write & Manage)" scope — a read-only PAT is enough to list repos but cannot create the destination Git repo or trigger the Import API.';
    }
    if (type === 'repo-tfvc') {
      return 'The Azure DevOps PAT was rejected. Verify it is not expired and includes "Code (Read, Write & Manage)" — the TFVC → Git flow creates a temporary Git repo in Azure before pushing.';
    }
    return 'Your access token may have expired or lacks the required permissions. Verify the token is valid and has the right scopes (Code: Read on the source; Code: Read, Write & Manage on the destination).';
  }
  if (msg.includes('not found') || msg.includes('404'))
    return 'The source repository could not be found. Verify the organization, project, and repository name are correct.';
  if (msg.includes('git lfs is not installed') || msg.includes('git-lfs'))
    return 'Install git-lfs on the migration server (https://git-lfs.com) so files over 100 MB can be converted to LFS, then retry. Alternatively, exclude this repository.';
  if (msg.includes('already exists'))
    return 'A repository with the same name already exists on the target. Rename the target or delete the existing repository first.';
  if (msg.includes('invalid target repository name'))
    return 'The target repository name is invalid. Names cannot start with _ or ., end with ., or contain special characters. Rename and try again.';
  if (msg.includes('url rejected') || msg.includes('bad hostname'))
    return 'The clone URL was rejected — this can happen with special characters in the project name. Try re-running the migration.';
  if (msg.includes('private or internal network') || msg.includes('resolves to a private'))
    return 'The repository URL was blocked because it resolved to a private or internal network address. Verify the source URL is a public Azure DevOps address.';
  if (msg.includes('timeout') || msg.includes('timed out'))
    return 'The operation timed out. This can happen with very large repositories. Try again or consider migrating during off-peak hours.';
  if (msg.includes('tfvc conversion failed'))
    return 'The TFVC-to-Git conversion failed on the Azure DevOps side. Verify the TFVC path exists and the project supports Git imports.';
  if (msg.includes('rate limit'))
    return 'A rate limit was hit. Wait a few minutes and retry the migration.';
  if (msg.includes('could not retrieve wiki clone url'))
    return 'The wiki could not be found in Azure DevOps. Verify the wiki ID is correct and the project has an active wiki.';
  if (type === 'work-items')
    return 'Work item migration encountered an error. Verify the Azure DevOps project has accessible work items and the token has work item read permissions.';
  if (type === 'wiki')
    return 'Wiki migration failed. Verify the wiki exists and is accessible with your current credentials.';
  return '';
}

function parseMaybeJson(value) {
  if (value == null || typeof value === 'object') return value ?? {};
  try { return JSON.parse(value) || {}; } catch { return {}; }
}

function taskDurationSeconds(task) {
  if (!task.started_at || !task.completed_at) return 0;
  const d = Math.round((new Date(task.completed_at) - new Date(task.started_at)) / 1000);
  return Number.isFinite(d) && d >= 0 ? d : 0;
}

/**
 * Extract a per-task conflict-resolution note, when the task's config asked
 * for `onConflict: 'replace'` or its metadata records an actual reuse/replace
 * decision made at run time.
 * @param {object} config
 * @param {object} metadata
 * @returns {string|null}
 */
function taskConflictNote(config, metadata) {
  if (metadata.replacedExistingRepo) return 'Target already existed and was replaced (deleted + recreated) — onConflict=replace.';
  if (metadata.reusedExistingRepo) return 'Target already existed empty and was reused.';
  if (config.onConflict === 'replace') return 'Configured to replace an existing non-empty target on conflict.';
  return null;
}

/**
 * Extract a per-task Git LFS note: strategy chosen, and any fetch/push
 * failure recorded by the importer.
 * @param {object} config
 * @param {object} metadata
 * @returns {string|null}
 */
function taskLfsNote(config, metadata) {
  const notes = [];
  if (config.sizeStrategy === 'lfs-migrate') notes.push('Large blobs converted to Git LFS in-place (sizeStrategy=lfs-migrate).');
  if (metadata.hasLFS) notes.push('Source repository already used Git LFS.');
  if (metadata.lfsFetchFailed) notes.push('Fetching LFS objects from the source failed (pointers were still pushed).');
  if (metadata.lfsPushFailed) notes.push('Pushing LFS objects to the target failed after retries — the target has orphaned LFS pointers until retried.');
  return notes.length ? notes.join(' ') : null;
}

function formatTaskForReport(task) {
  const config = parseMaybeJson(task.config);
  const metadata = parseMaybeJson(task.metadata);
  const skipReason = task.status === 'skipped' || task.status === 'cancelled'
    ? (task.error_message || metadata.reason || 'No reason recorded')
    : null;
  return {
    id: task.id,
    type: task.type,
    sourceRef: task.source_ref,
    targetRef: task.target_ref || null,
    status: task.status,
    retries: task.retries ?? 0,
    durationSeconds: taskDurationSeconds(task),
    skipReason,
    conflict: taskConflictNote(config, metadata),
    lfs: taskLfsNote(config, metadata),
    emptySource: !!metadata.emptySource,
    branchCount: typeof metadata.branchCount === 'number' ? metadata.branchCount : null,
    // Kept verbatim for back-compat: SummaryStep.jsx (metadata.reusedExistingRepo,
    // .replacedExistingRepo, .lfsFetchFailed, .lfsPushFailed, .url) and
    // migrationHealth.js read this object directly from the JSON report.
    metadata,
  };
}

function computeSummaryFromTasks(tasks) {
  const summary = { total: tasks.length, success: 0, failed: 0, skipped: 0 };
  for (const t of tasks) {
    if (t.status === 'completed' || t.status === 'complete') summary.success++;
    else if (t.status === 'failed') summary.failed++;
    else if (t.status === 'skipped' || t.status === 'cancelled') summary.skipped++;
  }
  return summary;
}

/**
 * Build the report data object from a plan (the shape returned by
 * `MigrationEngine#getPlanStatus`: a snake_case `migration_plans` row plus a
 * `tasks` array of snake_case `migration_tasks` rows, `config`/`metadata`
 * already parsed where possible) and the plan's `migration_marks` rows.
 * Pure — no I/O, no side effects.
 *
 * @param {object} plan
 * @param {Array<object>} [marks]
 * @returns {object} report data, shared by both the JSON and Markdown formats
 */
export function buildMigrationReportData(plan, marks = []) {
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const startedAt = plan.started_at || null;
  const completedAt = plan.completed_at || null;
  const durationSeconds = startedAt && completedAt
    ? Math.max(0, Math.round((new Date(completedAt) - new Date(startedAt)) / 1000))
    : 0;
  const summary = (plan.summary && typeof plan.summary === 'object')
    ? plan.summary
    : computeSummaryFromTasks(tasks);

  const formattedTasks = tasks.map(formatTaskForReport);
  const conflicts = formattedTasks
    .filter(t => t.conflict)
    .map(t => ({ taskId: t.id, type: t.type, targetRef: t.targetRef, resolution: t.conflict }));
  const lfsEvents = formattedTasks
    .filter(t => t.lfs)
    .map(t => ({ taskId: t.id, type: t.type, targetRef: t.targetRef, retries: t.retries, note: t.lfs }));
  const skipped = formattedTasks
    .filter(t => t.skipReason)
    .map(t => ({ taskId: t.id, type: t.type, sourceRef: t.sourceRef, reason: t.skipReason }));
  const errors = tasks
    .filter(t => t.status === 'failed')
    .map(t => ({
      taskId: t.id,
      type: t.type,
      targetRef: t.target_ref || null,
      error: t.error_message || 'Unknown error',
      suggestion: getSuggestionForError(t.error_message, t.type, t.config),
    }));
  const marksFormatted = marks.map(m => ({
    scope: m.scope,
    targetKind: m.target_kind,
    targetId: m.target_id,
    status: m.status,
    skipReason: m.skip_reason || null,
    errorMessage: m.error_message || null,
    writtenAt: m.written_at || null,
  }));

  return {
    plan: {
      id: plan.id,
      status: plan.status,
      isDryRun: !!plan.is_dry_run,
      source: {
        type: plan.source_type || 'azure',
        host: plan.azure_host || 'dev.azure.com',
        org: plan.source_org || null,
        project: plan.source_project || null,
      },
      targetOrg: plan.target_org || null,
      startedAt,
      completedAt,
      durationSeconds,
    },
    summary,
    tasks: formattedTasks,
    conflicts,
    lfs: lfsEvents,
    skipped,
    marks: marksFormatted,
    errors,
    generatedAt: new Date().toISOString(),
  };
}

function fmtDuration(seconds) {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function mdEscape(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

/**
 * Render a report data object (from `buildMigrationReportData`) as Markdown —
 * the artifact a migration lead can forward: what moved, what was skipped and
 * why, conflicts and their resolutions, LFS retries, provenance marks, and
 * timings.
 * @param {object} report
 * @returns {string}
 */
export function renderMigrationReportMarkdown(report) {
  const { plan, summary, tasks, conflicts, lfs, skipped, marks, errors } = report;
  const lines = [];
  const sourceLabel = plan.source.org && plan.source.project
    ? `${plan.source.org}/${plan.source.project} (${plan.source.host})`
    : plan.source.host;
  const targetLabel = plan.targetOrg || '(personal account)';

  lines.push(`# Migration Report — Plan #${plan.id}`);
  lines.push('');
  lines.push(`- **Status:** ${plan.status}${plan.isDryRun ? ' (dry run)' : ''}`);
  lines.push(`- **Source:** ${sourceLabel}`);
  lines.push(`- **Target:** ${targetLabel}`);
  lines.push(`- **Started:** ${plan.startedAt || '—'}`);
  lines.push(`- **Completed:** ${plan.completedAt || '—'}`);
  lines.push(`- **Duration:** ${fmtDuration(plan.durationSeconds)}`);
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Total | Succeeded | Failed | Skipped |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| ${summary.total ?? tasks.length} | ${summary.success ?? 0} | ${summary.failed ?? 0} | ${summary.skipped ?? 0} |`);
  lines.push('');

  lines.push('## What moved');
  lines.push('');
  if (tasks.length === 0) {
    lines.push('_No tasks in this plan._');
  } else {
    lines.push('| Type | Source | Target | Status | Duration |');
    lines.push('|---|---|---|---|---|');
    for (const t of tasks) {
      lines.push(`| ${mdEscape(t.type)} | ${mdEscape(t.sourceRef)} | ${mdEscape(t.targetRef || '—')} | ${mdEscape(t.status)} | ${fmtDuration(t.durationSeconds)} |`);
    }
  }
  lines.push('');

  lines.push('## What was skipped, and why');
  lines.push('');
  if (skipped.length === 0) {
    lines.push('_Nothing was skipped._');
  } else {
    for (const s of skipped) {
      lines.push(`- **${mdEscape(s.sourceRef)}** (${mdEscape(s.type)}): ${mdEscape(s.reason)}`);
    }
  }
  lines.push('');

  lines.push('## Conflicts and their resolutions');
  lines.push('');
  if (conflicts.length === 0) {
    lines.push('_No naming conflicts encountered._');
  } else {
    for (const c of conflicts) {
      lines.push(`- **${mdEscape(c.targetRef || `task #${c.taskId}`)}**: ${mdEscape(c.resolution)}`);
    }
  }
  lines.push('');

  lines.push('## Git LFS');
  lines.push('');
  if (lfs.length === 0) {
    lines.push('_No Git LFS activity._');
  } else {
    for (const l of lfs) {
      lines.push(`- **${mdEscape(l.targetRef || `task #${l.taskId}`)}**: ${mdEscape(l.note)}${l.retries ? ` (${l.retries} retr${l.retries === 1 ? 'y' : 'ies'})` : ''}`);
    }
  }
  lines.push('');

  lines.push('## Provenance marks');
  lines.push('');
  if (marks.length === 0) {
    lines.push('_No provenance marks recorded for this plan._');
  } else {
    lines.push('| Scope | Kind | Target | Status |');
    lines.push('|---|---|---|---|');
    for (const m of marks) {
      lines.push(`| ${mdEscape(m.scope)} | ${mdEscape(m.targetKind)} | ${mdEscape(m.targetId)} | ${mdEscape(m.status)}${m.skipReason ? ` (${mdEscape(m.skipReason)})` : ''} |`);
    }
  }
  lines.push('');

  if (errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const e of errors) {
      lines.push(`- **${mdEscape(e.targetRef || `task #${e.taskId}`)}** (${mdEscape(e.type)}): ${mdEscape(e.error)}`);
      if (e.suggestion) lines.push(`  - _Suggestion:_ ${mdEscape(e.suggestion)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
