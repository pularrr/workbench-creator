import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ThesisDomainStore } from '../src/domain-store.js'

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-thesis-'))
  const store = new ThesisDomainStore(directory)
  await store.initialize()
  return { store, directory }
}

test('creates a project and persists an outline with writing logic', async () => {
  const { store, directory } = await createStore()
  const project = await store.createProject('session-a', {
    name: '混合检索论文',
    title: '面向论文写作的混合检索方法研究',
    targetWords: 30000,
  })

  const workbench = await store.setPlan('session-a', {
    expectedRevision: 0,
    confirmed: true,
    outline: [{
      title: '国内外研究现状',
      objective: '比较现有方法并引出本文工作',
      targetWords: 4000,
      logic: [
        { purpose: '横向比较关键词、向量和混合检索', targetWords: 1800 },
        { purpose: '纵向梳理检索增强技术演进', targetWords: 1600 },
      ],
    }],
  })

  assert.equal(workbench.project.status, 'ready_to_generate')
  assert.equal(workbench.project.planningRevision, 1)
  assert.equal(workbench.outline.length, 1)
  assert.equal(workbench.logicBlocks.length, 2)
  assert.equal(workbench.logicBlocks[0].outlineNodeId, workbench.outline[0].id)

  const persisted = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'))
  assert.equal(persisted.projects[project.id].logicBlocks.length, 2)
})

test('creates, compares, and non-destructively restores manuscript snapshots', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '版本项目' })
  const planned = await store.setPlan('session-a', {
    expectedRevision: 0, confirmed: true,
    outline: [{ title: '系统设计', logic: [{ purpose: '说明总体架构' }] }],
  })
  await store.setManuscriptBlocks('session-a', {
    expectedRevision: 0,
    blocks: [{ id: 'block-1', outlineNodeId: planned.outline[0].id, logicBlockIds: [planned.logicBlocks[0].id], markdown: '第一版正文。' }],
  })
  const snapshot = await store.createManuscriptSnapshot('session-a', { expectedRevision: 1, name: '可用初稿' })
  await store.setManuscriptBlocks('session-a', {
    expectedRevision: 1,
    blocks: [{ id: 'block-1', revision: 0, outlineNodeId: planned.outline[0].id, logicBlockIds: [planned.logicBlocks[0].id], markdown: '第二版正文。' }],
  })
  const compared = store.compareManuscriptVersion('session-a', { versionId: snapshot.id })
  assert.equal(compared.changes[0].type, 'modified')
  const restored = await store.restoreManuscriptVersion('session-a', { versionId: snapshot.id, expectedRevision: 2 })
  const workbench = store.getWorkbench('session-a')
  assert.equal(workbench.manuscriptBlocks[0].markdown, '第一版正文。')
  assert.equal(restored.manuscriptRevision, 3)
  assert.equal(workbench.manuscriptVersions.length, 2)
  assert.equal(workbench.manuscriptVersions[1].restoredFromVersionId, snapshot.id)
})

test('exports the accepted manuscript as a basic DOCX using the selected template', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '导出项目', title: '论文导出测试' })
  const planned = await store.setPlan('session-a', {
    expectedRevision: 0, confirmed: true,
    outline: [{ title: '绪论', logic: [{ purpose: '说明研究背景' }] }],
  })
  await store.setManuscriptBlocks('session-a', {
    expectedRevision: 0,
    blocks: [{ id: 'intro-1', outlineNodeId: planned.outline[0].id, logicBlockIds: [planned.logicBlocks[0].id], markdown: '# 绪论\n本文介绍研究背景。' }],
  })
  const configured = await store.setExportTemplate('session-a', {
    expectedRevision: 0, template: { name: '学校基础模板', fontFamily: '宋体', lineSpacingTwips: 400 },
  })
  assert.equal(configured.templateRevision, 1)
  const exported = await store.exportCurrentDocx('session-a', { expectedRevision: 1, filename: '验收文档' })
  assert.equal(exported.format, 'docx')
  assert.ok((await stat(exported.outputPath)).size > 0)
  const bytes = await readFile(exported.outputPath)
  assert.equal(bytes.subarray(0, 2).toString(), 'PK')
})

