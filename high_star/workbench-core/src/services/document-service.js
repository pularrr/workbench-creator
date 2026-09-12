/** Generic, task-neutral parsing service for a single user-approved file. */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { OfficeGenerator, OfficeParser } from 'officeparser'
import { isTextMaterialFile, parseMaterialFile } from '../core/material-parser.js'
import { DEFAULT_OCR_OPTIONS, getOcrFailureMetadata, recognizeImageFile } from './ocr-service.js'

const OFFICE_TYPES = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.rtf', '.html', '.htm', '.epub'])
const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'])

/** Whether a file can be meaningfully parsed or OCRed by the built-in importer. */
export function isSupportedDocumentFile(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return OFFICE_TYPES.has(extension) || IMAGE_TYPES.has(extension) || isTextMaterialFile(filePath)
}

export async function parseDocumentFile(filePath, options = {}) {
  const absolutePath = path.resolve(filePath)
  const info = await stat(absolutePath)
  if (!info.isFile()) throw new Error('filePath must refer to a file')
  const maxBytes = options.maxBytes || 50 * 1024 * 1024
  if (info.size > maxBytes) throw new Error(`Document exceeds ${maxBytes} byte import limit`)
  const extension = path.extname(absolutePath).toLowerCase()
  const ocrOptions = { ...DEFAULT_OCR_OPTIONS, ...(options.ocr || {}) }
  if (!OFFICE_TYPES.has(extension) && !IMAGE_TYPES.has(extension)) return parseMaterialFile(absolutePath)
  if (IMAGE_TYPES.has(extension)) {
    try {
      const ocr = await recognizeImageFile(absolutePath, ocrOptions)
      return { name: path.basename(absolutePath), type: 'image', uri: absolutePath, extractedText: ocr.text, metadata: { extension, sizeBytes: info.size, importedFrom: 'local-file', extractionStatus: ocr.status, ocrLanguage: ocr.language, ocrEngine: 'tesseract.js' } }
    } catch (error) {
      return { name: path.basename(absolutePath), type: 'image', uri: absolutePath, metadata: { extension, sizeBytes: info.size, importedFrom: 'local-file', ...getOcrFailureMetadata(error, ocrOptions) } }
    }
  }
  let ast = await OfficeParser.parseOffice(absolutePath, { ocr: false, extractAttachments: options.extractAttachments === true })
  let generated = await OfficeGenerator.generate(ast, 'md', { dialect: 'commonmark' })
  let extractedText = typeof generated.value === 'string' ? generated.value : Buffer.from(generated.value).toString('utf8')
  let ocrStatus = 'not_required'
  if (!extractedText.trim() && ocrOptions.enabled !== false) {
    try {
      ast = await OfficeParser.parseOffice(absolutePath, { ocr: true, extractAttachments: options.extractAttachments === true, ocrConfig: { language: ocrOptions.language, ...(ocrOptions.langPath ? { langPath: ocrOptions.langPath } : {}), timeout: { recognition: ocrOptions.timeoutMs } } })
      generated = await OfficeGenerator.generate(ast, 'md', { dialect: 'commonmark' })
      extractedText = typeof generated.value === 'string' ? generated.value : Buffer.from(generated.value).toString('utf8')
      ocrStatus = extractedText.trim() ? 'ocr_completed' : 'ocr_empty'
    } catch (error) {
      ocrStatus = 'ocr_failed'
      ast.metadata ||= {}
      ast.metadata.ocrError = getOcrFailureMetadata(error, ocrOptions).ocrError
    }
  }
  return {
    name: path.basename(absolutePath), type: extension.slice(1), uri: absolutePath, extractedText,
    metadata: { extension, sizeBytes: info.size, importedFrom: 'local-file', parser: 'officeparser', warnings: generated.messages || [], document: ast.metadata || {}, extractionStatus: ocrStatus === 'ocr_failed' ? 'ocr_failed' : 'parsed', ocrStatus, ...(ocrStatus === 'ocr_failed' ? getOcrFailureMetadata({ message: ast.metadata?.ocrError }, ocrOptions) : {}) },
  }
}
