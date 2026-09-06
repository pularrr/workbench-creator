import { localEmbedding } from './source-index.js'

export function createEmbeddingProvider(config = {}) {
  const type = config.type || 'local-hash'
  if (type === 'local-hash') {
    return {
      id: 'local-hash-v1', dimensions: 192,
      async embedBatch(texts) { return texts.map((text) => localEmbedding(text, 192)) },
    }
  }
  if (type !== 'openai-compatible') throw new Error(`Unsupported embedding provider: ${type}`)
  const endpoint = String(config.endpoint || '').replace(/\/$/, '')
  const model = String(config.model || '')
  if (!endpoint || !model) throw new Error('OpenAI-compatible embedding requires endpoint and model')
  const parsedEndpoint = new URL(endpoint)
  if (!['http:', 'https:'].includes(parsedEndpoint.protocol) || parsedEndpoint.username || parsedEndpoint.password) throw new Error('Embedding endpoint must be an HTTP(S) URL without embedded credentials')
  return {
    id: `openai-compatible:${model}`,
    async embedBatch(texts) {
      const key = config.apiKey || (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined)
      const response = await fetch(`${endpoint}/embeddings`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model, input: texts }), signal: AbortSignal.timeout(Number(config.timeoutMs || 60000)),
      })
      if (!response.ok) throw new Error(`Embedding request failed: HTTP ${response.status}`)
      const payload = await response.json()
      const rows = [...(payload.data || [])].sort((a, b) => a.index - b.index).map((item) => item.embedding)
      if (rows.length !== texts.length || rows.some((item) => !Array.isArray(item) || item.length === 0 || item.some((value) => !Number.isFinite(value)))) throw new Error('Embedding response shape is invalid')
      if (new Set(rows.map((item) => item.length)).size !== 1) throw new Error('Embedding vectors have inconsistent dimensions')
      return rows
    },
  }
}

export async function embedInBatches(provider, texts, batchSize = 32) {
  const output = []
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    output.push(...await provider.embedBatch(texts.slice(offset, offset + batchSize)))
  }
  return output
}
