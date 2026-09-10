import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WorkbenchRuntime } from '../src/core/runtime.js'
import { registerThesisPlugins } from '../src/plugins/thesis/index.js'

registerThesisPlugins()

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wb-persist-'))
  const storagePath = path.join(directory, 'state.json')
  return { directory, storagePath, runtime: new WorkbenchRuntime({ storagePath, ...options }) }
}

test('assistant binding resumes a project under a new DSH session', async () => {
  const { directory, storagePath, runtime } = await fixture()
  try {
    const assistantKey = 'web:text-workbench-assistant-v0'
    const project = await runtime.createProject('old-session', { name: 'Long-lived Project', taskType: 'thesis', assistantKey })
    await runtime.storage.setWorkStage('old-session', 'write', { assistantKey, userConfirmed: true })
    const restarted = new WorkbenchRuntime({ storagePath })
    const available = await restarted.getResumeState('new-session', assistantKey)
    assert.equal(available.source, 'assistant')
    assert.equal(available.project.id, project.id)
    assert.equal(available.stage, 'write')
    const resumed = await restarted.resumeProject('new-session', assistantKey)
    assert.equal(resumed.project.id, project.id)
    assert.equal(resumed.stage, 'write')
    assert.equal((await restarted.getBoundProject('new-session')).id, project.id)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('eleventh project requires confirmation then archives the oldest project', async () => {
  const { directory, runtime } = await fixture()
  try {
    let oldest
    for (let index = 0; index < 10; index += 1) {
      const project = await runtime.createProject(`session-${index}`, { name: `Project ${index}`, taskType: 'thesis' })
      if (index === 0) oldest = project
    }
    const limit = await runtime.getProjectLimit()
    assert.equal(limit.activeCount, 10)
    assert.equal(limit.evictionCandidate.id, oldest.id)
    await assert.rejects(
      () => runtime.createProject('session-10', { name: 'Project 10', taskType: 'thesis' }),
      (error) => error.code === 'PROJECT_LIMIT_CONFIRMATION_REQUIRED' && error.evictionCandidate.id === oldest.id,
    )
    const created = await runtime.createProject('session-10', { name: 'Project 10', taskType: 'thesis', confirmedEviction: true })
    assert.equal(created.evictedProject.id, oldest.id)
    assert.equal((await runtime.listProjects()).length, 10)
    assert.equal((await runtime.listArchivedProjects())[0].id, oldest.id)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('storage recovers from a valid backup instead of replacing corrupted data', async () => {
  const { directory, storagePath, runtime } = await fixture()
  try {
    const project = await runtime.createProject('session', { name: 'Recoverable', taskType: 'thesis' })
    await runtime.bindProject('session', project.id)
    await writeFile(storagePath, '{broken', 'utf8')
    const recovered = new WorkbenchRuntime({ storagePath })
    assert.equal((await recovered.listProjects())[0].id, project.id)
    const repaired = await readFile(storagePath, 'utf8')
    assert.doesNotThrow(() => JSON.parse(repaired))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('run advancement is idempotent and keeps a durable checkpoint', async () => {
  const { directory, storagePath, runtime } = await fixture()
  try {
    await runtime.createProject('session', { name: 'Run Project', taskType: 'thesis' })
    const run = await runtime.createRun('session')
    const input = { runId: run.id, expectedRevision: run.revision, event: run.recommendedNextEvent, idempotencyKey: 'step-1', checkpoint: { materialIds: ['m1'] } }
    const advanced = await runtime.advanceRun('session', input)
    const repeated = await runtime.advanceRun('session', input)
    assert.equal(repeated.revision, advanced.revision)
    const restarted = new WorkbenchRuntime({ storagePath })
    const restored = await restarted.getRun('session', run.id)
    assert.deepEqual(restored.checkpoint, { materialIds: ['m1'] })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('stale manuscript writes cannot overwrite a newer project revision', async () => {
  const { directory, runtime } = await fixture()
  try {
    const project = await runtime.createProject('session', { name: 'Revision Project', taskType: 'thesis' })
    const first = await runtime.setManuscriptBlocks('session', { expectedRevision: project.revision, blocks: [{ id: 'b1', markdown: 'first' }] })
    assert.ok(first.revision > project.revision)
    await assert.rejects(
      () => runtime.setManuscriptBlocks('session', { expectedRevision: project.revision, blocks: [{ id: 'b1', markdown: 'stale' }] }),
      /revision conflict/,
    )
    assert.equal((await runtime.getBoundProject('session')).manuscriptBlocks[0].markdown, 'first')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