test('exports one unified manuscript model as a LaTeX project with citation keys', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: 'LaTeX 项目', title: '统一论文模型' })
  const planned = await store.setPlan('session-a', { expectedRevision: 0, confirmed: true, outline: [{ title: '相关工作', logic: [{ purpose: '比较已有工作' }] }] })
  await store.setManuscriptBlocks('session-a', { expectedRevision: 0, blocks: [{ id: 'latex-1', outlineNodeId: planned.outline[0].id, logicBlockIds: [planned.logicBlocks[0].id], markdown: '# 相关工作\n已有研究提出混合检索。' }] })
  const [candidate] = await store.submitLiteratureCandidates('session-a', { candidates: [{ title: 'Hybrid Retrieval', authors: ['Li Ming'], year: 2025, venue: 'AI Journal', relevanceReason: '支持相关工作' }] })
  await store.decideLiterature('session-a', { literatureId: candidate.id, expectedRevision: 0, decision: 'approve' })
  await store.bindCitation('session-a', { blockId: 'latex-1', literatureId: candidate.id })
  const result = await store.exportCurrentLatex('session-a', { expectedRevision: 1, compilePdf: false, filename: 'thesis' })
  const tex = await readFile(result.texPath, 'utf8')
  assert.match(tex, /\\documentclass/)
  assert.match(tex, /\\cite\{liming2025\}/)
  assert.match(tex, /\\bibitem\{liming2025\}/)
  assert.equal(result.compiled, false)
})

test('explicitly switches Embedding configuration and rebuilds stale project vectors', async () => {
  const { store, directory } = await createStore()
  await store.createProject('session-a', { name: 'Embedding 设置项目' })
  await store.importSourceText('session-a', { sourceKey: 'a.md', name: 'a.md', content: '论文检索材料。' })
  const tested = await store.testEmbeddingConnection('session-a', { config: { type: 'local-hash' } })
  assert.equal(tested.dimensions, 192)
  const changed = await store.setEmbeddingConfig('session-a', { expectedRevision: 0, config: { type: 'local-hash' }, apiKey: 'must-not-persist' })
  assert.equal(changed.index.status, 'stale')
  await assert.rejects(store.searchSources('session-a', { query: '论文' }), /stale/)
  const rebuilt = await store.rebuildEmbeddings('session-a', { expectedConfigRevision: 1 })
  assert.equal(rebuilt.index.status, 'ready')
  assert.equal(rebuilt.index.indexedChunks, rebuilt.index.totalChunks)
  assert.doesNotMatch(await readFile(path.join(directory, 'state.json'), 'utf8'), /must-not-persist/)
})

test('governs a lightweight ReAct run with validated transitions, observations, pause and resume', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: 'ReAct 项目' })
  const run = await store.createAgentRun('session-a', { mode: 'full', reviewEnabled: false, budget: { maxSteps: 20, maxRetrievalAttempts: 2 } })
  let current = await store.advanceAgentRun('session-a', { runId: run.id, expectedRevision: 0, event: 'start' })
  current = await store.pauseAgentRun('session-a', { runId: run.id, expectedRevision: current.revision })
  assert.equal(current.state, 'paused')
  current = await store.resumeAgentRun('session-a', { runId: run.id, expectedRevision: current.revision })
  current = await store.advanceAgentRun('session-a', { runId: run.id, expectedRevision: current.revision, event: 'plan_ready' })
  current = await store.advanceAgentRun('session-a', { runId: run.id, expectedRevision: current.revision, event: 'plan_confirmed' })
  current = await store.advanceAgentRun('session-a', { runId: run.id, expectedRevision: current.revision, event: 'retrieval_completed', observation: { type: 'retrieval', result: '3 chunks' } })
  current = await store.advanceAgentRun('session-a', { runId: run.id, expectedRevision: current.revision, event: 'evidence_sufficient' })
  current = await store.advanceAgentRun('session-a', { runId: run.id, expectedRevision: current.revision, event: 'draft_completed' })
  current = await store.advanceAgentRun('session-a', { runId: run.id, expectedRevision: current.revision, event: 'validation_passed' })
  assert.equal(current.state, 'awaiting_user_decision')
  assert.equal(current.observations.length, 1)
  await assert.rejects(store.advanceAgentRun('session-a', { runId: run.id, expectedRevision: current.revision, event: 'apply_completed' }), /Invalid/)
})

