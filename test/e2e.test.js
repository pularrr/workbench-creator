import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { Document, Packer, Paragraph } from 'docx'

import { WorkbenchRuntime } from '../src/core/runtime.js'
import { registerThesisPlugins } from '../src/plugins/thesis/index.js'
import { registerPatentPlugins } from '../src/plugins/patent/index.js'
import { generatePluginBundle, analyzeTaskDescription, verifyGeneratedPluginBundle } from '../src/generator.js'

// Register plugins before tests
registerThesisPlugins()
registerPatentPlugins()

async function makeRuntime(options = {}) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wb-e2e-'))
  const storagePath = path.join(tmpDir, 'state.json')
  const runtime = new WorkbenchRuntime({ storagePath, ...options })
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

test('e2e: built-in thesis v2 stores the selected degree profile', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  try {
    const project = await runtime.createProject('thesis-v2', { name: '博士论文', taskType: 'thesis', degreeType: 'doctor' })
    assert.equal(project.outlineProfile.degreeType, 'doctor')
    assert.equal(project.outlineProfile.generatorVersion, '2.0.0')
    assert.ok(project.outline.some((node) => node.id === 'abstract-zh'))
    await assert.rejects(() => runtime.createProject('thesis-v2', { name: '冲突论文', taskType: 'thesis', degreeType: 'doctor', domainFields: { degreeType: 'master' } }), /conflicts/)
  } finally {
    await cleanup(tmpDir)
  }
})

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

