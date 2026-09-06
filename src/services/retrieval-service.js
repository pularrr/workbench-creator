import { createHash, randomUUID } from 'node:crypto'

const tokens = (text) => String(text || '').toLowerCase().match(/[\p{Script=Han}]|[a-z0-9_]+/gu) || []
export function localEmbedding(text, dimensions = 192) {
  const vector = Array(dimensions).fill(0)
  for (const token of tokens(text)) { const digest = createHash('sha256').update(token).digest(); vector[digest.readUInt16BE(0) % dimensions] += digest[2] % 2 ? -1 : 1 }
  const norm = Math.hypot(...vector) || 1
  return vector.map((value) => value / norm)
}
export function chunkText(text, maxChars = 1200, overlap = 120) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n'); const result = []; let buffer = ''; let startLine = 1
  const flush = (endLine) => { const content = buffer.trim(); if (content) result.push({ id: randomUUID(), content, startLine, endLine, embedding: localEmbedding(content) }); buffer = content.slice(-overlap); startLine = endLine }
  lines.forEach((line, index) => { if (buffer && buffer.length + line.length + 1 > maxChars) flush(index + 1); buffer += `${buffer ? '\n' : ''}${line}` })
  flush(lines.length); return result
}
export function searchChunks(chunks, query, limit = 8) {
  const queryTokens = new Set(tokens(query)); const queryVector = localEmbedding(query)
  const cosine = (vector) => vector.reduce((score, value, index) => score + value * queryVector[index], 0)
  return (chunks || []).map((chunk) => { const matched = tokens(chunk.content).filter((token) => queryTokens.has(token)).length; const keyword = queryTokens.size ? matched / queryTokens.size : 0; const vector = chunk.embedding?.length === queryVector.length ? Math.max(0, cosine(chunk.embedding)) : 0; return { ...chunk, relevance: keyword * 0.45 + vector * 0.55 } }).filter((item) => item.relevance > 0).sort((a, b) => b.relevance - a.relevance).slice(0, Math.max(1, limit))
}