test('requires a second decision after editing a review suggestion', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '论文项目' })
  const [suggestion] = await store.submitReviewSuggestions('session-a', {
    suggestions: [{
      targetType: 'outline',
      targetId: 'related-work',
      category: 'logic',
      text: '增加纵向演进比较',
    }],
  })

  const edited = await store.editReviewSuggestion('session-a', {
    suggestionId: suggestion.id,
    expectedRevision: 0,
    text: '增加 2018—2026 年的纵向技术演进比较',
  })
  assert.equal(edited.status, 'edited_pending_decision')
  assert.equal(edited.revision, 1)

  await assert.rejects(
    store.createRevisionBatch('session-a', { userChanges: [] }),
    /requires an accepted suggestion/,
  )

  const accepted = await store.decideReviewSuggestion('session-a', {
    suggestionId: suggestion.id,
    expectedRevision: 1,
    decision: 'accept',
  })
  assert.equal(accepted.status, 'accepted_for_revision')

  const batch = await store.createRevisionBatch('session-a', { userChanges: [] })
  assert.equal(batch.items.length, 1)
  assert.equal(batch.items[0].instruction, '增加 2018—2026 年的纵向技术演进比较')
})

test('combines accepted review suggestions and direct user changes', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '论文项目' })
  const [suggestion] = await store.submitReviewSuggestions('session-a', {
    suggestions: [{ targetType: 'logic', targetId: 'logic-1', text: '补充横向比较表' }],
  })
  await store.decideReviewSuggestion('session-a', {
    suggestionId: suggestion.id,
    expectedRevision: 0,
    decision: 'accept',
  })

  const batch = await store.createRevisionBatch('session-a', {
    userChanges: [{
      targetType: 'logic',
      targetId: 'logic-2',
      instruction: '保留用户手工修改的结论段',
    }],
  })

  assert.deepEqual(batch.items.map((item) => item.source).sort(), [
    'accepted_review_suggestion',
    'user_edit',
  ])
  assert.equal(batch.status, 'ready_for_confirmation')
})

test('isolates projects by session binding', async () => {
  const { store } = await createStore()
  const first = await store.createProject('session-a', { name: '项目 A' })
  await store.createProject('session-b', { name: '项目 B' })

  assert.equal(store.projectStatus('session-a').name, '项目 A')
  assert.equal(store.projectStatus('session-b').name, '项目 B')

  await store.bindProject('session-b', first.id)
  assert.equal(store.projectStatus('session-b').name, '项目 A')
})

test('resolves manuscript-to-logic and logic-to-manuscript navigation', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '双向编辑项目' })
  const planned = await store.setPlan('session-a', {
    expectedRevision: 0,
    confirmed: true,
    outline: [{
      title: '系统设计',
      logic: [
        { purpose: '先说明总体架构' },
        { purpose: '再说明核心模块协作' },
      ],
    }],
  })
  const outlineId = planned.outline[0].id
  const [architectureLogic, moduleLogic] = planned.logicBlocks

  const saved = await store.setManuscriptBlocks('session-a', {
    expectedRevision: 0,
    blocks: [
      {
        id: 'paragraph-1',
        outlineNodeId: outlineId,
        logicBlockIds: [architectureLogic.id],
        markdown: '系统采用分层架构。',
      },
      {
        id: 'paragraph-2',
        outlineNodeId: outlineId,
        logicBlockIds: [moduleLogic.id],
        markdown: '各模块通过稳定接口协作。',
      },
    ],
  })
  assert.equal(saved.manuscriptRevision, 1)

  const cursorSide = store.getLogicForBlock('session-a', 'paragraph-2')
  assert.equal(cursorSide.logicBlocks[0].id, moduleLogic.id)
  const reverseSide = store.locateBlocksForLogic('session-a', architectureLogic.id)
  assert.deepEqual(reverseSide.manuscriptBlocks.map((item) => item.id), ['paragraph-1'])

  await assert.rejects(
    store.setManuscriptBlocks('session-a', {
      expectedRevision: 0,
      blocks: [],
    }),
    /Manuscript revision conflict/,
  )
})

