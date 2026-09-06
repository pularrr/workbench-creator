import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

function safeFilename(value) {
  return String(value || 'thesis').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'thesis'
}

// LaTeX command → Unicode math symbol (reverse of latex-exporter)
const LATEX_TO_UNICODE = {
  '\\varepsilon': 'ε', '\\epsilon': 'ϵ', '\\alpha': 'α', '\\beta': 'β',
  '\\gamma': 'γ', '\\delta': 'δ', '\\kappa': 'κ', '\\lambda': 'λ',
  '\\mu': 'μ', '\\nu': 'ν', '\\pi': 'π', '\\rho': 'ρ', '\\sigma': 'σ',
  '\\tau': 'τ', '\\varphi': 'φ', '\\phi': 'ϕ', '\\chi': 'χ', '\\psi': 'ψ',
  '\\omega': 'ω', '\\eta': 'η', '\\theta': 'θ', '\\iota': 'ι', '\\xi': 'ξ',
  '\\zeta': 'ζ', '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ',
  '\\Lambda': 'Λ', '\\Xi': 'Ξ', '\\Pi': 'Π', '\\Sigma': 'Σ', '\\Phi': 'Φ',
  '\\Psi': 'Ψ', '\\Omega': 'Ω',
  '\\times': '×', '\\div': '÷', '\\cdot': '·', '\\pm': '±', '\\mp': '∓',
  '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\approx': '≈', '\\equiv': '≡',
  '\\propto': '∝', '\\infty': '∞', '\\partial': '∂', '\\nabla': '∇',
  '\\sum': '∑', '\\int': '∫', '\\rightarrow': '→', '\\leftarrow': '←',
  '\\leftrightarrow': '↔', '\\Rightarrow': '⇒', '\\Leftarrow': '⇐',
  '\\Leftrightarrow': '⇔', '\\in': '∈', '\\notin': '∉', '\\subset': '⊂',
  '\\supset': '⊃', '\\subseteq': '⊆', '\\supseteq': '⊇', '\\cup': '∪',
  '\\cap': '∩', '\\emptyset': '∅', '\\forall': '∀', '\\exists': '∃',
  '\\neg': '¬', '\\wedge': '∧', '\\vee': '∨', '\\ldots': '…',
  '\\sqrt': '√',
}

function latexToUnicode(text) {
  let result = text
  // Sort commands by length descending to avoid partial matches
  const commands = Object.keys(LATEX_TO_UNICODE).sort((a, b) => b.length - a.length)
  for (const cmd of commands) {
    result = result.split(cmd).join(LATEX_TO_UNICODE[cmd])
  }
  // Handle \sqrt{...} → √(...)
  result = result.replace(/\\sqrt\{([^}]+)\}/g, '√($1)')
  // Handle ^{...} → keep as superscript marker, _{...} → subscript marker
  return result
}

// Parse a formula string into TextRun segments (normal / superscript / subscript)
function formulaToRuns(formula, font, size) {
  const mathFont = 'Cambria Math'
  const runs = []
  let text = latexToUnicode(formula)
  // Remove remaining braces used for grouping
  text = text.replace(/[{}]/g, '')
  // Parse ^{...} and _{...}
  let i = 0
  let buffer = ''
  while (i < text.length) {
    if (text[i] === '^' && text[i + 1] === '{') {
      if (buffer) { runs.push(new TextRun({ text: buffer, font: mathFont, size })); buffer = '' }
      const end = text.indexOf('}', i + 2)
      const content = end > i + 2 ? text.substring(i + 2, end) : ''
      runs.push(new TextRun({ text: content, font: mathFont, size, superScript: true }))
      i = end > i + 2 ? end + 1 : i + 2
    } else if (text[i] === '_' && text[i + 1] === '{') {
      if (buffer) { runs.push(new TextRun({ text: buffer, font: mathFont, size })); buffer = '' }
      const end = text.indexOf('}', i + 2)
      const content = end > i + 2 ? text.substring(i + 2, end) : ''
      runs.push(new TextRun({ text: content, font: mathFont, size, subScript: true }))
      i = end > i + 2 ? end + 1 : i + 2
    } else if (text[i] === '^' && i + 1 < text.length) {
      if (buffer) { runs.push(new TextRun({ text: buffer, font: mathFont, size })); buffer = '' }
      runs.push(new TextRun({ text: text[i + 1], font: mathFont, size, superScript: true }))
      i += 2
    } else if (text[i] === '_' && i + 1 < text.length) {
      if (buffer) { runs.push(new TextRun({ text: buffer, font: mathFont, size })); buffer = '' }
      runs.push(new TextRun({ text: text[i + 1], font: mathFont, size, subScript: true }))
      i += 2
    } else {
      buffer += text[i]
      i++
    }
  }
  if (buffer) runs.push(new TextRun({ text: buffer, font: mathFont, size }))
  return runs
}

