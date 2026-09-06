/**
 * RAGFlow Core Adapter (P3 · v1.0).
 *
 * Provides a uniform interface to RAGFlow's core retrieval stack:
 *   - Document parsing (DeepDoc-compatible)
 *   - Chunking & embedding
 *   - Vector storage (Qdrant-compatible API)
 *   - Keyword search (PostgreSQL full-text / Elasticsearch-compatible)
 *   - Caching (Redis-compatible)
 *   - Hybrid retrieval (recall → rerank → generate)
 *
 * Two backends:
 *   - 'local':  uses the plugin's existing local-hash embedding + JSON storage
 *   - 'ragflow': connects to a RAGFlow-compatible HTTP API
 *
 * The adapter ensures all operations return lossless-JSON-safe results.
 */

import { createEmbeddingProvider, embedInBatches } from './embedding-provider.js'
import { chunkText, contentHash, hybridSearch } from './source-index.js'
import { createReranker, rerankPassages } from './reranker.js'

const FINITE = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

// ---------------------------------------------------------------------------
// Local backend (uses existing plugin infrastructure)
// ---------------------------------------------------------------------------
class LocalRagBackend {
  constructor(options = {}) {
    this.type = 'local'
    this.embeddingConfig = options.embeddingConfig || { type: 'local-hash' }
    this.embeddingProvider = createEmbeddingProvider(this.embeddingConfig)
    this.collections = new Map() // collectionId → { chunks: [], embeddings: [] }
  }

  async createCollection(collectionId, options = {}) {
    if (!this.collections.has(collectionId)) {
      this.collections.set(collectionId, {
        chunks: [],
        embeddings: [],
        metadata: { ...options, createdAt: new Date().toISOString() },
      })
    }
    return { collectionId, created: true, backend: 'local' }
  }

  async addDocuments(collectionId, documents, options = {}) {
    const collection = this.collections.get(collectionId)
    if (!collection) throw new Error(`Collection not found: ${collectionId}`)
    const maxChars = options.maxChars || options.chunkSize || 1200
    const overlapChars = options.overlapChars || options.chunkOverlap || 120
    let added = 0
    const allChunks = []
    for (const doc of documents) {
      const chunks = chunkText(doc.content || doc.text || '', { maxChars, overlapChars })
      for (const chunk of chunks) {
        const id = contentHash(chunk.content)
        allChunks.push({
          id, text: chunk.content, sourceId: doc.id || doc.sourceId || '',
          sourceName: doc.name || doc.sourceName || '', metadata: doc.metadata || {},
          startLine: chunk.startLine || 0, endLine: chunk.endLine || 0,
        })
      }
    }
    // Embed all chunks in one batch
    if (allChunks.length > 0) {
      const embeddings = await embedInBatches(this.embeddingProvider, allChunks.map((c) => c.text))
      for (let i = 0; i < allChunks.length; i++) {
        const chunk = { ...allChunks[i], content: allChunks[i].text, embedding: embeddings[i] }
        collection.chunks.push(chunk)
        collection.embeddings.push(embeddings[i])
        added++
      }
    }
    return { added, collectionId, totalChunks: collection.chunks.length }
  }

  async search(collectionId, query, options = {}) {
    const collection = this.collections.get(collectionId)
    if (!collection) return { results: [], total: 0, backend: 'local' }
    const topK = options.topK || 10
    const queryEmbeddings = await embedInBatches(this.embeddingProvider, [query])
    const queryEmbedding = queryEmbeddings[0]
    // hybridSearch(chunks, query, limit, queryVector) — synchronous
    const rawResults = hybridSearch(collection.chunks, query, topK, queryEmbedding)
    const results = rawResults.map((r) => ({ ...r, score: FINITE(r.relevance || 0) }))
    return { results, total: results.length, backend: 'local', query }
  }

  async deleteCollection(collectionId) {
    const existed = this.collections.has(collectionId)
    this.collections.delete(collectionId)
    return { deleted: existed, collectionId }
  }

  async getCollectionStats(collectionId) {
    const collection = this.collections.get(collectionId)
    if (!collection) return { exists: false, collectionId }
    return {
      exists: true, collectionId,
      chunkCount: FINITE(collection.chunks.length),
      metadata: collection.metadata,
    }
  }
}

// ---------------------------------------------------------------------------
// RAGFlow backend (HTTP API)
// ---------------------------------------------------------------------------
class RagflowBackend {
  constructor(options = {}) {
    this.type = 'ragflow'
    this.endpoint = options.endpoint || process.env.RAGFLOW_ENDPOINT || 'http://127.0.0.1:9380'
    this.apiKey = options.apiKey || process.env.RAGFLOW_API_KEY || ''
    this.timeout = options.timeout || 30000
    this.datasetId = options.datasetId || ''
  }

