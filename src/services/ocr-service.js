import { stat } from 'node:fs/promises'

const DEFAULT_LANGUAGE = 'chi_sim+eng'
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 60000

function safeError(error) {
  return String(error?.message || error || 'OCR failed').replace(/[\r\n]+/g, ' ').slice(0, 240)
}

/**
 * OCR one user-authorized image without writing its content to any remote API.
 * Tesseract may download language data on its first use unless an offline
 * langPath is supplied by the operator.
 */
export async function recognizeImageFile(filePath, options = {}) {
  const info = await stat(filePath)
  const maxBytes = Math.max(1, Number(options.maxBytes || DEFAULT_MAX_BYTES))
  if (info.size > maxBytes) throw new Error(`Image exceeds ${maxBytes} byte OCR limit`)
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS))
  const language = String(options.language || DEFAULT_LANGUAGE)
  const createWorker = options.createWorker || (await import('tesseract.js')).createWorker
  let worker
  try {
    worker = await createWorker(language, 1, {
      logger: typeof options.logger === 'function' ? options.logger : () => {},
      ...(options.langPath ? { langPath: options.langPath } : {}),
    })
    const result = await Promise.race([
      worker.recognize(filePath),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`OCR recognition timed out after ${timeoutMs}ms`)), timeoutMs)),
    ])
    const text = String(result?.data?.text || '').trim()
    return { text, language, sizeBytes: info.size, status: text ? 'ocr_completed' : 'ocr_empty' }
  } catch (error) {
    const wrapped = new Error(safeError(error))
    wrapped.code = 'OCR_FAILED'
    throw wrapped
  } finally {
    await worker?.terminate?.().catch(() => {})
  }
}

export function getOcrFailureMetadata(error, options = {}) {
  return {
    extractionStatus: 'ocr_failed',
    ocrLanguage: String(options.language || DEFAULT_LANGUAGE),
    ocrError: safeError(error),
  }
}

export const DEFAULT_OCR_OPTIONS = Object.freeze({ language: DEFAULT_LANGUAGE, maxBytes: DEFAULT_MAX_BYTES, timeoutMs: DEFAULT_TIMEOUT_MS })
