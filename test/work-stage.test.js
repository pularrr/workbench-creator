import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertToolAllowedForStage, getAllowedTools, getWorkStageInfo, setWorkStage } from '../src/work-stage.js'
import { WorkbenchRuntime } from '../src/core/runtime.js'
import { registerThesisPlugins } from '../src/plugins/thesis/index.js'

registerThesisPlugins()

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wb-stage-'))
  return { directory, runtime: new WorkbenchRuntime({ storagePath: path.join(directory, 'state.json') }) }
}

test('work stages default to design and expose distinct capabilities', async () => {
  const { directory, runtime } = await fixture()
  try {
    assert.equal((await getWorkStageInfo(runtime, 'stage-session')).stage, 'design')
    assert.ok(getAllowedTools('design').includes('wb_create_project'))
    assert.ok(getAllowedTools('design').includes('wb_generate_plugin_bundle'))
    assert.ok(!getAllowedTools('design').includes('wb_set_manuscript'))
    assert.ok(getAllowedTools('write').includes('wb_set_manuscript'))
    assert.ok(!getAllowedTools('review').includes('wb_set_manuscript'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('stage guards persist across runtime restarts', async () => {
  const { directory, runtime } = await fixture()
  try {
    const project = await runtime.createProject('stage-session', { name: 'Stage Project', taskType: 'thesis' })
    await assert.rejects(() => assertToolAllowedForStage(runtime, 'stage-session', 'wb_set_manuscript'), /design stage/)
    await setWorkStage(runtime, 'stage-session', 'write', { userConfirmed: true, reason: 'confirmed' })
    await assert.doesNotReject(() => assertToolAllowedForStage(runtime, 'stage-session', 'wb_set_manuscript'))
    const restarted = new WorkbenchRuntime({ storagePath: path.join(directory, 'state.json') })
    assert.equal((await getWorkStageInfo(restarted, 'stage-session')).stage, 'write')
    assert.equal((await restarted.getBoundProject('stage-session')).id, project.id)
    await setWorkStage(restarted, 'stage-session', 'review', { userConfirmed: true })
    await assert.rejects(() => assertToolAllowedForStage(restarted, 'stage-session', 'wb_restore_snapshot'), /review stage/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('write stage requires a bound project and explicit confirmation', async () => {
  const { directory, runtime } = await fixture()
  try {
    await assert.rejects(() => setWorkStage(runtime, 'empty-session', 'write', { userConfirmed: true }), /bound project/)
    await runtime.createProject('stage-session', { name: 'Stage Project', taskType: 'thesis' })
    await assert.rejects(() => setWorkStage(runtime, 'stage-session', 'write'), /explicit user confirmation/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
