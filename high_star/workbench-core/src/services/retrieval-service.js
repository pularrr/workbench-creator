import { createHash, randomUUID } from 'node:crypto'

const DEFAULT_DIMENSIONS = 192
const DEFAULT_RRF_K = 60
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

export const tokens = (text) => String(text || '').toLowerCase().match(/[\p{Script=Han}]|[a-z0-9_]+/gu) || []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function localEmbedding(text, dimensions = DEFAULT_DIMENSIONS) {
  const vector = Array(dimensions).fill(0)
  for (const token of tokens(text)) {
    const digest = createHash('sha256').update(token).digest()
    vector[digest.readUInt16BE(0) % dimensions] += digest[2] % 2 ? -1 : 1
  }
  const norm = Math.hypot(...vector) || 1
  return vector.map((value) => value / norm)
}

export function contentHash(text) {
  return `sha256:${createHash('sha256').update(String(text || '')).digest('hex')}`
}

export function createHashEmbeddingProvider(config = {}) {
  const dimensions = Number(config.dimensions || DEFAULT_DIMENSIONS)
  return {
    id: 'hash', model: 'sha256-token-hash-v1', dimensions, normalized: true,
    async embedDocuments(texts) { return texts.map((text) => localEmbedding(text, dimensions)) },
    async embedQuery(query) { return localEmbedding(query, dimensions) },
  }
}

function validateEndpoint(endpoint) {
  const value = String(endpoint || '').replace(/\/$/, '')
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Embedding endpoint must be an HTTP(S) URL without embedded credentials')
  return value
}

function validateVectors(rows, expectedCount, expectedDimensions) {
  if (!Array.isArray(rows) || rows.length !== expectedCount || rows.some((row) => !Array.isArray(row) || row.length === 0 || row.some((value) => !Number.isFinite(value)))) throw new Error('Embedding response shape is invalid')
  const dimensions = rows[0].length
  if (rows.some((row) => row.length !== dimensions)) throw new Error('Embedding vectors have inconsistent dimensions')
  if (expectedDimensions && dimensions !== expectedDimensions) throw new Error(`Embedding dimensions mismatch: expected ${expectedDimensions}, received ${dimensions}`)
  return rows
}

export function createOpenAICompatibleEmbeddingProvider(config = {}) {
  const endpoint = validateEndpoint(config.endpoint)
  const model = String(config.model || '').trim()
  const dimensions = Number(config.dimensions || 0) || undefined
  const apiKeyEnv = String(config.apiKeyEnv || 'DASHSCOPE_API_KEY')
  const timeoutMs = Math.max(1000, Number(config.timeoutMs || 30000))
  const maxRetries = Math.max(0, Number(config.maxRetries ?? 2))
  if (!model) throw new Error('OpenAI-compatible embedding requires a model')

  async function embed(texts) {
    const apiKey = config.apiKey || process.env[apiKeyEnv]
    if (!apiKey) throw new Error(`Embedding credential is unavailable: ${apiKeyEnv}`)
    let response
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        response = await fetch(`${endpoint}/embeddings`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, input: texts, ...(dimensions ? { dimensions } : {}) }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!RETRYABLE_STATUS.has(response.status) || attempt === maxRetries) break
      } catch (error) {
        if (attempt === maxRetries) throw new Error(`Embedding request failed: ${error.message}`)
      }
      await sleep(250 * (attempt + 1))
    }
    if (!response?.ok) throw new Error(`Embedding request failed: HTTP ${response?.status || 'network'}`)
    const payload = await response.json()
    return validateVectors([...(payload.data || [])].sort((a, b) => a.index - b.index).map((item) => item.embedding), texts.length, dimensions)
  }

  return {
    id: 'openai-compatible', model, dimensions: dimensions || null, normalized: true,
    async embedDocuments(texts) { return embed(texts) },
    async embedQuery(query) { return (await embed([query]))[0] },
  }
}

export function createEmbeddingProvider(config = {}) {
  const type = config.type || 'hash'
  if (type === 'hash') return createHashEmbeddingProvider(config)
  if (type === 'openai-compatible') return createOpenAICompatibleEmbeddingProvider(config)
  throw new Error(`Unsupported embedding provider: ${type}`)
}

export function chunkText(text, options = {}) {
  const maxChars = Math.max(300, Number(options.maxChars || 1200))
  const overlapChars = Math.min(Math.max(0, Number(options.overlapChars || 120)), Math.floor(maxChars / 2))
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const result = []; let buffer = ''; let startLine = 1; let headingPath = []
  const flush = (endLine) => {
    const content = buffer.trim()
    if (content) result.push({ id: randomUUID(), content, contentSha256: contentHash(content), startLine, endLine, locator: { startLine, endLine, headingPath: [...headingPath] } })
    buffer = content.slice(-overlapChars); startLine = Math.max(1, endLine)
  }
  lines.forEach((line, index) => {
    const lineNumber = index + 1
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim())
    if (heading) {
      if (buffer.trim()) flush(lineNumber - 1)
      const level = heading[1].length
      headingPath = [...headingPath.slice(0, level - 1), heading[2].trim()]
    }
    if (buffer && buffer.length + line.length + 1 > maxChars) flush(lineNumber - 1)
    buffer += `${buffer ? '\n' : ''}${line}`
  })
  flush(lines.length)
  return result
}

