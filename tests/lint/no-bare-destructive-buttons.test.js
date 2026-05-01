/*
 * Regression guard for slice 2 (Intent affordances audit): every red /
 * destructive button in src/components/ must either:
 *   - be wired through useDangerAction({ ... }).run
 *   - or call openModalWithData('showConfirm', ...) directly (the underlying
 *     primitive useDangerAction wraps)
 *   - or sit inside an error / status display (role="alert" or similar)
 *   - or carry an explicit `// danger-button-allowed: <reason>` comment
 *     within 5 lines, documenting why the bare red styling is intentional
 *
 * Any NEW destructive button without one of these escape hatches will fail
 * this test. The existing offenders captured below are the slice-2 audit
 * baseline — Tasks 4–8 of the plan migrate each cluster.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = join(import.meta.dirname, '../..')
const SRC_DIR = join(ROOT, 'src')

const REDFLAG_PATTERNS = [
	/<Button[^>]*variant=['"]danger['"]/,
	/<Button[^>]*\bdestructive\b/,
	// className containing "bg-red-" applied to a Button or button element.
	// We require the element name nearby so we don't flag every red icon.
	/<(?:button|Button)[^>]*className=['"][^'"]*\bbg-red-/,
]

const SAFE_NEIGHBOR_PATTERNS = [
	/useDangerAction/,
	/openModalWithData\(['"]showConfirm/,
	/onConfirm:|onConfirm=\{/,
	/confirmGate\(/,
	// `setConfirmAction({ title, message, … onConfirm })` is a project-wide
	// state-based confirm pattern (DevToolkit/PRTab, RepoDetail/BranchesTab,
	// RepoDetail/SettingsTab) that renders its own confirm dialog. Functionally
	// equivalent to showConfirm; recognised here so the lint test doesn't
	// flag the destructive trigger button.
	/setConfirmAction\(/,
	// `<ConfirmModal …>` rendered locally with `setConfirmOpen(true)` trigger
	// is the same idea — Settings/DangerZoneSection uses this for "Delete
	// account". The button opens the modal via state, the modal does the gate.
	/setConfirmOpen\(/,
	/<ConfirmModal\b/,
	// Accessibility roles for status displays — red is the variant for those,
	// not a destructive trigger.
	/role=['"]alert['"]/,
	/role=['"]status['"]/,
	// Close / dismiss controls on red banners are not destructive triggers.
	/aria-label=['"][^'"]*(?:close|dismiss)/i,
	// Native HTML form elements (input/select) sometimes carry a red border
	// for invalid state — that's a status indicator, not a button.
	/aria-invalid=['"]?true['"]?/,
]

// Accept both JS line comments (// danger-button-allowed: …) and JSX block
// comments ({/* danger-button-allowed: … */}) — the latter is the only valid
// in-JSX form.
const ALLOW_COMMENT = /(?:\/\/|\{\/\*)\s*danger-button-allowed:\s*\S+/

// Frozen slice-2 baseline: pre-existing offenders that Tasks 4–8 migrate.
// Path is relative to src/. Each entry must include at least the file path;
// line is informational (helps locate when migrating). NEW offenders must NOT
// be added here — they should be wired through useDangerAction instead.
const BASELINE_OFFENDERS = new Set([
	// Populated lazily by the Tasks 4–8 audit runs. Empty here means: any
	// offender currently present needs migration. The test produces a sorted
	// list in its failure message so a developer can either fix the offender
	// or, if intentional, add a `// danger-button-allowed: <reason>` comment.
])

function* walk(dir) {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry)
		const st = statSync(p)
		if (st.isDirectory()) yield* walk(p)
		else if (p.endsWith('.jsx') || p.endsWith('.js')) yield p
	}
}

function findOffenders() {
	const offenders = []
	for (const file of walk(SRC_DIR)) {
		const lines = readFileSync(file, 'utf8').split('\n')
		lines.forEach((line, idx) => {
			if (!REDFLAG_PATTERNS.some(rx => rx.test(line))) return

			// Inspect ±5 lines for safe-neighbour markers OR an allow comment.
			const start = Math.max(0, idx - 5)
			const end = Math.min(lines.length, idx + 6)
			const window = lines.slice(start, end).join('\n')

			if (SAFE_NEIGHBOR_PATTERNS.some(rx => rx.test(window))) return
			if (ALLOW_COMMENT.test(window)) return

			const rel = relative(SRC_DIR, file).replace(/\\/g, '/')
			offenders.push(`${rel}:${idx + 1}`)
		})
	}
	return offenders.sort()
}

describe('no bare destructive buttons', () => {
	it('every red/danger button has a confirmation flow nearby (or an explicit allow comment)', () => {
		const offenders = findOffenders()
		// Anything in the baseline is acknowledged; only NEW offenders fail.
		const newOffenders = offenders.filter(o => !BASELINE_OFFENDERS.has(o))

		expect(newOffenders, [
			'',
			'Bare destructive buttons found. Each should either:',
			'  - call useDangerAction({...}).run',
			'  - or call openModalWithData(\'showConfirm\', ...) directly',
			'  - or be inside a role="alert" / role="status" display',
			'  - or have a // danger-button-allowed: <reason> comment within 5 lines',
			'',
			'New offenders not in BASELINE_OFFENDERS:',
			...newOffenders,
			'',
		].join('\n')).toEqual([])
	})
})
