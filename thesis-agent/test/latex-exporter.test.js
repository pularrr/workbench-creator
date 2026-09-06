import assert from 'node:assert/strict'
import { mkdtemp, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { exportLatex } from '../src/latex-exporter.js'

test('compiles the safe built-in Chinese LaTeX template when XeLaTeX is configured', { skip: !process.env.THESIS_XELATEX_PATH }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'thesis-latex-'))
  const result = await exportLatex({
    title: '论文 PDF 验收', name: '论文 PDF 验收', template: {}, formattedReferences: [], literature: [],
    blocks: [{ id: 'p1', markdown: '# 绪论\n这是统一论文结构生成的 PDF。', citations: [] }],
  }, directory, { filename: 'acceptance', compilePdf: true })
  assert.equal(result.compiled, true)
  assert.ok((await stat(result.pdfPath)).size > 0)
})
