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
  'src/components/MigrationWizard',
  'src/components/Settings',
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
  ].join('|') + ')\\b',
  'i',
)

function listSourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...listSourceFiles(p))
    else if (/\.(jsx|js)$/.test(name)) out.push(p)
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

describe('No Portuguese in Wizard/Settings UI copy', () => {
  const violations = []
  for (const root of ROOTS) {
    for (const file of listSourceFiles(root)) {
      const stripped = stripComments(readFileSync(file, 'utf8'))
      stripped.split('\n').forEach((line, i) => {
        if (PT_ACCENTS.test(line) || PT_WORDS.test(line)) {
          violations.push(`${file.replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`)
        }
      })
    }
  }

  it('contains no Portuguese user-facing strings', () => {
    if (violations.length) {
      // Surface the full worklist in the test output.
      console.error(`\nPortuguese UI copy found (${violations.length}):\n${violations.join('\n')}\n`)
    }
    expect(violations).toEqual([])
  })
})
