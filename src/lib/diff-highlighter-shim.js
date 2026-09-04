/**
 * Drop-in replacement for @git-diff-view/lowlight that uses only the ~40-language
 * "common" lowlight subset instead of all ~190 highlight.js grammars.
 *
 * @git-diff-view/core imports { highlighter } from '@git-diff-view/lowlight' and
 * re-exports everything from it. Vite's resolve.alias in vite.config.js redirects
 * that import here, keeping the public API identical while shrinking vendor-diff
 * by ~70% gzip (from 332 KB to ~95 KB).
 *
 * Languages added on top of common:
 *   dart  — in our DiffRenderer LANG_MAP but absent from lowlight/common
 *   vue   — custom grammar (same logic as the original @git-diff-view/lowlight)
 */
import { createLowlight, common } from 'lowlight'
import dart from 'highlight.js/lib/languages/dart'

const lowlight = createLowlight(common)
lowlight.register('dart', dart)

lowlight.register('vue', function hljsDefineVue(hljs) {
  return {
    subLanguage: 'xml',
    contains: [
      hljs.COMMENT('<!--', '-->', { relevance: 10 }),
      {
        begin: /^(\s*)(<script>)/gm,
        end: /^(\s*)(<\/script>)/gm,
        subLanguage: 'javascript',
        excludeBegin: true,
        excludeEnd: true,
      },
      {
        begin: /^(?:\s*)(?:<script\s+lang=(["'])ts\1>)/gm,
        end: /^(\s*)(<\/script>)/gm,
        subLanguage: 'typescript',
        excludeBegin: true,
        excludeEnd: true,
      },
      {
        begin: /^(\s*)(<style(\s+scoped)?>)/gm,
        end: /^(\s*)(<\/style>)/gm,
        subLanguage: 'css',
        excludeBegin: true,
        excludeEnd: true,
      },
      {
        begin: /^(?:\s*)(?:<style(?:\s+scoped)?\s+lang=(["'])(?:s[ca]ss)\1(?:\s+scoped)?>)/gm,
        end: /^(\s*)(<\/style>)/gm,
        subLanguage: 'scss',
        excludeBegin: true,
        excludeEnd: true,
      },
      {
        begin: /^(?:\s*)(?:<style(?:\s+scoped)?\s+lang=(["'])stylus\1(?:\s+scoped)?>)/gm,
        end: /^(\s*)(<\/style>)/gm,
        subLanguage: 'stylus',
        excludeBegin: true,
        excludeEnd: true,
      },
    ],
  }
})

// processAST — identical to @git-diff-view/lowlight's implementation.
// @git-diff-view/core re-exports this, so the signature must match exactly.
function processAST(ast) {
  let lineNumber = 1
  const syntaxObj = {}
  const loopAST = (nodes, wrapper) => {
    nodes.forEach((node) => {
      if (node.type === 'text') {
        if (node.value.indexOf('\n') === -1) {
          const valueLength = node.value.length
          if (!syntaxObj[lineNumber]) {
            node.startIndex = 0
            node.endIndex = valueLength - 1
            syntaxObj[lineNumber] = {
              value: node.value,
              lineNumber,
              valueLength,
              nodeList: [{ node, wrapper }],
            }
          } else {
            node.startIndex = syntaxObj[lineNumber].valueLength
            node.endIndex = node.startIndex + valueLength - 1
            syntaxObj[lineNumber].value += node.value
            syntaxObj[lineNumber].valueLength += valueLength
            syntaxObj[lineNumber].nodeList.push({ node, wrapper })
          }
          node.lineNumber = lineNumber
          return
        }
        const lines = node.value.split('\n')
        node.children = node.children || []
        for (let i = 0; i < lines.length; i++) {
          const _value = i === lines.length - 1 ? lines[i] : lines[i] + '\n'
          const _lineNumber = i === 0 ? lineNumber : ++lineNumber
          const _valueLength = _value.length
          const _node = {
            type: 'text',
            value: _value,
            startIndex: Infinity,
            endIndex: Infinity,
            lineNumber: _lineNumber,
          }
          if (!syntaxObj[_lineNumber]) {
            _node.startIndex = 0
            _node.endIndex = _valueLength - 1
            syntaxObj[_lineNumber] = {
              value: _value,
              lineNumber: _lineNumber,
              valueLength: _valueLength,
              nodeList: [{ node: _node, wrapper }],
            }
          } else {
            _node.startIndex = syntaxObj[_lineNumber].valueLength
            _node.endIndex = _node.startIndex + _valueLength - 1
            syntaxObj[_lineNumber].value += _value
            syntaxObj[_lineNumber].valueLength += _valueLength
            syntaxObj[_lineNumber].nodeList.push({ node: _node, wrapper })
          }
          node.children.push(_node)
        }
        node.lineNumber = lineNumber
        return
      }
      if (node.children) {
        loopAST(node.children, node)
        node.lineNumber = lineNumber
      }
    })
  }
  loopAST(ast.children)
  return { syntaxFileObject: syntaxObj, syntaxFileLineNumber: lineNumber }
}

export const versions = '0.1.3'

const instance = { name: 'lowlight' }
let _maxLineToIgnoreSyntax = 2000
const _ignoreSyntaxHighlightList = []

Object.defineProperty(instance, 'maxLineToIgnoreSyntax', {
  get: () => _maxLineToIgnoreSyntax,
})
Object.defineProperty(instance, 'setMaxLineToIgnoreSyntax', {
  value: (v) => { _maxLineToIgnoreSyntax = v },
})
Object.defineProperty(instance, 'ignoreSyntaxHighlightList', {
  get: () => _ignoreSyntaxHighlightList,
})
Object.defineProperty(instance, 'setIgnoreSyntaxHighlightList', {
  value: (v) => {
    _ignoreSyntaxHighlightList.length = 0
    _ignoreSyntaxHighlightList.push(...v)
  },
})
Object.defineProperty(instance, 'getAST', {
  value: (raw, fileName, lang) => {
    let hasRegisteredLang = true
    if (!lowlight.registered(lang)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`not support current lang: ${lang} yet`)
      }
      hasRegisteredLang = false
    }
    if (
      fileName &&
      highlighter.ignoreSyntaxHighlightList.some((item) =>
        item instanceof RegExp ? item.test(fileName) : fileName === item
      )
    ) {
      return
    }
    return hasRegisteredLang
      ? lowlight.highlight(lang, raw)
      : lowlight.highlightAuto(raw)
  },
})
Object.defineProperty(instance, 'processAST', {
  value: (ast) => processAST(ast),
})
Object.defineProperty(instance, 'hasRegisteredCurrentLang', {
  value: (lang) => lowlight.registered(lang),
})
Object.defineProperty(instance, 'getHighlighterEngine', {
  value: () => lowlight,
})
Object.defineProperty(instance, 'type', { value: 'class' })

export const highlighter = instance
