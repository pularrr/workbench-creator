/**
 * Figure describer (P2 · v0.8).
 *
 * Generates text descriptions for figures/images extracted from documents.
 * Two modes:
 *   - multimodal: calls a multimodal LLM API (OpenAI-compatible / vision model)
 *   - fallback:   OCR + caption/context extraction (no external API)
 *
 * All descriptions are lossless-JSON safe.
 */

import { createOcrProvider, runOcr } from './ocr-provider.js'

const FINITE = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

/**
 * Create a figure describer instance.
 * @param {object} options
 * @param {'multimodal'|'fallback'} options.mode - describer mode
 * @param {string} options.apiKey - API key for multimodal mode
 * @param {string} options.endpoint - OpenAI-compatible endpoint
 * @param {string} options.model - vision model name (default: gpt-4o-mini)
 * @param {object} options.ocrOptions - OCR options for fallback mode
 */
export function createFigureDescriber(options = {}) {
  return {
    mode: options.mode || 'fallback',
    apiKey: options.apiKey || '',
    endpoint: options.endpoint || 'https://api.openai.com/v1/chat/completions',
    model: options.model || 'gpt-4o-mini',
    ocrOptions: options.ocrOptions || {},
    timeout: options.timeout || 30000,
  }
}

/**
 * Describe a figure using multimodal LLM.
 * @param {object} describer - from createFigureDescriber()
 * @param {string} imagePath - absolute path to image file
 * @param {object} context - { caption, surroundingText, figureNumber }
 * @returns {Promise<{description:string, mode:string, confidence:number}>}
 */
async function describeMultimodal(describer, imagePath, context = {}) {
  if (!describer.apiKey) {
    throw new Error('Multimodal describer requires apiKey')
  }
  const fs = await import('node:fs')
  const imageBuffer = fs.readFileSync(imagePath)
  const base64 = imageBuffer.toString('base64')
  const mimeType = inferMimeType(imagePath)
  const prompt = buildPrompt(context)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), describer.timeout)
  try {
    const response = await fetch(describer.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${describer.apiKey}`,
      },
      body: JSON.stringify({
        model: describer.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        }],
        max_tokens: 500,
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Multimodal API ${response.status}: ${await response.text().catch(() => '')}`)
    const data = await response.json()
    const description = clean(data.choices?.[0]?.message?.content || '')
    return { description, mode: 'multimodal', confidence: FINITE(0.85) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Describe a figure using fallback OCR + context.
 */
async function describeFallback(describer, imagePath, context = {}) {
  const parts = []
  // 1. Caption from document context
  if (context.caption) parts.push(`图注: ${clean(context.caption)}`)
  // 2. OCR text from the image itself
  try {
    const ocr = createOcrProvider('tesseract', { ...describer.ocrOptions, fallbackToNone: true })
    const ocrResult = await runOcr(ocr, imagePath)
    if (ocrResult.text && ocrResult.text.length > 5) {
      parts.push(`图内文字: ${clean(ocrResult.text).slice(0, 300)}`)
    }
  } catch {
    // OCR failed, skip
  }
  // 3. Surrounding text context
  if (context.surroundingText) {
    parts.push(`上下文: ${clean(context.surroundingText).slice(0, 200)}`)
  }
  // 4. Figure number
  if (context.figureNumber) {
    parts.unshift(`图 ${context.figureNumber}`)
  }
  const description = parts.length > 0 ? parts.join('；') : '无法自动描述该图表（未启用多模态模型，且未检测到图内文字）'
  return { description, mode: 'fallback', confidence: FINITE(parts.length > 1 ? 0.5 : 0.2) }
}

function buildPrompt(context) {
  const parts = ['请用中文简要描述这张学术图表的内容，包括：图表类型、横纵坐标含义、主要数据趋势或结论。不超过150字。']
  if (context.caption) parts.push(`图注: ${context.caption}`)
  if (context.figureNumber) parts.push(`图号: 图 ${context.figureNumber}`)
  if (context.surroundingText) parts.push(`上下文: ${context.surroundingText.slice(0, 300)}`)
  return parts.join('\n')
}

function inferMimeType(filePath) {
  const ext = String(filePath || '').split('.').pop().toLowerCase()
  const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tiff: 'image/tiff', tif: 'image/tiff' }
  return map[ext] || 'image/png'
}

/**
 * Describe a figure.
 * @param {object} describer - from createFigureDescriber()
 * @param {string} imagePath - absolute path to image file
 * @param {object} context - { caption, surroundingText, figureNumber }
 * @returns {Promise<{description:string, mode:string, confidence:number}>}
 */
export async function describeFigure(describer, imagePath, context = {}) {
  try {
    if (describer.mode === 'multimodal') {
      return await describeMultimodal(describer, imagePath, context)
    }
    return await describeFallback(describer, imagePath, context)
  } catch (error) {
    // Fall back to basic description on any error
    return {
      description: `图表描述生成失败: ${String(error.message || error)}`,
      mode: 'error',
      confidence: 0,
    }
  }
}

/**
 * Batch describe multiple figures.
 */
export async function describeFigures(describer, figures) {
  const results = []
  for (const figure of figures || []) {
    const result = await describeFigure(describer, figure.path, figure.context || {})
    results.push({ ...figure, ...result })
  }
  return results
}

export const __test__ = { describeMultimodal, describeFallback, buildPrompt, inferMimeType }
