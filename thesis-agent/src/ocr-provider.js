/**
 * OCR provider abstraction (P1 · v0.6).
 *
 * Provides a uniform interface for extracting text from scanned PDFs and
 * images. Three providers:
 *   - none     : no OCR (default)
 *   - tesseract: local Tesseract CLI or tesseract.js (if installed)
 *   - paddleocr: PaddleOCR HTTP service (self-hosted)
 *
 * All providers return { text, confidence, provider, pages } with finite
 * confidence values (safe for the lossless-JSON bridge).
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const FINITE = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

// ---------------------------------------------------------------------------
// None provider (no-op)
// ---------------------------------------------------------------------------
async function ocrNone() {
  return { text: '', confidence: 0, provider: 'none', pages: 0 }
}

// ---------------------------------------------------------------------------
// Tesseract provider (CLI)
// ---------------------------------------------------------------------------
function findTesseract() {
  const candidates = [
    'tesseract',
    'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
    'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe',
    '/usr/bin/tesseract',
    '/usr/local/bin/tesseract',
  ]
  for (const candidate of candidates) {
    try {
      if (candidate === 'tesseract') {
        // Just check if it's in PATH by running --version
        execFile('tesseract', ['--version'], { timeout: 5000 })
        return 'tesseract'
      }
      if (existsSync(candidate)) return candidate
    } catch {
      // continue
    }
  }
  return null
}

async function ocrTesseract(filePath, options = {}) {
  const binary = options.binary || findTesseract()
  if (!binary) throw new Error('Tesseract not found. Install Tesseract or set ocrProvider to "none".')
  const lang = options.lang || 'eng+chi_sim'
  const outBase = path.join(tmpdir(), `ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  return new Promise((resolve, reject) => {
    const args = [filePath, outBase, '-l', lang, '--psm', String(options.psm || 3)]
    if (options.dpi) args.push('--dpi', String(options.dpi))
    execFile(binary, args, { timeout: options.timeout || 120000 }, (error, stdout, stderr) => {
      try {
        const txtPath = `${outBase}.txt`
        let text = ''
        if (existsSync(txtPath)) {
          const fs = require('node:fs')
          text = fs.readFileSync(txtPath, 'utf8')
          try { fs.unlinkSync(txtPath) } catch { /* ignore */ }
        }
        if (error && !text) {
          reject(new Error(`Tesseract OCR failed: ${error.message} ${stderr || ''}`))
          return
        }
        resolve({ text: text.trim(), confidence: FINITE(options.expectedConfidence || 0.8), provider: 'tesseract', pages: 1 })
      } catch (e) {
        reject(e)
      }
    })
  })
}

// ---------------------------------------------------------------------------
// PaddleOCR HTTP provider
// ---------------------------------------------------------------------------
async function ocrPaddleOcr(filePath, options = {}) {
  const endpoint = options.endpoint || process.env.PADDLEOCR_ENDPOINT || 'http://127.0.0.1:8000/ocr'
  const fs = await import('node:fs')
  const imageBuffer = fs.readFileSync(filePath)
  const base64 = imageBuffer.toString('base64')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout || 60000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, lang: options.lang || 'ch' }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`PaddleOCR HTTP ${response.status}: ${await response.text().catch(() => '')}`)
    const data = await response.json()
    const results = Array.isArray(data.results) ? data.results : (Array.isArray(data) ? data : [])
    const text = results.map((r) => r.text || r.words || '').join('\n')
    const confidence = results.length > 0
      ? FINITE(results.reduce((sum, r) => sum + FINITE(Number(r.confidence || r.score || 0)), 0) / results.length)
      : 0
    return { text, confidence, provider: 'paddleocr', pages: 1 }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an OCR provider instance.
 * @param {'none'|'tesseract'|'paddleocr'} provider
 * @param {object} options - { lang, endpoint, binary, timeout, dpi, psm }
 */
export function createOcrProvider(provider = 'none', options = {}) {
  const name = String(provider || 'none').toLowerCase()
  if (!['none', 'tesseract', 'paddleocr'].includes(name)) {
    throw new Error(`Unsupported OCR provider: ${provider}`)
  }
  return { provider: name, options: { ...options } }
}

/**
 * Run OCR on an image or scanned PDF file.
 * @param {object} ocr - from createOcrProvider()
 * @param {string} filePath - absolute path to image/PDF
 * @returns {Promise<{text:string, confidence:number, provider:string, pages:number}>}
 */
export async function runOcr(ocr, filePath) {
  const provider = ocr?.provider || 'none'
  const options = ocr?.options || {}
  try {
    if (provider === 'tesseract') return await ocrTesseract(filePath, options)
    if (provider === 'paddleocr') return await ocrPaddleOcr(filePath, options)
    return await ocrNone()
  } catch (error) {
    if (options.fallbackToNone === false) throw error
    return { text: '', confidence: 0, provider: 'none', pages: 0, error: String(error.message || error) }
  }
}

/**
 * Check if an OCR provider is available (binary installed / endpoint reachable).
 */
export function isOcrAvailable(provider = 'tesseract') {
  if (provider === 'none') return true
  if (provider === 'tesseract') return findTesseract() !== null
  if (provider === 'paddleocr') return Boolean(process.env.PADDLEOCR_ENDPOINT)
  return false
}

export const __test__ = { findTesseract, ocrNone, ocrTesseract, ocrPaddleOcr }
