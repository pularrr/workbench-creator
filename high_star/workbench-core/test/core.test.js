import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStateMachine, isTerminal } from '../src/core/state-machine.js'
import { registerPlugin, registerPluginBundle, listPlugins, listPluginBundles, resolvePluginBundle, listSupportedTaskTypes, generatePluginScaffold, validatePluginManifest, registerExporter, resolveExporter, listExporters } from '../src/core/plugin-loader.js'
import { thesisFramework } from '../src/plugins/thesis/framework.js'
import { thesisLogic } from '../src/plugins/thesis/logic.js'
import { thesisEvidence } from '../src/plugins/thesis/evidence.js'
import { patentFramework } from '../src/plugins/patent/framework.js'
import { patentLogic } from '../src/plugins/patent/logic.js'
import { patentEvidence } from '../src/plugins/patent/evidence.js'
import { registerThesisPlugins } from '../src/plugins/thesis/index.js'
import { analyzeTaskDescription } from '../src/generator.js'
import { createPluginBundleFromSpec, validatePluginSpec } from '../src/core/plugin-spec.js'
import { acquireServiceLock } from '../src/core/service-lock.js'
import { WorkbenchRuntime } from '../src/core/runtime.js'
import { createWorkbenchServer } from '../src/core/workbench-server.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('state machine: create and advance through happy path', () => {
  const sm = createStateMachine(thesisFramework.stateTable)
  const run = sm.createRun({ taskType: 'thesis' })
  assert.equal(run.state, 'created')
  assert.equal(sm.getRecommendedEvent('created'), 'start')

  const r1 = sm.advance(run, { expectedRevision: 0, event: 'start', summary: 'start' })
  assert.equal(r1.state, 'planning')
  assert.equal(sm.getRecommendedEvent('planning'), 'plan_ready')

  const r2 = sm.advance(r1, { expectedRevision: 1, event: 'plan_ready', summary: 'plan ready' })
  assert.equal(r2.state, 'awaiting_plan_confirmation')
})

test('Core service lock rejects a second runtime and recovers after release', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wb-lock-'))
  const lockPath = path.join(tmpDir, 'workbench.db.server.lock')
  try {
    const first = acquireServiceLock(lockPath, { storagePath: 'test.db' })
    assert.throws(() => acquireServiceLock(lockPath), (error) => error.code === 'WORKBENCH_CORE_ALREADY_RUNNING')
    first.release()
    const second = acquireServiceLock(lockPath, { storagePath: 'test.db' })
    second.release()
  } finally { await rm(tmpDir, { recursive: true, force: true }) }
})

