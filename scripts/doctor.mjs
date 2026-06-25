// SPDX-License-Identifier: AGPL-3.0-only
// `npm run doctor` — validate migration tooling; `--fix` installs what's missing.
import process from 'node:process';
import { createInterface } from 'node:readline';
import { getReadiness } from '../server/lib/env/readiness.js';
import { resolveManagers, buildInstallCommand } from '../server/lib/env/package-managers.js';
import { installTool } from '../server/lib/env/installer.js';
import { getTool } from '../server/lib/env/tool-registry.js';

const ICON = { ok: '✓', outdated: '!', missing: '✗', 'n/a': '·' };

export function formatToolLine(tool) {
  const icon = ICON[tool.status] ?? '?';
  const ver = tool.version ? ` ${tool.version}` : '';
  const tag = tool.status === 'ok' ? '' : `  [${tool.status}]`;
  return `  ${icon} ${tool.label}${ver}${tag}`;
}

async function main() {
  const fix = process.argv.includes('--fix');
  const yes = process.argv.includes('--yes');
  const { tools, ok } = await getReadiness({ force: true });
  const { preferred, available } = await resolveManagers();

  process.stdout.write('\nMigration tooling readiness\n\n');
  for (const t of tools) process.stdout.write(formatToolLine(t) + '\n');
  process.stdout.write(`\nPackage managers: ${available.join(', ') || 'none detected'}\n`);

  const fixable = tools.filter((t) => (t.status === 'missing' || t.status === 'outdated') && buildInstallCommand(getTool(t.id), preferred));
  if (fixable.length && !fix) {
    process.stdout.write('\nTo install the missing tools, run:  npm run doctor:fix\n');
    for (const t of fixable) {
      const c = buildInstallCommand(getTool(t.id), preferred);
      process.stdout.write(`  ${t.label}:  ${c.cmd} ${c.args.join(' ')}\n`);
    }
  }

  if (fix && fixable.length) {
    for (const t of fixable) {
      if (!yes && !(await confirm(`Install ${t.label} via ${preferred}?`))) continue;
      process.stdout.write(`\nInstalling ${t.label}…\n`);
      const r = await installTool(t.id, { onProgress: (e) => e.line && process.stdout.write(`  ${e.line}\n`) });
      process.stdout.write(r.ok ? `  ✓ ${t.label} installed\n` : `  ✗ ${t.label} failed (exit ${r.code})\n`);
    }
  }

  // Required-missing → non-zero exit for CI.
  process.exit(ok ? 0 : 1);
}

function confirm(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(`${q} [y/N] `, (a) => { rl.close(); res(/^y/i.test(a)); }));
}

// Only run when invoked directly (not when imported by the formatter test).
if (process.argv[1] && process.argv[1].endsWith('doctor.mjs')) {
  main().catch((e) => { process.stderr.write(String(e?.stack || e) + '\n'); process.exit(1); });
}
