import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmbeddingProvider, embedInBatches } from '../src/embedding-provider.js'

test('local embedding provider batches deterministically', async () => {
  const provider = createEmbeddingProvider({ type: 'local-hash' })
  const vectors = await embedInBatches(provider, ['论文检索', '论文检索', '实验结果'], 2)
  assert.equal(vectors.length, 3)
  assert.deepEqual(vectors[0], vectors[1])
  assert.equal(vectors[0].length, 192)
})
