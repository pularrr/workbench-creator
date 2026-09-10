/**
 * Safe baseline parser for user-selected project materials.
 * It deliberately does not scan directories or execute documents. Rich,
 * domain-specific parsing belongs to an optional Material plugin.
 */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.xml', '.html', '.htm', '.js', '.ts', '.py'])
const TYPE_BY_EXTENSION = {
  '.pdf': 'pdf', '.docx': 'docx', '.pptx': 'pptx', '.xlsx': 'xlsx',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image',
}
const MAX_TEXT_BYTES = 2 * 1024 * 1024

export async function parseMaterialFile(filePath) {
  if (!filePath || typeof filePath !== 'string') throw new Error('filePath is required')
  const absolutePath = path.resolve(filePath)
  const info = await stat(absolutePath)
  if (!info.isFile()) throw new Error('filePath must refer to a file')
  const extension = path.extname(absolutePath).toLowerCase()
  const type = TEXT_EXTENSIONS.has(extension) ? 'text' : (TYPE_BY_EXTENSION[extension] || 'binary')
  const record = {
    name: path.basename(absolutePath), type, uri: absolutePath,
    metadata: { extension, sizeBytes: info.size, importedFrom: 'local-file' },
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    if (info.size > MAX_TEXT_BYTES) throw new Error(`Text material exceeds ${MAX_TEXT_BYTES} byte import limit`)
    const text = await readFile(absolutePath, 'utf8')
    record.extractedText = text
    record.metadata.characterCount = text.length
  } else {
    record.metadata.extractionStatus = 'metadata_only'
    record.metadata.extractionHint = 'Install or provide a task Material plugin for rich parsing of this file type.'
  }
  return record
}