test('e2e: patent type controls the initial outline and survives reload', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  try {
    const utility = await runtime.createProject('patent-type', { name: '实用新型', taskType: 'patent', patentType: 'utility_model' })
    const invention = await runtime.createProject('patent-type', { name: '发明', taskType: 'patent', patentType: 'invention' })
    assert.equal(utility.domainFields.patentType, 'utility_model')
    assert.equal(utility.outlineProfile.patentType, 'utility_model')
    assert.equal(utility.outline[0].targetWords, Math.round(invention.outline[0].targetWords * 0.7))
    await assert.rejects(() => runtime.createProject('patent-type', { name: '冲突', taskType: 'patent', patentType: 'invention', domainFields: { patentType: 'utility_model' } }), /conflicts/)
  } finally { runtime?.close(); await cleanup(tmpDir) }
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

test('e2e: review agent findings persist for the workbench UI', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-review-findings'
  try {
    const project = await runtime.createProject(sessionId, { name: '审查建议测试', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)
    const finding = await runtime.addReviewSuggestion(sessionId, {
      suggestion: '第二章缺少与核心结论对应的来源绑定。',
      category: 'evidence', severity: 'warning', blockId: 'ch2',
    })
    assert.equal(finding.source, 'dsh-review-agent')
    const workbench = await runtime.getWorkbench(sessionId)
    assert.equal(workbench.reviewSuggestions.length, 1)
    assert.equal(workbench.reviewSuggestions[0].suggestion, finding.suggestion)
  } finally {
    await cleanup(tmpDir)
  }
})

test('e2e: regeneration candidate stays pending until selected blocks are confirmed', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-regeneration-candidate'
  try {
    const project = await runtime.createProject(sessionId, { name: '候选 Diff 测试', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)
    await runtime.setManuscriptBlocks(sessionId, { blocks: [
      { id: 'one', markdown: '原始第一段' }, { id: 'two', markdown: '原始第二段' },
    ] })
    const request = await runtime.requestRegeneration(sessionId, { content: '草稿', instruction: '补足证据' })
    const candidate = await runtime.submitRegenerationCandidate(sessionId, {
      requestId: request.id,
      proposedBlocks: [{ id: 'one', markdown: '候选第一段' }, { id: 'two', markdown: '候选第二段' }],
      summary: '替换两段', rationale: '根据证据补足',
    })
    const pending = await runtime.getWorkbench(sessionId)
    assert.equal(pending.regenerationCandidates.length, 1)
    assert.equal(pending.manuscriptBlocks[0].markdown, '原始第一段')
    const result = await runtime.resolveRegenerationCandidate(sessionId, { candidateId: candidate.id, acceptedBlockIds: ['one'], userConfirmed: true })
    assert.equal(result.applied, 1)
    const updated = await runtime.getWorkbench(sessionId)
    assert.equal(updated.manuscriptBlocks[0].markdown, '候选第一段')
    assert.equal(updated.manuscriptBlocks[1].markdown, '原始第二段')
    assert.ok(updated.agentTrace.some((item) => item.kind === 'candidate_resolved'))
  } finally { await cleanup(tmpDir) }
})

test('e2e: chunked manuscript writes preserve earlier chapters unless whole replacement is confirmed', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-safe-manuscript'
  try {
    const project = await runtime.createProject(sessionId, { name: '分章写作保护测试', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)
    await runtime.setManuscriptBlocks(sessionId, { blocks: [{ outlineNodeId: 'ch1', markdown: '第一章内容' }] })
    await runtime.setManuscriptBlocks(sessionId, { blocks: [{ outlineNodeId: 'ch2', markdown: '第二章内容' }] })
    let workbench = await runtime.getWorkbench(sessionId)
    assert.equal(workbench.manuscriptBlocks.length, 2)
    assert.equal(workbench.manuscriptBlocks[0].markdown, '第一章内容')
    await runtime.setManuscriptBlocks(sessionId, { blocks: [{ outlineNodeId: 'ch1', markdown: '第一章修订' }] })
    workbench = await runtime.getWorkbench(sessionId)
    assert.equal(workbench.manuscriptBlocks.length, 2)
    assert.equal(workbench.manuscriptBlocks[0].markdown, '第一章修订')
    await assert.rejects(() => runtime.setManuscriptBlocks(sessionId, { blocks: [{ markdown: '覆盖文本' }], replaceAll: true }), /explicit user confirmation/)
    await runtime.setManuscriptBlocks(sessionId, { blocks: [{ markdown: '覆盖文本' }], replaceAll: true, userConfirmed: true })
    workbench = await runtime.getWorkbench(sessionId)
    assert.equal(workbench.manuscriptBlocks.length, 1)
  } finally { await cleanup(tmpDir) }
})

test('e2e: workspace binding and durable AgentTask survive runtime restart', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-workspace'
  try {
    const project = await runtime.createProject(sessionId, { name: '工作区任务测试', taskType: 'thesis', workspaceId: 'web:test' })
    const workspace = await runtime.getWorkspace('web:test')
    assert.equal(workspace.activeProjectId, project.id)
    await runtime.bindProject('new-dsh-session', project.id, { assistantKey: 'web:stable-assistant' })
    assert.equal((await runtime.getWorkspace('web:stable-assistant')).activeProjectId, project.id)
    const task = await runtime.createAgentTask(sessionId, { type: 'review_manuscript', payload: { blockIds: [] } })
    assert.equal(task.status, 'queued')
    const collaborationEvents = await runtime.listCollaborationEvents({ sessionId })
    assert.ok(collaborationEvents.some((event) => event.kind === 'user_request' && event.taskId === task.id))
    await runtime.claimAgentTask(sessionId, { taskId: task.id })
    await runtime.updateAgentTaskProgress(sessionId, { taskId: task.id, step: 'retrieving_evidence', percent: 30 })
    const completed = await runtime.completeAgentTask(sessionId, { taskId: task.id, awaitingUserConfirmation: true, result: { suggestionCount: 2 } })
    assert.equal(completed.status, 'awaiting_user_confirmation')
    const restarted = new WorkbenchRuntime({ storagePath: path.join(tmpDir, 'state.json') })
    const afterRestart = await restarted.getWorkspace('web:test')
    assert.equal(afterRestart.activeProjectId, project.id)
    assert.equal((await restarted.getWorkspace('web:stable-assistant')).activeProjectId, project.id)
    await restarted.bindProject(sessionId, project.id)
    assert.equal((await restarted.listAgentTasks(sessionId))[0].status, 'awaiting_user_confirmation')
  } finally { await cleanup(tmpDir) }
})

