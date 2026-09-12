import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { chunkText, createOpenAICompatibleEmbeddingProvider, reciprocalRankFusion, RetrievalService } from '../src/services/retrieval-service.js'

test('structured chunker preserves Chinese heading and source lines', () => {
  const chunks = chunkText('# 方法\n毫米波雷达用于水分检测。\n\n## 实验\n样品共 20 组。', { maxChars: 300 })
  assert.equal(chunks.length, 2)
  assert.deepEqual(chunks[0].locator.headingPath, ['方法'])
  assert.deepEqual(chunks[1].locator.headingPath, ['方法', '实验'])
  assert.equal(chunks[0].locator.startLine, 1)
  assert.equal(chunks[0].locator.endLine, 3)
  assert.equal(chunks[1].locator.endLine, 5)
  assert.match(chunks[0].contentSha256, /^sha256:[a-f0-9]{64}$/)
})

test('RRF keeps keyword and dense ranks explainable', () => {
  const first = { id: 'a', content: '雷达' }; const second = { id: 'b', content: '水分' }
  const results = reciprocalRankFusion([
    [{ chunk: first, keywordScore: 1 }, { chunk: second, keywordScore: 0.5 }],
    [{ chunk: second, denseScore: 0.9 }, { chunk: first, denseScore: 0.8 }],
  ])
  assert.equal(results.length, 2)
  assert.equal(results[0].keywordRank, 1)
  assert.equal(results[0].denseRank, 2)
  assert.ok(results.every((item) => item.rrfScore > 0))
})

let received = null
const server = http.createServer((request, response) => {
  let body = ''
  request.on('data', (part) => { body += part })
  request.on('end', () => {
    received = { url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: [{ index: 1, embedding: [0, 1, 0, 0] }, { index: 0, embedding: [1, 0, 0, 0] }] }))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
after(() => new Promise((resolve) => server.close(resolve)))
const port = server.address().port

test('OpenAI-compatible provider batches, sorts response rows, and never exposes key in results', async () => {
  const provider = createOpenAICompatibleEmbeddingProvider({ endpoint: `http://127.0.0.1:${port}`, model: 'test-embedding', dimensions: 4, apiKey: 'test-key', maxRetries: 0 })
  const vectors = await provider.embedDocuments(['第一段', '第二段'])
  assert.deepEqual(vectors, [[1, 0, 0, 0], [0, 1, 0, 0]])
  assert.equal(received.url, '/embeddings')
  assert.equal(received.body.dimensions, 4)
  assert.equal(received.authorization, 'Bearer test-key')
})

test('configured provider failure falls back to hash embeddings during indexing', async () => {
  const service = new RetrievalService({ embedding: { type: 'openai-compatible', endpoint: 'http://127.0.0.1:1', model: 'unavailable', dimensions: 4, apiKey: 'not-used', timeoutMs: 1000, maxRetries: 0 } })
  const indexed = await service.indexChunks(chunkText('中文资料可以在离线模式下检索。'))
  assert.equal(indexed[0].embeddingMeta.provider, 'hash')
  assert.match(indexed[0].embeddingMeta.fallbackReason, /Embedding request failed/)
})
