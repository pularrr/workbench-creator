/**
 * Citation & cross-reference engine (P3 · v1.0).
 *
 * Handles automatic numbering of figures, tables, equations, and
 * cross-reference resolution in academic manuscripts.
 *
 * Features:
 *   - Scan manuscript for figure/table/equation definitions and references
 *   - Auto-number in order of appearance (per-section or global)
 *   - Resolve cross-references ("如图1所示" → "如图1所示" with verified number)
 *   - Detect orphan references (referenced but not defined) and orphan definitions
 *   - Generate a list of all captions with their numbers and positions
 *
 * All outputs are lossless-JSON safe.
 */

const FINITE = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

// Patterns for figure/table/equation definitions
const DEFINITION_PATTERNS = {
  figure: [
    /^(?:图|Figure|Fig\.?)\s*(\d+(?:\.\d+)?)\s*[：:．.]?\s*(.+)$/im,
    /^\[!\[.*?\]\(.*?\)\]\s*\n?\s*(?:图|Figure|Fig\.?)\s*(\d+(?:\.\d+)?)\s*[：:．.]?\s*(.+)$/im,
  ],
  table: [
    /^(?:表|Table|Tab\.?)\s*(\d+(?:\.\d+)?)\s*[：:．.]?\s*(.+)$/im,
  ],
  equation: [
    /^\$\$(.+?)\$\$\s*\\?\((\d+(?:\.\d+)?)\)?\s*$/m,
    /^\\begin\{equation\}(.+?)\\label\{eq:(\w+)\}\\end\{equation\}$/m,
  ],
}

// Patterns for cross-references in text
const REFERENCE_PATTERNS = {
  figure: [
    /(?:如|参见|见图|参考图|如图)\s*(?:图|Figure|Fig\.?)\s*(\d+(?:\.\d+)?)/gi,
    /(?:图|Figure|Fig\.?)\s*(\d+(?:\.\d+)?)\s*(?:所示|如下|中)/gi,
    /(?:as shown in|see|refer to|in)\s*(?:figure|fig\.?)\s*(\d+(?:\.\d+)?)/gi,
    /(?:figure|fig\.?)\s*(\d+(?:\.\d+)?)\s*(?:shows?|depicts?|presents?|illustrates?)/gi,
  ],
  table: [
    /(?:如|参见|见表|参考表|如表)\s*(?:表|Table|Tab\.?)\s*(\d+(?:\.\d+)?)/gi,
    /(?:表|Table|Tab\.?)\s*(\d+(?:\.\d+)?)\s*(?:所示|如下|中)/gi,
    /(?:as shown in|see|refer to|in)\s*(?:table|tab\.?)\s*(\d+(?:\.\d+)?)/gi,
    /(?:table|tab\.?)\s*(\d+(?:\.\d+)?)\s*(?:shows?|presents?|lists?|summarizes?)/gi,
  ],
  equation: [
    /(?:公式|式|Equation|Eq\.?)\s*(\d+(?:\.\d+)?)/gi,
    /\((\d+(?:\.\d+)?)\)\s*(?:所示|如下)/g,
  ],
}

/**
 * Scan manuscript text for all definitions and references.
 * @param {string} text - manuscript markdown text
 * @param {object} options - { numbering: 'global'|'section', startNumber: number }
 * @returns {object} scan result
 */