test('e2e: a new DSH session preserves the prior stage when rebinding the same assistant project', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  try {
    const project = await runtime.createProject('original-session', { name: '阶段恢复项目', taskType: 'thesis' })
    await runtime.bindProject('original-session', project.id, { assistantKey: 'stable-stage-assistant' })
    await runtime.setWorkStage('original-session', 'write', { assistantKey: 'stable-stage-assistant', userConfirmed: true })
    await runtime.bindProject('new-session', project.id, { assistantKey: 'stable-stage-assistant' })
    assert.equal(await runtime.getWorkStage('new-session'), 'write')
    assert.equal((await runtime.getResumeState('new-session', 'stable-stage-assistant')).stage, 'write')
  } finally { runtime.close(); await cleanup(tmpDir) }
})

test('e2e: SQLite audit events and Core entity projections are queryable', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wb-audit-'))
  const storagePath = path.join(tmpDir, 'workbench.db')
  const sessionId = 'test-session-audit'
  let runtime
  try {
    runtime = new WorkbenchRuntime({ storagePath })
    const project = await runtime.createProject(sessionId, { name: '审计测试', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)
    await runtime.setManuscriptBlocks(sessionId, { blocks: [{ outlineNodeId: 'chapter-1', markdown: '第一章' }] })
    const events = await runtime.listAuditEvents(sessionId)
    assert.ok(events.some((event) => event.action === 'project-created' && event.projectId === project.id))
    const manuscriptEvent = events.find((event) => event.action === 'project.updated')
    assert.ok(manuscriptEvent)
    assert.equal(manuscriptEvent.actor, 'system')
    assert.equal(typeof manuscriptEvent.beforeRevision, 'number')
    assert.equal(manuscriptEvent.afterRevision, manuscriptEvent.beforeRevision + 1)
    assert.equal(typeof manuscriptEvent.timestamp, 'string')
    const database = new DatabaseSync(storagePath)
    try {
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
      assert.ok(!tables.includes('workbench_state'), 'new SQLite-only databases must not create a state snapshot table')
      for (const table of ['workspaces', 'projects', 'materials', 'material_chunks', 'source_bindings', 'manuscript_blocks', 'manuscript_versions', 'review_suggestions', 'regeneration_candidates', 'agent_tasks', 'agent_traces', 'agent_workers', 'collaboration_events']) assert.ok(tables.includes(table), `missing ${table}`)
      const storedProject = database.prepare('SELECT id, revision FROM projects WHERE id = ?').get(project.id)
      assert.equal(storedProject.id, project.id)
      assert.equal(storedProject.revision, 3)
      const block = database.prepare('SELECT outline_node_id, block_order FROM manuscript_blocks WHERE project_id = ?').get(project.id)
      assert.equal(block.outline_node_id, 'chapter-1')
      assert.equal(block.block_order, 0)
    } finally { database.close() }
    runtime.close()
    runtime = new WorkbenchRuntime({ storagePath })
    const restored = await runtime.getProject(project.id)
    assert.equal(restored.manuscriptBlocks[0].markdown, '第一章')
  } finally { runtime?.close(); await cleanup(tmpDir) }
})

test('e2e: agent worker heartbeat is durable and becomes stale when it stops reporting', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wb-worker-'))
  const storagePath = path.join(tmpDir, 'workbench.db')
  let runtime
  try {
    runtime = new WorkbenchRuntime({ storagePath })
    const worker = await runtime.registerAgentWorker({ id: 'dsh-worker-1', name: 'DSH Worker', capabilities: ['claim_agent_task'] })
    assert.equal(worker.status, 'online')
    await runtime.heartbeatAgentWorker(worker.id)
    assert.equal((await runtime.listAgentWorkers())[0].status, 'online')
    runtime.close()
    runtime = new WorkbenchRuntime({ storagePath })
    assert.equal((await runtime.listAgentWorkers())[0].name, 'DSH Worker')
    await runtime.stopAgentWorker(worker.id, { reason: 'normal shutdown' })
    assert.equal((await runtime.listAgentWorkers())[0].status, 'stopped')
  } finally { runtime?.close(); await cleanup(tmpDir) }
})

