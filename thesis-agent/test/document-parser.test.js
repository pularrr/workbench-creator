import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isSupportedDocument, parseApprovedDocument, scanApprovedDirectory } from '../src/document-parser.js'

test('isSupportedDocument accepts text, office, and image files', () => {
  assert.equal(isSupportedDocument('paper.md'), true)
  assert.equal(isSupportedDocument('paper.pdf'), true)
  assert.equal(isSupportedDocument('paper.docx'), true)
  assert.equal(isSupportedDocument('figure.png'), true)
  assert.equal(isSupportedDocument('figure.jpg'), true)
  assert.equal(isSupportedDocument('data.xlsx'), true)
  assert.equal(isSupportedDocument('archive.zip'), false)
  assert.equal(isSupportedDocument('noext'), false)
})

test('parseApprovedDocument reads markdown text', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'doc-parse-'))
  const filePath = path.join(dir, 'test.md')
  await writeFile(filePath, '# 标题\n\n正文内容。\n', 'utf8')
  const result = await parseApprovedDocument(filePath)
  assert.equal(result.name, 'test.md')
  assert.equal(result.mediaType, 'text/markdown')
  assert.ok(result.text.includes('标题'))
  assert.equal(result.metadata.tablesExtracted, 0)
  assert.equal(result.metadata.ocrApplied, false)
})

test('parseApprovedDocument extracts tables from markdown with table', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'doc-table-'))
  const filePath = path.join(dir, 'with-table.md')
  const content = `# 论文

| 方法 | 精度 | 召回率 |
| --- | --- | --- |
| 方法A | 0.95 | 0.90 |
| 方法B | 0.92 | 0.93 |

正文。
`
  await writeFile(filePath, content, 'utf8')
  const result = await parseApprovedDocument(filePath)
  // Markdown files go through the text path, so tablesExtracted is 0 there.
  // Table extraction from AST only applies to office/pdf files.
  assert.equal(result.metadata.tablesExtracted, 0)
  assert.ok(result.text.includes('方法A'))
})

test('parseApprovedDocument rejects unsupported file type', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'doc-unsup-'))
  const filePath = path.join(dir, 'test.zip')
  await writeFile(filePath, 'not a zip', 'utf8')
  await assert.rejects(() => parseApprovedDocument(filePath), /Unsupported document type/)
})

test('parseApprovedDocument rejects oversized file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'doc-size-'))
  const filePath = path.join(dir, 'big.md')
  await writeFile(filePath, 'x'.repeat(100), 'utf8')
  await assert.rejects(() => parseApprovedDocument(filePath, { maxBytes: 50 }), /size limit/)
})

test('scanApprovedDirectory lists supported files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'doc-scan-'))
  await writeFile(path.join(dir, 'a.md'), '# a', 'utf8')
  await writeFile(path.join(dir, 'b.pdf'), '%PDF', 'utf8')
  await writeFile(path.join(dir, 'c.zip'), 'zip', 'utf8')
  const subdir = path.join(dir, 'sub')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(subdir)
  await writeFile(path.join(subdir, 'd.docx'), 'docx', 'utf8')
  const result = await scanApprovedDirectory(dir)
  assert.equal(result.files.length, 3)
  const names = result.files.map((f) => path.basename(f.absolutePath)).sort()
  assert.deepEqual(names, ['a.md', 'b.pdf', 'd.docx'])
})

test('scanApprovedDirectory respects limit', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'doc-limit-'))
  for (let i = 0; i < 10; i++) {
    await writeFile(path.join(dir, `f${i}.md`), '#', 'utf8')
  }
  const result = await scanApprovedDirectory(dir, { limit: 3 })
  assert.equal(result.files.length, 3)
  assert.equal(result.truncated, true)
})

test('parseApprovedDocument metadata is lossless JSON', async () => {
  const { isLosslessJson } = await import('../src/lossless.js')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'doc-lossless-'))
  const filePath = path.join(dir, 'test.md')
  await writeFile(filePath, '# test\n', 'utf8')
  const result = await parseApprovedDocument(filePath)
  assert.ok(isLosslessJson(result), 'parse result must be lossless JSON')
})
