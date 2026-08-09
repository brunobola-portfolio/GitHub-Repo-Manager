/*
 * Env-load-order guard.
 *
 * server/db.js resolves the SQLite file path from process.env.DATA_DIR inside
 * its top-level `await createDatabaseAdapter()` — i.e. during module
 * evaluation, not at first query. ESM evaluates the import graph depth-first
 * in source order, and server/index.js imports route barrels that reach db.js
 * before it reaches config.js. So whichever module calls dotenv.config() has
 * to be evaluated FIRST, or the .env file lands in process.env too late for
 * the database path to see it.
 *
 * That bug shipped and was invisible: DATA_DIR from the .env still applied to
 * the tmp/scratch directories (evaluated later), so the data directory looked
 * correct while manager.db was quietly created under server/data — inside the
 * install tree, where the next upgrade overwrites it.
 *
 * These are structural assertions rather than a behavioural test because the
 * failure lives in module evaluation order, which is fixed the moment the
 * process starts and cannot be re-entered from inside a test run.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const LOADER = 'server/lib/env/load-dotenv.js'
const LOADER_SPECIFIERS = ['./lib/env/load-dotenv.js']

/** Every `import …` specifier in a file, in source order. */
function importSpecifiers(source) {
  // Strip comments first. A block comment that merely MENTIONS an import (this
  // file's own explanatory notes do) would otherwise be read as import #0 and
  // fail the "loader is first" assertion for a change that altered nothing.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...code.matchAll(/^\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1])
}

// Every executable that reaches server/db.js. The server entry is the obvious
// one; the operator CLIs are the ones that were missed — each opens the SQLite
// database, so without the loader they silently resolve <repo>/server/data
// instead of DATA_DIR and report on (or create) an empty database. That is how
// `npm run audit:verify` returned a clean SOC 2 tamper check against a file
// that was not the production database.
const DB_TOUCHING_ENTRY_POINTS = [
  { file: 'server/index.js', specifiers: ['./lib/env/load-dotenv.js'] },
  { file: 'server/scripts/retention.js', specifiers: ['../lib/env/load-dotenv.js'] },
  { file: 'server/scripts/admin-grant.mjs', specifiers: ['../lib/env/load-dotenv.js'] },
  { file: 'server/scripts/admin-dlq.mjs', specifiers: ['../lib/env/load-dotenv.js'] },
  { file: 'server/scripts/dlq-sweep.mjs', specifiers: ['../lib/env/load-dotenv.js'] },
  { file: 'server/scripts/verify-audit-chain.mjs', specifiers: ['../lib/env/load-dotenv.js'] },
]

describe('dotenv is loaded before any module-load-time process.env read', () => {
  for (const { file, specifiers } of DB_TOUCHING_ENTRY_POINTS) {
    it(`${file} imports the loader first`, () => {
      const first = importSpecifiers(readFileSync(file, 'utf8'))[0]
      expect(
        specifiers,
        `${file} must import the env loader before anything else — got "${first}". Any import ahead of it can reach server/db.js, which resolves DATA_DIR during module evaluation.`
      ).toContain(first)
    })
  }

  it('covers every server/scripts entry point that reaches the database', () => {
    // A new CLI added without the loader would otherwise inherit the bug
    // silently. Anything under server/scripts/ that imports db.js — directly
    // or via a lib — must be in the list above.
    const listed = new Set(DB_TOUCHING_ENTRY_POINTS.map((e) => e.file.replace(/\\/g, '/')))
    const dir = 'server/scripts'
    for (const name of readdirSync(dir)) {
      if (!/\.(mjs|js)$/.test(name)) continue
      const rel = `${dir}/${name}`
      const source = readFileSync(rel, 'utf8')
      // _cli-utils.mjs is a helper, not an entry point, and touches no DB.
      const isEntry = /process\.argv|pathToFileURL/.test(source)
      const touchesDb = /db\.js|\.\.\/lib\//.test(source)
      if (isEntry && touchesDb) {
        expect(listed, `${rel} looks like a DB-touching CLI but is not covered by this guard`).toContain(rel)
      }
    }
  })

  it('config.js gets its env through the same loader, not its own dotenv call', () => {
    const source = readFileSync('server/config.js', 'utf8')
    expect(importSpecifiers(source)).toContain('./lib/env/load-dotenv.js')
    // Comments mentioning dotenv are fine; a second live config() call is not,
    // because it would make the load point ambiguous again.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/dotenv\.config\s*\(/)
  })

  it('the loader is the only place under server/ that calls dotenv.config()', () => {
    // A second call site is not harmful on its own (dotenv never overwrites an
    // already-set variable), but it re-creates the ambiguity this split exists
    // to remove: two load points means no single answer to "has .env loaded
    // yet?" at any given module's evaluation.
    //
    // This walks the whole of server/ — an earlier version checked three
    // hardcoded files, so a dotenv.config() added to any other module (queue.js,
    // say) passed silently.
    const offenders = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'data') continue
        const full = `${dir}/${entry.name}`
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.(js|mjs)$/.test(entry.name)) continue
        if (full === LOADER) continue
        const code = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
        // Three spellings, because only checking `dotenv.config(` let the two
        // canonical alternatives through — and `import 'dotenv/config'` is the
        // one most likely to be added by someone who does not know this rule.
        if (/dotenv\.config\s*\(|['"]dotenv\/config['"]|from\s+['"]dotenv['"]/.test(code)) offenders.push(full)
      }
    }
    walk('server')
    expect(offenders).toEqual([])
  })

  it('the loader honours GRM_ENV_FILE — the env file cannot name its own location', () => {
    const source = readFileSync(LOADER, 'utf8')
    expect(source).toMatch(/process\.env\.GRM_ENV_FILE/)
    expect(source).toMatch(/dotenv\.config\s*\(/)
  })

  it('the loader has no imports of its own beyond dotenv', () => {
    // Anything else it pulled in would be evaluated BEFORE the config() call,
    // reintroducing exactly the ordering hazard this file exists to close.
    expect(importSpecifiers(readFileSync(LOADER, 'utf8'))).toEqual(['dotenv'])
  })
})