test('applies a rich unconfirmed master thesis template', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '模板项目', targetWords: 30000 })

  const workbench = await store.applyDefaultMasterTemplate('session-a', {
    expectedRevision: 0,
  })

  assert.equal(workbench.project.status, 'awaiting_plan_approval')
  assert.equal(workbench.outline.length, 8)
  const relatedWork = workbench.outline.find((item) => item.title.includes('研究现状'))
  const relatedLogic = workbench.logicBlocks.filter((item) => item.outlineNodeId === relatedWork.id)
  assert.ok(relatedLogic.some((item) => item.purpose.includes('横向比较')))
  assert.ok(relatedLogic.some((item) => item.purpose.includes('纵向梳理')))
  assert.equal(workbench.outline.reduce((sum, item) => sum + item.targetWords, 0), 30000)
})

test('requires two decisions before applying a review-driven manuscript patch', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '双重确认项目' })
  const planned = await store.setPlan('session-a', {
    expectedRevision: 0,
    confirmed: true,
    outline: [{ title: '研究现状', logic: [{ purpose: '横向比较现有方法' }] }],
  })
  const outlineId = planned.outline[0].id
  const logicId = planned.logicBlocks[0].id
  await store.setManuscriptBlocks('session-a', {
    expectedRevision: 0,
    blocks: [{
      id: 'paragraph-1',
      outlineNodeId: outlineId,
      logicBlockIds: [logicId],
      markdown: '现有方法包括关键词检索。',
    }],
  })
  const [suggestion] = await store.submitReviewSuggestions('session-a', {
    suggestions: [{
      targetType: 'block',
      targetId: 'paragraph-1',
      text: '补充向量检索和混合检索的横向比较',
    }],
  })
  await store.decideReviewSuggestion('session-a', {
    suggestionId: suggestion.id,
    expectedRevision: 0,
    decision: 'accept',
  })
  const batch = await store.createRevisionBatch('session-a', { userChanges: [] })
  assert.equal(batch.status, 'ready_for_confirmation')
  const confirmed = await store.confirmRevisionBatch('session-a', {
    batchId: batch.id,
    expectedRevision: batch.revision,
    confirmed: true,
  })
  assert.equal(confirmed.status, 'confirmed')
  const patch = await store.submitPatchProposal('session-a', {
    batchId: batch.id,
    baseManuscriptRevision: 1,
    changes: [{
      blockId: 'paragraph-1',
      expectedBlockRevision: 0,
      markdown: '现有方法包括关键词检索、向量检索与混合检索，三者在精确匹配、语义召回和融合成本方面各有差异。',
      reason: '落实已接受的横向比较建议',
    }],
  })
  assert.equal(store.getWorkbench('session-a').manuscriptBlocks[0].markdown, '现有方法包括关键词检索。')

  const applied = await store.decidePatchProposal('session-a', {
    patchId: patch.id,
    expectedRevision: 0,
    decision: 'accept',
  })
  assert.equal(applied.manuscriptRevision, 2)
  assert.equal(applied.version.manuscriptBlocks[0].markdown, patch.changes[0].afterMarkdown)
  assert.equal(store.getWorkbench('session-a').manuscriptVersions.length, 1)
})

test('rejecting a patch leaves manuscript content and revision unchanged', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '拒绝 Patch 项目' })
  const planned = await store.setPlan('session-a', {
    expectedRevision: 0,
    confirmed: true,
    outline: [{ title: '总结', logic: [{ purpose: '总结主要贡献' }] }],
  })
  await store.setManuscriptBlocks('session-a', {
    expectedRevision: 0,
    blocks: [{
      id: 'summary-1',
      outlineNodeId: planned.outline[0].id,
      logicBlockIds: [planned.logicBlocks[0].id],
      markdown: '原总结。',
    }],
  })
  const batch = await store.createRevisionBatch('session-a', {
    userChanges: [{ targetType: 'block', targetId: 'summary-1', instruction: '扩写贡献' }],
  })
  await store.confirmRevisionBatch('session-a', {
    batchId: batch.id,
    expectedRevision: 0,
    confirmed: true,
  })
  const patch = await store.submitPatchProposal('session-a', {
    batchId: batch.id,
    baseManuscriptRevision: 1,
    changes: [{ blockId: 'summary-1', expectedBlockRevision: 0, markdown: '候选总结。' }],
  })
  const rejected = await store.decidePatchProposal('session-a', {
    patchId: patch.id,
    expectedRevision: 0,
    decision: 'reject',
  })
  assert.equal(rejected.manuscriptRevision, 1)
  assert.equal(store.getWorkbench('session-a').manuscriptBlocks[0].markdown, '原总结。')
  assert.equal(store.getWorkbench('session-a').manuscriptVersions.length, 0)
})

