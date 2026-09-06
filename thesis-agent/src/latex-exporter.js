import { spawn } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const LATEX_ESCAPES = { '\\': '\\textbackslash{}', '#': '\\#', '$': '\\$', '%': '\\%', '&': '\\&', '_': '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }
const escapeLatex = (value) => String(value ?? '').replace(/[\\#$%&_{}~^]/g, (c) => LATEX_ESCAPES[c])
const safeFilename = (value) => String(value || 'thesis').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'thesis'

// Unicode math symbol → LaTeX command mapping
const MATH_SYMBOLS = {
  'ε': '\\varepsilon', 'ϵ': '\\epsilon', 'α': '\\alpha', 'β': '\\beta',
  'γ': '\\gamma', 'δ': '\\delta', 'κ': '\\kappa', 'λ': '\\lambda',
  'μ': '\\mu', 'ν': '\\nu', 'π': '\\pi', 'ρ': '\\rho', 'σ': '\\sigma',
  'τ': '\\tau', 'φ': '\\varphi', 'ϕ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi',
  'ω': '\\omega', 'η': '\\eta', 'θ': '\\theta', 'ι': '\\iota', 'ξ': '\\xi',
  'ζ': '\\zeta', 'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta',
  'Λ': '\\Lambda', 'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Φ': '\\Phi',
  'Ψ': '\\Psi', 'Ω': '\\Omega',
  '×': '\\times', '÷': '\\div', '·': '\\cdot', '±': '\\pm', '∓': '\\mp',
  '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx', '≡': '\\equiv',
  '∝': '\\propto', '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla',
  '∑': '\\sum', '∫': '\\int', '→': '\\rightarrow', '←': '\\leftarrow',
  '↔': '\\leftrightarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow',
  '⇔': '\\Leftrightarrow', '∈': '\\in', '∉': '\\notin', '⊂': '\\subset',
  '⊃': '\\supset', '⊆': '\\subseteq', '⊇': '\\supseteq', '∪': '\\cup',
  '∩': '\\cap', '∅': '\\emptyset', '∀': '\\forall', '∃': '\\exists',
  '¬': '\\neg', '∧': '\\wedge', '∨': '\\vee', '°': '^{\\circ}',
  'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}',
  'ℚ': '\\mathbb{Q}', 'ℂ': '\\mathbb{C}',
  '−': '-', '–': '-', '—': '---', '…': '\\ldots',
}

const GREEK_AND_MATH_CHARS = Object.keys(MATH_SYMBOLS).join('')

function convertMathSymbols(formula) {
  let f = formula
  // Handle sqrt: √(...) or √x
  f = f.replace(/√\(([^)]+)\)/g, '\\sqrt{$1}')
  f = f.replace(/√([a-zA-Z0-9_]+)/g, '\\sqrt{$1}')
  f = f.replace(/√/g, '\\sqrt{}')
  // Handle superscript star: x* → x^{*} (only after alphanumeric or bracket)
  f = f.replace(/([a-zA-Z0-9)}\]])\*/g, '$1^{*}')
  // Handle subscript: x_y → x_{y} (only after alphanumeric, before alphanumeric)
  f = f.replace(/([a-zA-Z0-9)}])_([a-zA-Z0-9])/g, '$1_{$2}')
  // Replace remaining Unicode math symbols
  for (const [symbol, latex] of Object.entries(MATH_SYMBOLS)) {
    if (symbol === '−' || symbol === '–' || symbol === '—' || symbol === '…') continue
    f = f.split(symbol).join(latex)
  }
  // Handle dashes and ellipsis (after math symbols to avoid double-processing)
  f = f.replace(/−/g, '-').replace(/–/g, '-').replace(/—/g, '---').replace(/…/g, '\\ldots')
  return f
}

// Protect $...$ and $$...$$ math from escapeLatex
function protectMath(text) {
  const placeholders = []
  let result = text
  // Protect $$...$$ block math first
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, formula) => {
    placeholders.push({ type: 'block', formula: formula.trim() })
    return `__MATHBLOCK_${placeholders.length - 1}__`
  })
  // Protect $...$ inline math
  result = result.replace(/\$([^$\n]+?)\$/g, (_, formula) => {
    placeholders.push({ type: 'inline', formula: formula.trim() })
    return `__MATHINLINE_${placeholders.length - 1}__`
  })
  return { text: result, placeholders }
}

function restoreMath(text, placeholders) {
  let result = text
  result = result.replace(/__MATHBLOCK_(\d+)__/g, (_, i) => {
    const p = placeholders[Number(i)]
    return `$$${convertMathSymbols(p.formula)}$$`
  })
  result = result.replace(/__MATHINLINE_(\d+)__/g, (_, i) => {
    const p = placeholders[Number(i)]
    return `$${convertMathSymbols(p.formula)}$`
  })
  return result
}

