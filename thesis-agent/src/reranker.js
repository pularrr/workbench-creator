/**
 * Rerank layer for thesis source retrieval (P1 · v0.5).
 *
 * Provides a provider-agnostic rerank interface on top of hybridSearch.
 * Three providers:
 *   - local   : BM25 + character n-gram overlap, no external dependency (default)
 *   - cohere  : Cohere /v1/rerank HTTP API (requires apiKey)
 *   - voyage  : Voyage AI rerank HTTP API (requires apiKey)
 *
 * All returned scores are guaranteed finite numbers (safe for the DSH
 * lossless-JSON bridge). External providers automatically degrade to `local`
 * on network/API failure so retrieval never hard-fails.
 */

const FINITE = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

function tokenize(text) {
  const normalized = String(text || '').toLowerCase()
  return normalized.match(/[\p{Script=Han}]|[a-z0-9_]+/gu) || []
}

function charNGrams(text, n = 2) {
  const normalized = String(text || '').toLowerCase().replace(/\s+/g, '')
  const grams = new Set()
  for (let i = 0; i + n <= normalized.length; i += 1) grams.add(normalized.slice(i, i + n))
  return grams
}

// ---------------------------------------------------------------------------
// Local reranker: BM25 (k1=1.5, b=0.75) + bigram overlap boost
// ---------------------------------------------------------------------------
function buildCorpus(passages) {
  const docs = passages.map((p) => tokenize(typeof p === 'string' ? p : p.text))
  const df = new Map()
  for (const tokens of docs) {
    const seen = new Set(tokens)
    for (const token of seen) df.set(token, (df.get(token) || 0) + 1)
  }
  const avgdl = docs.reduce((sum, tokens) => sum + tokens.length, 0) / Math.max(1, docs.length)
  return { docs, df, avgdl, N: docs.length }
}

function bm25Score(queryTokens, docTokens, corpus, k1 = 1.5, b = 0.75) {
  const tf = new Map()
  for (const token of docTokens) tf.set(token, (tf.get(token) || 0) + 1)
  let score = 0
  for (const token of queryTokens) {
    const freq = tf.get(token) || 0
    if (freq === 0) continue
    const idf = Math.log(1 + (corpus.N - (corpus.df.get(token) || 0) + 0.5) / ((corpus.df.get(token) || 0) + 0.5))
    const denom = freq + k1 * (1 - b + (b * docTokens.length) / Math.max(1, corpus.avgdl))
    score += (idf * freq * (k1 + 1)) / Math.max(1e-9, denom)
  }
  return score
}

function localRerank(query, passages, topK) {
  const queryTokens = tokenize(query)
  const queryGrams = charNGrams(query, 2)
  const corpus = buildCorpus(passages)
  const scored = passages.map((passage, index) => {
    const text = typeof passage === 'string' ? passage : passage.text
    const docTokens = tokenize(text)
    const bm25 = bm25Score(queryTokens, docTokens, corpus)
    const docGrams = charNGrams(text, 2)
    let overlap = 0
    for (const gram of queryGrams) if (docGrams.has(gram)) overlap += 1
    const gramScore = queryGrams.size === 0 ? 0 : overlap / queryGrams.size
    // Normalize BM25 to [0,1] via sigmoid; combine with bigram overlap.
    const normalized = 1 / (1 + Math.exp(-bm25 / Math.max(1, corpus.avgdl)))
    const score = FINITE(normalized * 0.6 + gramScore * 0.4)
    return { index, score, text }
  })
  return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, topK))
}

// ---------------------------------------------------------------------------
// HTTP helpers for external providers
// ---------------------------------------------------------------------------
async function postJson(url, headers, body, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => '')}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function cohereRerank(query, passages, topK, options) {
  const apiKey = options.apiKey || process.env.COHERE_API_KEY
  if (!apiKey) throw new Error('Cohere rerank requires apiKey (or COHERE_API_KEY)')
  const texts = passages.map((p) => (typeof p === 'string' ? p : p.text))
  const data = await postJson(
    options.endpoint || 'https://api.cohere.com/v1/rerank',
    { Authorization: `Bearer ${apiKey}` },
    { model: options.model || 'rerank-english-v3.0', query, documents: texts, top_n: Math.max(1, topK), return_documents: false },
  )
  const results = Array.isArray(data.results) ? data.results : []
  return results.map((r) => ({ index: Number(r.index), score: FINITE(Number(r.relevance_score)), text: texts[Number(r.index)] || '' }))
}

async function voyageRerank(query, passages, topK, options) {
  const apiKey = options.apiKey || process.env.VOYAGE_API_KEY
  if (!apiKey) throw new Error('Voyage rerank requires apiKey (or VOYAGE_API_KEY)')
  const texts = passages.map((p) => (typeof p === 'string' ? p : p.text))
  const data = await postJson(
    options.endpoint || 'https://api.voyageai.com/v1/rerank',
    { Authorization: `Bearer ${apiKey}` },
    { model: options.model || 'rerank-2', query, documents: texts, top_k: Math.max(1, topK) },
  )
  const results = Array.isArray(data.data) ? data.data : []
  return results.map((r) => ({ index: Number(r.index), score: FINITE(Number(r.relevance_score)), text: texts[Number(r.index)] || '' }))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a reranker instance.
 * @param {'local'|'cohere'|'voyage'} provider
 * @param {object} options - { apiKey, model, endpoint, fallbackToLocal=true }
 */
export function createReranker(provider = 'local', options = {}) {
  const name = String(provider || 'local').toLowerCase()
  if (!['local', 'cohere', 'voyage'].includes(name)) {
    throw new Error(`Unsupported rerank provider: ${provider}`)
  }
  return { provider: name, options: { ...options } }
}

/**
 * Rerank passages against a query.
 * @param {object} reranker - from createReranker()
 * @param {string} query
 * @param {Array<string|{text:string}>} passages
 * @param {number} [topK=8]
 * @returns {Promise<Array<{index:number, score:number, text:string}>>}
 */
export async function rerankPassages(reranker, query, passages, topK = 8) {
  const list = Array.isArray(passages) ? passages : []
  if (list.length === 0) return []
  const k = Math.min(Math.max(1, Number(topK) || 8), list.length)
  const provider = reranker?.provider || 'local'
  const options = reranker?.options || {}
  try {
    if (provider === 'cohere') return await cohereRerank(query, list, k, options)
    if (provider === 'voyage') return await voyageRerank(query, list, k, options)
    return localRerank(query, list, k)
  } catch (error) {
    if (options.fallbackToLocal === false) throw error
    // Degrade to local reranker so retrieval never hard-fails.
    return localRerank(query, list, k)
  }
}

export const __test__ = { tokenize, charNGrams, bm25Score, buildCorpus, localRerank }