test('requires plan and user confirmation before accepting a scoped generation', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '生成闭环项目' })
  await assert.rejects(store.prepareGeneration('session-a', { scope: 'full' }), /must be confirmed/)
  const planned = await store.setPlan('session-a', {
    expectedRevision: 0,
    confirmed: true,
    outline: [
      { title: '绪论', logic: [{ purpose: '说明研究背景' }] },
      { title: '系统设计', logic: [{ purpose: '说明系统架构' }] },
    ],
  })
  const prepared = await store.prepareGeneration('session-a', {
    scope: 'chapters', outlineNodeIds: [planned.outline[1].id],
  })
  assert.equal(prepared.task.status, 'prepared_pending_confirmation')
  await assert.rejects(store.submitGeneratedScope('session-a', { taskId: prepared.task.id, blocks: [] }), /not confirmed/)
  const confirmed = await store.confirmGeneration('session-a', {
    taskId: prepared.task.id, expectedRevision: 0, confirmed: true,
  })
  const candidate = await store.submitGeneratedScope('session-a', {
    taskId: prepared.task.id,
    blocks: [{
      outlineNodeId: planned.outline[1].id,
      logicBlockIds: [planned.logicBlocks[1].id],
      markdown: '系统采用插件化分层架构。',
    }],
  })
  assert.equal(candidate.status, 'candidate_pending_acceptance')
  assert.equal(store.getWorkbench('session-a').manuscriptBlocks.length, 0)
  const accepted = await store.decideGeneratedScope('session-a', {
    taskId: prepared.task.id, expectedRevision: confirmed.revision + 1, decision: 'accept',
  })
  assert.equal(accepted.manuscriptRevision, 1)
  assert.equal(store.getWorkbench('session-a').manuscriptBlocks[0].markdown, '系统采用插件化分层架构。')
  assert.equal(store.getWorkbench('session-a').manuscriptVersions[0].reason, 'accepted_generation')
})

test('imports a reference structure as an unconfirmed editable plan', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '参考模板项目' })
  const imported = await store.importReferenceTemplate('session-a', {
    sourceName: '优秀硕士论文.pdf', expectedRevision: 0,
    extractionNotes: '由写作 Agent 提取，待用户确认',
    outline: [{ title: '相关工作', logic: [{ purpose: '先横向比较，再纵向总结' }] }],
  })
  assert.equal(imported.template.status, 'extracted_pending_confirmation')
  assert.equal(imported.workbench.project.status, 'awaiting_plan_approval')
  assert.equal(imported.workbench.referenceTemplates.length, 1)
})

test('indexes approved source text idempotently and returns traceable hybrid results', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '检索项目' })
  const first = await store.importSourceText('session-a', {
    sourceKey: 'docs/experiment.md', name: 'experiment.md',
    content: '# 实验结果\n混合检索的召回率为 92%，关键词检索为 81%。\n\n# 结论\n融合方法提高了召回率。',
    maxChars: 300,
  })
  const repeated = await store.importSourceText('session-a', {
    sourceKey: 'docs/experiment.md', name: 'experiment.md',
    content: '# 实验结果\n混合检索的召回率为 92%，关键词检索为 81%。\n\n# 结论\n融合方法提高了召回率。',
    maxChars: 300,
  })
  assert.equal(first.unchanged, false)
  assert.equal(repeated.unchanged, true)
  const results = await store.searchSources('session-a', { query: '混合检索召回率', limit: 3 })
  assert.ok(results.length > 0)
  assert.equal(results[0].sourceName, 'experiment.md')
  assert.ok(results[0].startLine >= 1)
  assert.ok(results[0].relevance > 0)
  assert.equal('embedding' in results[0], false)
})

