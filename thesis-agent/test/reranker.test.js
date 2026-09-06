import assert from 'node:assert/strict'
import test from 'node:test'
import { createReranker, rerankPassages, __test__ } from '../src/reranker.js'

const PASSAGES = [
  '毫米波雷达通过发射调频连续波信号感知物料的介电常数变化，从而反演水分含量。',
  '烟草加工过程中，水分含量是影响烟叶品质和卷制质量的关键工艺参数。',
  '近红外光谱技术利用水分子在特定波长的吸收峰来快速测定样品水分。',
  '计算机视觉系统通过采集物料表面图像，结合机器学习算法识别缺陷和分类。',
  '卡尔费休滴定法是实验室测定微量水分的经典化学方法，精度高但耗时。',
]

test('local reranker returns finite scores and correct count', async () => {
  const reranker = createReranker('local')
  const results = await rerankPassages(reranker, '雷达 水分 检测', PASSAGES, 3)
  assert.equal(results.length, 3)
  for (const r of results) {
    assert.equal(typeof r.index, 'number')
    assert.equal(typeof r.score, 'number')
    assert.ok(Number.isFinite(r.score), 'score must be finite')
    assert.ok(r.score >= 0, 'score must be non-negative')
    assert.equal(typeof r.text, 'string')
  }
})

test('local reranker ranks radar+moisture passage highest for relevant query', async () => {
  const reranker = createReranker('local')
  const results = await rerankPassages(reranker, '毫米波雷达 水分含量 检测', PASSAGES, 5)
  // The first passage is about radar + moisture; it should rank in top 2.
  const topIndexes = results.slice(0, 2).map((r) => r.index)
  assert.ok(topIndexes.includes(0), `radar+moisture passage should be in top 2, got ${JSON.stringify(topIndexes)}`)
})

test('local reranker is deterministic', async () => {
  const reranker = createReranker('local')
  const a = await rerankPassages(reranker, '雷达 水分', PASSAGES, 5)
  const b = await rerankPassages(reranker, '雷达 水分', PASSAGES, 5)
  assert.deepEqual(a.map((r) => r.index), b.map((r) => r.index))
})

test('empty passages returns empty array', async () => {
  const reranker = createReranker('local')
  const results = await rerankPassages(reranker, 'query', [], 5)
  assert.deepEqual(results, [])
})

test('unsupported provider throws', () => {
  assert.throws(() => createReranker('unknown-provider'), /Unsupported rerank provider/)
})

test('cohere provider without apiKey degrades to local (fallback default)', async () => {
  const reranker = createReranker('cohere', { apiKey: undefined })
  const results = await rerankPassages(reranker, '雷达', PASSAGES, 3)
  assert.equal(results.length, 3)
  assert.ok(results.every((r) => Number.isFinite(r.score)))
})

test('cohere provider with fallbackToLocal=false throws without apiKey', async () => {
  const reranker = createReranker('cohere', { apiKey: undefined, fallbackToLocal: false })
  await assert.rejects(() => rerankPassages(reranker, '雷达', PASSAGES, 3), /apiKey/)
})

test('BM25 score is finite for all passages', () => {
  const { tokenize, buildCorpus, bm25Score } = __test__
  const corpus = buildCorpus(PASSAGES)
  const queryTokens = tokenize('雷达 水分 检测')
  for (const passage of PASSAGES) {
    const score = bm25Score(queryTokens, tokenize(passage), corpus)
    assert.ok(Number.isFinite(score), `BM25 score must be finite, got ${score}`)
  }
})

test('rerank scores pass lossless JSON check (no NaN/Infinity)', async () => {
  const { isLosslessJson } = await import('../src/lossless.js')
  const reranker = createReranker('local')
  const results = await rerankPassages(reranker, '雷达 水分 检测', PASSAGES, 5)
  assert.ok(isLosslessJson(results), 'rerank results must be lossless JSON')
})
