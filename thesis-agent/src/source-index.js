import { createHash } from 'node:crypto'

export function contentHash(text) {
  return createHash('sha256').update(text).digest('hex')
}

function tokens(text) {
  const normalized = text.toLowerCase()
  return normalized.match(/[\p{Script=Han}]|[a-z0-9_]+/gu) || []
}

export function localEmbedding(text, dimensions = 192) {
  const vector = Array(dimensions).fill(0)
  for (const token of tokens(text)) {
    const digest = createHash('sha256').update(token).digest()
    const index = digest.readUInt16BE(0) % dimensions
    vector[index] += digest[2] % 2 === 0 ? 1 : -1
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map((value) => value / norm)
}

export function chunkText(text, options = {}) {
  const maxChars = Math.max(300, options.maxChars || 1200)
  const overlapChars = Math.min(Math.max(0, options.overlapChars || 120), Math.floor(maxChars / 2))
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const chunks = []
  let buffer = ''
  let startLine = 1
  const flush = (endLine) => {
    const content = buffer.trim()
    if (!content) return
    chunks.push({ content, startLine, endLine })
    const overlap = content.slice(-overlapChars)
    buffer = overlap
    startLine = endLine
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const isHeading = /^#{1,6}\s+/.test(line.trim())
    if (isHeading && buffer.trim()) flush(index)
    if (buffer.length + line.length + 1 > maxChars && buffer.trim()) flush(index + 1)
    buffer += `${buffer ? '\n' : ''}${line}`
  }
  flush(lines.length)
  return chunks
}

function cosine(left, right) {
  let score = 0
  for (let index = 0; index < left.length; index += 1) score += left[index] * right[index]
  return score
}

export function hybridSearch(chunks, query, limit = 8, queryVector = localEmbedding(query)) {
  const queryTokens = new Set(tokens(query))
  return chunks.map((chunk) => {
    const chunkTokens = tokens(chunk.content)
    const matched = chunkTokens.filter((token) => queryTokens.has(token)).length
    const keywordScore = queryTokens.size === 0 ? 0 : matched / Math.max(queryTokens.size, 1)
    const vectorScore = chunk.embedding?.length === queryVector.length ? Math.max(0, cosine(queryVector, chunk.embedding)) : 0
    return { ...chunk, keywordScore, vectorScore, relevance: keywordScore * 0.45 + vectorScore * 0.55 }
  }).filter((item) => item.relevance > 0).sort((a, b) => b.relevance - a.relevance).slice(0, Math.max(1, limit))
}
