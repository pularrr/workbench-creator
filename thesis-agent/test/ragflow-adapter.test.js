import assert from 'node:assert/strict'
import test from 'node:test'
import { createRagflowAdapter } from '../src/ragflow-adapter.js'

test('createRagflowAdapter defaults to local backend', () => {
  const adapter = createRagflowAdapter()
  assert.equal(adapter.backend, 'local')
})

test('createRagflowAdapter with backend=ragflow', () => {
  const adapter = createRagflowAdapter({ backend: 'ragflow', endpoint: 'http://localhost:9380' })
  assert.equal(adapter.backend, 'ragflow')
})

test('local backend createCollection', async () => {
  const adapter = createRagflowAdapter()
  const result = await adapter.createCollection('test-collection')
  assert.equal(result.collectionId, 'test-collection')
  assert.equal(result.created, true)
  assert.equal(result.backend, 'local')
})

test('local backend addDocuments and search', async () => {
  const adapter = createRagflowAdapter()
  await adapter.createCollection('search-test')
  const docs = [
    { id: 'd1', name: '雷达论文', content: '毫米波雷达通过发射调频连续波信号感知物料的介电常数变化，从而反演水分含量。烟草加工过程中水分含量是关键参数。' },
    { id: 'd2', name: '近红外论文', content: '近红外光谱技术利用水分子在特定波长的吸收峰来快速测定样品水分。该方法无损且速度快。' },
    { id: 'd3', name: '计算机视觉', content: '计算机视觉系统通过采集物料表面图像，结合机器学习算法识别缺陷和分类。与水分检测无关。' },
  ]
  const addResult = await adapter.addDocuments('search-test', docs, { chunkSize: 200, chunkOverlap: 20 })
  assert.ok(addResult.added > 0)
  assert.equal(addResult.collectionId, 'search-test')

  const searchResult = await adapter.search('search-test', '雷达 水分 检测', { topK: 3 })
  assert.equal(searchResult.backend, 'local')
  assert.ok(searchResult.results.length > 0)
  assert.ok(searchResult.results.length <= 3)
  for (const r of searchResult.results) {
    assert.equal(typeof r.text, 'string')
    assert.ok(Number.isFinite(r.score))
  }
})

test('local backend search ranks relevant results higher', async () => {
  const adapter = createRagflowAdapter()
  await adapter.createCollection('rank-test')
  const docs = [
    { id: 'd1', name: '雷达', content: '毫米波雷达检测烟草水分含量的研究。FMCW雷达发射信号。' },
    { id: 'd2', name: '无关', content: '今天天气很好，适合出去散步。美食推荐。' },
  ]
  await adapter.addDocuments('rank-test', docs, { chunkSize: 100, chunkOverlap: 0 })
  const result = await adapter.search('rank-test', '雷达 烟草 水分', { topK: 2 })
  assert.ok(result.results.length >= 1)
  // The radar document should rank higher
  const topResult = result.results[0]
  assert.ok(topResult.text.includes('雷达') || topResult.text.includes('烟草') || topResult.text.includes('水分'))
})

test('local backend getCollectionStats', async () => {
  const adapter = createRagflowAdapter()
  await adapter.createCollection('stats-test')
  await adapter.addDocuments('stats-test', [{ id: 'd1', content: 'test content' }], { chunkSize: 50 })
  const stats = await adapter.getCollectionStats('stats-test')
  assert.equal(stats.exists, true)
  assert.ok(stats.chunkCount > 0)
})

test('local backend getCollectionStats for missing collection', async () => {
  const adapter = createRagflowAdapter()
  const stats = await adapter.getCollectionStats('nonexistent')
  assert.equal(stats.exists, false)
})

test('local backend deleteCollection', async () => {
  const adapter = createRagflowAdapter()
  await adapter.createCollection('delete-test')
  const result = await adapter.deleteCollection('delete-test')
  assert.equal(result.deleted, true)
  const stats = await adapter.getCollectionStats('delete-test')
  assert.equal(stats.exists, false)
})

test('local backend healthCheck', async () => {
  const adapter = createRagflowAdapter()
  const health = await adapter.healthCheck()
  assert.equal(health.healthy, true)
  assert.equal(health.backend, 'local')
})

test('local backend with rerank', async () => {
  const adapter = createRagflowAdapter({ rerank: { provider: 'local', topK: 3 } })
  await adapter.createCollection('rerank-test')
  await adapter.addDocuments('rerank-test', [
    { id: 'd1', content: '毫米波雷达检测水分。雷达信号处理。' },
    { id: 'd2', content: '今天天气好。美食。旅游。' },
  ], { chunkSize: 80 })
  const result = await adapter.search('rerank-test', '雷达 水分', { topK: 3 })
  assert.ok(result.results.length > 0)
  assert.equal(result.reranked, true)
  for (const r of result.results) {
    assert.ok(Number.isFinite(r.rerankScore))
  }
})

test('adapter search results are lossless JSON', async () => {
  const { isLosslessJson } = await import('../src/lossless.js')
  const adapter = createRagflowAdapter()
  await adapter.createCollection('lossless-test')
  await adapter.addDocuments('lossless-test', [{ id: 'd1', content: 'test' }], { chunkSize: 50 })
  const result = await adapter.search('lossless-test', 'test', { topK: 5 })
  assert.ok(isLosslessJson(result), 'search result must be lossless JSON')
})