  async _request(path, options = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)
    try {
      const response = await fetch(`${this.endpoint}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...(options.headers || {}),
        },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`RAGFlow API ${response.status}: ${await response.text().catch(() => '')}`)
      return response.json()
    } finally {
      clearTimeout(timer)
    }
  }

  async createCollection(collectionId, options = {}) {
    // RAGFlow uses datasets; create a dataset
    const result = await this._request('/api/v1/datasets', {
      method: 'POST',
      body: JSON.stringify({ name: collectionId, ...options }),
    })
    return { collectionId, created: true, backend: 'ragflow', datasetId: result.data?.id }
  }

  async addDocuments(collectionId, documents, options = {}) {
    // Upload documents to RAGFlow dataset
    const formData = new FormData()
    for (const doc of documents) {
      const blob = new Blob([doc.content || doc.text || ''], { type: 'text/plain' })
      formData.append('files', blob, doc.name || `${doc.id || 'doc'}.txt`)
    }
    const result = await this._request(`/api/v1/datasets/${collectionId}/documents`, {
      method: 'POST',
      body: formData,
      headers: {}, // FormData sets its own content-type
    })
    return { added: documents.length, collectionId, backend: 'ragflow', result }
  }

  async search(collectionId, query, options = {}) {
    const result = await this._request('/api/v1/retrieval', {
      method: 'POST',
      body: JSON.stringify({
        dataset_ids: [collectionId],
        query,
        top_k: options.topK || 10,
        similarity_threshold: options.similarityThreshold || 0.2,
        vector: options.vectorWeight !== undefined ? options.vectorWeight : undefined,
        keyword: options.keywordWeight !== undefined ? options.keywordWeight : undefined,
      }),
    })
    const results = (result.data?.chunks || []).map((chunk) => ({
      id: chunk.chunk_id,
      text: chunk.content,
      score: FINITE(Number(chunk.similarity || 0)),
      sourceName: chunk.document_name || '',
      metadata: chunk.metadata || {},
    }))
    return { results, total: results.length, backend: 'ragflow', query }
  }

  async deleteCollection(collectionId) {
    await this._request(`/api/v1/datasets/${collectionId}`, { method: 'DELETE' })
    return { deleted: true, collectionId }
  }

  async getCollectionStats(collectionId) {
    const result = await this._request(`/api/v1/datasets/${collectionId}`)
    return {
      exists: true, collectionId,
      chunkCount: FINITE(result.data?.chunk_count || 0),
      metadata: result.data || {},
    }
  }
}

// ---------------------------------------------------------------------------
// Public adapter
// ---------------------------------------------------------------------------

/**
 * Create a RAGFlow-compatible retrieval adapter.
 * @param {object} options
 * @param {'local'|'ragflow'} options.backend - backend type
 * @param {object} options.embeddingConfig - embedding config (local backend)
 * @param {string} options.endpoint - RAGFlow API endpoint
 * @param {string} options.apiKey - RAGFlow API key
 * @param {object} options.rerank - rerank config { provider, topK, ... }
 */
export function createRagflowAdapter(options = {}) {
  const backend = options.backend || 'local'
  const ragBackend = backend === 'ragflow'
    ? new RagflowBackend(options)
    : new LocalRagBackend(options)

  const reranker = options.rerank ? createReranker(options.rerank.provider || 'local', options.rerank) : null

  return {
    backend: ragBackend.type,

    async createCollection(collectionId, opts = {}) {
      return ragBackend.createCollection(collectionId, opts)
    },

    async addDocuments(collectionId, documents, opts = {}) {
      return ragBackend.addDocuments(collectionId, documents, opts)
    },

    async search(collectionId, query, opts = {}) {
      const result = await ragBackend.search(collectionId, query, opts)
      // Optional rerank pass
      if (reranker && result.results.length > 0) {
        const passages = result.results.map((r) => r.text)
        const reranked = await rerankPassages(reranker, query, passages, opts.rerankTopK || opts.topK || 10)
        result.results = reranked.map((rr) => ({
          ...result.results[rr.index],
          rerankScore: FINITE(rr.score),
          score: FINITE(rr.score),
        }))
        result.reranked = true
      }
      return result
    },

    async deleteCollection(collectionId) {
      return ragBackend.deleteCollection(collectionId)
    },

    async getCollectionStats(collectionId) {
      return ragBackend.getCollectionStats(collectionId)
    },

    /** Health check: verify backend is reachable. */
    async healthCheck() {
      if (ragBackend.type === 'local') {
        return { healthy: true, backend: 'local', message: 'Local backend always available' }
      }
      try {
        await ragBackend._request('/api/v1/version')
        return { healthy: true, backend: 'ragflow' }
      } catch (error) {
        return { healthy: false, backend: 'ragflow', error: String(error.message || error) }
      }
    },
  }
}

export const __test__ = { LocalRagBackend, RagflowBackend }
