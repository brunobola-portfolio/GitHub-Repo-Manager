#!/usr/bin/env node
/*
 * Zero-dependency documentation link checker.
 *
 * Scans every Markdown file at the repo root and under docs/ and verifies that
 * each relative link and image target resolves to a file that exists on disk.
 * External URLs (http/https/mailto/tel/data), pure anchors (#…) and
 * protocol-relative links are ignored; code fences and inline code spans are
 * masked so example paths inside them are never treated as links. Anchors and
 * query strings are stripped before the on-disk existence check.
 *
 * Exit 1 (with a file:line list) if any relative link is broken, 0 otherwise.
 * Wired as `npm run docs:linkcheck` — keeps the "no broken links" guarantee
 * enforceable rather than aspirational.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, acc)
    else if (entry.isFile() && entry.name.endsWith('.md')) acc.push(p)
  }
}

const files = []
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.md')) files.push(path.join(ROOT, entry.name))
}
if (fs.existsSync(path.join(ROOT, 'docs'))) walk(path.join(ROOT, 'docs'), files)

// Replace fenced/inline code with equal-length whitespace so link-like text
// inside code never counts, while byte offsets (and thus line numbers) stay
// aligned with the original content.
function mask(content) {
  let m = content.replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, ' '))
  m = m.replace(/~~~[\s\S]*?~~~/g, (b) => b.replace(/[^\n]/g, ' '))
  m = m.replace(/`[^`\n]*`/g, (s) => s.replace(/[^\n]/g, ' '))
  return m
}

const inlineLink = /!?\[[^\]]*\]\(([^)]+)\)/g
const refDef = /^[ \t]*\[[^\]]+\]:[ \t]*(\S+)/gm
// HTML attributes used for images/links in mixed HTML+Markdown (e.g. the
// README hero's <picture>/<img>). srcset may carry a comma-separated list.
const htmlAttr = /\b(?:src|srcset|href)\s*=\s*"([^"]+)"/g

function isExternal(t) {
  return /^(https?:|mailto:|tel:|data:|ftp:)/i.test(t) || t.startsWith('//') || t.startsWith('#')
}

const broken = []
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8')
  const masked = mask(content)
  const seen = []
  let match
  while ((match = inlineLink.exec(masked)) !== null) seen.push([match.index, match[1]])
  while ((match = refDef.exec(masked)) !== null) seen.push([match.index, match[1]])
  while ((match = htmlAttr.exec(masked)) !== null) {
    // srcset entries are "url descriptor" pairs separated by commas
    for (const part of match[1].split(',')) seen.push([match.index, part.trim().split(/\s+/)[0]])
  }

  for (const [idx, rawTarget] of seen) {
    let target = rawTarget.trim().replace(/^<|>$/g, '')
    // Drop an optional link title:  path "Title"
    target = target.split(/\s+/)[0]
    if (!target || isExternal(target)) continue
    target = target.replace(/[#?].*$/, '')
    if (!target) continue
    let decoded
    try { decoded = decodeURIComponent(target) } catch { decoded = target }
    const resolved = decoded.startsWith('/')
      ? path.join(ROOT, decoded)
      : path.resolve(path.dirname(file), decoded)
    if (!fs.existsSync(resolved)) {
      const line = content.slice(0, idx).split('\n').length
      broken.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), line, target: rawTarget.trim() })
    }
  }
}

if (broken.length) {
  console.error(`\n✖ ${broken.length} broken relative link(s) across ${files.length} markdown files:\n`)
  for (const b of broken) console.error(`  ${b.file}:${b.line}  →  ${b.target}`)
  process.exit(1)
}
console.log(`✓ docs:linkcheck — 0 broken relative links across ${files.length} markdown files`)