export function scanManuscript(text, options = {}) {
  const safeText = String(text || '')
  const lines = safeText.split('\n')
  const numbering = options.numbering || 'global'

  const definitions = { figure: [], table: [], equation: [] }
  const references = { figure: [], table: [], equation: [] }

  // Scan for definitions
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    for (const [type, patterns] of Object.entries(DEFINITION_PATTERNS)) {
      for (const pattern of patterns) {
        const match = line.match(pattern)
        if (match) {
          definitions[type].push({
            type,
            number: match[1],
            caption: (match[2] || '').trim(),
            line: lineIndex + 1,
            text: line.trim(),
          })
          break
        }
      }
    }
  }

  // Scan for references (full text, not line-by-line, for multi-line context)
  for (const [type, patterns] of Object.entries(REFERENCE_PATTERNS)) {
    for (const pattern of patterns) {
      let match
      const regex = new RegExp(pattern.source, pattern.flags)
      while ((match = regex.exec(safeText)) !== null) {
        const lineNumber = safeText.slice(0, match.index).split('\n').length
        references[type].push({
          type,
          number: match[1],
          line: lineNumber,
          context: safeText.slice(Math.max(0, match.index - 20), match.index + match[0].length + 20).trim(),
        })
      }
    }
  }

  // Deduplicate references (same number on same line)
  for (const type of Object.keys(references)) {
    const seen = new Set()
    references[type] = references[type].filter((ref) => {
      const key = `${ref.number}:${ref.line}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  return { definitions, references, numbering, totalLines: lines.length }
}

/**
 * Auto-number definitions in order of appearance.
 * Returns a mapping of oldNumber → newNumber and the renumbered text.
 */
export function autoNumber(scanResult, options = {}) {
  const numbering = options.numbering || scanResult.numbering || 'global'
  const mapping = { figure: {}, table: {}, equation: {} }
  const counters = { figure: 0, table: 0, equation: 0 }

  // Sort definitions by line number and assign new numbers
  const allDefs = []
  for (const [type, defs] of Object.entries(scanResult.definitions)) {
    for (const def of defs) {
      allDefs.push({ ...def, _type: type })
    }
  }
  allDefs.sort((a, b) => a.line - b.line)

  for (const def of allDefs) {
    counters[def._type] += 1
    const newNumber = numbering === 'section' && def.number.includes('.')
      ? def.number // keep section-numbered as-is
      : String(counters[def._type])
    mapping[def._type][def.number] = newNumber
  }

  return { mapping, counters, numbering }
}

/**
 * Find orphan references (referenced but not defined) and orphan definitions.
 */
export function findOrphans(scanResult) {
  const orphans = { references: [], definitions: [] }
  for (const type of Object.keys(scanResult.definitions)) {
    const definedNumbers = new Set(scanResult.definitions[type].map((d) => d.number))
    const referencedNumbers = new Set(scanResult.references[type].map((r) => r.number))
    // Orphan references: referenced but not defined
    for (const ref of scanResult.references[type]) {
      if (!definedNumbers.has(ref.number)) {
        orphans.references.push({ ...ref, issue: 'referenced_but_not_defined' })
      }
    }
    // Orphan definitions: defined but never referenced
    for (const def of scanResult.definitions[type]) {
      if (!referencedNumbers.has(def.number)) {
        orphans.definitions.push({ ...def, issue: 'defined_but_not_referenced' })
      }
    }
  }
  return orphans
}

/**
 * Generate a caption list (table of figures/tables/equations).
 */
export function generateCaptionList(scanResult) {
  const list = { figures: [], tables: [], equations: [] }
  const typeMap = { figure: 'figures', table: 'tables', equation: 'equations' }
  for (const [type, defs] of Object.entries(scanResult.definitions)) {
    const sorted = [...defs].sort((a, b) => {
      const aNum = parseFloat(a.number) || 0
      const bNum = parseFloat(b.number) || 0
      return aNum - bNum
    })
    list[typeMap[type]] = sorted.map((d) => ({
      number: d.number,
      caption: d.caption,
      page: null, // page number not available in markdown
      line: d.line,
    }))
  }
  return list
}

/**
 * Full citation engine analysis.
 * @param {string} text - manuscript markdown text
 * @param {object} options
 * @returns {object} complete analysis
 */
export function analyzeCitations(text, options = {}) {
  const scan = scanManuscript(text, options)
  const numbering = autoNumber(scan, options)
  const orphans = findOrphans(scan)
  const captionList = generateCaptionList(scan)

  const stats = {
    figures: {
      defined: FINITE(scan.definitions.figure.length),
      referenced: FINITE(scan.references.figure.length),
      orphanReferences: FINITE(orphans.references.filter((r) => r.type === 'figure').length),
      orphanDefinitions: FINITE(orphans.definitions.filter((d) => d.type === 'figure').length),
    },
    tables: {
      defined: FINITE(scan.definitions.table.length),
      referenced: FINITE(scan.references.table.length),
      orphanReferences: FINITE(orphans.references.filter((r) => r.type === 'table').length),
      orphanDefinitions: FINITE(orphans.definitions.filter((d) => d.type === 'table').length),
    },
    equations: {
      defined: FINITE(scan.definitions.equation.length),
      referenced: FINITE(scan.references.equation.length),
      orphanReferences: FINITE(orphans.references.filter((r) => r.type === 'equation').length),
      orphanDefinitions: FINITE(orphans.definitions.filter((d) => d.type === 'equation').length),
    },
  }

  return {
    scan,
    numbering,
    orphans,
    captionList,
    stats,
    analyzedAt: new Date().toISOString(),
  }
}

export const __test__ = {
  scanManuscript, autoNumber, findOrphans, generateCaptionList,
  DEFINITION_PATTERNS, REFERENCE_PATTERNS,
}