test('keeps source evidence hidden, invalidates it on source changes, and blocks unsafe export', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '证据回溯项目' })
  const planned = await store.setPlan('session-a', {
    expectedRevision: 0, confirmed: true,
    outline: [{ title: '实验', logic: [{ purpose: '报告可回溯结果' }] }],
  })
  await store.setManuscriptBlocks('session-a', { expectedRevision: 0, blocks: [{
    id: 'result-1', outlineNodeId: planned.outline[0].id, logicBlockIds: [planned.logicBlocks[0].id], markdown: '召回率为 92%。',
  }] })
  await store.importSourceText('session-a', { sourceKey: 'result.md', name: 'result.md', content: '实验召回率为 92%。' })
  const result = (await store.searchSources('session-a', { query: '召回率 92', limit: 1 }))[0]
  await store.bindBlockSources('session-a', { blockId: 'result-1', chunkIds: [result.id] })
  assert.equal(store.inspectAndExport('session-a').canExport, true)
  await store.importSourceText('session-a', { sourceKey: 'result.md', name: 'result.md', content: '复核后实验召回率为 89%。' })
  const inspected = store.inspectAndExport('session-a')
  assert.equal(inspected.canExport, false)
  assert.ok(inspected.issues.some((item) => item.code === 'SOURCE_STALE'))
})

test('builds a deduplicated evidence package under a context budget', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '证据包项目' })
  await store.importSourceText('session-a', { sourceKey: 'a.md', name: 'a.md', content: '# 结果\n混合检索召回率达到92%。\n该结果来自测试集。' })
  const pack = await store.buildEvidencePackage('session-a', { task: '撰写实验分析', query: '混合检索召回率', characterBudget: 200, limit: 10 })
  assert.equal(pack.task, '撰写实验分析')
  assert.ok(pack.evidence.length > 0)
  assert.ok(pack.usedCharacters <= 200)
  assert.equal(new Set(pack.evidence.map((item) => item.contentHash)).size, pack.evidence.length)
})

test('requires human approval before binding and formatting literature citations', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '文献项目' })
  const planned = await store.setPlan('session-a', { expectedRevision: 0, confirmed: true, outline: [{ title: '相关工作', logic: [{ purpose: '比较已有研究' }] }] })
  await store.setManuscriptBlocks('session-a', { expectedRevision: 0, blocks: [{ id: 'related-1', outlineNodeId: planned.outline[0].id, logicBlockIds: [planned.logicBlocks[0].id], markdown: '已有研究采用混合检索。' }] })
  const [candidate] = await store.submitLiteratureCandidates('session-a', { discoverySource: 'LLM 检索建议', candidates: [{ title: 'Hybrid Retrieval for RAG', doi: 'https://doi.org/10.1000/test', authors: ['Zhang San'], year: 2025, venue: 'AI Journal', relevanceReason: '比较混合检索方法' }] })
  await assert.rejects(store.bindCitation('session-a', { blockId: 'related-1', literatureId: candidate.id }), /Only approved/)
  const approved = await store.decideLiterature('session-a', { literatureId: candidate.id, expectedRevision: 0, decision: 'approve' })
  assert.equal(approved.status, 'approved_for_citation')
  await store.bindCitation('session-a', { blockId: 'related-1', literatureId: candidate.id, locator: 'p. 12' })
  const references = store.formatReferences('session-a', { style: 'gb-t-7714' })
  assert.match(references[0].text, /Hybrid Retrieval for RAG/)
  assert.equal(store.inspectAndExport('session-a').canExport, true)
})

test('quality checks detect unsupported numbers, duplicate text, and weak related-work logic', async () => {
  const { store } = await createStore()
  await store.createProject('session-a', { name: '审查项目' })
  const planned = await store.setPlan('session-a', { expectedRevision: 0, confirmed: true, outline: [{ title: '国内外研究现状', targetWords: 1000, logic: [{ purpose: '介绍已有研究' }] }] })
  const duplicate = '实验结果表明，该方法召回率达到92%，但当前段落没有绑定任何实验来源。'
  await store.setManuscriptBlocks('session-a', { expectedRevision: 0, blocks: [
    { id: 'review-1', outlineNodeId: planned.outline[0].id, logicBlockIds: [planned.logicBlocks[0].id], markdown: duplicate },
    { id: 'review-2', outlineNodeId: planned.outline[0].id, logicBlockIds: [planned.logicBlocks[0].id], markdown: duplicate },
  ] })
  const report = await store.runQualityChecks('session-a', { submitSuggestions: true })
  assert.ok(report.findings.some((item) => item.code === 'NUMERIC_CLAIM_WITHOUT_SOURCE'))
  assert.ok(report.findings.some((item) => item.code === 'DUPLICATE_PARAGRAPH'))
  assert.ok(report.findings.some((item) => item.code === 'RELATED_WORK_COMPARISON_MISSING'))
  assert.ok(store.getWorkbench('session-a').reviewSuggestions.length >= report.findings.length)
})
