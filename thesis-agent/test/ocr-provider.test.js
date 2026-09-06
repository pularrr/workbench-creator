import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createOcrProvider, isOcrAvailable, runOcr, __test__ } from '../src/ocr-provider.js'

test('createOcrProvider returns none by default', () => {
  const ocr = createOcrProvider()
  assert.equal(ocr.provider, 'none')
})

test('createOcrProvider accepts tesseract', () => {
  const ocr = createOcrProvider('tesseract', { lang: 'chi_sim' })
  assert.equal(ocr.provider, 'tesseract')
  assert.equal(ocr.options.lang, 'chi_sim')
})

test('createOcrProvider accepts paddleocr', () => {
  const ocr = createOcrProvider('paddleocr', { endpoint: 'http://localhost:8000/ocr' })
  assert.equal(ocr.provider, 'paddleocr')
})

test('createOcrProvider rejects unknown provider', () => {
  assert.throws(() => createOcrProvider('unknown'), /Unsupported OCR provider/)
})

test('runOcr with none provider returns empty result', async () => {
  const ocr = createOcrProvider('none')
  const result = await runOcr(ocr, '/tmp/nonexistent.png')
  assert.equal(result.text, '')
  assert.equal(result.confidence, 0)
  assert.equal(result.provider, 'none')
  assert.equal(result.pages, 0)
})

test('runOcr with tesseract but no binary falls back to none', async () => {
  const ocr = createOcrProvider('tesseract', { binary: '/nonexistent/tesseract' })
  const result = await runOcr(ocr, '/tmp/nonexistent.png')
  // Should fall back to none with error recorded
  assert.equal(result.provider, 'none')
  assert.ok(result.error || result.text === '')
})

test('runOcr with tesseract and fallbackToLocal=false throws', async () => {
  const ocr = createOcrProvider('tesseract', { binary: '/nonexistent/tesseract', fallbackToNone: false })
  await assert.rejects(() => runOcr(ocr, '/tmp/nonexistent.png'))
})

test('isOcrAvailable returns true for none', () => {
  assert.equal(isOcrAvailable('none'), true)
})

test('ocrNone returns valid lossless result', async () => {
  const result = await __test__.ocrNone()
  assert.equal(typeof result.text, 'string')
  assert.equal(typeof result.confidence, 'number')
  assert.ok(Number.isFinite(result.confidence))
  assert.equal(typeof result.provider, 'string')
  assert.equal(typeof result.pages, 'number')
})

test('OCR results pass lossless JSON check', async () => {
  const { isLosslessJson } = await import('../src/lossless.js')
  const ocr = createOcrProvider('none')
  const result = await runOcr(ocr, '/tmp/test.png')
  assert.ok(isLosslessJson(result), 'OCR result must be lossless JSON')
})
