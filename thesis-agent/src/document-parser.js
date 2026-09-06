import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { OfficeGenerator, OfficeParser } from 'officeparser'
import { createOcrProvider, runOcr } from './ocr-provider.js'

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.yaml', '.yml', '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.go', '.rs', '.sql'])
const OFFICE_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.rtf', '.html', '.htm', '.epub'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'])
const DEFAULT_IGNORES = new Set(['.git', 'node_modules', '.dsh', '.env', '.venv', 'dist', 'build', '__pycache__'])

function resolved(value) { return path.resolve(String(value)) }

export function isSupportedDocument(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return TEXT_EXTENSIONS.has(extension) || OFFICE_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension)
}

// ---------------------------------------------------------------------------
// AST table extraction: count tables and convert to Markdown if needed
// ---------------------------------------------------------------------------
function extractTablesFromAst(ast) {
  const tables = []
  function walk(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'table' && Array.isArray(node.content)) {
      const rows = node.content.filter((n) => n.type === 'row' || n.type === 'table-row')
      if (rows.length > 0) {
        const markdownRows = rows.map((row) => {
          const cells = (row.content || []).filter((n) => n.type === 'cell' || n.type === 'table-cell')
          return cells.map((cell) => {
            const text = extractTextFromNode(cell)
            return text.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
          }).join(' | ')
        })
        const header = markdownRows[0] || ''
        const separator = (row => {
          const cells = (row.content || []).filter((n) => n.type === 'cell' || n.type === 'table-cell')
          return cells.map(() => '---').join(' | ')
        })(rows[0])
        const body = markdownRows.slice(1).join('\n')
        tables.push({ header, separator, body, markdown: [header, separator, body].filter(Boolean).join('\n') })
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(ast)
  return tables
}

function extractTextFromNode(node) {
  if (!node) return ''
  if (typeof node.text === 'string') return node.text
  if (Array.isArray(node.content)) return node.content.map(extractTextFromNode).join('')
  if (Array.isArray(node.children)) return node.children.map(extractTextFromNode).join('')
  return ''
}

// ---------------------------------------------------------------------------
// Image extraction from AST attachments
// ---------------------------------------------------------------------------
function extractImagesFromAst(ast) {
  const images = []
  if (ast.attachments && Array.isArray(ast.attachments)) {
    ast.attachments.forEach((att, index) => {
      if (att && (att.mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|bmp|tiff?|webp)$/i.test(att.name || ''))) {
        images.push({
          id: `img-${index}`,
          name: att.name || `image-${index}`,
          mimeType: att.mimeType || 'application/octet-stream',
          size: att.size || 0,
          // Note: actual binary data may be in att.data or att.content; we keep metadata here
        })
      }
    })
  }
  return images
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------
export async function scanApprovedDirectory(directory, options = {}) {
  const root = resolved(directory)
  const rootStat = await stat(root)
  if (!rootStat.isDirectory()) throw new Error('Approved path is not a directory')
  const limit = Math.min(Math.max(Number(options.limit || 1000), 1), 5000)
  const userIgnores = new Set((options.excludeNames || []).map(String))
  const results = []
  async function visit(current) {
    if (results.length >= limit) return
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (results.length >= limit) break
      if (DEFAULT_IGNORES.has(entry.name) || userIgnores.has(entry.name)) continue
      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(absolutePath)
      else if (entry.isFile() && isSupportedDocument(absolutePath)) {
        const info = await stat(absolutePath)
        results.push({ absolutePath, relativePath: path.relative(root, absolutePath), extension: path.extname(entry.name).toLowerCase(), size: info.size, modifiedAt: info.mtime.toISOString() })
      }
    }
  }
  await visit(root)
  return { root, files: results, truncated: results.length >= limit }
}

// ---------------------------------------------------------------------------
// Document parsing (with optional OCR, table metadata, image extraction)
// ---------------------------------------------------------------------------
export async function parseApprovedDocument(filePath, options = {}) {
  const absolutePath = resolved(filePath)
  const info = await stat(absolutePath)
  if (!info.isFile()) throw new Error('Approved path is not a file')
  const extension = path.extname(absolutePath).toLowerCase()
  if (!isSupportedDocument(absolutePath)) throw new Error(`Unsupported document type: ${extension || 'unknown'}`)
  if (info.size > Number(options.maxBytes || 50 * 1024 * 1024)) throw new Error('Document exceeds configured size limit')

  // Plain text files
  if (TEXT_EXTENSIONS.has(extension)) {
    return {
      name: path.basename(absolutePath), absolutePath,
      mediaType: extension === '.md' ? 'text/markdown' : 'text/plain',
      text: await readFile(absolutePath, 'utf8'),
      metadata: { extension, size: info.size, tablesExtracted: 0, ocrApplied: false, imagesExtracted: 0 },
    }
  }

  // Image files: run OCR directly
  if (IMAGE_EXTENSIONS.has(extension)) {
    const ocr = createOcrProvider(options.ocrProvider || 'none', options.ocrOptions || {})
    const ocrResult = await runOcr(ocr, absolutePath)
    return {
      name: path.basename(absolutePath), absolutePath,
      mediaType: `image/${extension.slice(1)}`,
      text: ocrResult.text,
      metadata: {
        extension, size: info.size, tablesExtracted: 0,
        ocrApplied: ocrResult.provider !== 'none',
        ocrProvider: ocrResult.provider,
        ocrConfidence: ocrResult.confidence,
        imagesExtracted: 1,
      },
    }
  }

  // Office / PDF files
  const extractImages = options.extractImages === true
  const enableOcr = options.enableOcr === true
  const ast = await OfficeParser.parseOffice(absolutePath, {
    ocr: enableOcr,
    extractAttachments: extractImages,
  })
  const generated = await OfficeGenerator.generate(ast, 'md', { dialect: 'commonmark' })
  let text = typeof generated.value === 'string' ? generated.value : Buffer.from(generated.value).toString('utf8')

  // Table metadata
  const tables = extractTablesFromAst(ast)
  const tablesExtracted = tables.length

  // Image metadata
  const images = extractImages ? extractImagesFromAst(ast) : []
  const imagesExtracted = images.length

  // OCR for scanned PDFs (if officeparser's built-in OCR was enabled)
  let ocrApplied = enableOcr
  let ocrProvider = enableOcr ? 'officeparser-builtin' : 'none'
  let ocrConfidence = 0

  // If external OCR provider is specified and text is empty (likely scanned),
  // run external OCR as a fallback
  if (options.ocrProvider && options.ocrProvider !== 'none' && (!text || text.trim().length < 50)) {
    const ocr = createOcrProvider(options.ocrProvider, options.ocrOptions || {})
    const ocrResult = await runOcr(ocr, absolutePath)
    if (ocrResult.text && ocrResult.text.trim().length > 0) {
      text = ocrResult.text
      ocrApplied = true
      ocrProvider = ocrResult.provider
      ocrConfidence = ocrResult.confidence
    }
  }

  return {
    name: path.basename(absolutePath), absolutePath,
    mediaType: `application/${extension.slice(1)}`,
    text,
    metadata: {
      extension, size: info.size,
      parser: 'officeparser-7.8.0',
      warnings: generated.messages || [],
      document: ast.metadata || {},
      tablesExtracted,
      ocrApplied,
      ocrProvider,
      ocrConfidence,
      imagesExtracted,
    },
    // Include extracted images metadata separately (not in text)
    images: extractImages ? images : undefined,
    // Include extracted tables as separate structured data
    tables: tables.length > 0 ? tables.map((t) => ({ markdown: t.markdown })) : undefined,
  }
}
