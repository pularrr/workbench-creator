import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply } from '../src/index.js'

async function createHarness() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-follow-'))
  const definitions = new Map()
  const ctx = {
    tools: {
      register(definition) {
        definitions.set(definition.name, definition)
        return () => definitions.delete(definition.name)
      },
    },
  }
  await apply(ctx, { dataDir, enableWorkbench: false })
  const execA = { agent: { session: { id: 'session-follow-a' } } }
  const execB = { agent: { session: { id: 'session-follow-b' } } }
  const call = (def, args, exec) => defsExecute(definitions.get(def), args, exec)
  return { dataDir, definitions, execA, execB, call }
}

async function defsExecute(def, args, exec) {
  const result = await def.execute(args, exec)
  return result.data
}

test('create_project result carries workbenchUrl', async () => {
  const { call, execA } = await createHarness()
  const created = await call('thesis_create_project', { name: '跟随测试' }, execA)
  assert.ok(created.workbenchUrl.startsWith('http://127.0.0.1:3199'))
  assert.ok(created.id)
  assert.equal(created.name, '跟随测试')
})

test('get_workbench result carries workbenchUrl', async () => {
  const { call, execA } = await createHarness()
  await call('thesis_create_project', { name: '工作台URL测试' }, execA)
  const wb = await call('thesis_get_workbench', {}, execA)
  assert.equal(wb.workbenchUrl, 'http://127.0.0.1:3199')
})

test('followRecentProject binds an unbound session to the latest project', async () => {
  const { call, execA, execB } = await createHarness()
  await call('thesis_create_project', { name: '项目一' }, execA)
  const bound = await call('thesis_follow_recent_project', {}, execB)
  assert.equal(bound.bound, true)
  assert.equal(bound.autoBound, true)
  assert.equal(bound.name, '项目一')
  // second call keeps the same binding, no rebind
  const again = await call('thesis_follow_recent_project', {}, execB)
  assert.equal(again.bound, true)
  assert.equal(again.autoBound, false)
  assert.equal(again.id, bound.id)
})

test('followRecentProject binds the most recently updated project', async () => {
  const { call, execA } = await createHarness()
  await call('thesis_create_project', { name: '旧项目' }, execA)
  await call('thesis_create_project', { name: '新项目' }, execA)
  const bound = await call('thesis_follow_recent_project', {}, { agent: { session: { id: 'session-fresh' } } })
  assert.equal(bound.name, '新项目')
})

test('followRecentProject returns bound:false when no projects exist', async () => {
  const { call } = await createHarness()
  const bound = await call('thesis_follow_recent_project', {}, { agent: { session: { id: 'session-empty' } } })
  assert.equal(bound.bound, false)
})

test('thesis_open_workbench returns URL, status, and instructions', async () => {
  const { call, execA } = await createHarness()
  await call('thesis_create_project', { name: '打开测试' }, execA)
  const result = await call('thesis_open_workbench', {}, execA)
  assert.equal(result.workbenchUrl, 'http://127.0.0.1:3199')
  // test harness uses enableWorkbench:false to avoid port conflicts
  assert.equal(result.serverRunning, false)
  assert.ok(result.project)
  assert.equal(result.project.name, '打开测试')
  assert.ok(Array.isArray(result.instructions))
  assert.ok(result.instructions.length >= 3)
  assert.ok(result.hint)
})

test('requestRegeneration creates pending request and getWorkbench includes it', async () => {
  const { call, execA } = await createHarness()
  await call('thesis_create_project', { name: '重生成测试' }, execA)
  const req = await call('thesis_request_regeneration', { blockId: 'blk-1', content: '修改后的段落', instruction: '重新生成这段' }, execA)
  assert.equal(req.status, 'pending')
  assert.equal(req.blockId, 'blk-1')
  assert.equal(req.content, '修改后的段落')
  const wb = await call('thesis_get_workbench', {}, execA)
  assert.ok(Array.isArray(wb.regenerationRequests))
  assert.equal(wb.regenerationRequests.length, 1)
  assert.equal(wb.regenerationRequests[0].id, req.id)
})

test('listRegenerationRequests returns only pending, resolve marks completed', async () => {
  const { call, execA } = await createHarness()
  await call('thesis_create_project', { name: '重生成列表测试' }, execA)
  const req = await call('thesis_request_regeneration', { content: 'test' }, execA)
  const list = await call('thesis_list_regeneration_requests', {}, execA)
  assert.equal(list.length, 1)
  const resolved = await call('thesis_resolve_regeneration', { requestId: req.id, status: 'completed' }, execA)
  assert.equal(resolved.status, 'completed')
  const listAfter = await call('thesis_list_regeneration_requests', {}, execA)
  assert.equal(listAfter.length, 0)
})