test('e2e: a page task reports real DSH conversation injection delivery', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  try {
    const project = await runtime.createProject('injection-session', { name: '会话注入', taskType: 'thesis' })
    const calls = []
    runtime.setAgentTaskNotifier(async (value) => { calls.push(value); return { delivered: true } })
    const task = await runtime.createAgentTask('injection-session', { type: 'review_manuscript', requestedBy: 'page' })
    assert.equal(task.delivery.delivered, true)
    assert.equal(calls[0].sessionId, 'injection-session')
    const events = await runtime.listCollaborationEvents({ sessionId: 'injection-session' })
    assert.ok(events.some((event) => event.kind === 'chat_injected' && event.taskId === task.id))
  } finally { runtime.close(); await cleanup(tmpDir) }
})

test('e2e: confirmed literature is deduplicated and can be bound without becoming RAG evidence', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  try {
    const project = await runtime.createProject('literature', { name: '书目', taskType: 'thesis' })
    await runtime.bindProject('literature', project.id)
    await runtime.setManuscriptBlocks('literature', { blocks: [{ id: 'background', markdown: '背景。' }] })
    await assert.rejects(() => runtime.addLiterature('literature', { record: { title: 'A paper', doi: '10.1000/ABC' } }), /confirmation/)
    const added = await runtime.addLiterature('literature', { userConfirmed: true, record: { title: 'A paper', doi: 'https://doi.org/10.1000/ABC', authors: [{ family: 'Li' }], year: 2025 } })
    const duplicate = await runtime.addLiterature('literature', { userConfirmed: true, record: { title: 'Different title', doi: '10.1000/abc' } })
    assert.equal(duplicate.duplicate, true)
    const binding = await runtime.bindLiterature('literature', { literatureId: added.id, blockId: 'background', note: '背景引用' })
    assert.equal(binding.blockId, 'background')
    assert.equal((await runtime.listLiterature('literature')).length, 1)
  } finally { await cleanup(tmpDir) }
})

test('e2e: a user-selected template is parsed separately from RAG materials', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  try {
    const project = await runtime.createProject('template-import', { name: '模板导入', taskType: 'thesis' })
    await runtime.bindProject('template-import', project.id)
    const filePath = path.join(tmpDir, 'outline-template.md')
    await writeFile(filePath, '# 总体结构\n\n## 研究背景\n\n示例文本', 'utf8')
    const template = await runtime.importTemplateFile('template-import', filePath, { type: 'outline' })
    assert.equal(template.type, 'outline')
    assert.equal(template.outlineSkeleton.length, 2)
    assert.equal(template.outlineSkeleton[1].locator.startLine, 3)
    assert.match(template.sourceSha256, /^[a-f0-9]{64}$/)
    assert.equal((await runtime.getWorkbench('template-import')).materials.length, 0)
    assert.equal((await runtime.getTemplate('template-import', template.id)).sourceFormat, 'text')
  } finally { await cleanup(tmpDir) }
})

test('e2e: template restructure is previewed, validated, and only applied after confirmation', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  try {
    const project = await runtime.createProject('template-preview', { name: '模板重构', taskType: 'thesis' })
    await runtime.bindProject('template-preview', project.id)
    const filePath = path.join(tmpDir, 'restructure.md')
    await writeFile(filePath, '# 绪论\n# 方法\n# 结论', 'utf8')
    const template = await runtime.importTemplateFile('template-preview', filePath, { type: 'outline' })
    const preview = await runtime.previewTemplateRestructure('template-preview', { templateId: template.id })
    assert.equal(preview.status, 'ready_for_confirmation')
    await assert.rejects(() => runtime.applyTemplateRestructure('template-preview', { previewId: preview.id, userConfirmed: false }), /explicit user confirmation/)
    const applied = await runtime.applyTemplateRestructure('template-preview', { previewId: preview.id, userConfirmed: true })
    assert.deepEqual(applied.outline.map((node) => node.title), ['绪论', '方法', '结论'])
  } finally { await cleanup(tmpDir) }
})

