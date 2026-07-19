/*
 * Anti-Portuguese UI guard.
 *
 * The app ships English-only UI copy. The Migration Wizard + Settings trees
 * were partially translated (commit 12525cd) but kept pockets of Portuguese.
 * This guard scans those trees and fails on any Portuguese user-facing string
 * so PT copy cannot be (re)introduced.
 *
 * Scope: src/components/MigrationWizard/** and src/components/Settings/**.
 * Other app areas still contain PT and are translated in follow-up slices —
 * extend ROOTS once they are clean.
 *
 * Detection: comments are stripped first (developer notes are out of scope),
 * then each remaining line is checked for Portuguese-specific accented letters
 * (which never occur in English UI copy or code identifiers) plus a short list
 * of accent-free Portuguese words that would otherwise slip through.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOTS = [
  'src/components',
  'src/utils',
  'src/hooks',
  'src/api',
  'src/contexts',
  'src/actions',
  'src/config',
  'src/__mocks__',
]

// Portuguese-specific accented letters. These do not appear in English UI copy
// or in JS identifiers, so after comment-stripping any hit is PT user text.
const PT_ACCENTS = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/
// Accent-free Portuguese words that the accent check alone would miss. These
// are Portuguese-specific tokens that never occur in English UI copy or in JS
// identifiers used in these trees, so a whole-word, case-insensitive match is
// a reliable PT signal. (Deliberately excludes accent-free words that collide
// with English — e.g. "active", "server" — which the accent regex never sees.)
const PT_WORDS = new RegExp(
  '\\b(' + [
    // verbs / actions
    'Guardar', 'guardar', 'guardados?', 'guardado',
    'Cancelar', 'cancelar',
    'Adicionar', 'adicionar', 'adicionad[oa]s?',
    'Remover', 'remover',
    'Apagar', 'apagar', 'Eliminar', 'eliminar',
    'Fechar', 'fechar', 'Abrir', 'abrir',
    'Editar', 'editar', 'Edita',
    'Mostrar', 'mostrar', 'Esconder', 'esconder',
    'Selecionar', 'Seleccionar', 'seleccionad[oa]s?', 'selecionad[oa]s?',
    'Pesquisar', 'pesquisar', 'Carregar', 'carregar',
    'Enviar', 'enviar', 'Configurar', 'configurar',
    'Copiar', 'copiar', 'comando',
    'Tentar', 'tentar', 'Voltar', 'voltar',
    'reinicia\\w*', 'reinicio', 'reutiliza\\w*',
    'Reutiliza', 'Cria', 'Criar', 'criad[oa]s?',
    'escolher', 'escolhe', 'escolha',
    // nouns / adjectives / status
    'projectos?', 'projetos?', 'activa', 'activos', 'inactivos?', 'Inactivos?',
    'vazi[oa]s?', 'devolvidos?', 'devolvido',
    'nenhum[ao]?', 'Nenhum[ao]?',
    'servidor', 'servidores',
    'Destino', 'destino', 'autorizad[oa]s?', 'naoautorizado',
    'Autenticad[oa]', 'Pronto',
    'Apenas', 'Partilha', 'partilha\\w*',
    'Novo', 'Nova', 'Existente',
    'Confirmar', 'confirmar', 'Testar', 'Trocar',
    'Falhou', 'falhou', 'falharam',
    'Repetir', 'repetir', 'Aplicar', 'aplicar', 'Aplicad[oa]s?',
    'Pronto', 'Incluir', 'incluir', 'Anterior',
    // Tokens that evaded the accent check in App.jsx's injected AI message.
    'Acabei', 'Queres', 'sugira', 'migrad[oa]s?', 'Polir', 'polir', 'manter', 'Manter',
    // Accent-free PT that shipped in Dashboard / MigrationHistory / wizard copy
    // ("A sincronizar", "Sem tags", "nada escrito", "Progresso"). Each is a
    // Portuguese-only token with no English or JS-identifier collision — note
    // 'tags' is deliberately excluded (English) so 'Sem tags' is caught via 'sem'.
    'sincroniza\\w*', 'progresso', 'nada', 'escrit[oa]s?', 'sem',
  ].join('|') + ')\\b',
  'i',
)

// Files in the scanned ROOTS that intentionally contain Portuguese and must be
// skipped. There are none: `src/utils/greeting.js` used to ship PT copy for
// pt-* locales but was made English-only (the rest of the UI is English), so
// the guard now covers every file in the ROOTS with no exclusions.
const EXCLUDE = new Set()

// Root-level entry files that live outside the scanned dirs but still carry
// user-facing copy — e.g. App.jsx injects AI-Assistant chat messages at
// runtime (these have no accents + no common tokens, so they evade unless
// scanned explicitly).
const EXTRA_FILES = ['src/App.jsx', 'src/main.jsx']

function listSourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...listSourceFiles(p))
    else if (/\.(jsx|js)$/.test(name) && !EXCLUDE.has(p.replace(/\\/g, '/'))) out.push(p)
  }
  return out
}

// Strip block comments and `//` line comments WITHOUT collapsing lines, so the
// reported line numbers still line up with the source file. Block-comment
// bodies are replaced by spaces but every newline is preserved. The `//` strip
// keeps the char before the slashes so `https://` / `http://` inside strings
// survive, and replaces the comment body with spaces rather than deleting it.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/([^:])\/\/[^\n]*/g, (_, c) => c)
    .replace(/^\/\/[^\n]*/gm, '')
}

describe('No Portuguese in UI copy (app-wide)', () => {
  const violations = []
  const files = [
    ...ROOTS.flatMap(listSourceFiles),
    ...EXTRA_FILES.filter((f) => !EXCLUDE.has(f)),
  ]
  for (const file of files) {
    const stripped = stripComments(readFileSync(file, 'utf8'))
    stripped.split('\n').forEach((line, i) => {
      if (PT_ACCENTS.test(line) || PT_WORDS.test(line)) {
        violations.push(`${file.replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`)
      }
    })
  }

  it('contains no Portuguese user-facing strings', () => {
    if (violations.length) {
      // Surface the full worklist in the test output.
      console.error(`\nPortuguese UI copy found (${violations.length}):\n${violations.join('\n')}\n`)
    }
    expect(violations).toEqual([])
  })
})
