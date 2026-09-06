import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Document, Packer, Paragraph } from 'docx'

import { WorkbenchRuntime } from '../src/core/runtime.js'
import { registerThesisPlugins } from '../src/plugins/thesis/index.js'
import { registerPatentPlugins } from '../src/plugins/patent/index.js'
import { generatePluginBundle, analyzeTaskDescription, verifyGeneratedPluginBundle } from '../src/generator.js'

// Register plugins before tests
registerThesisPlugins()
registerPatentPlugins()

async function makeRuntime() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wb-e2e-'))
  const storagePath = path.join(tmpDir, 'state.json')
  const runtime = new WorkbenchRuntime({ storagePath })
  return { runtime, tmpDir }
}

async function cleanup(tmpDir) {
  await rm(tmpDir, { recursive: true, force: true })
}

// ─── End-to-End: Thesis Project Full Lifecycle ────────────────────────────

test('e2e: thesis project full lifecycle (create → bind → outline → run → advance)', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-thesis'

  try {
    // 1. Create project
    const project = await runtime.createProject(sessionId, {
      name: '毫米波雷达水分检测研究',
      taskType: 'thesis',
      title: '面向工业烟草水分在线检测的毫米波雷达信号建模与水分反演方法研究',
      targetWords: 30000,
    })
    assert.ok(project.id, 'project should have id')
    assert.equal(project.taskType, 'thesis')
    assert.ok(project.outline && project.outline.length >= 5, 'auto-generated outline should exist')

    // 2. Bind project
    const bound = await runtime.bindProject(sessionId, project.id)
    assert.equal(bound.projectId, project.id)

    // 3. Get workbench state
    const wb = await runtime.getWorkbench(sessionId)
    assert.ok(wb.project, 'workbench should have project')
    assert.equal(wb.project.id, project.id)
    assert.ok(wb.bundle, 'workbench should have plugin bundle')
    assert.equal(wb.bundle.taskType, 'thesis')
    assert.ok(wb.bundle.framework, 'bundle should have framework plugin')
    assert.ok(wb.bundle.logic, 'bundle should have logic plugin')
    assert.ok(wb.bundle.evidence, 'bundle should have evidence plugin')

    // 4. Set outline (confirmed)
    const outline = [
      { id: 'ch1', title: '绪论', objective: '研究背景与意义', targetWords: 6000, order: 0, expectedFigures: 2, expectedTables: 1 },
      { id: 'ch2', title: '相关理论基础', objective: '毫米波雷达原理', targetWords: 8000, order: 1, expectedFigures: 4, expectedTables: 2 },
      { id: 'ch3', title: '系统设计与方法', objective: '硬件与算法设计', targetWords: 10000, order: 2, expectedFigures: 6, expectedTables: 3 },
    ]
    const wbAfterOutline = await runtime.setOutline(sessionId, { outline, confirmed: true })
    assert.equal(wbAfterOutline.project.status, 'ready_to_generate')
    assert.ok(wbAfterOutline.logicBlocks && wbAfterOutline.logicBlocks.length > 0, 'logic blocks should be auto-generated')
    assert.ok(wbAfterOutline.logicBlocks[0].purpose, 'logic block should have purpose')

    // 5. Create run (standard mode, auto-skips planning)
    const run = await runtime.createRun(sessionId, { mode: 'standard', reviewEnabled: true })
    assert.ok(run.id, 'run should have id')
    assert.equal(run.state, 'created')
    assert.ok(run.recommendedNextEvent, 'run should have recommendedNextEvent')
    assert.equal(run.recommendedNextEvent, 'start')

    // 6. Advance run with recommendedNextEvent (start → auto-skip planning → retrieving)
    const advanced = await runtime.advanceRun(sessionId, {
      runId: run.id,
      expectedRevision: run.revision,
      event: run.recommendedNextEvent, // 'start'
      summary: '启动生成任务',
    })
    assert.ok(advanced.state, 'advanced run should have state')
    assert.ok(advanced.recommendedNextEvent, 'advanced run should have next recommended event')
    // In standard mode, after start it should auto-skip to retrieving
    assert.ok(['retrieving', 'planning'].includes(advanced.state), `state should be retrieving or planning, got ${advanced.state}`)

    // 7. Get run and verify recommendedNextEvent is usable
    const runDetail = await runtime.getRun(sessionId, run.id)
    assert.ok(runDetail.recommendedNextEvent, 'run detail should have recommendedNextEvent')
    assert.ok(runDetail.validEvents && runDetail.validEvents.length > 0, 'run detail should have validEvents list')
    assert.ok(runDetail.validEvents.includes(runDetail.recommendedNextEvent), 'recommendedNextEvent should be in validEvents')

    // 8. Cancel run
    const cancelled = await runtime.cancelRun(sessionId, { runId: run.id, expectedRevision: runDetail.revision })
    assert.equal(cancelled.state, 'cancelled')

    console.log('  ✅ thesis lifecycle: create → bind → outline → run → advance → cancel')
  } finally {
    await cleanup(tmpDir)
  }
})

