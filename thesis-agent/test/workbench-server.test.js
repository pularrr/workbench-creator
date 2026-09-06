import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ThesisDomainStore } from '../src/domain-store.js'
import { startWorkbenchServer } from '../src/workbench-server.js'

test('serves the P1 workbench and project API on localhost', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'thesis-workbench-'))
  const store = new ThesisDomainStore(directory)
  await store.initialize()
  const workbench = startWorkbenchServer(store, { port: 0 })
  await workbench.ready
  context.after(() => workbench.close())
  const page = await fetch(workbench.url).then((response) => response.text())
  assert.match(page, /论文写作工作台/)
  assert.match(page, /id="editor"/)
  assert.match(page, /LaTeX\/PDF/)
  assert.match(page, /Embedding 模型/)
  assert.match(page, /新建受控生成任务/)
  const created = await fetch(`${workbench.url}/api/projects`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'ui-test', name: '界面项目' }),
  }).then((response) => response.json())
  assert.equal(created.name, '界面项目')
  const projects = await fetch(`${workbench.url}/api/projects`).then((response) => response.json())
  assert.equal(projects.length, 1)
  const run = await fetch(`${workbench.url}/api/agent-run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'ui-test', reviewEnabled: true }),
  }).then((response) => response.json())
  assert.equal(run.state, 'created')
  const embedding = await fetch(`${workbench.url}/api/embedding-test`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'ui-test', config: { type: 'local-hash' } }),
  }).then((response) => response.json())
  assert.equal(embedding.dimensions, 192)
})
