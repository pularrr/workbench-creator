import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createMasterThesisTemplate } from './master-template.js'
import { chunkText, contentHash, hybridSearch } from './source-index.js'
import { parseApprovedDocument, scanApprovedDirectory } from './document-parser.js'
import { createEmbeddingProvider, embedInBatches } from './embedding-provider.js'
import { exportDocx } from './docx-exporter.js'
import { buildManuscriptModel } from './manuscript-model.js'
import { exportLatex } from './latex-exporter.js'
import { advanceAgentRun, cancelAgentRun, createAgentRun, getEventGuidance, pauseAgentRun, resumeAgentRun } from './agent-run.js'
import { createReranker, rerankPassages } from './reranker.js'
import { expandTemplatePack, getBuiltinPack, listBuiltinPacks, loadTemplatePack, validateTemplatePack } from './template-pack.js'
import { listEmbeddingPresets as listEmbeddingPresetsAll, resolveEmbeddingPreset } from './embedding-presets.js'
import { createStorageBackend } from './storage-sqlite.js'

const CURRENT_SCHEMA_VERSION = 1

function now() {
  return new Date().toISOString()
}

function clone(value) {
  return structuredClone(value)
}

/** Return a copy of a config object with any embedded API key stripped. */
function withoutSecret(config) {
  const { apiKey: _omit, ...safe } = config
  return safe
}

function createEmptyState() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sessionBindings: {},
    projects: {},
  }
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value.trim()
}

function requireArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

