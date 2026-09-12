import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseDocumentFile } from '../src/services/document-service.js'
import { recognizeImageFile } from '../src/services/ocr-service.js'

async function withTempFile(name, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wb-ocr-'))
  const filePath = path.join(directory, name)
  await writeFile(filePath, 'image-fixture')
  try { await callback(filePath) } finally { await rm(directory, { recursive: true, force: true }) }
}

const fakeWorkerFactory = async () => ({
  async recognize() { return { data: { text: '雷达 图像文字' } } },
  async terminate() {},
})

test('OCR service recognizes a user-approved image through an injectable local worker', async () => {
  await withTempFile('page.png', async (filePath) => {
    const result = await recognizeImageFile(filePath, { createWorker: fakeWorkerFactory, language: 'chi_sim+eng' })
    assert.equal(result.text, '雷达 图像文字')
    assert.equal(result.status, 'ocr_completed')
    assert.equal(result.language, 'chi_sim+eng')
  })
})

test('image material import retains OCR text and status for retrieval', async () => {
  await withTempFile('page.png', async (filePath) => {
    const material = await parseDocumentFile(filePath, { ocr: { createWorker: fakeWorkerFactory } })
    assert.equal(material.type, 'image')
    assert.equal(material.extractedText, '雷达 图像文字')
    assert.equal(material.metadata.extractionStatus, 'ocr_completed')
    assert.equal(material.metadata.ocrEngine, 'tesseract.js')
  })
})
