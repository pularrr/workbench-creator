/** Generic, task-neutral parsing service for a single user-approved file. */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { OfficeGenerator, OfficeParser } from 'officeparser'
import { parseMaterialFile } from '../core/material-parser.js'

const OFFICE_TYPES = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.rtf', '.html', '.htm', '.epub'])
const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'])

export async function parseDocumentFile(filePath, options = {}) {
  const absolutePath = path.resolve(filePath)
  const info = await stat(absolutePath)
  if (!info.isFile()) throw new Error('filePath must refer to a file')
  const maxBytes = options.maxBytes || 50 * 1024 * 1024
  if (info.size > maxBytes) throw new Error(`Document exceeds ${maxBytes} byte import limit`)
  const extension = path.extname(absolutePath).toLowerCase()
  if (!OFFICE_TYPES.has(extension) && !IMAGE_TYPES.has(extension)) return parseMaterialFile(absolutePath)
  if (IMAGE_TYPES.has(extension)) {
    return { name: path.basename(absolutePath), type: 'image', uri: absolutePath, metadata: { extension, sizeBytes: info.size, importedFrom: 'local-file', extractionStatus: 'ocr_plugin_required', extractionHint: 'Provide an OCR-capable Material plugin to extract image text.' } }
  }
  const ast = await OfficeParser.parseOffice(absolutePath, { ocr: false, extractAttachments: options.extractAttachments === true })
  const generated = await OfficeGenerator.generate(ast, 'md', { dialect: 'commonmark' })
  const extractedText = typeof generated.value === 'string' ? generated.value : Buffer.from(generated.value).toString('utf8')
  return {
    name: path.basename(absolutePath), type: extension.slice(1), uri: absolutePath, extractedText,
    metadata: { extension, sizeBytes: info.size, importedFrom: 'local-file', parser: 'officeparser', warnings: generated.messages || [], document: ast.metadata || {}, extractionStatus: 'parsed' },
  }
}