export class ThesisDomainStore {
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir
    this.statePath = path.join(dataDir, 'state.json')
    this.state = createEmptyState()
    this.writeQueue = Promise.resolve()
    this.defaultEmbeddingConfig = options.embedding || { type: 'local-hash' }
    this.embeddingSecrets = new Map()
    this.embeddingBatchSize = Number(options.embeddingBatchSize || 32)
    this.storageOptions = options.storage || {}
    this.storage = null
  }

  async initialize() {
    this.storage = await createStorageBackend(this.dataDir, this.storageOptions)
    const parsed = await this.storage.load()
    if (parsed) {
      if (parsed.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        throw new Error(`unsupported thesis store schema: ${parsed.schemaVersion}`)
      }
      this.state = parsed
    } else {
      await this.storage.save(this.state)
    }
  }

  async #persist() {
    if (!this.storage) return
    this.writeQueue = this.writeQueue.then(() => this.storage.save(this.state))
    await this.writeQueue
  }

  #projectForSession(sessionId) {
    const projectId = this.state.sessionBindings[sessionId]
    const project = projectId ? this.state.projects[projectId] : undefined
    if (!project) {
      const available = this.listProjects()
      const hint = available.length
        ? ` Available projects: ${available.map((p) => `"${p.name}"`).join(', ')}. Use thesis_list_projects to see all, thesis_bind_project to rebind, or thesis_create_project to create a new one.`
        : ' No projects exist yet. Use thesis_create_project to create one.'
      throw new Error(`No thesis project is bound to this session (the previously bound project may have been deleted).${hint}`)
    }
    return project
  }

  #embeddingConfig(project) {
    project.embeddingConfig ||= { ...clone(this.defaultEmbeddingConfig), revision: 0 }
    project.embeddingIndex ||= { status: 'ready', revision: 0, providerId: createEmbeddingProvider(this.defaultEmbeddingConfig).id, indexedChunks: project.sourceChunks?.length || 0, totalChunks: project.sourceChunks?.length || 0 }
    return project.embeddingConfig
  }

  #embeddingProvider(project, temporarySecret) {
    const config = this.#embeddingConfig(project)
    const apiKey = temporarySecret || this.embeddingSecrets.get(project.id)
    return createEmbeddingProvider({ ...config, ...(apiKey ? { apiKey } : {}) })
  }

  async createProject(sessionId, input) {
    const projectId = randomUUID()
    const createdAt = now()
    const project = {
      id: projectId,
      name: requireText(input.name, 'name'),
      title: typeof input.title === 'string' ? input.title.trim() : '',
      degreeType: input.degreeType || 'master',
      targetWords: Number.isFinite(input.targetWords) ? Math.max(0, Math.round(input.targetWords)) : 0,
      status: 'planning',
      planningRevision: 0,
      manuscriptRevision: 0,
      templateRevision: 0,
      outline: [],
      logicBlocks: [],
      manuscriptBlocks: [],
      reviewSuggestions: [],
      revisionBatches: [],
      patchProposals: [],
      referenceTemplates: [],
      generationTasks: [],
      agentRuns: [],
      sourceDocuments: [],
      sourceChunks: [],
      sourceBindings: [],
      literature: [],
      citations: [],
      manuscriptVersions: [],
      templatePacks: [],
      customTemplates: [],
      embeddingConfig: { ...withoutSecret(clone(this.defaultEmbeddingConfig)), revision: 0 },
      embeddingIndex: { status: 'ready', revision: 0, providerId: createEmbeddingProvider(this.defaultEmbeddingConfig).id, indexedChunks: 0, totalChunks: 0 },
      exportTemplate: {
        name: '通用硕士论文', fontFamily: '宋体', bodyFontSizeHalfPoints: 24,
        referenceFontSizeHalfPoints: 21, firstLineIndentTwips: 480, lineSpacingTwips: 360,
        referencesTitle: '参考文献', includeTitlePage: true,
      },
      createdAt,
      updatedAt: createdAt,
    }
    this.state.projects[projectId] = project
    this.state.sessionBindings[sessionId] = projectId
    await this.#persist()
    return clone(project)
  }

  async deleteProject(projectId) {
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    const name = project.name
    delete this.state.projects[projectId]
    // Clean up all session bindings pointing to this project
    for (const [sid, pid] of Object.entries(this.state.sessionBindings)) {
      if (pid === projectId) delete this.state.sessionBindings[sid]
    }
    await this.#persist()
    return { deleted: true, id: projectId, name, remainingProjects: this.listProjects().length }
  }

  async bindProject(sessionId, projectId) {
    if (!this.state.projects[projectId]) throw new Error('Project not found')
    this.state.sessionBindings[sessionId] = projectId
    await this.#persist()
    return this.projectStatus(sessionId)
  }

  /**
   * Auto-follow the most recently active project (v1.1).
   * If this session is not bound yet, bind it to the project with the
   * latest updatedAt — so the workbench side-panel can track the project
   * created/loaded from natural-language dialogue without a manual bind.
   * Never rebinds a session that already has a project.
   */
  async followRecentProject(sessionId) {
    if (this.state.sessionBindings[sessionId]) {
      return { bound: true, ...this.projectStatus(sessionId), autoBound: false }
    }
    const projects = this.listProjects()
    if (!projects.length) return { bound: false }
    const target = projects[0]
    await this.bindProject(sessionId, target.id)
    return { bound: true, ...this.projectStatus(sessionId), autoBound: true }
  }

  async requestRegeneration(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    project.regenerationRequests ||= []
    const request = {
      id: randomUUID(),
      blockId: input.blockId || null,
      content: String(input.content || '').slice(0, 50000),
      instruction: String(input.instruction || '基于当前修改重新生成相关内容'),
      createdAt: now(),
      status: 'pending',
    }
    project.regenerationRequests.push(request)
    project.updatedAt = now()
    await this.#persist()
    return clone(request)
  }

  listRegenerationRequests(sessionId) {
    const project = this.#projectForSession(sessionId)
    return clone((project.regenerationRequests || []).filter((r) => r.status === 'pending'))
  }

  async resolveRegeneration(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const request = (project.regenerationRequests || []).find((r) => r.id === input.requestId)
    if (!request) throw new Error('Regeneration request not found')
    request.status = input.status === 'cancelled' ? 'cancelled' : 'completed'
    request.resolvedAt = now()
    project.updatedAt = now()
    await this.#persist()
    return clone(request)
  }

  listProjects() {
    return Object.values(this.state.projects).map((project) => ({
      id: project.id, name: project.name, title: project.title, status: project.status,
      planningRevision: project.planningRevision, manuscriptRevision: project.manuscriptRevision, updatedAt: project.updatedAt,
    })).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  projectStatus(sessionId) {
    const project = this.#projectForSession(sessionId)
    return {
      id: project.id,
      name: project.name,
      title: project.title,
      degreeType: project.degreeType,
      targetWords: project.targetWords,
      status: project.status,
      planningRevision: project.planningRevision,
      manuscriptRevision: project.manuscriptRevision,
      templateRevision: project.templateRevision || 0,
      outlineCount: project.outline.length,
      logicBlockCount: project.logicBlocks.length,
      manuscriptBlockCount: project.manuscriptBlocks.length,
      generationTaskCount: (project.generationTasks || []).length,
      agentRunCount: (project.agentRuns || []).length,
      sourceDocumentCount: (project.sourceDocuments || []).filter((item) => item.status === 'indexed').length,
      approvedLiteratureCount: (project.literature || []).filter((item) => item.status === 'approved_for_citation').length,
      pendingReviewCount: project.reviewSuggestions.filter((item) =>
        ['proposed', 'edited_pending_decision'].includes(item.status),
      ).length,
      acceptedReviewCount: project.reviewSuggestions.filter((item) => item.status === 'accepted_for_revision').length,
      embedding: this.getEmbeddingStatus(sessionId),
      updatedAt: project.updatedAt,
    }
  }

  async setPlan(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const expectedRevision = Number(input.expectedRevision)
    if (expectedRevision !== project.planningRevision) {
      throw new Error(`Planning revision conflict: expected ${expectedRevision}, current ${project.planningRevision}`)
    }
    const outlineInput = requireArray(input.outline, 'outline')
    const nextOutline = []
    const nextLogic = []
    for (const [outlineIndex, nodeInput] of outlineInput.entries()) {
      const outlineId = nodeInput.id || randomUUID()
      const node = {
        id: outlineId,
        title: requireText(nodeInput.title, `outline[${outlineIndex}].title`),
        objective: typeof nodeInput.objective === 'string' ? nodeInput.objective.trim() : '',
        targetWords: Number.isFinite(nodeInput.targetWords) ? Math.max(0, Math.round(nodeInput.targetWords)) : 0,
        expectedFigures: Number.isFinite(nodeInput.expectedFigures) ? Math.max(0, Math.round(nodeInput.expectedFigures)) : 0,
        expectedTables: Number.isFinite(nodeInput.expectedTables) ? Math.max(0, Math.round(nodeInput.expectedTables)) : 0,
        expectedMedia: typeof nodeInput.expectedMedia === 'string' ? nodeInput.expectedMedia.trim() : '',
        order: outlineIndex,
        locked: Boolean(nodeInput.locked),
      }
      nextOutline.push(node)
      for (const [logicIndex, logicInput] of requireArray(nodeInput.logic || [], `outline[${outlineIndex}].logic`).entries()) {
        nextLogic.push({
          id: logicInput.id || randomUUID(),
          outlineNodeId: outlineId,
          purpose: requireText(logicInput.purpose, `outline[${outlineIndex}].logic[${logicIndex}].purpose`),
          transition: typeof logicInput.transition === 'string' ? logicInput.transition.trim() : '',
          targetWords: Number.isFinite(logicInput.targetWords) ? Math.max(0, Math.round(logicInput.targetWords)) : 0,
          order: logicIndex,
          status: 'confirmed',
        })
      }
    }
    project.outline = nextOutline
    project.logicBlocks = nextLogic
    const validLogicIds = new Set(nextLogic.map((item) => item.id))
    for (const block of project.manuscriptBlocks) {
      block.bindingStatus = block.logicBlockIds.every((id) => validLogicIds.has(id)) ? 'linked' : 'stale'
    }
    project.planningRevision += 1
    project.status = input.confirmed ? 'ready_to_generate' : 'awaiting_plan_approval'
    project.updatedAt = now()
    await this.#persist()
    return this.getWorkbench(sessionId)
  }

  async applyDefaultMasterTemplate(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const targetWords = Number.isFinite(input.targetWords) ? input.targetWords : project.targetWords || 30000
    let outline
    if (typeof input.packId === 'string' && input.packId.trim()) {
      const pack = this.#resolveTemplatePack(project, input.packId.trim())
      if (!pack) throw new Error(`Template pack not found: ${input.packId}`)
      outline = expandTemplatePack(pack, targetWords)
    } else {
      outline = createMasterThesisTemplate(targetWords)
    }
    return this.setPlan(sessionId, {
      expectedRevision: input.expectedRevision,
      confirmed: false,
      outline,
    })
  }

  #resolveTemplatePack(project, packId) {
    const projectPack = (project.templatePacks || []).find((pack) => pack.id === packId)
    if (projectPack) return projectPack
    return getBuiltinPack(packId)
  }

  listTemplatePacks(sessionId) {
    const project = this.#projectForSession(sessionId)
    const builtin = listBuiltinPacks()
    const projectPacks = project.templatePacks || []
    const byId = new Map()
    for (const pack of [...builtin, ...projectPacks]) byId.set(pack.id, pack)
    return clone([...byId.values()].map(({ id, name, degreeType, targetWords, sections }) => ({
      id, name, degreeType, targetWords, sectionCount: sections.length,
      source: builtin.some((p) => p.id === id) ? 'builtin' : 'project',
    })))
  }

  async importTemplatePack(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const filePath = requireText(input.filePath, 'filePath')
    const pack = await loadTemplatePack(filePath)
    project.templatePacks ||= []
    project.templatePacks = project.templatePacks.filter((existing) => existing.id !== pack.id)
    project.templatePacks.push(pack)
    project.templateRevision = Number(project.templateRevision || 0) + 1
    project.updatedAt = now()
    await this.#persist()
    return clone({ imported: pack.id, name: pack.name, degreeType: pack.degreeType, totalPacks: project.templatePacks.length })
  }

  listCustomTemplates(sessionId) {
    const project = this.#projectForSession(sessionId)
    return clone((project.customTemplates || []).map(({ id, name, type, description, revision, createdAt, updatedAt }) => ({ id, name, type, description, revision, createdAt, updatedAt })))
  }

  getCustomTemplate(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const template = (project.customTemplates || []).find((t) => t.id === input.templateId)
    if (!template) throw new Error('Custom template not found')
    return clone(template)
  }

  async saveCustomTemplate(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    project.customTemplates ||= []
    const type = ['text', 'format'].includes(input.type) ? input.type : 'text'
    const content = typeof input.content === 'string' ? input.content : ''
    const nowTs = now()
    if (input.templateId) {
      const existing = project.customTemplates.find((t) => t.id === input.templateId)
      if (!existing) throw new Error('Custom template not found')
      existing.name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : existing.name
      existing.description = typeof input.description === 'string' ? input.description : existing.description
      existing.type = type
      existing.content = content
      existing.revision = Number(existing.revision || 0) + 1
      existing.updatedAt = nowTs
      project.updatedAt = nowTs
      await this.#persist()
      return clone(existing)
    }
    const template = {
      id: randomUUID(),
      name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : `自定义${type === 'format' ? '格式' : '文本'}模板`,
      description: typeof input.description === 'string' ? input.description : '',
      type,
      content,
      revision: 1,
      createdAt: nowTs,
      updatedAt: nowTs,
    }
    project.customTemplates.push(template)
    project.updatedAt = nowTs
    await this.#persist()
    return clone(template)
  }

  async deleteCustomTemplate(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const before = (project.customTemplates || []).length
    project.customTemplates = (project.customTemplates || []).filter((t) => t.id !== input.templateId)
    if (project.customTemplates.length === before) throw new Error('Custom template not found')
    project.updatedAt = now()
    await this.#persist()
    return { deleted: true, id: input.templateId, remaining: project.customTemplates.length }
  }

  getWorkbench(sessionId) {
    const project = this.#projectForSession(sessionId)
    const chunkById = new Map((project.sourceChunks || []).map((item) => [item.id, item]))
    return clone({
      project: this.projectStatus(sessionId),
      outline: project.outline,
      logicBlocks: project.logicBlocks,
      manuscriptBlocks: project.manuscriptBlocks,
      reviewSuggestions: project.reviewSuggestions,
      revisionBatches: project.revisionBatches,
      patchProposals: project.patchProposals,
      referenceTemplates: project.referenceTemplates || [],
      generationTasks: project.generationTasks || [],
      agentRuns: project.agentRuns || [],
      sourceDocuments: project.sourceDocuments || [],
      sourceBindings: (project.sourceBindings || []).map((binding) => {
        const chunk = chunkById.get(binding.chunkId)
        return { ...binding, sourceName: chunk?.sourceName, startLine: chunk?.startLine, endLine: chunk?.endLine, content: chunk?.content }
      }),
      literature: project.literature || [],
      citations: project.citations || [],
      regenerationRequests: (project.regenerationRequests || []).filter((r) => r.status === 'pending'),
      manuscriptVersions: project.manuscriptVersions,
      templatePacks: (project.templatePacks || []).map(({ id, name, degreeType, targetWords, sections }) => ({
        id, name, degreeType, targetWords, sectionCount: sections.length,
      })),
      customTemplates: project.customTemplates || [],
      exportTemplate: project.exportTemplate || {},
      embeddingConfig: withoutSecret(this.#embeddingConfig(project)),
      embeddingIndex: project.embeddingIndex,
    })
  }

  async setManuscriptBlocks(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const expectedRevision = Number(input.expectedRevision)
    if (expectedRevision !== project.manuscriptRevision) {
      throw new Error(`Manuscript revision conflict: expected ${expectedRevision}, current ${project.manuscriptRevision}`)
    }
    const outlineIds = new Set(project.outline.map((item) => item.id))
    const logicIds = new Set(project.logicBlocks.map((item) => item.id))
    const previousById = new Map(project.manuscriptBlocks.map((item) => [item.id, item]))
    const seenIds = new Set()
    const nextBlocks = requireArray(input.blocks, 'blocks').map((blockInput, index) => {
      const id = blockInput.id || randomUUID()
      if (seenIds.has(id)) throw new Error(`Duplicate manuscript block id: ${id}`)
      seenIds.add(id)
      const outlineNodeId = requireText(blockInput.outlineNodeId, `blocks[${index}].outlineNodeId`)
      if (!outlineIds.has(outlineNodeId)) throw new Error(`Unknown outline node: ${outlineNodeId}`)
      const blockLogicIds = requireArray(blockInput.logicBlockIds, `blocks[${index}].logicBlockIds`)
      for (const logicId of blockLogicIds) {
        if (!logicIds.has(logicId)) throw new Error(`Unknown logic block: ${logicId}`)
      }
      const previous = previousById.get(id)
      if (previous && Number(blockInput.revision) !== previous.revision) {
        throw new Error(`Block revision conflict for ${id}: expected ${blockInput.revision}, current ${previous.revision}`)
      }
      const uniqueLogicIds = [...new Set(blockLogicIds)]
      const markdown = typeof blockInput.markdown === 'string' ? blockInput.markdown : ''
      const changed = previous && (previous.markdown !== markdown || previous.outlineNodeId !== outlineNodeId || JSON.stringify(previous.logicBlockIds) !== JSON.stringify(uniqueLogicIds))
      return {
        id,
        outlineNodeId,
        logicBlockIds: uniqueLogicIds,
        type: blockInput.type || 'paragraph',
        markdown,
        order: index,
        userLocked: Boolean(blockInput.userLocked),
        bindingStatus: blockLogicIds.length > 0 ? 'linked' : 'unlinked',
        revision: previous ? previous.revision + (changed ? 1 : 0) : 0,
      }
    })
    const changedOrDeletedIds = new Set()
    for (const previous of project.manuscriptBlocks) {
      const next = nextBlocks.find((item) => item.id === previous.id)
      if (!next || next.revision !== previous.revision) changedOrDeletedIds.add(previous.id)
    }
    for (const binding of project.sourceBindings || []) if (changedOrDeletedIds.has(binding.blockId)) binding.status = 'stale'
    for (const citation of project.citations || []) if (changedOrDeletedIds.has(citation.blockId)) citation.status = 'stale'
    project.manuscriptBlocks = nextBlocks
    project.manuscriptRevision += 1
    project.updatedAt = now()
    await this.#persist()
    return {
      manuscriptRevision: project.manuscriptRevision,
      blocks: clone(nextBlocks),
    }
  }

  getEmbeddingStatus(sessionId) {
    const project = this.#projectForSession(sessionId)
    const config = this.#embeddingConfig(project)
    const needsKey = config.requiresKey !== false
    const needsSecret = config.type === 'openai-compatible' && needsKey && !this.embeddingSecrets.has(project.id) && !(config.apiKeyEnv && process.env[config.apiKeyEnv])
    return clone({
      provider: config.type, model: config.model || '', endpoint: config.endpoint || '', revision: config.revision || 0,
      credentialReady: !needsSecret, index: project.embeddingIndex,
    })
  }

  listEmbeddingPresets() {
    return clone(listEmbeddingPresetsAll())
  }

  async testEmbeddingConnection(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const started = Date.now()
    const provider = createEmbeddingProvider({ ...input.config, ...(input.apiKey ? { apiKey: input.apiKey } : {}) })
    const [vector] = await provider.embedBatch(['论文知识库语义检索连接测试'])
    if (!Array.isArray(vector) || vector.length === 0) throw new Error('Embedding provider returned an empty vector')
    return clone({ ok: true, providerId: provider.id, dimensions: vector.length, latencyMs: Date.now() - started, projectId: project.id })
  }

  async setEmbeddingConfig(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const current = this.#embeddingConfig(project)
    if (Number(input.expectedRevision) !== Number(current.revision || 0)) throw new Error(`Embedding config revision conflict: expected ${input.expectedRevision}, current ${current.revision || 0}`)
    const next = clone(input.config || {})
    if (!['local-hash', 'openai-compatible'].includes(next.type)) throw new Error('Unsupported embedding provider')
    const provider = createEmbeddingProvider({ ...next, ...(input.apiKey ? { apiKey: input.apiKey } : {}) })
    if (input.apiKey) this.embeddingSecrets.set(project.id, input.apiKey)
    project.embeddingConfig = { ...withoutSecret(next), revision: Number(current.revision || 0) + 1 }
    const total = (project.sourceChunks || []).length
    project.embeddingIndex = { status: total ? 'stale' : 'ready', revision: Number(project.embeddingIndex?.revision || 0), providerId: provider.id, indexedChunks: total ? 0 : 0, totalChunks: total, updatedAt: now() }
    project.updatedAt = now(); await this.#persist(); return this.getEmbeddingStatus(sessionId)
  }

  /**
   * One-call conversational embedding setup (v1.1):
   * resolve preset → (optional) test connection → save config + secret →
   * (optional) rebuild all chunk vectors. Lets the Agent turn natural
   * language ("用 DeepSeek 的向量模型，Key 是 xxx") into a fully configured
   * semantic index without the user ever touching the settings page.
   */
  async setEmbeddingPreset(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const current = this.#embeddingConfig(project)
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 0)) {
      throw new Error(`Embedding config revision conflict: expected ${input.expectedRevision}, current ${current.revision || 0}`)
    }
    const preset = resolveEmbeddingPreset(input.provider)
    if (!preset) throw new Error(`Unknown embedding preset: ${input.provider}. Use thesis_list_embedding_presets to see available options.`)
    const next = {
      type: 'openai-compatible',
      endpoint: String(input.endpoint || preset.endpoint || '').replace(/\/$/, ''),
      model: String(input.model || preset.model || ''),
      requiresKey: preset.requiresKey !== false,
    }
    if (!next.endpoint || !next.model) throw new Error('Embedding preset requires endpoint and model')
    const provider = createEmbeddingProvider({ ...next, ...(input.apiKey ? { apiKey: input.apiKey } : {}) })

    // Optional pre-flight connection test before persisting anything.
    if (input.test !== false) {
      try {
        await provider.embedBatch(['论文知识库语义检索连接测试'])
      } catch (error) {
        throw new Error(`Embedding connection test failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (input.apiKey) this.embeddingSecrets.set(project.id, input.apiKey)
    project.embeddingConfig = { ...withoutSecret(next), revision: Number(current.revision || 0) + 1, preset: preset.key }
    const total = (project.sourceChunks || []).length
    project.embeddingIndex = { status: total ? 'stale' : 'ready', revision: Number(project.embeddingIndex?.revision || 0), providerId: provider.id, indexedChunks: total ? 0 : 0, totalChunks: total, updatedAt: now() }
    project.updatedAt = now(); await this.#persist()

    // Rebuild existing chunk vectors unless explicitly skipped.
    if (total > 0 && input.rebuild !== false) {
      return this.rebuildEmbeddings(sessionId, {
        expectedConfigRevision: project.embeddingConfig.revision,
        batchSize: input.batchSize,
      })
    }
    return this.getEmbeddingStatus(sessionId)
  }

  async rebuildEmbeddings(sessionId, input = {}) {
    const project = this.#projectForSession(sessionId)
    const config = this.#embeddingConfig(project)
    if (Number(input.expectedConfigRevision) !== Number(config.revision || 0)) throw new Error(`Embedding config revision conflict: expected ${input.expectedConfigRevision}, current ${config.revision || 0}`)
    const provider = this.#embeddingProvider(project, input.apiKey)
    if (input.apiKey) this.embeddingSecrets.set(project.id, input.apiKey)
    const chunks = project.sourceChunks || []
    project.embeddingIndex = { ...project.embeddingIndex, status: 'rebuilding', totalChunks: chunks.length, indexedChunks: 0, providerId: provider.id, updatedAt: now() }
    await this.#persist()
    try {
      const vectors = await embedInBatches(provider, chunks.map((item) => item.content), Number(input.batchSize || this.embeddingBatchSize))
      for (let index = 0; index < chunks.length; index += 1) { chunks[index].embedding = vectors[index]; chunks[index].embeddingProvider = provider.id }
      project.embeddingIndex = { status: 'ready', revision: Number(project.embeddingIndex.revision || 0) + 1, providerId: provider.id, indexedChunks: chunks.length, totalChunks: chunks.length, updatedAt: now() }
    } catch (error) {
      project.embeddingIndex = { ...project.embeddingIndex, status: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: now() }
      await this.#persist(); throw error
    }
    project.updatedAt = now(); await this.#persist(); return this.getEmbeddingStatus(sessionId)
  }

  async importSourceText(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const text = requireText(input.content, 'content')
    const hash = contentHash(text)
    project.sourceDocuments ||= []
    project.sourceChunks ||= []
    const existing = project.sourceDocuments.find((item) => item.sourceKey === input.sourceKey)
    if (existing?.contentHash === hash && existing.status === 'indexed') {
      return clone({ document: existing, unchanged: true, chunkCount: project.sourceChunks.filter((item) => item.documentId === existing.id).length })
    }
    const document = existing || { id: randomUUID(), sourceKey: requireText(input.sourceKey, 'sourceKey'), createdAt: now() }
    document.name = requireText(input.name, 'name')
    document.mediaType = input.mediaType || 'text/plain'
    document.contentHash = hash
    document.status = 'indexing'
    document.updatedAt = now()
    if (!existing) project.sourceDocuments.push(document)
    const replacedChunkIds = new Set(project.sourceChunks.filter((item) => item.documentId === document.id).map((item) => item.id))
    project.sourceChunks = project.sourceChunks.filter((item) => item.documentId !== document.id)
    project.sourceBindings ||= []
    for (const binding of project.sourceBindings) {
      if (replacedChunkIds.has(binding.chunkId)) binding.status = 'stale'
    }
    const rawChunks = chunkText(text, { maxChars: input.maxChars, overlapChars: input.overlapChars })
    const provider = this.#embeddingProvider(project)
    const embeddings = await embedInBatches(provider, rawChunks.map((item) => item.content), this.embeddingBatchSize)
    const chunks = rawChunks.map((item, index) => ({
      id: `${document.id}:${index}`,
      projectId: project.id,
      documentId: document.id,
      sourceName: document.name,
      sourceKey: document.sourceKey,
      chunkIndex: index,
      content: item.content,
      startLine: item.startLine,
      endLine: item.endLine,
      contentHash: contentHash(item.content),
      mediaType: document.mediaType,
      embeddingProvider: provider.id,
      embedding: embeddings[index],
    }))
    project.sourceChunks.push(...chunks)
    document.status = 'indexed'
    document.chunkCount = chunks.length
    project.embeddingIndex = { status: 'ready', revision: Number(project.embeddingIndex?.revision || 0) + 1, providerId: provider.id, indexedChunks: project.sourceChunks.length, totalChunks: project.sourceChunks.length, updatedAt: now() }
    project.updatedAt = now()
    await this.#persist()
    return clone({ document, unchanged: false, chunkCount: chunks.length })
  }

  async scanDirectory(sessionId, input) {
    this.#projectForSession(sessionId)
    if (input.approved !== true) throw new Error('Directory scan requires explicit user approval')
    return scanApprovedDirectory(requireText(input.directory, 'directory'), input)
  }

  async importSourceFile(sessionId, input) {
    this.#projectForSession(sessionId)
    if (input.approved !== true) throw new Error('File parsing requires explicit user approval')
    const parsed = await parseApprovedDocument(requireText(input.filePath, 'filePath'), input)
    const indexed = await this.importSourceText(sessionId, {
      sourceKey: input.sourceKey || parsed.absolutePath,
      name: parsed.name,
      content: parsed.text,
      mediaType: parsed.mediaType,
      maxChars: input.maxChars,
      overlapChars: input.overlapChars,
    })
    return clone({ ...indexed, parsed: { name: parsed.name, mediaType: parsed.mediaType, metadata: parsed.metadata } })
  }

  async searchSources(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const query = requireText(input.query, 'query')
    const provider = this.#embeddingProvider(project)
    if (project.embeddingIndex?.status === 'stale') throw new Error('Embedding index is stale; rebuild it after changing the model')
    const [queryVector] = await provider.embedBatch([query])
    const documentIds = new Set(input.documentIds || [])
    const mediaTypes = new Set(input.mediaTypes || [])
    const candidates = (project.sourceChunks || []).filter((item) => item.embeddingProvider === provider.id &&
      (documentIds.size === 0 || documentIds.has(item.documentId)) && (mediaTypes.size === 0 || mediaTypes.has(item.mediaType)),
    )
    const results = hybridSearch(candidates, query, input.limit || 8, queryVector)
    const stripped = results.map(({ embedding, ...item }) => item)
    // Optional rerank (P1): re-sort top candidates with a cross-encoder-style provider.
    if (input.rerank && typeof input.rerank === 'object') {
      const rerankProvider = String(input.rerank.provider || 'local').toLowerCase()
      const topK = Math.min(Math.max(1, Number(input.rerank.topK) || stripped.length), stripped.length)
      try {
        const reranker = createReranker(rerankProvider, {
          apiKey: input.rerank.apiKey,
          model: input.rerank.model,
          endpoint: input.rerank.endpoint,
          fallbackToLocal: input.rerank.fallbackToLocal !== false,
        })
        const reranked = await rerankPassages(reranker, query, stripped.map((item) => item.content), topK)
        const byIndex = new Map(stripped.map((item, index) => [index, item]))
        const reordered = reranked.map(({ index, score }) => ({ ...(byIndex.get(index) || {}), rerankScore: score, relevance: score }))
        // Fill any missing items (in case reranker returned fewer) with the rest in original order.
        const returnedIndexes = new Set(reranked.map((r) => r.index))
        const rest = stripped.filter((_, index) => !returnedIndexes.has(index))
        return clone([...reordered, ...rest])
      } catch (error) {
        if (input.rerank.fallbackToLocal === false) throw error
        // Fall through to baseline results on rerank failure.
      }
    }
    return clone(stripped)
  }

  async buildEvidencePackage(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const budget = Math.max(200, Number(input.characterBudget || 6000))
    const results = await this.searchSources(sessionId, { ...input, limit: Math.min(Number(input.limit || 12), 30) })
    const selected = []
    let usedCharacters = 0
    for (const item of results) {
      if (selected.some((chosen) => chosen.contentHash === item.contentHash)) continue
      if (usedCharacters + item.content.length > budget && selected.length > 0) continue
      const content = item.content.slice(0, Math.max(0, budget - usedCharacters))
      if (!content) break
      selected.push({ ...item, content })
      usedCharacters += content.length
      if (usedCharacters >= budget) break
    }
    return clone({ projectId: project.id, task: typeof input.task === 'string' ? input.task.trim() : '', query: input.query, characterBudget: budget, usedCharacters, evidence: selected })
  }

  async bindBlockSources(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const block = project.manuscriptBlocks.find((item) => item.id === input.blockId)
    if (!block) throw new Error('Manuscript block not found')
    const chunkById = new Map((project.sourceChunks || []).map((item) => [item.id, item]))
    project.sourceBindings ||= []
    project.sourceBindings = project.sourceBindings.filter((item) => item.blockId !== block.id)
    const bindings = [...new Set(requireArray(input.chunkIds, 'chunkIds'))].map((chunkId) => {
      const chunk = chunkById.get(chunkId)
      if (!chunk) throw new Error(`Source chunk not found: ${chunkId}`)
      return { id: randomUUID(), blockId: block.id, chunkId, documentId: chunk.documentId, status: 'valid', createdAt: now() }
    })
    project.sourceBindings.push(...bindings)
    project.updatedAt = now()
    await this.#persist()
    return clone(bindings)
  }

  inspectAndExport(sessionId) {
    const project = this.#projectForSession(sessionId)
    const bindings = project.sourceBindings || []
    const issues = []
    for (const block of project.manuscriptBlocks) {
      if (block.bindingStatus !== 'linked') issues.push({ severity: 'blocking', code: 'LOGIC_BINDING_INVALID', blockId: block.id })
      if (/\[(待补充|TODO|待确认)\]/i.test(block.markdown)) issues.push({ severity: 'blocking', code: 'PLACEHOLDER', blockId: block.id })
    }
    for (const binding of bindings) {
      if (binding.status === 'stale') issues.push({ severity: 'blocking', code: 'SOURCE_STALE', blockId: binding.blockId, chunkId: binding.chunkId })
    }
    const literatureById = new Map((project.literature || []).map((item) => [item.id, item]))
    for (const citation of project.citations || []) {
      const literature = literatureById.get(citation.literatureId)
      if (!literature || literature.status !== 'approved_for_citation') issues.push({ severity: 'blocking', code: 'CITATION_NOT_APPROVED', blockId: citation.blockId, literatureId: citation.literatureId })
      if (citation.status === 'stale') issues.push({ severity: 'blocking', code: 'CITATION_STALE_AFTER_EDIT', blockId: citation.blockId, literatureId: citation.literatureId })
      if (literature?.metadataConflict) issues.push({ severity: 'blocking', code: 'LITERATURE_METADATA_CONFLICT', literatureId: literature.id })
    }
    const outlineById = new Map(project.outline.map((item) => [item.id, item]))
    const markdown = project.manuscriptBlocks.map((block) => block.markdown || `## ${outlineById.get(block.outlineNodeId)?.title || ''}`).join('\n\n')
    return clone({ canExport: !issues.some((item) => item.severity === 'blocking'), issues, format: 'markdown', markdown })
  }

  async createManuscriptSnapshot(sessionId, input = {}) {
    const project = this.#projectForSession(sessionId)
    if (Number(input.expectedRevision) !== project.manuscriptRevision) throw new Error(`Manuscript revision conflict: expected ${input.expectedRevision}, current ${project.manuscriptRevision}`)
    const version = {
      id: randomUUID(), number: project.manuscriptVersions.length + 1, reason: 'manual_snapshot',
      name: requireText(input.name, 'name'), description: typeof input.description === 'string' ? input.description.trim() : '',
      planningRevision: project.planningRevision, manuscriptRevision: project.manuscriptRevision,
      manuscriptBlocks: clone(project.manuscriptBlocks), createdAt: now(),
    }
    project.manuscriptVersions.push(version); project.updatedAt = version.createdAt; await this.#persist(); return clone(version)
  }

  compareManuscriptVersion(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const version = project.manuscriptVersions.find((item) => item.id === input.versionId)
    if (!version) throw new Error('Manuscript version not found')
    const before = new Map((version.manuscriptBlocks || []).map((item) => [item.id, item]))
    const current = new Map(project.manuscriptBlocks.map((item) => [item.id, item]))
    const ids = new Set([...before.keys(), ...current.keys()])
    const changes = []
    for (const id of ids) {
      const oldBlock = before.get(id); const newBlock = current.get(id)
      if (!oldBlock) changes.push({ blockId: id, type: 'added', before: '', after: newBlock.markdown })
      else if (!newBlock) changes.push({ blockId: id, type: 'removed', before: oldBlock.markdown, after: '' })
      else if (oldBlock.markdown !== newBlock.markdown || oldBlock.outlineNodeId !== newBlock.outlineNodeId || JSON.stringify(oldBlock.logicBlockIds) !== JSON.stringify(newBlock.logicBlockIds)) changes.push({ blockId: id, type: 'modified', before: oldBlock.markdown, after: newBlock.markdown })
    }
    return clone({ version: { id: version.id, number: version.number, name: version.name, createdAt: version.createdAt }, currentManuscriptRevision: project.manuscriptRevision, changes })
  }

  async restoreManuscriptVersion(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    if (Number(input.expectedRevision) !== project.manuscriptRevision) throw new Error(`Manuscript revision conflict: expected ${input.expectedRevision}, current ${project.manuscriptRevision}`)
    const source = project.manuscriptVersions.find((item) => item.id === input.versionId)
    if (!source) throw new Error('Manuscript version not found')
    const currentById = new Map(project.manuscriptBlocks.map((item) => [item.id, item]))
    project.manuscriptBlocks = clone(source.manuscriptBlocks || []).map((block, index) => ({ ...block, order: index, revision: (currentById.get(block.id)?.revision ?? block.revision ?? 0) + 1 }))
    for (const binding of project.sourceBindings || []) binding.status = 'stale'
    for (const citation of project.citations || []) citation.status = 'stale'
    project.manuscriptRevision += 1
    const restored = {
      id: randomUUID(), number: project.manuscriptVersions.length + 1, reason: 'version_restore',
      name: `恢复：${source.name || `版本 ${source.number}`}`, restoredFromVersionId: source.id,
      planningRevision: project.planningRevision, manuscriptRevision: project.manuscriptRevision,
      manuscriptBlocks: clone(project.manuscriptBlocks), createdAt: now(),
    }
    project.manuscriptVersions.push(restored); project.updatedAt = restored.createdAt; await this.#persist()
    return clone({ version: restored, manuscriptRevision: project.manuscriptRevision })
  }

  async setExportTemplate(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const currentRevision = project.templateRevision || 0
    if (Number(input.expectedRevision) !== currentRevision) throw new Error(`Template revision conflict: expected ${input.expectedRevision}, current ${currentRevision}`)
    const template = input.template
    if (typeof template !== 'object' || template === null || Array.isArray(template)) throw new Error('template must be an object')
    const numberFields = ['bodyFontSizeHalfPoints', 'referenceFontSizeHalfPoints', 'firstLineIndentTwips', 'lineSpacingTwips']
    for (const field of numberFields) if (template[field] !== undefined && (!Number.isFinite(template[field]) || template[field] < 0)) throw new Error(`Invalid template field: ${field}`)
    project.exportTemplate = { ...(project.exportTemplate || {}), ...clone(template), name: requireText(template.name || project.exportTemplate?.name || '论文模板', 'template.name') }
    project.templateRevision = currentRevision + 1; project.updatedAt = now(); await this.#persist()
    return clone({ templateRevision: project.templateRevision, template: project.exportTemplate })
  }

  async exportCurrentDocx(sessionId, input = {}) {
    const project = this.#projectForSession(sessionId)
    if (Number(input.expectedRevision) !== project.manuscriptRevision) throw new Error(`Manuscript revision conflict: expected ${input.expectedRevision}, current ${project.manuscriptRevision}`)
    const inspection = this.inspectAndExport(sessionId)
    if (!inspection.canExport) throw new Error(`Export blocked by ${inspection.issues.length} issue(s)`)
    const references = this.formatReferences(sessionId, { style: input.referenceStyle || 'gb-t-7714' })
    const model = buildManuscriptModel(project, references)
    const result = await exportDocx(model, path.join(this.dataDir, 'exports', project.id), input)
    return clone({ ...result, manuscriptRevision: project.manuscriptRevision, templateRevision: project.templateRevision || 0, inspection })
  }

  async exportCurrentLatex(sessionId, input = {}) {
    const project = this.#projectForSession(sessionId)
    if (Number(input.expectedRevision) !== project.manuscriptRevision) throw new Error(`Manuscript revision conflict: expected ${input.expectedRevision}, current ${project.manuscriptRevision}`)
    const inspection = this.inspectAndExport(sessionId)
    if (!inspection.canExport) throw new Error(`Export blocked by ${inspection.issues.length} issue(s)`)
    const references = this.formatReferences(sessionId, { style: input.referenceStyle || 'gb-t-7714' })
    const model = buildManuscriptModel(project, references)
    const result = await exportLatex(model, path.join(this.dataDir, 'exports', project.id, 'latex'), input)
    return clone({ ...result, manuscriptRevision: project.manuscriptRevision, templateRevision: project.templateRevision || 0, inspection })
  }

  async createAgentRun(sessionId, input = {}) {
    const project = this.#projectForSession(sessionId)
    project.agentRuns ||= []
    const run = createAgentRun(project, input); project.agentRuns.push(run); project.updatedAt = run.updatedAt
    await this.#persist(); return { ...clone(run), ...getEventGuidance(run.state) }
  }

  getAgentRun(sessionId, runId) {
    const project = this.#projectForSession(sessionId)
    const run = (project.agentRuns || []).find((item) => item.id === runId)
    if (!run) throw new Error('Agent run not found')
    return { ...clone(run), ...getEventGuidance(run.state) }
  }

  async advanceAgentRun(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const run = (project.agentRuns || []).find((item) => item.id === input.runId)
    if (!run) throw new Error('Agent run not found')
    if (input.event === 'plan_confirmed') {
      run.basePlanningRevision = project.planningRevision
      run.baseManuscriptRevision = project.manuscriptRevision
    }
    if (input.event === 'user_accepted' && (project.planningRevision !== run.basePlanningRevision || project.manuscriptRevision !== run.baseManuscriptRevision)) throw new Error('Project changed after Agent run planning')
    advanceAgentRun(run, input); project.updatedAt = run.updatedAt; await this.#persist(); return { ...clone(run), ...getEventGuidance(run.state) }
  }

  async pauseAgentRun(sessionId, input) {
    const project = this.#projectForSession(sessionId); const run = (project.agentRuns || []).find((item) => item.id === input.runId)
    if (!run) throw new Error('Agent run not found')
    pauseAgentRun(run, input.expectedRevision); await this.#persist(); return clone(run)
  }

  async resumeAgentRun(sessionId, input) {
    const project = this.#projectForSession(sessionId); const run = (project.agentRuns || []).find((item) => item.id === input.runId)
    if (!run) throw new Error('Agent run not found')
    resumeAgentRun(run, input.expectedRevision); await this.#persist(); return clone(run)
  }

  async cancelAgentRun(sessionId, input) {
    const project = this.#projectForSession(sessionId); const run = (project.agentRuns || []).find((item) => item.id === input.runId)
    if (!run) throw new Error('Agent run not found')
    cancelAgentRun(run, input.expectedRevision); await this.#persist(); return clone(run)
  }

  async submitLiteratureCandidates(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    project.literature ||= []
    const created = []
    for (const [index, candidate] of requireArray(input.candidates, 'candidates').entries()) {
      const title = requireText(candidate.title, `candidates[${index}].title`)
      const doi = typeof candidate.doi === 'string' ? candidate.doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '') : ''
      const duplicate = project.literature.find((item) => (doi && item.doi === doi) || item.title.toLowerCase() === title.toLowerCase())
      if (duplicate) continue
      const item = {
        id: randomUUID(), title, doi, authors: requireArray(candidate.authors || [], 'authors').map(String),
        year: Number.isInteger(candidate.year) ? candidate.year : null, venue: typeof candidate.venue === 'string' ? candidate.venue.trim() : '',
        url: typeof candidate.url === 'string' ? candidate.url.trim() : '', relevanceReason: requireText(candidate.relevanceReason, `candidates[${index}].relevanceReason`),
        discoverySource: typeof input.discoverySource === 'string' ? input.discoverySource.trim() : 'llm-assisted-search',
        metadataConflict: false, status: 'candidate', revision: 0, createdAt: now(), updatedAt: now(),
      }
      project.literature.push(item); created.push(item)
    }
    project.updatedAt = now(); await this.#persist(); return clone(created)
  }

  async editLiterature(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const item = (project.literature || []).find((candidate) => candidate.id === input.literatureId)
    if (!item) throw new Error('Literature item not found')
    if (Number(input.expectedRevision) !== item.revision) throw new Error(`Literature revision conflict: expected ${input.expectedRevision}, current ${item.revision}`)
    for (const field of ['title', 'doi', 'venue', 'url']) if (typeof input[field] === 'string') item[field] = input[field].trim()
    if (Array.isArray(input.authors)) item.authors = input.authors.map(String)
    if (Number.isInteger(input.year)) item.year = input.year
    item.metadataConflict = Boolean(input.metadataConflict)
    item.status = item.status === 'approved_for_citation' ? 'metadata_edited_pending_confirmation' : item.status
    item.revision += 1; item.updatedAt = now(); project.updatedAt = item.updatedAt
    await this.#persist(); return clone(item)
  }

  async decideLiterature(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const item = (project.literature || []).find((candidate) => candidate.id === input.literatureId)
    if (!item) throw new Error('Literature item not found')
    if (Number(input.expectedRevision) !== item.revision) throw new Error(`Literature revision conflict: expected ${input.expectedRevision}, current ${item.revision}`)
    if (!['approve', 'reject'].includes(input.decision)) throw new Error('decision must be approve or reject')
    if (input.decision === 'approve' && item.metadataConflict) throw new Error('Conflicting literature metadata must be resolved before approval')
    if (input.decision === 'approve' && (!item.title || item.authors.length === 0 || !item.year)) throw new Error('Citation approval requires title, authors, and year')
    item.status = input.decision === 'approve' ? 'approved_for_citation' : 'rejected'
    item.revision += 1; item.updatedAt = now(); project.updatedAt = item.updatedAt
    await this.#persist(); return clone(item)
  }

  async bindCitation(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const block = project.manuscriptBlocks.find((item) => item.id === input.blockId)
    if (!block) throw new Error('Manuscript block not found')
    const literature = (project.literature || []).find((item) => item.id === input.literatureId)
    if (!literature || literature.status !== 'approved_for_citation') throw new Error('Only approved literature can be cited')
    project.citations ||= []
    const existing = project.citations.find((item) => item.blockId === block.id && item.literatureId === literature.id)
    if (existing) {
      existing.status = 'valid'; existing.locator = typeof input.locator === 'string' ? input.locator.trim() : existing.locator
      existing.updatedAt = now(); await this.#persist(); return clone(existing)
    }
    const citation = { id: randomUUID(), blockId: block.id, literatureId: literature.id, locator: typeof input.locator === 'string' ? input.locator.trim() : '', status: 'valid', createdAt: now() }
    project.citations.push(citation); project.updatedAt = citation.createdAt; await this.#persist(); return clone(citation)
  }

  formatReferences(sessionId, input = {}) {
    const project = this.#projectForSession(sessionId)
    const style = input.style || 'gb-t-7714'
    const approved = (project.literature || []).filter((item) => item.status === 'approved_for_citation')
    return clone(approved.map((item, index) => {
      const authors = item.authors.join(', ')
      const text = style === 'apa'
        ? `${authors} (${item.year}). ${item.title}. ${item.venue}.${item.doi ? ` https://doi.org/${item.doi}` : ''}`
        : `[${index + 1}] ${authors}. ${item.title}[J]. ${item.venue}, ${item.year}.${item.doi ? ` DOI:${item.doi}.` : ''}`
      return { literatureId: item.id, number: index + 1, style, text }
    }))
  }

  async runQualityChecks(sessionId, input = {}) {
    const project = this.#projectForSession(sessionId)
    const findings = []
    const bindingBlocks = new Set((project.sourceBindings || []).filter((item) => item.status === 'valid').map((item) => item.blockId))
    const citationBlocks = new Set((project.citations || []).map((item) => item.blockId))
    const blockText = project.manuscriptBlocks.map((item) => item.markdown)
    const seen = new Map()
    for (const block of project.manuscriptBlocks) {
      const normalized = block.markdown.replace(/\s+/g, '').toLowerCase()
      if (normalized.length > 20 && seen.has(normalized)) findings.push({ code: 'DUPLICATE_PARAGRAPH', severity: 'warning', targetType: 'block', targetId: block.id, message: `与正文块 ${seen.get(normalized)} 内容重复` })
      else seen.set(normalized, block.id)
      if (/\d+(?:\.\d+)?\s*(?:%|％|ms|秒|分钟|个|次|倍)/.test(block.markdown) && !bindingBlocks.has(block.id) && !citationBlocks.has(block.id)) findings.push({ code: 'NUMERIC_CLAIM_WITHOUT_SOURCE', severity: 'blocking', targetType: 'block', targetId: block.id, message: '正文包含定量结论，但没有有效来源或文献绑定' })
    }
    for (const node of project.outline) {
      const textLength = project.manuscriptBlocks.filter((item) => item.outlineNodeId === node.id).reduce((sum, item) => sum + item.markdown.replace(/\s+/g, '').length, 0)
      if (node.targetWords > 0 && textLength < node.targetWords * 0.35) findings.push({ code: 'CHAPTER_UNDERFILLED', severity: 'suggestion', targetType: 'outline', targetId: node.id, message: `章节“${node.title}”内容明显低于规划篇幅` })
    }
    const related = project.outline.find((item) => /研究现状|相关工作/.test(item.title))
    if (related) {
      const logic = project.logicBlocks.filter((item) => item.outlineNodeId === related.id).map((item) => item.purpose).join(' ')
      if (!/横向|比较/.test(logic) || !/纵向|演进/.test(logic)) findings.push({ code: 'RELATED_WORK_COMPARISON_MISSING', severity: 'warning', targetType: 'outline', targetId: related.id, message: '研究现状缺少横向比较或纵向演进逻辑' })
    }
    for (const [canonical, variants] of Object.entries(input.terminology || {})) {
      const used = [canonical, ...(Array.isArray(variants) ? variants : [])].filter((term) => blockText.some((text) => text.includes(term)))
      if (used.length > 1) findings.push({ code: 'TERMINOLOGY_INCONSISTENT', severity: 'warning', targetType: 'project', targetId: project.id, message: `术语存在多个写法：${used.join('、')}；建议统一为“${canonical}”` })
    }
    if (input.submitSuggestions && findings.length > 0) {
      await this.submitReviewSuggestions(sessionId, { suggestions: findings.map((finding) => ({ targetType: finding.targetType, targetId: finding.targetId, category: finding.code, severity: finding.severity === 'suggestion' ? 'suggestion' : finding.severity, text: finding.message })) })
    }
    return clone({ checkedPlanningRevision: project.planningRevision, checkedManuscriptRevision: project.manuscriptRevision, findings })
  }

  async importReferenceTemplate(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const workbench = await this.setPlan(sessionId, {
      expectedRevision: input.expectedRevision,
      confirmed: false,
      outline: requireArray(input.outline, 'outline'),
    })
    const template = {
      id: randomUUID(),
      sourceName: requireText(input.sourceName, 'sourceName'),
      extractionNotes: typeof input.extractionNotes === 'string' ? input.extractionNotes.trim() : '',
      planningRevision: workbench.project.planningRevision,
      status: 'extracted_pending_confirmation',
      createdAt: now(),
    }
    project.referenceTemplates ||= []
    project.referenceTemplates.push(template)
    project.updatedAt = template.createdAt
    await this.#persist()
    return clone({ template, workbench: this.getWorkbench(sessionId) })
  }

  async prepareGeneration(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    if (project.status !== 'ready_to_generate') throw new Error('Thesis plan must be confirmed before generation')
    const scope = input.scope || 'full'
    if (!['full', 'chapters'].includes(scope)) throw new Error('scope must be full or chapters')
    const allOutlineIds = project.outline.map((item) => item.id)
    const requestedIds = scope === 'full' ? allOutlineIds : [...new Set(requireArray(input.outlineNodeIds, 'outlineNodeIds'))]
    if (requestedIds.length === 0) throw new Error('Generation scope cannot be empty')
    for (const id of requestedIds) {
      if (!allOutlineIds.includes(id)) throw new Error(`Unknown outline node: ${id}`)
    }
    const task = {
      id: randomUUID(),
      scope,
      outlineNodeIds: requestedIds,
      basePlanningRevision: project.planningRevision,
      baseManuscriptRevision: project.manuscriptRevision,
      status: 'prepared_pending_confirmation',
      revision: 0,
      candidateBlocks: [],
      createdAt: now(),
      updatedAt: now(),
    }
    project.generationTasks ||= []
    project.generationTasks.push(task)
    project.updatedAt = task.updatedAt
    await this.#persist()
    const outlineIds = new Set(requestedIds)
    return clone({
      task,
      context: {
        outline: project.outline.filter((item) => outlineIds.has(item.id)),
        logicBlocks: project.logicBlocks.filter((item) => outlineIds.has(item.outlineNodeId)),
        existingBlocks: project.manuscriptBlocks.filter((item) => outlineIds.has(item.outlineNodeId)),
      },
    })
  }

  async confirmGeneration(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const task = (project.generationTasks || []).find((item) => item.id === input.taskId)
    if (!task) throw new Error('Generation task not found')
    if (Number(input.expectedRevision) !== task.revision) throw new Error(`Generation task revision conflict: expected ${input.expectedRevision}, current ${task.revision}`)
    if (task.status !== 'prepared_pending_confirmation') throw new Error(`Generation task is not awaiting confirmation: ${task.status}`)
    task.status = input.confirmed ? 'confirmed' : 'cancelled'
    task.revision += 1
    task.updatedAt = now()
    project.updatedAt = task.updatedAt
    await this.#persist()
    return clone(task)
  }

  async submitGeneratedScope(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const task = (project.generationTasks || []).find((item) => item.id === input.taskId)
    if (!task) throw new Error('Generation task not found')
    if (task.status !== 'confirmed') throw new Error(`Generation task is not confirmed: ${task.status}`)
    if (task.basePlanningRevision !== project.planningRevision || task.baseManuscriptRevision !== project.manuscriptRevision) {
      throw new Error('Project changed after generation task preparation')
    }
    const allowedOutlineIds = new Set(task.outlineNodeIds)
    const logicIds = new Set(project.logicBlocks.map((item) => item.id))
    task.candidateBlocks = requireArray(input.blocks, 'blocks').map((block, index) => {
      const outlineNodeId = requireText(block.outlineNodeId, `blocks[${index}].outlineNodeId`)
      if (!allowedOutlineIds.has(outlineNodeId)) throw new Error(`Block is outside generation scope: ${outlineNodeId}`)
      const blockLogicIds = [...new Set(requireArray(block.logicBlockIds, `blocks[${index}].logicBlockIds`))]
      if (blockLogicIds.length === 0 || blockLogicIds.some((id) => !logicIds.has(id))) throw new Error('Generated block requires valid writing-logic bindings')
      return {
        id: block.id || randomUUID(),
        outlineNodeId,
        logicBlockIds: blockLogicIds,
        type: block.type || 'paragraph',
        markdown: requireText(block.markdown, `blocks[${index}].markdown`),
        order: index,
        userLocked: false,
        bindingStatus: 'linked',
        revision: 0,
      }
    })
    if (task.candidateBlocks.length === 0) throw new Error('Generated scope requires at least one block')
    task.status = 'candidate_pending_acceptance'
    task.revision += 1
    task.updatedAt = now()
    project.updatedAt = task.updatedAt
    await this.#persist()
    return clone(task)
  }

  async decideGeneratedScope(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const task = (project.generationTasks || []).find((item) => item.id === input.taskId)
    if (!task) throw new Error('Generation task not found')
    if (Number(input.expectedRevision) !== task.revision) throw new Error(`Generation task revision conflict: expected ${input.expectedRevision}, current ${task.revision}`)
    if (task.status !== 'candidate_pending_acceptance') throw new Error(`Generation candidate is not awaiting acceptance: ${task.status}`)
    if (!['accept', 'reject'].includes(input.decision)) throw new Error('decision must be accept or reject')
    if (input.decision === 'reject') {
      task.status = 'rejected'
    } else {
      if (task.basePlanningRevision !== project.planningRevision || task.baseManuscriptRevision !== project.manuscriptRevision) throw new Error('Project changed after generation task preparation')
      const scopeIds = new Set(task.outlineNodeIds)
      const retained = project.manuscriptBlocks.filter((item) => !scopeIds.has(item.outlineNodeId) || item.userLocked)
      project.manuscriptBlocks = [...retained, ...clone(task.candidateBlocks)].map((item, index) => ({ ...item, order: index }))
      project.manuscriptRevision += 1
      project.manuscriptVersions.push({
        id: randomUUID(), number: project.manuscriptVersions.length + 1, reason: 'accepted_generation',
        generationTaskId: task.id, planningRevision: project.planningRevision,
        manuscriptRevision: project.manuscriptRevision, manuscriptBlocks: clone(project.manuscriptBlocks), createdAt: now(),
      })
      task.status = 'accepted'
    }
    task.revision += 1
    task.updatedAt = now()
    project.updatedAt = task.updatedAt
    await this.#persist()
    return clone({ task, manuscriptRevision: project.manuscriptRevision })
  }

  getLogicForBlock(sessionId, blockId) {
    const project = this.#projectForSession(sessionId)
    const block = project.manuscriptBlocks.find((item) => item.id === blockId)
    if (!block) throw new Error('Manuscript block not found')
    const logicById = new Map(project.logicBlocks.map((item) => [item.id, item]))
    return clone({
      block,
      logicBlocks: block.logicBlockIds.map((id) => logicById.get(id)).filter(Boolean),
    })
  }

  locateBlocksForLogic(sessionId, logicBlockId) {
    const project = this.#projectForSession(sessionId)
    const logicBlock = project.logicBlocks.find((item) => item.id === logicBlockId)
    if (!logicBlock) throw new Error('Logic block not found')
    return clone({
      logicBlock,
      manuscriptBlocks: project.manuscriptBlocks.filter((item) => item.logicBlockIds.includes(logicBlockId)),
    })
  }

  async submitReviewSuggestions(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const suggestions = requireArray(input.suggestions, 'suggestions')
    const created = suggestions.map((suggestion, index) => {
      const text = requireText(suggestion.text, `suggestions[${index}].text`)
      const item = {
        id: randomUUID(),
        targetType: suggestion.targetType || 'project',
        targetId: suggestion.targetId || project.id,
        category: suggestion.category || 'general',
        severity: suggestion.severity || 'suggestion',
        originalSuggestion: text,
        editedSuggestion: text,
        revision: 0,
        status: 'proposed',
        decisionReason: '',
        createdAt: now(),
        updatedAt: now(),
      }
      project.reviewSuggestions.push(item)
      return item
    })
    project.updatedAt = now()
    await this.#persist()
    return clone(created)
  }

  async editReviewSuggestion(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const suggestion = project.reviewSuggestions.find((item) => item.id === input.suggestionId)
    if (!suggestion) throw new Error('Review suggestion not found')
    if (Number(input.expectedRevision) !== suggestion.revision) {
      throw new Error(`Suggestion revision conflict: expected ${input.expectedRevision}, current ${suggestion.revision}`)
    }
    suggestion.editedSuggestion = requireText(input.text, 'text')
    suggestion.revision += 1
    suggestion.status = 'edited_pending_decision'
    suggestion.updatedAt = now()
    project.updatedAt = suggestion.updatedAt
    await this.#persist()
    return clone(suggestion)
  }

  async decideReviewSuggestion(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const suggestion = project.reviewSuggestions.find((item) => item.id === input.suggestionId)
    if (!suggestion) throw new Error('Review suggestion not found')
    if (Number(input.expectedRevision) !== suggestion.revision) {
      throw new Error(`Suggestion revision conflict: expected ${input.expectedRevision}, current ${suggestion.revision}`)
    }
    if (!['accept', 'reject'].includes(input.decision)) throw new Error('decision must be accept or reject')
    suggestion.status = input.decision === 'accept' ? 'accepted_for_revision' : 'rejected'
    suggestion.decisionReason = typeof input.reason === 'string' ? input.reason.trim() : ''
    suggestion.revision += 1
    suggestion.updatedAt = now()
    project.updatedAt = suggestion.updatedAt
    await this.#persist()
    return clone(suggestion)
  }

  async createRevisionBatch(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const acceptedSuggestions = project.reviewSuggestions.filter((item) => item.status === 'accepted_for_revision')
    const userChanges = requireArray(input.userChanges || [], 'userChanges').map((item, index) => ({
      id: randomUUID(),
      source: 'user_edit',
      targetType: item.targetType || 'project',
      targetId: item.targetId || project.id,
      instruction: requireText(item.instruction, `userChanges[${index}].instruction`),
    }))
    const items = [
      ...acceptedSuggestions.map((item) => ({
        id: randomUUID(),
        source: 'accepted_review_suggestion',
        sourceId: item.id,
        targetType: item.targetType,
        targetId: item.targetId,
        instruction: item.editedSuggestion,
      })),
      ...userChanges,
    ]
    if (items.length === 0) throw new Error('Revision batch requires an accepted suggestion or user change')
    const conflicts = []
    const byTarget = new Map()
    for (const item of items) {
      const key = `${item.targetType}:${item.targetId}`
      const group = byTarget.get(key) || []
      group.push(item)
      byTarget.set(key, group)
    }
    const oppositePairs = [
      [['扩写', '补充', '详细'], ['压缩', '精简', '删除']],
      [['保留'], ['删除', '移除']],
    ]
    for (const [target, group] of byTarget) {
      if (group.length < 2) continue
      for (const [positive, negative] of oppositePairs) {
        const positiveItems = group.filter((item) => positive.some((word) => item.instruction.includes(word)))
        const negativeItems = group.filter((item) => negative.some((word) => item.instruction.includes(word)))
        if (positiveItems.length > 0 && negativeItems.length > 0) {
          conflicts.push({
            id: randomUUID(),
            target,
            itemIds: [...positiveItems, ...negativeItems].map((item) => item.id),
            message: '同一目标包含方向相反的修改要求',
            resolution: '',
          })
        }
      }
    }
    const batch = {
      id: randomUUID(),
      basePlanningRevision: project.planningRevision,
      baseManuscriptRevision: project.manuscriptRevision,
      revision: 0,
      status: conflicts.length > 0 ? 'resolving_conflicts' : 'ready_for_confirmation',
      items,
      conflicts,
      createdAt: now(),
      updatedAt: now(),
    }
    project.revisionBatches.push(batch)
    for (const suggestion of acceptedSuggestions) suggestion.status = 'queued_in_batch'
    project.updatedAt = batch.updatedAt
    await this.#persist()
    return clone(batch)
  }

  async resolveRevisionBatch(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const batch = project.revisionBatches.find((item) => item.id === input.batchId)
    if (!batch) throw new Error('Revision batch not found')
    if (Number(input.expectedRevision) !== batch.revision) {
      throw new Error(`Revision batch conflict: expected ${input.expectedRevision}, current ${batch.revision}`)
    }
    const resolutions = requireArray(input.resolutions, 'resolutions')
    for (const resolution of resolutions) {
      const conflict = batch.conflicts.find((item) => item.id === resolution.conflictId)
      if (!conflict) throw new Error(`Revision conflict not found: ${resolution.conflictId}`)
      conflict.resolution = requireText(resolution.instruction, 'resolution.instruction')
    }
    batch.revision += 1
    batch.status = batch.conflicts.every((item) => item.resolution) ? 'ready_for_confirmation' : 'resolving_conflicts'
    batch.updatedAt = now()
    project.updatedAt = batch.updatedAt
    await this.#persist()
    return clone(batch)
  }

  async confirmRevisionBatch(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const batch = project.revisionBatches.find((item) => item.id === input.batchId)
    if (!batch) throw new Error('Revision batch not found')
    if (Number(input.expectedRevision) !== batch.revision) {
      throw new Error(`Revision batch conflict: expected ${input.expectedRevision}, current ${batch.revision}`)
    }
    if (batch.status !== 'ready_for_confirmation') throw new Error(`Revision batch is not ready: ${batch.status}`)
    batch.status = input.confirmed ? 'confirmed' : 'rejected'
    batch.revision += 1
    batch.updatedAt = now()
    project.updatedAt = batch.updatedAt
    await this.#persist()
    return clone(batch)
  }

  async submitPatchProposal(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const batch = project.revisionBatches.find((item) => item.id === input.batchId)
    if (!batch) throw new Error('Revision batch not found')
    if (batch.status !== 'confirmed') throw new Error(`Revision batch is not confirmed: ${batch.status}`)
    if (Number(input.baseManuscriptRevision) !== project.manuscriptRevision) {
      throw new Error(`Manuscript revision conflict: expected ${input.baseManuscriptRevision}, current ${project.manuscriptRevision}`)
    }
    const changes = requireArray(input.changes, 'changes').map((change, index) => {
      const block = project.manuscriptBlocks.find((item) => item.id === change.blockId)
      if (!block) throw new Error(`Unknown manuscript block: ${change.blockId}`)
      if (Number(change.expectedBlockRevision) !== block.revision) {
        throw new Error(`Block revision conflict for ${change.blockId}: expected ${change.expectedBlockRevision}, current ${block.revision}`)
      }
      return {
        id: randomUUID(),
        blockId: block.id,
        expectedBlockRevision: block.revision,
        beforeMarkdown: block.markdown,
        afterMarkdown: requireText(change.markdown, `changes[${index}].markdown`),
        reason: typeof change.reason === 'string' ? change.reason.trim() : '',
      }
    })
    if (changes.length === 0) throw new Error('Patch proposal requires at least one change')
    const patch = {
      id: randomUUID(),
      batchId: batch.id,
      baseManuscriptRevision: project.manuscriptRevision,
      revision: 0,
      status: 'proposed',
      changes,
      createdAt: now(),
      updatedAt: now(),
    }
    project.patchProposals.push(patch)
    batch.status = 'patch_ready'
    batch.revision += 1
    batch.updatedAt = patch.updatedAt
    project.updatedAt = patch.updatedAt
    await this.#persist()
    return clone(patch)
  }

  async decidePatchProposal(sessionId, input) {
    const project = this.#projectForSession(sessionId)
    const patch = project.patchProposals.find((item) => item.id === input.patchId)
    if (!patch) throw new Error('Patch proposal not found')
    if (Number(input.expectedRevision) !== patch.revision) {
      throw new Error(`Patch revision conflict: expected ${input.expectedRevision}, current ${patch.revision}`)
    }
    if (patch.status !== 'proposed') throw new Error(`Patch proposal is already decided: ${patch.status}`)
    if (!['accept', 'reject'].includes(input.decision)) throw new Error('decision must be accept or reject')
    const batch = project.revisionBatches.find((item) => item.id === patch.batchId)
    if (!batch) throw new Error('Revision batch not found')
    if (input.decision === 'reject') {
      patch.status = 'rejected'
      patch.revision += 1
      patch.updatedAt = now()
      batch.status = 'rejected'
      batch.updatedAt = patch.updatedAt
      project.updatedAt = patch.updatedAt
      await this.#persist()
      return clone({ patch, manuscriptRevision: project.manuscriptRevision })
    }
    if (patch.baseManuscriptRevision !== project.manuscriptRevision) {
      patch.status = 'conflict'
      patch.revision += 1
      patch.updatedAt = now()
      await this.#persist()
      throw new Error(`Manuscript changed after patch generation: expected ${patch.baseManuscriptRevision}, current ${project.manuscriptRevision}`)
    }
    const blockById = new Map(project.manuscriptBlocks.map((item) => [item.id, item]))
    for (const change of patch.changes) {
      const block = blockById.get(change.blockId)
      if (!block || block.revision !== change.expectedBlockRevision) {
        patch.status = 'conflict'
        patch.revision += 1
        patch.updatedAt = now()
        await this.#persist()
        throw new Error(`Manuscript block changed after patch generation: ${change.blockId}`)
      }
    }
    for (const change of patch.changes) {
      const block = blockById.get(change.blockId)
      block.markdown = change.afterMarkdown
      block.revision += 1
    }
    project.manuscriptRevision += 1
    const version = {
      id: randomUUID(),
      number: project.manuscriptVersions.length + 1,
      reason: 'accepted_revision_batch',
      batchId: batch.id,
      patchId: patch.id,
      planningRevision: project.planningRevision,
      manuscriptRevision: project.manuscriptRevision,
      manuscriptBlocks: clone(project.manuscriptBlocks),
      createdAt: now(),
    }
    project.manuscriptVersions.push(version)
    patch.status = 'accepted'
    patch.revision += 1
    patch.updatedAt = now()
    batch.status = 'applied'
    batch.updatedAt = patch.updatedAt
    for (const item of batch.items) {
      if (item.source !== 'accepted_review_suggestion') continue
      const suggestion = project.reviewSuggestions.find((candidate) => candidate.id === item.sourceId)
      if (suggestion) suggestion.status = 'executed'
    }
    project.updatedAt = patch.updatedAt
    await this.#persist()
    return clone({ patch, version, manuscriptRevision: project.manuscriptRevision })
  }
}