function cosine(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return 0
  return left.reduce((score, value, index) => score + value * right[index], 0)
}

function keywordHits(chunks, query, limit) {
  const queryTokens = new Set(tokens(query))
  return chunks.map((chunk) => {
    const matched = tokens(chunk.content).filter((token) => queryTokens.has(token)).length
    return { chunk, keywordScore: queryTokens.size ? matched / queryTokens.size : 0 }
  }).filter((item) => item.keywordScore > 0).sort((a, b) => b.keywordScore - a.keywordScore).slice(0, limit)
}

function denseHits(chunks, queryVector, limit) {
  return chunks.map((chunk) => ({ chunk, denseScore: Math.max(0, cosine(chunk.embedding, queryVector)) }))
    .filter((item) => item.denseScore > 0).sort((a, b) => b.denseScore - a.denseScore).slice(0, limit)
}

export function reciprocalRankFusion(rankings, options = {}) {
  const k = Math.max(1, Number(options.k || DEFAULT_RRF_K)); const merged = new Map()
  for (const ranking of rankings) ranking.forEach((hit, index) => {
    const id = hit.chunk.id; const value = merged.get(id) || { ...hit.chunk, keywordScore: 0, denseScore: 0, keywordRank: null, denseRank: null, rrfScore: 0 }
    if ('keywordScore' in hit) { value.keywordScore = hit.keywordScore; value.keywordRank = index + 1 }
    if ('denseScore' in hit) { value.denseScore = hit.denseScore; value.denseRank = index + 1 }
    value.rrfScore += 1 / (k + index + 1); merged.set(id, value)
  })
  return [...merged.values()].sort((a, b) => b.rrfScore - a.rrfScore)
}

export class RetrievalService {
  constructor(options = {}) {
    this.provider = options.provider || createEmbeddingProvider(options.embedding || {})
    this.batchSize = Math.max(1, Number(options.batchSize || 10))
    this.keywordTopN = Math.max(1, Number(options.keywordTopN || 30))
    this.denseTopN = Math.max(1, Number(options.denseTopN || 30))
    this.rrfK = Math.max(1, Number(options.rrfK || DEFAULT_RRF_K))
  }

  metadata() { return { provider: this.provider.id, model: this.provider.model, dimensions: this.provider.dimensions, normalized: this.provider.normalized } }

  async indexChunks(chunks) {
    const output = []
    for (let offset = 0; offset < chunks.length; offset += this.batchSize) {
      const batch = chunks.slice(offset, offset + this.batchSize)
      let provider = this.provider; let vectors; let fallbackReason = null
      try {
        vectors = await provider.embedDocuments(batch.map((chunk) => chunk.content))
        validateVectors(vectors, batch.length, provider.dimensions || undefined)
      } catch (error) {
        if (provider.id === 'hash') throw error
        provider = createHashEmbeddingProvider()
        vectors = await provider.embedDocuments(batch.map((chunk) => chunk.content))
        fallbackReason = error.message
      }
      const embeddingMeta = { provider: provider.id, model: provider.model, dimensions: provider.dimensions, normalized: provider.normalized, fallbackReason }
      output.push(...batch.map((chunk, index) => ({ ...chunk, embedding: vectors[index], embeddingMeta })))
    }
    return output
  }

  async search(chunks, query, limit = 8) {
    const keyword = keywordHits(chunks || [], query, this.keywordTopN)
    let dense = []; let fallbackReason = null
    const matchesProvider = (chunk, provider) => {
      const meta = chunk.embeddingMeta
      if (!meta) return provider.id === 'hash'
      return meta.provider === provider.id && meta.model === provider.model && meta.dimensions === provider.dimensions
    }
    try {
      dense = denseHits((chunks || []).filter((chunk) => matchesProvider(chunk, this.provider)), await this.provider.embedQuery(query), this.denseTopN)
    } catch (error) {
      fallbackReason = error.message
      if (this.provider.id !== 'hash') {
        const fallback = createHashEmbeddingProvider()
        dense = denseHits((chunks || []).filter((chunk) => matchesProvider(chunk, fallback)), await fallback.embedQuery(query), this.denseTopN)
      }
    }
    return reciprocalRankFusion([keyword, dense], { k: this.rrfK }).slice(0, Math.max(1, limit)).map((hit) => ({ ...hit, relevance: hit.rrfScore, retrieval: { provider: this.provider.id, fallbackReason, fusion: 'rrf' } }))
  }
}

export async function searchChunks(chunks, query, limit = 8) {
  return new RetrievalService().search(chunks, query, limit)
}