// ─── End-to-End: Patent Project Full Lifecycle ─────────────────────────────

test('e2e: patent project full lifecycle (different state machine, different outline)', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-patent'

  try {
    // 1. Create patent project
    const project = await runtime.createProject(sessionId, {
      name: '一种毫米波雷达水分检测装置',
      taskType: 'patent',
      patentType: 'invention',
    })
    assert.equal(project.taskType, 'patent')
    assert.ok(project.outline && project.outline.length >= 6, 'patent outline should have required sections')
    const titles = project.outline.map((n) => n.title)
    assert.ok(titles.some((t) => t.includes('权利要求')), 'patent outline should include claims section')

    // 2. Bind and get workbench
    await runtime.bindProject(sessionId, project.id)
    const wb = await runtime.getWorkbench(sessionId)
    assert.equal(wb.bundle.taskType, 'patent')
    assert.equal(wb.bundle.framework.id, 'patent-framework')
    assert.equal(wb.ui.outlineLabel, '专利结构')
    await runtime.setDomainFields(sessionId, { patentType: 'invention', applicant: '测试申请人' })
    const material = await runtime.addMaterial(sessionId, { name: '技术交底书', type: 'pdf', uri: 'file:///brief.pdf' })
    assert.equal(material.type, 'pdf')
    assert.equal(material.metadata.materialRole, 'technical-disclosure')
    assert.ok(material.suggestedEvidenceUse.includes('技术特征'))
    const enriched = await runtime.getWorkbench(sessionId)
    assert.equal(enriched.domainFields.applicant, '测试申请人')
    assert.equal(enriched.materials.length, 1)

    // 3. Create patent run (should use patent state machine with prior_art_search)
    const run = await runtime.createRun(sessionId, { mode: 'standard' })
    assert.equal(run.recommendedNextEvent, 'start')

    const advanced = await runtime.advanceRun(sessionId, {
      runId: run.id,
      expectedRevision: run.revision,
      event: 'start',
      summary: '启动专利撰写',
    })
    // Patent standard mode should skip to prior_art_search or retrieving
    assert.ok(advanced.state, 'patent run should advance')

    console.log('  ✅ patent lifecycle: create → bind → run → advance (different state machine)')
  } finally {
    await cleanup(tmpDir)
  }
})

// ─── End-to-End: Templates and Regeneration ─────────────────────────────────

test('e2e: templates and regeneration requests', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-templates'

  try {
    const project = await runtime.createProject(sessionId, { name: '测试项目', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)

    // 1. Save text template
    const tpl = await runtime.saveTemplate(sessionId, {
      name: '论文摘要模板',
      type: 'text',
      description: '硕士论文摘要标准结构',
      content: '研究背景：\n研究方法：\n研究结果：\n研究结论：',
    })
    assert.ok(tpl.id, 'template should have id')
    assert.equal(tpl.type, 'text')

    // 2. List templates
    const templates = await runtime.listTemplates(sessionId)
    assert.equal(templates.length, 1)
    assert.equal(templates[0].name, '论文摘要模板')

    // 3. Save format template
    const fmtTpl = await runtime.saveTemplate(sessionId, {
      name: 'IEEE 格式模板',
      type: 'format',
      content: 'font: Times New Roman\nsize: 12pt\nspacing: 1.5',
    })
    assert.equal(fmtTpl.type, 'format')
    const allTemplates = await runtime.listTemplates(sessionId)
    assert.equal(allTemplates.length, 2)

    // 4. Request regeneration
    const regen = await runtime.requestRegeneration(sessionId, {
      content: '这是修改后的正文内容...',
      instruction: '基于修改重新生成第2章',
      blockId: 'ch2',
    })
    assert.ok(regen.id, 'regeneration request should have id')
    assert.equal(regen.status, 'pending')

    // 5. List pending regeneration requests
    const pending = await runtime.listPendingRegenerationRequests(sessionId)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].instruction, '基于修改重新生成第2章')

    console.log('  ✅ templates + regeneration: save → list → request → list pending')
  } finally {
    await cleanup(tmpDir)
  }
})