// Best-effort auto-wrap of unprotected math phrases
function autoWrapMath(text) {
  // Skip if already has $...$
  if (/\$[^$\n]+\$/.test(text)) return text
  const charClass = `[${GREEK_AND_MATH_CHARS.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')}]`
  // Match phrases containing ≥2 math symbols and an = or relation operator
  const pattern = new RegExp(`([^。！？；：,，\\s（）【】""'']*(?:${charClass}[^。！？；：,，\\s（）【】""'']*){2,}=[^。！？；：,，\\s（）【】""'']*)`, 'g')
  return text.replace(pattern, (match) => {
    const count = (match.match(new RegExp(charClass, 'g')) || []).length
    return count >= 2 ? `$${match}$` : match
  })
}

// Clean section titles: remove "第X章/节" prefix since LaTeX auto-numbers
function cleanHeading(text) {
  return String(text).replace(/^第[一二三四五六七八九十百千0-9]+[章节编]\s*/, '').trim()
}

function blockLatex(block) {
  const lines = String(block.markdown || '').split('\n')
  const rendered = lines.map((line) => {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim())
    if (heading) {
      const cmd = ['\\section', '\\subsection', '\\subsubsection'][heading[1].length - 1]
      const title = cleanHeading(heading[2])
      return `${cmd}{${escapeLatex(title)}}`
    }
    if (!line.trim()) return ''
    // Auto-wrap unprotected math, then protect, escape, restore
    let text = autoWrapMath(line.trim())
    const { text: protectedText, placeholders } = protectMath(text)
    const escaped = escapeLatex(protectedText)
    return restoreMath(escaped, placeholders)
  }).join('\n\n')
  const keys = [...new Set((block.citations || []).map((item) => item.citationKey))]
  return `${rendered}${keys.length ? ` \\cite{${keys.join(',')}}` : ''}`
}

function bibEntry(item) {
  return `@article{${item.citationKey},\n  title={${String(item.title || '').replace(/[{}]/g, '')}},\n  author={${(item.authors || []).join(' and ').replace(/[{}]/g, '')}},\n  year={${item.year || ''}},\n  journal={${String(item.venue || '').replace(/[{}]/g, '')}},\n  doi={${item.doi || ''}}\n}`
}

function texSource(model) {
  const references = model.literature.map((item) => `\\bibitem{${item.citationKey}} ${escapeLatex((model.formattedReferences.find((ref) => ref.literatureId === item.id)?.text) || `${item.authors.join(', ')}. ${item.title}. ${item.year || ''}.`)}`).join('\n')
  return `\\documentclass[UTF8,12pt]{ctexart}
\\usepackage[a4paper,margin=2.5cm]{geometry}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{booktabs}
\\title{${escapeLatex(model.title)}}
\\date{}
\\begin{document}
\\maketitle
\\tableofcontents
\\newpage
${model.blocks.map(blockLatex).join('\n\n')}
${references ? `\\begin{thebibliography}{99}\n${references}\n\\end{thebibliography}` : ''}
\\end{document}
`
}

function run(command, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false })
    let output = ''; const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, output: error.message }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: output.slice(-12000), code }) })
  })
}

export async function exportLatex(model, outputDirectory, input = {}) {
  await mkdir(outputDirectory, { recursive: true })
  const base = safeFilename(input.filename || model.title || model.name)
  const texPath = path.join(outputDirectory, `${base}.tex`)
  const bibPath = path.join(outputDirectory, 'references.bib')
  await writeFile(texPath, texSource(model), 'utf8')
  await writeFile(bibPath, `${model.literature.map(bibEntry).join('\n\n')}\n`, 'utf8')
  const result = { format: 'latex', texPath, bibPath, pdfPath: null, compiled: false, compileLog: '' }
  if (input.compilePdf === false) return result
  const compiler = process.env.THESIS_XELATEX_PATH || 'xelatex'
  const first = await run(compiler, ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', path.basename(texPath)], outputDirectory, Number(input.timeoutMs || 120000))
  if (!first.ok) return { ...result, compileLog: first.output, compileError: 'XeLaTeX compilation failed or compiler is unavailable' }
  const second = await run(compiler, ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', path.basename(texPath)], outputDirectory, Number(input.timeoutMs || 120000))
  const pdfPath = path.join(outputDirectory, `${base}.pdf`)
  try { await access(pdfPath); return { ...result, format: 'pdf', pdfPath, compiled: second.ok, compileLog: second.output } } catch { return { ...result, compileLog: second.output, compileError: 'PDF output was not created' } }
}