test('e2e: confirmed literature full text and code semantics become traceable RAG materials', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  try {
    const project = await runtime.createProject('fulltext-code', { name: '全文与代码', taskType: 'thesis' })
    await runtime.bindProject('fulltext-code', project.id)
    const literature = await runtime.addLiterature('fulltext-code', { userConfirmed: true, record: { title: 'Evidence paper', doi: '10.1000/fulltext' } })
    const paperPath = path.join(tmpDir, 'paper.txt'); await writeFile(paperPath, '全文证据：雷达测量结果。', 'utf8')
    await assert.rejects(() => runtime.importLiteratureFulltext('fulltext-code', { literatureId: literature.id, filePath: paperPath }), /explicit user confirmation/)
    const imported = await runtime.importLiteratureFulltext('fulltext-code', { literatureId: literature.id, filePath: paperPath, userConfirmed: true })
    assert.ok(imported.materialId)
    assert.equal((await runtime.listLiterature('fulltext-code'))[0].fulltextMaterialId, imported.materialId)
    const codePath = path.join(tmpDir, 'radar.py'); await writeFile(codePath, 'def measure(signal):\n    return signal * 2\n', 'utf8')
    const code = await runtime.importMaterialFile('fulltext-code', codePath)
    assert.equal(code.type, 'code')
    const request = await runtime.requestCodeSemanticInterpretation('fulltext-code', { materialId: code.id })
    const semantic = await runtime.saveCodeSemanticInterpretation('fulltext-code', { materialId: code.id, requestId: request.id, semantic: { summary: 'measure 将输入信号乘以二并返回。', responsibilities: ['信号变换'] } })
    assert.equal(semantic.sourceLocator.path, 'radar.py')
    const stored = await runtime.getProject(project.id)
    assert.ok(stored.sourceChunks.some((chunk) => chunk.contentKind === 'code_semantic'))
  } finally { await cleanup(tmpDir) }
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
    assert.equal(material.metadata.managedCopy, true)
    assert.match(material.metadata.sha256, /^[a-f0-9]{64}$/)
    await access(material.uri)
    const wb = await runtime.getWorkbench(sessionId)
    assert.equal(wb.materials[0].characterCount, material.extractedText.length)
    assert.equal(Object.hasOwn(wb.materials[0], 'extractedText'), false)
  } finally {
    await cleanup(tmpDir)
  }
})

test('e2e: material inspection is paginated and never leaks extracted text through workbench state', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-material-inspection'
  try {
    const project = await runtime.createProject(sessionId, { name: '材料验收测试', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)
    for (const name of ['one.md', 'two.md', 'three.md']) {
      const sourcePath = path.join(tmpDir, name)
      await writeFile(sourcePath, `# ${name}\n用于验收的材料正文。`, 'utf8')
      await runtime.importMaterialFile(sessionId, sourcePath)
    }
    const checklist = await runtime.listMaterialSummaries(sessionId, { page: 2, pageSize: 2 })
    assert.equal(checklist.total, 3)
    assert.equal(checklist.items.length, 1)
    assert.ok(checklist.items[0].characterCount > 0)
    assert.equal(Object.hasOwn(checklist.items[0], 'extractedText'), false)
    const content = await runtime.getMaterialContent(sessionId, { materialId: checklist.items[0].id, limit: 8 })
    assert.equal(content.content.length, 8)
    assert.equal(content.hasMore, true)
    const chunks = await runtime.listMaterialChunks(sessionId, { materialId: checklist.items[0].id })
    assert.ok(chunks.total > 0)
    const workbench = await runtime.getWorkbench(sessionId)
    assert.equal(Object.hasOwn(workbench.materials[0], 'extractedText'), false)
  } finally { await cleanup(tmpDir) }
})