test('e2e: import one user-selected local text material without directory scanning', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-material-import'
  try {
    const project = await runtime.createProject(sessionId, { name: '材料导入测试', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)
    const sourcePath = path.join(tmpDir, 'research-notes.md')
    await writeFile(sourcePath, '# 雷达笔记\n毫米波雷达用于水分检测。', 'utf8')
    const material = await runtime.importMaterialFile(sessionId, sourcePath)
    assert.equal(material.type, 'text')
    assert.ok(material.extractedText.includes('毫米波雷达'))
    assert.ok(material.summary.includes('毫米波雷达'))
    const wb = await runtime.getWorkbench(sessionId)
    assert.equal(wb.materials[0].metadata.importedFrom, 'local-file')
  } finally {
    await cleanup(tmpDir)
  }
})

test('e2e: generic retrieval, evidence binding, snapshot and export services', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-platform-services'
  try {
    const project = await runtime.createProject(sessionId, { name: '通用报告', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)
    const sourcePath = path.join(tmpDir, 'source.txt')
    await writeFile(sourcePath, '毫米波雷达可以用于烟草水分的非接触检测，并提供稳定测量结果。', 'utf8')
    await runtime.importMaterialFile(sessionId, sourcePath)
    await runtime.setManuscriptBlocks(sessionId, { blocks: [{ id: 'block-1', markdown: '本系统采用毫米波雷达完成水分检测。' }] })
    const results = await runtime.searchMaterials(sessionId, '毫米波雷达 水分检测')
    assert.ok(results.length > 0)
    const binding = await runtime.bindEvidence(sessionId, { blockId: 'block-1', chunkId: results[0].id, note: '实验依据' })
    assert.equal(binding.blockId, 'block-1')
    const snapshot = await runtime.createSnapshot(sessionId, '初稿')
    await runtime.setManuscriptBlocks(sessionId, { blocks: [{ id: 'block-1', markdown: '修改后的内容。' }] })
    assert.deepEqual((await runtime.compareSnapshot(sessionId, snapshot.id)).changed, ['block-1'])
    await runtime.restoreSnapshot(sessionId, snapshot.id)
    const exported = await runtime.exportDocument(sessionId, 'markdown')
    assert.ok(exported.content.includes('毫米波雷达完成水分检测'))
  } finally {
    await cleanup(tmpDir)
  }
})

test('e2e: import DOCX through the generic document service', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-docx-import'
  try {
    const project = await runtime.createProject(sessionId, { name: 'DOCX 导入', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)
    const doc = new Document({ sections: [{ children: [new Paragraph('通用工作台可解析 DOCX 文档。')] }] })
    const filePath = path.join(tmpDir, 'material.docx')
    await writeFile(filePath, await Packer.toBuffer(doc))
    const material = await runtime.importMaterialFile(sessionId, filePath)
    assert.equal(material.type, 'docx')
    assert.ok(material.extractedText.includes('通用工作台'))
    assert.equal(material.metadata.parser, 'officeparser')
  } finally {
    await cleanup(tmpDir)
  }
})

// ─── End-to-End: followProject auto-bind ────────────────────────────────────

test('e2e: followProject auto-binds to most recent project', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-follow'

  try {
    // No projects yet
    const noProject = await runtime.followProject(sessionId)
    assert.equal(noProject.bound, false, 'should not bind when no projects exist')

    // Create two projects
    const p1 = await runtime.createProject(sessionId, { name: '旧项目', taskType: 'thesis' })
    await new Promise((r) => setTimeout(r, 10)) // ensure different timestamps
    const p2 = await runtime.createProject(sessionId, { name: '新项目', taskType: 'patent' })

    // follow should bind to the most recent (p2)
    const followed = await runtime.followProject(sessionId)
    assert.equal(followed.bound, true)
    assert.equal(followed.id, p2.id, 'should bind to most recently created project')
    assert.equal(followed.name, '新项目')

    // Second follow should return existing binding (not re-bind)
    const followed2 = await runtime.followProject(sessionId)
    assert.equal(followed2.id, p2.id, 'should keep existing binding')

    console.log('  ✅ followProject: no-project → create → auto-bind latest → keep binding')
  } finally {
    await cleanup(tmpDir)
  }
})

// ─── End-to-End: Plugin Generator (scaffold correctness) ───────────────────