test('Core service exposes health only after it is ready', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wb-health-'))
  const runtime = new WorkbenchRuntime({ storagePath: path.join(tmpDir, 'state.json') })
  const server = createWorkbenchServer(runtime, { port: 0, singleInstance: false })
  try {
    await server.ready
    const response = await fetch(`${server.url}/health`)
    const health = await response.json()
    assert.equal(response.status, 200)
    assert.equal(health.status, 'ready')
    assert.equal(health.service, 'workbench-core')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    runtime.close()
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test('Core HTTP API exposes page-direct RAG and retrieval configuration operations', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wb-page-api-'))
  const runtime = new WorkbenchRuntime({ storagePath: path.join(tmpDir, 'state.json') })
  const sessionId = 'page-direct-api'
  const server = createWorkbenchServer(runtime, { port: 0, singleInstance: false })
  try {
    await server.ready
    registerThesisPlugins()
    const project = await runtime.createProject(sessionId, { name: '页面直连测试', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)
    await runtime.setWorkStage(sessionId, 'write', { userConfirmed: true })
    const profilesResponse = await fetch(`${server.url}/api/retrieval/profiles`)
    const profiles = await profilesResponse.json()
    assert.ok(profilesResponse.ok)
    assert.ok(profiles.length > 0)
    const searchResponse = await fetch(`${server.url}/api/materials/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, query: '不存在的材料' }) })
    assert.deepEqual(await searchResponse.json(), [])
    const configureResponse = await fetch(`${server.url}/api/retrieval/configure`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, profileId: profiles[0].id, userConfirmed: true }) })
    const configured = await configureResponse.json()
    assert.ok(configureResponse.ok)
    assert.equal(configured.profile.id, profiles[0].id)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    runtime.close()
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test('state machine: invalid event rejected with guidance', () => {
  const sm = createStateMachine(thesisFramework.stateTable)
  const run = sm.createRun({ taskType: 'thesis' })
  sm.advance(run, { expectedRevision: 0, event: 'start' })
  assert.throws(
    () => sm.advance(run, { expectedRevision: 1, event: 'plan' }),
    /Invalid run event "plan"/
  )
})

test('state machine: auto-skip stages in standard mode', () => {
  const sm = createStateMachine(thesisFramework.stateTable)
  const run = sm.createRun({ taskType: 'thesis', mode: 'standard', skipStages: ['planning', 'awaiting_plan_confirmation'] })
  sm.advance(run, { expectedRevision: 0, event: 'start' })
  // After start, should auto-skip planning and awaiting_plan_confirmation
  assert.equal(run.state, 'retrieving')
  assert.ok(run.steps.some((s) => s.event === 'skipped'))
})

test('state machine: getEventGuidance returns recommendedNextEvent', () => {
  const sm = createStateMachine(thesisFramework.stateTable)
  const guidance = sm.getEventGuidance('planning')
  assert.equal(guidance.recommendedNextEvent, 'plan_ready')
  assert.ok(guidance.validEvents.includes('plan_ready'))
  assert.ok(guidance.guidance.includes('plan_ready'))
})

test('plugin loader: register and list thesis plugins', () => {
  registerPlugin(thesisFramework, 'framework')
  registerPlugin(thesisLogic, 'logic')
  registerPlugin(thesisEvidence, 'evidence')

  const frameworks = listPlugins('framework', 'thesis')
  assert.equal(frameworks.length, 1)
  assert.equal(frameworks[0].id, 'thesis-framework')

  const bundle = resolvePluginBundle('thesis')
  assert.ok(bundle.framework)
  assert.ok(bundle.logic)
  assert.ok(bundle.evidence)
  assert.equal(bundle.taskType, 'thesis')
})

test('plugin loader: register and list patent plugins', () => {
  registerPlugin(patentFramework, 'framework')
  registerPlugin(patentLogic, 'logic')
  registerPlugin(patentEvidence, 'evidence')

  const bundle = resolvePluginBundle('patent')
  assert.ok(bundle.framework)
  assert.equal(bundle.framework.id, 'patent-framework')

  const types = listSupportedTaskTypes()
  assert.ok(types.includes('thesis'))
  assert.ok(types.includes('patent'))
})

test('plugin loader: generatePluginScaffold creates valid structure', () => {
  const scaffold = generatePluginScaffold('contract', { name: 'Contract Workbench' })
  assert.equal(scaffold.taskType, 'contract')
  assert.ok(scaffold.framework.stateTable)
  assert.ok(scaffold.framework.defaultSkipStages)
  assert.equal(scaffold.logic.taskType, 'contract')
  assert.equal(scaffold.evidence.taskType, 'contract')
})

test('plugin loader: external bundle validates manifest and registers its three layers', () => {
  const manifest = { id: 'test-contract-workbench', taskType: 'test-contract', name: 'Test Contract', version: '1.0.0', apiVersion: 2, entry: './src/index.js' }
  assert.equal(validatePluginManifest(manifest).valid, true)
  registerPluginBundle({
    manifest,
    framework: { id: 'test-contract-framework', taskType: 'test-contract', name: 'Framework', stateTable: { created: { finish: 'completed' } } },
    logic: { id: 'test-contract-logic', taskType: 'test-contract', name: 'Logic' },
    evidence: { id: 'test-contract-evidence', taskType: 'test-contract', name: 'Evidence' },
  })
  assert.ok(resolvePluginBundle('test-contract').framework)
  assert.ok(listPluginBundles().some((bundle) => bundle.id === manifest.id))
})

test('plugin loader: task exporter can be registered and resolved', async () => {
  const exporter = { id: 'test-exporter', taskType: 'test-export', format: 'custom', name: 'Custom export', async export() { return { format: 'custom', content: 'ok' } } }
  registerExporter(exporter)
  assert.equal(resolveExporter('test-export', 'custom'), exporter)
  assert.ok(listExporters('test-export').some((item) => item.format === 'custom'))
})

test('plugin spec: JSON is sufficient to create a complete task bundle', async () => {
  const spec = {
    taskType: 'inspection-report', name: 'Inspection Report',
    documentSchema: { sections: [{ id: 'finding', title: '检查发现', objective: '说明检查事实' }], fields: { site: { label: '检查地点', type: 'text' } } },
    workflow: { stateTable: { created: { start: 'completed' } } },
    materialSchema: { supportedTypes: ['text'], roles: [] },
  }
  assert.equal(validatePluginSpec(spec).valid, true)
  const bundle = createPluginBundleFromSpec(spec)
  const outline = await bundle.framework.generateOutline({ targetWords: 800 })
  assert.equal(outline[0].title, '检查发现')
  assert.equal(bundle.framework.projectFieldSchema.site.label, '检查地点')
  assert.equal((await bundle.material.normalizeMaterial({ name: '记录.txt', type: 'text' })).type, 'text')
})

test('thesis framework: generateOutline returns valid structure', async () => {
  const outline = await thesisFramework.generateOutline({ targetWords: 30000 })
  assert.ok(Array.isArray(outline))
  assert.ok(outline.length >= 5)
  assert.ok(outline[0].title)
  assert.ok(outline[0].targetWords > 0)
  assert.equal(typeof outline[0].expectedFigures, 'number')
  assert.equal(typeof outline[0].expectedTables, 'number')
})

test('thesis framework v2 includes complete academic structure and degree scaling', async () => {
  const master = await thesisFramework.generateOutline({ targetWords: 32700, degreeType: 'master' })
  const doctor = await thesisFramework.generateOutline({ targetWords: 32700, degreeType: 'doctor' })
  const titles = master.map((node) => node.title)
  for (const title of ['中文摘要', 'Abstract', '绪论', '实验方案与数据处理', '实验结果与分析', '参考文献']) assert.ok(titles.includes(title))
  assert.ok(doctor.find((node) => node.id === 'ch3').targetWords > master.find((node) => node.id === 'ch3').targetWords)
  assert.equal(master.find((node) => node.id === 'refs').targetWords, 0)
})

test('thesis framework: validateOutline catches empty outline', async () => {
  const result = await thesisFramework.validateOutline([])
  assert.equal(result.valid, false)
  assert.ok(result.issues.some((i) => i.code === 'EMPTY_OUTLINE'))
})

test('patent framework: generateOutline has required sections', async () => {
  const outline = await patentFramework.generateOutline({})
  const titles = outline.map((n) => n.title)
  assert.ok(titles.some((t) => t.includes('权利要求')))
  assert.ok(titles.some((t) => t.includes('技术领域')))
  assert.ok(titles.some((t) => t.includes('背景技术')))
})

test('patent framework: validateOutline catches missing required sections', async () => {
  const result = await patentFramework.validateOutline([{ title: '概述' }])
  assert.equal(result.valid, false)
  assert.ok(result.issues.some((i) => i.code === 'MISSING_REQUIRED_SECTION'))
})

test('thesis evidence: formatCitation GB/T 7714', async () => {
  const citation = await thesisEvidence.formatCitation({
    authors: ['张三', '李四'],
    title: '毫米波雷达水分检测方法研究',
    type: 'journal',
    venue: '电子学报',
    year: '2024',
    volume: '52',
    issue: '3',
    pages: '100-110',
  })
  assert.ok(citation.includes('张三'))
  assert.ok(citation.includes('[J]'))
  assert.ok(citation.includes('2024'))
})

test('patent evidence: formatCitation patent format', async () => {
  const citation = await patentEvidence.formatCitation({
    type: 'patent',
    country: 'CN',
    patentNumber: '110000000',
    kind: 'A',
    title: '一种毫米波雷达水分检测装置',
    assignee: '某公司',
    date: '2024-01-01',
  })
  assert.ok(citation.includes('CN110000000A'))
})

test('generator: analyzeTaskDescription detects thesis', () => {
  const result = analyzeTaskDescription('帮我写一篇硕士学位论文，关于毫米波雷达')
  assert.equal(result.detectedType, 'thesis')
  assert.ok(result.confidence > 0)
})

test('generator: analyzeTaskDescription detects patent', () => {
  const result = analyzeTaskDescription('帮我写一个发明专利申请，关于一种新的检测装置')
  assert.equal(result.detectedType, 'patent')
})

test('generator: analyzeTaskDescription falls back to generic', () => {
  const result = analyzeTaskDescription('帮我写点东西')
  assert.equal(result.detectedType, 'generic')
})

test('state machine: terminal states cannot advance', () => {
  const sm = createStateMachine(thesisFramework.stateTable)
  const run = sm.createRun({ taskType: 'thesis' })
  run.state = 'completed'
  assert.throws(
    () => sm.advance(run, { expectedRevision: 0, event: 'start' }),
    /cannot advance from completed/
  )
  assert.ok(isTerminal('completed'))
  assert.ok(isTerminal('cancelled'))
  assert.ok(!isTerminal('planning'))
})

test('state machine: revision conflict detection', () => {
  const sm = createStateMachine(thesisFramework.stateTable)
  const run = sm.createRun({ taskType: 'thesis' })
  assert.throws(
    () => sm.advance(run, { expectedRevision: 99, event: 'start' }),
    /revision conflict/
  )
})