// Parse a line with $...$ formulas into TextRun segments
function lineToRuns(line, font, size) {
  const runs = []
  let remaining = line
  // Handle $$...$$ block math (treat as inline for docx)
  remaining = remaining.replace(/\$\$([\s\S]+?)\$\$/g, (_, formula) => `$${formula}$`)
  let lastIndex = 0
  const regex = /\$([^$\n]+?)\$/g
  let match
  while ((match = regex.exec(remaining)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: remaining.substring(lastIndex, match.index), font, size }))
    }
    runs.push(...formulaToRuns(match[1], font, size))
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < remaining.length) {
    runs.push(new TextRun({ text: remaining.substring(lastIndex), font, size }))
  }
  return runs.length > 0 ? runs : [new TextRun({ text: line, font, size })]
}

function cleanHeading(text) {
  return String(text).replace(/^第[一二三四五六七八九十百千0-9]+[章节编]\s*/, '').trim()
}

function markdownParagraphs(markdown, template) {
  const font = template.fontFamily || '宋体'
  const size = Number(template.bodyFontSizeHalfPoints || 24)
  return String(markdown).split(/\n+/).filter((line) => line.trim()).map((line) => {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim())
    if (heading) {
      const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
      return new Paragraph({ text: cleanHeading(heading[2]), heading: levels[heading[1].length - 1], spacing: { before: 240, after: 120 } })
    }
    const runs = lineToRuns(line.trim(), font, size)
    return new Paragraph({ children: runs, indent: { firstLine: Number(template.firstLineIndentTwips || 480) }, spacing: { line: Number(template.lineSpacingTwips || 360), after: 80 } })
  })
}

export async function exportDocx(model, outputDirectory, input = {}) {
  const template = model.template || {}
  const children = []
  if (template.includeTitlePage !== false) {
    children.push(new Paragraph({ text: model.title || model.name, heading: HeadingLevel.TITLE, alignment: 'center', spacing: { after: 480 } }))
  }
  for (const block of model.blocks) children.push(...markdownParagraphs(block.markdown, template))
  if (model.formattedReferences.length > 0) {
    children.push(new Paragraph({ text: template.referencesTitle || '参考文献', heading: HeadingLevel.HEADING_1 }))
    for (const reference of model.formattedReferences) children.push(new Paragraph({ children: [new TextRun({ text: reference.text, font: template.fontFamily || '宋体', size: Number(template.referenceFontSizeHalfPoints || 21) })], indent: { hanging: 420 } }))
  }
  const document = new Document({ sections: [{ properties: {}, children }] })
  const buffer = await Packer.toBuffer(document)
  await mkdir(outputDirectory, { recursive: true })
  const filename = `${safeFilename(input.filename || model.title || model.name)}.docx`
  const outputPath = path.join(outputDirectory, filename)
  await writeFile(outputPath, buffer)
  return { outputPath, filename, bytes: buffer.length, format: 'docx' }
}