test('e2e: generatePluginBundle creates valid, loadable scaffold', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wb-gen-'))
  const outputDir = path.join(tmpDir, 'contract-workbench')

  try {
    // 1. Analyze task description
    const analysis = analyzeTaskDescription('帮我写一个法律合同审查工作台')
    assert.equal(analysis.detectedType, 'contract')
    assert.ok(analysis.confidence > 0)

    // 2. Generate plugin bundle
    const result = await generatePluginBundle({
      taskType: 'contract',
      name: 'Contract Workbench',
      description: '法律合同审查与起草工作台',
      outputDir,
    })

    assert.equal(result.taskType, 'contract')
    assert.ok(result.files.length >= 10, 'should generate an installable isolated package')
    assert.equal(result.verification.valid, true, 'generation should complete static verification')

    // 3. Verify all files exist and are non-empty
    const { readFile, stat } = await import('node:fs/promises')
    for (const file of result.files) {
      const filePath = path.join(outputDir, file)
      const fileStat = await stat(filePath)
      assert.ok(fileStat.size > 0, `${file} should be non-empty`)
    }

    // 4. Verify package.json is valid JSON with correct fields
    const pkg = JSON.parse(await readFile(path.join(outputDir, 'package.json'), 'utf8'))
    assert.equal(pkg.name, 'dsh-contract-workbench')
    assert.equal(pkg.type, 'module')
    assert.ok(pkg.peerDependencies['dsh-workbench-core'])
    assert.ok(pkg.dsh.bundle.patch)

    // The manifest/spec are inspectable without running generated code.
    const manifest = JSON.parse(await readFile(path.join(outputDir, 'plugin.manifest.json'), 'utf8'))
    assert.equal(manifest.taskType, 'contract')
    assert.equal(manifest.apiVersion, 2)
    const spec = JSON.parse(await readFile(path.join(outputDir, 'plugin-spec.json'), 'utf8'))
    assert.ok(spec.documentSchema.sections.length >= 1)
    assert.ok(spec.workflow.stateTable)
    const verification = await verifyGeneratedPluginBundle(outputDir)
    assert.equal(verification.valid, true)

    // 5. Verify framework.js exports a valid framework plugin
    const frameworkCode = await readFile(path.join(outputDir, 'src', 'framework.js'), 'utf8')
    assert.ok(frameworkCode.includes('export const contractFramework'), 'framework.js should export contractFramework')
    assert.ok(frameworkCode.includes('stateTable'), 'framework should define stateTable')
    assert.ok(frameworkCode.includes('generateOutline'), 'framework should have generateOutline')
    assert.ok(frameworkCode.includes('validateOutline'), 'framework should have validateOutline')

    // 6. Verify logic.js exports a valid logic plugin
    const logicCode = await readFile(path.join(outputDir, 'src', 'logic.js'), 'utf8')
    assert.ok(logicCode.includes('export const contractLogic'), 'logic.js should export contractLogic')
    assert.ok(logicCode.includes('generateLogic'), 'logic should have generateLogic')
    assert.ok(logicCode.includes('suggestRewrite'), 'logic should have suggestRewrite')

    // 7. Verify evidence.js exports a valid evidence plugin
    const evidenceCode = await readFile(path.join(outputDir, 'src', 'evidence.js'), 'utf8')
    assert.ok(evidenceCode.includes('export const contractEvidence'), 'evidence.js should export contractEvidence')
    assert.ok(evidenceCode.includes('formatCitation'), 'evidence should have formatCitation')
    assert.ok(evidenceCode.includes('evaluateEvidence'), 'evidence should have evaluateEvidence')

    // 8. Verify index.js registers all three plugins
    const indexCode = await readFile(path.join(outputDir, 'src', 'index.js'), 'utf8')
    assert.ok(indexCode.includes('registerPluginBundle'), 'index should register the bundle')
    assert.ok(indexCode.includes('export async function apply'), 'index should expose the DSH activation entry point')
    const materialCode = await readFile(path.join(outputDir, 'src', 'material.js'), 'utf8')
    assert.ok(materialCode.includes('normalizeMaterial'), 'material plugin should expose a controlled material boundary')

    // 9. Verify README has installation instructions
    const readme = await readFile(path.join(outputDir, 'README.md'), 'utf8')
    assert.ok(readme.includes('npm install'), 'README should have install instructions')
    assert.ok(readme.includes('dsh plugin'), 'README should have DSH plugin install command')

    console.log('  ✅ plugin generator: isolated package → manifest verification → DSH activation entry')
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

// ─── End-to-End: Delete project and workbench state ─────────────────────────

test('e2e: delete project removes it from list', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-delete'

  try {
    const p1 = await runtime.createProject(sessionId, { name: '项目A', taskType: 'thesis' })
    const p2 = await runtime.createProject(sessionId, { name: '项目B', taskType: 'patent' })

    let projects = await runtime.listProjects()
    assert.equal(projects.length, 2)

    await runtime.deleteProject(p1.id)
    projects = await runtime.listProjects()
    assert.equal(projects.length, 1)
    assert.equal(projects[0].id, p2.id)

    console.log('  ✅ delete project: create 2 → delete 1 → list 1')
  } finally {
    await cleanup(tmpDir)
  }
})
