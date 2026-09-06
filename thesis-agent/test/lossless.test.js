import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply } from '../src/index.js'
import { isLosslessJson, toLosslessJson } from '../src/lossless.js'

test('toLosslessJson sanitizes every value that breaks the Harness bridge', () => {
  assert.equal(toLosslessJson(NaN), 0)
  assert.equal(toLosslessJson(Infinity), 0)
  assert.equal(toLosslessJson(-Infinity), 0)
  assert.equal(toLosslessJson(-0), 0)
  assert.equal(toLosslessJson(42), 42)
  assert.equal(toLosslessJson(undefined), undefined)
  assert.equal(toLosslessJson(() => {}), undefined)
  assert.equal(toLosslessJson(Symbol('x')), undefined)
  assert.equal(toLosslessJson(10n), undefined)
  assert.deepEqual(toLosslessJson({ a: 1, b: undefined, c: NaN }), { a: 1, c: 0 })
  assert.deepEqual(toLosslessJson([1, undefined, NaN]), [1, 0])
  assert.deepEqual(toLosslessJson({ m: new Map([['k', 1]]) }), {}) // non-plain dropped
  // circular reference must not hang or crash
  const circular = { name: 'x' }
  circular.self = circular
  assert.deepEqual(toLosslessJson(circular), { name: 'x' })
  // dense lossless arrays survive unchanged
  const dense = [{ id: 'a', score: 0.5 }, { id: 'b', score: 0.2 }]
  assert.deepEqual(toLosslessJson(dense), dense)
})

test('every registered thesis tool result passes the lossless-JSON boundary', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-thesis-lossless-'))
  const definitions = new Map()
  const ctx = { tools: { register(d) { definitions.set(d.name, d); return () => definitions.delete(d.name) } } }
  await apply(ctx, { dataDir })
  const exec = { agent: { session: { id: 'session-lossless' } } }

  // The workbench data link that previously broke the bridge.
  const created = await definitions.get('thesis_create_project').execute({ name: '回归验证' }, exec)
  assert.equal(isLosslessJson(created), true, 'thesis_create_project result is not lossless')
  assert.ok(!('apiKey' in created.data.embeddingConfig), 'embeddingConfig must not leak an apiKey field')

  const wb = await definitions.get('thesis_get_workbench').execute({}, exec)
  assert.equal(isLosslessJson(wb), true, 'thesis_get_workbench result is not lossless')
  assert.ok(!('apiKey' in wb.data.embeddingConfig), 'workbench embeddingConfig must not leak an apiKey field')

  const plan = await definitions.get('thesis_set_plan').execute({
    expectedRevision: 0,
    confirmed: false,
    outline: [{ title: '绪论', logic: [{ purpose: '引出问题' }] }],
  }, exec)
  assert.equal(isLosslessJson(plan), true, 'thesis_set_plan result is not lossless')

  // Array-returning tools must also cross the boundary losslessly.
  const outlineId = plan.data.outline[0].id
  await definitions.get('thesis_set_manuscript_blocks').execute({
    expectedRevision: 0,
    blocks: [{ id: 'b1', outlineNodeId: outlineId, logicBlockIds: [], markdown: '雷达检测。', type: 'paragraph' }],
  }, exec)
  const located = await definitions.get('thesis_locate_blocks_for_logic').execute({ logicBlockId: plan.data.logicBlocks[0].id }, exec)
  assert.equal(isLosslessJson(located), true, 'thesis_locate_blocks_for_logic (array) result is not lossless')

  const search = await definitions.get('thesis_search_sources').execute({ query: '雷达' }, exec)
  assert.equal(isLosslessJson(search), true, 'thesis_search_sources result is not lossless')

  const refs = await definitions.get('thesis_format_references').execute({ style: 'gb-t-7714' }, exec)
  assert.equal(isLosslessJson(refs), true, 'thesis_format_references (array) result is not lossless')
})