test('e2e: confirmed directory import imports supported files and isolates failures', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'test-session-directory-import'
  try {
    const project = await runtime.createProject(sessionId, { name: '批量材料导入测试', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)
    const materialRoot = path.join(tmpDir, 'materials')
    const nested = path.join(materialRoot, 'nested')
    await mkdir(nested, { recursive: true })
    await writeFile(path.join(materialRoot, 'radar.txt'), '雷达水分检测资料。', 'utf8')
    await writeFile(path.join(nested, 'notes.md'), '# 实验记录\n微波传感器。', 'utf8')
    await writeFile(path.join(materialRoot, 'archive.zip'), 'not imported', 'utf8')
    await assert.rejects(() => runtime.importMaterialDirectory(sessionId, materialRoot), /explicit user confirmation/)
    const result = await runtime.importMaterialDirectory(sessionId, materialRoot, { userConfirmed: true, recursive: true, maxFiles: 10 })
    assert.equal(result.imported.length, 2)
    assert.ok(result.skipped.some((item) => item.filePath.endsWith('archive.zip') && item.reason === 'unsupported_file_type'))
    assert.equal((await runtime.getWorkbench(sessionId)).materials.length, 2)
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
    const retrievalStatus = await runtime.getRetrievalStatus(sessionId)
    assert.equal(retrievalStatus.provider.provider, 'hash')
    assert.equal(retrievalStatus.chunkCount, 1)
    assert.equal(retrievalStatus.state, 'ready')
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

test('e2e: a user can select an administrator-defined embedding profile then explicitly reindex', async () => {
  const { runtime, tmpDir } = await makeRuntime({
    retrieval: {
      profiles: {
        'offline-256': { name: '离线 256 维', description: '管理员预置的本地 profile', embedding: { type: 'hash', dimensions: 256 } },
      },
    },
  })
  const sessionId = 'test-session-retrieval-profile'
  try {
    const project = await runtime.createProject(sessionId, { name: '模型选择', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)
    const profiles = await runtime.listEmbeddingProfiles()
    assert.ok(profiles.some((profile) => profile.id === 'offline-hash'))
    assert.ok(profiles.some((profile) => profile.id === 'offline-256' && profile.credentialAvailable))
    await assert.rejects(() => runtime.configureRetrieval(sessionId, { profileId: 'offline-256', userConfirmed: false }), /explicit user confirmation/)
    const sourcePath = path.join(tmpDir, 'profile.txt')
    await writeFile(sourcePath, '毫米波雷达测量水分。', 'utf8')
    await runtime.importMaterialFile(sessionId, sourcePath)
    const configured = await runtime.configureRetrieval(sessionId, { profileId: 'offline-256', userConfirmed: true })
    assert.equal(configured.profile.id, 'offline-256')
    assert.equal(configured.state, 'stale')
    const rebuilt = await runtime.reindexMaterials(sessionId)
    assert.equal(rebuilt.provider.dimensions, 256)
    assert.equal(rebuilt.state, 'ready')
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

// ─── End-to-End: followProject explicit selection ───────────────────────────

test('e2e: followProject never guesses among unbound projects', async () => {
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

    await runtime.unbindProject(sessionId)
    // Follow must return candidates instead of guessing the most recent project.
    const followed = await runtime.followProject(sessionId)
    assert.equal(followed.bound, false)
    assert.equal(followed.requiresSelection, true)
    assert.deepEqual(new Set(followed.projects.map((project) => project.id)), new Set([p1.id, p2.id]))

    // Once the user explicitly selects a project, follow returns that binding.
    await runtime.bindProject(sessionId, p2.id)
    const followed2 = await runtime.followProject(sessionId)
    assert.equal(followed2.id, p2.id)

    console.log('  ✅ followProject: no-project → explicit selection → keep binding')
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
      confirmedDestination: true,
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

test('e2e: permanently delete requires an archived project and exact name confirmation', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wb-permanent-delete-'))
  const storagePath = path.join(tmpDir, 'workbench.db')
  const runtime = new WorkbenchRuntime({ storagePath })
  try {
    const project = await runtime.createProject('permanent-delete', { name: '待永久删除项目', taskType: 'thesis' })
    await runtime.setManuscriptBlocks('permanent-delete', { blocks: [{ id: 'p1', markdown: '待删除正文' }] })
    await assert.rejects(
      () => runtime.permanentlyDeleteArchivedProject(project.id, { userConfirmed: true, projectNameConfirmation: project.name }),
      /Only an archived project/,
    )
    await runtime.deleteProject(project.id)
    assert.equal((await runtime.listArchivedProjects()).length, 1)
    await assert.rejects(
      () => runtime.permanentlyDeleteArchivedProject(project.id, { userConfirmed: true, projectNameConfirmation: '错误名称' }),
      /Project name confirmation does not match/,
    )
    const deleted = await runtime.permanentlyDeleteArchivedProject(project.id, { userConfirmed: true, projectNameConfirmation: project.name })
    assert.equal(deleted.deleted, true)
    assert.equal(deleted.deletedEntityCounts.manuscriptBlocks, 1)
    assert.equal((await runtime.listArchivedProjects()).length, 0)
    const audit = await runtime.storage.listAuditEvents(null)
    assert.ok(audit.some((event) => event.action === 'project.permanently_deleted' && event.projectId === project.id))
  } finally { runtime.close(); await cleanup(tmpDir) }
})

test('e2e: unified change set previews and applies selected four-dimensional diffs', async () => {
  const { runtime, tmpDir } = await makeRuntime()
  const sessionId = 'changeset-session'
  try {
    const project = await runtime.createProject(sessionId, { name: '统一变更集', taskType: 'thesis' })
    await runtime.bindProject(sessionId, project.id)
    await runtime.setOutline(sessionId, { outline: [{ id: 'o1', title: '原大纲', objective: '原目标', order: 0 }], confirmed: true })
    await runtime.setManuscriptBlocks(sessionId, { blocks: [{ id: 'm1', markdown: '原始正文' }] })
    const current = await runtime.getBoundProject(sessionId)
    const changeSet = await runtime.createChangeSet(sessionId, {
      baseRevision: current.revision,
      outlineChanges: [{ id: 'o1', entityId: current.outline[0].id, before: current.outline[0], after: { title: '更新大纲' } }],
      logicChanges: [{ id: 'l1', entityId: current.logicBlocks[0].id, before: current.logicBlocks[0], after: { claim: '更新论点' } }],
      manuscriptChanges: [{ id: 'm1', entityId: 'm1', before: { markdown: '原始正文' }, after: { markdown: '更新正文' } }],
      reviewChanges: [{ id: 'r1', entityId: 'r1', before: null, after: { suggestion: '补充证据', severity: 'warning' } }],
    })
    assert.equal(changeSet.status, 'awaiting_confirmation')
    const result = await runtime.applyChangeSet(sessionId, { changeSetId: changeSet.id, selectedItemIds: ['m1', 'r1'], userConfirmed: true })
    assert.equal(result.applied, 2)
    const updated = await runtime.getBoundProject(sessionId)
    assert.equal(updated.manuscriptBlocks[0].markdown, '更新正文')
    assert.equal(updated.outline[0].title, current.outline[0].title)
    assert.equal(updated.logicBlocks[0].claim, current.logicBlocks[0].claim)
    assert.equal(updated.reviewSuggestions.at(-1).suggestion, '补充证据')
  } finally { runtime.close(); await cleanup(tmpDir) }
})
