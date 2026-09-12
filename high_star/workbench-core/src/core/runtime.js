/**
 * Workbench Runtime — the core execution engine that integrates
 * state machine, storage, and the three-layer plugin system.
 *
 * This is task-type-agnostic: all task-specific behavior comes from
 * the Framework/Logic/Evidence plugins resolved via plugin-loader.
 */

import { createStateMachine } from './state-machine.js'
import { createPluginBundle, resolvePluginBundle, registerExporter, resolveExporter, listExporters } from './plugin-loader.js'
import { WorkbenchStorage } from './storage.js'
import { isSupportedDocumentFile, parseDocumentFile } from '../services/document-service.js'
import { chunkText, contentHash, RetrievalService } from '../services/retrieval-service.js'
import { createSnapshot, compareSnapshot } from '../services/version-service.js'
import { markdownExporter, textExporter } from '../services/export-service.js'
import { canonicalLiteratureKey, createCrossrefProvider, createGoogleScholarProvider, createOpenAlexProvider, deduplicateLiterature, normalizeLiteratureCandidate } from '../services/literature-service.js'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

function publicEmbeddingProfile(id, value = {}) {
  if (value.embedding?.apiKey || value.apiKey) throw new Error(`Embedding profile "${id}" must reference an environment variable, not contain an API key`)
  const embedding = value.embedding || value
  const type = embedding.type || 'hash'
  return {
    id,
    name: String(value.name || id),
    description: String(value.description || (type === 'hash' ? '本地零成本基础检索' : '受管理员配置的语义检索模型')),
    dataBoundary: String(value.dataBoundary || (type === 'hash' ? '材料不离开本机' : '重建索引时会将已授权材料文本发送给该服务')),
    embedding: { type, endpoint: embedding.endpoint, model: embedding.model, dimensions: embedding.dimensions, apiKeyEnv: embedding.apiKeyEnv, timeoutMs: embedding.timeoutMs, maxRetries: embedding.maxRetries },
  }
}

function createEmbeddingProfiles(retrieval = {}) {
  const profiles = new Map()
  profiles.set('offline-hash', publicEmbeddingProfile('offline-hash', { name: '离线基础检索', description: '本地 hash 向量，不产生模型费用', embedding: { type: 'hash', dimensions: 192 } }))
  profiles.set('dashscope-text-embedding-v4', publicEmbeddingProfile('dashscope-text-embedding-v4', {
    name: '百炼中文语义检索',
    description: 'text-embedding-v4，适用于中文资料与通用语义检索',
    dataBoundary: '重建索引时会将已授权材料文本发送给百炼 embedding 服务',
    embedding: { type: 'openai-compatible', endpoint: process.env.DASHSCOPE_COMPATIBLE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'text-embedding-v4', dimensions: 1024, apiKeyEnv: 'DASHSCOPE_API_KEY' },
  }))
  const configured = retrieval.profiles || (retrieval.embedding ? { configured: { name: '管理员默认语义模型', embedding: retrieval.embedding } } : {})
  for (const [id, value] of Object.entries(configured)) profiles.set(id, publicEmbeddingProfile(id, value))
  return profiles
}

export class WorkbenchRuntime {
  constructor(options = {}) {
    this.storage = options.storage || new WorkbenchStorage(options.storagePath || './workbench-state.json')
    this.retrievalOptions = options.retrieval || {}
    this.embeddingProfiles = createEmbeddingProfiles(this.retrievalOptions)
    this.defaultEmbeddingProfileId = this.embeddingProfiles.has(this.retrievalOptions.defaultProfileId) ? this.retrievalOptions.defaultProfileId : 'offline-hash'
    this.retrievalServices = new Map()
    this.retrieval = options.retrievalService || this.#getRetrievalServiceByProfile(this.defaultEmbeddingProfileId)
    this.ocr = options.ocr || {}
    this.literatureProviders = options.literatureProviders || { openalex: createOpenAlexProvider(options.openalex), crossref: createCrossrefProvider(options.crossref), google_scholar: createGoogleScholarProvider(options.googleScholar) }
    this.agentTaskNotifier = typeof options.agentTaskNotifier === 'function' ? options.agentTaskNotifier : null
    this._stateMachines = new Map() // taskType -> stateMachine
    registerExporter(markdownExporter)
    registerExporter(textExporter)
  }

  close() {
    this.storage.close?.()
  }

  setAgentTaskNotifier(notifier) {
    this.agentTaskNotifier = typeof notifier === 'function' ? notifier : null
  }

  // ─── Plugin Resolution ─────────────────────────────────────────────────

  getBundle(taskType) {
    return createPluginBundle(taskType)
  }

  getStateMachine(taskType) {
    if (!this._stateMachines.has(taskType)) {
      const bundle = this.getBundle(taskType)
      if (!bundle.framework?.stateTable) {
        throw new Error(`Framework plugin for task type "${taskType}" does not define a stateTable`)
      }
      this._stateMachines.set(taskType, createStateMachine(bundle.framework.stateTable))
    }
    return this._stateMachines.get(taskType)
  }

  // ─── Project Operations ────────────────────────────────────────────────

  async createProject(sessionId, input) {
    const taskType = input.taskType || 'generic'
    const bundle = this.getBundle(taskType)
    if (!bundle.framework) throw new Error(`No framework plugin registered for task type: ${taskType}`)
    const requestedPatentType = input.patentType || input.domainFields?.patentType
    if (taskType === 'patent' && requestedPatentType && !['invention', 'utility_model'].includes(requestedPatentType)) {
      throw new Error('patentType must be invention or utility_model')
    }
    if (taskType === 'patent' && input.patentType && input.domainFields?.patentType && input.patentType !== input.domainFields.patentType) {
      throw new Error('patentType conflicts with domainFields.patentType')
    }
    if (taskType === 'thesis' && input.degreeType && input.domainFields?.degreeType && input.degreeType !== input.domainFields.degreeType) {
      throw new Error('degreeType conflicts with domainFields.degreeType')
    }
    const domainFields = taskType === 'patent' ? { ...(input.domainFields || {}), ...(requestedPatentType ? { patentType: requestedPatentType } : {}) } : input.domainFields
    const project = await this.storage.createProject(sessionId, { ...input, taskType, domainFields })
    // Auto-generate default outline if framework supports it and no outline provided
    if (bundle.framework.generateOutline && !input.outline) {
      const outlineInput = { taskType, targetWords: input.targetWords || 30000, ...(taskType === 'thesis' ? { degreeType: input.degreeType || domainFields?.degreeType || 'master' } : {}), ...(taskType === 'patent' ? { patentType: requestedPatentType || 'invention' } : {}) }
      const outline = await bundle.framework.generateOutline(outlineInput)
      await this.storage.updateProject(project.id, (p) => {
        p.outline = outline
        if (taskType === 'thesis') p.outlineProfile = { degreeType: outlineInput.degreeType, generatorVersion: bundle.framework.version || 'thesis-framework-v2', generatedAt: new Date().toISOString() }
        if (taskType === 'patent') p.outlineProfile = { patentType: outlineInput.patentType, generatorVersion: bundle.framework.version || 'patent-framework-v2', wordScale: outlineInput.patentType === 'utility_model' ? 0.7 : 1, generatedAt: new Date().toISOString() }
      })
    }
    // Re-fetch to include auto-generated outline
    const workspaceId = input.workspaceId || input.assistantKey || null
    if (workspaceId) await this.storage.setActiveProject(workspaceId, project.id, { source: 'project-created' })
    return { ...await this.storage.getProject(project.id), evictedProject: project.evictedProject || null }
  }

  async getProject(projectId) {
    return this.storage.getProject(projectId)
  }

  async listProjects() {
    return this.storage.listProjects()
  }

  async deleteProject(projectId) {
    return this.storage.archiveProject(projectId, 'user-request')
  }

  async getProjectLimit() { return this.storage.getProjectLimit() }
  async archiveProject(projectId, reason) { return this.storage.archiveProject(projectId, reason) }
  async listArchivedProjects() { return this.storage.listArchivedProjects() }
  async restoreArchivedProject(projectId, options) { return this.storage.restoreArchivedProject(projectId, options) }
  async permanentlyDeleteArchivedProject(projectId, options) { return this.storage.permanentlyDeleteArchivedProject(projectId, options) }

  // Keep the runtime API aligned with the Core tools and HTTP integration.
  // Storage owns the durable state; these methods deliberately remain thin
  // delegates so callers never need to reach into runtime.storage.
  async getWorkStage(sessionId) { return this.storage.getWorkStage(sessionId) }
  async setWorkStage(sessionId, stage, options = {}) { return this.storage.setWorkStage(sessionId, stage, options) }

  async bindProject(sessionId, projectId, options = {}) {
    const binding = await this.storage.bindProject(sessionId, projectId, options)
    // `sessionId` is an execution handle, not durable project identity.  Keep
    // it for backwards-compatible tool calls while the stable workspace is
    // the source of truth shared by DSH and a separately opened page.
    const workspaceId = options.workspaceId || options.assistantKey || null
    if (workspaceId) await this.storage.setActiveProject(workspaceId, projectId, { source: options.source || 'project-bound' })
    return binding
  }

  async getWorkspace(workspaceId) { return this.storage.getWorkspace(workspaceId) }
  async setActiveProject(workspaceId, projectId, options = {}) { return this.storage.setActiveProject(workspaceId, projectId, options) }

  async unbindProject(sessionId, options) { return this.storage.unbindProject(sessionId, options) }
  async getResumeState(sessionId, assistantKey) { return this.storage.getResumeState(sessionId, assistantKey) }
  async resumeProject(sessionId, assistantKey) {
    const state = await this.storage.getResumeState(sessionId, assistantKey)
    if (!state.project) throw new Error('No previous project is available to resume')
    await this.storage.bindProject(sessionId, state.project.id, { assistantKey })
    if (state.stage !== 'design') {
      await this.storage.setWorkStage(sessionId, state.stage, { assistantKey, userConfirmed: true, reason: 'User confirmed resuming the previous project' })
    }
    return { resumed: true, ...await this.storage.getResumeState(sessionId, assistantKey) }
  }

  async getBoundProject(sessionId) {
    return this.storage.getBoundProject(sessionId)
  }

  /** Return an existing binding or candidates without guessing for the user. */
  async followProject(sessionId) {
    let existing = null
    try {
      existing = await this.storage.getBoundProject(sessionId)
    } catch (e) {
      // No project bound yet — return candidates for explicit user selection.
    }
    if (existing) {
      return { bound: true, id: existing.id, name: existing.name, taskType: existing.taskType }
    }
    const projects = await this.storage.listProjects()
    if (projects.length === 0) {
      return { bound: false }
    }
    return { bound: false, requiresSelection: true, projects }
  }

  // ─── Outline / Logic Operations ────────────────────────────────────────

  async setOutline(sessionId, input) {
    const project = await this.storage.getBoundProject(sessionId)
    const bundle = this.getBundle(project.taskType)
    // Validate outline if framework supports it
    if (bundle.framework?.validateOutline) {
      const validation = await bundle.framework.validateOutline(input.outline)
      if (!validation.valid) {
        throw new Error(`Outline validation failed: ${validation.issues.map((i) => i.message).join('; ')}`)
      }
    }
    // Generate logic blocks if logic plugin supports it
    let logicBlocks = []
    if (bundle.logic?.generateLogic) {
      for (const node of input.outline) {
        const blocks = await bundle.logic.generateLogic(node, { projectId: project.id })
        logicBlocks.push(...blocks)
      }
    }
    await this.storage.updateProject(project.id, (p) => {
      p.outline = input.outline
      p.logicBlocks = logicBlocks
      p.status = input.confirmed ? 'ready_to_generate' : 'awaiting_plan_approval'
    })
    return this.getWorkbench(sessionId)
  }

  async updateLogicBlock(sessionId, logicBlockId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const fields = ['purpose', 'transition', 'objective', 'claim', 'evidenceRequirement', 'styleConstraint']
    let updated
    await this.storage.updateProject(project.id, (value) => {
      const block = (value.logicBlocks || []).find((item) => item.id === logicBlockId)
      if (!block) throw new Error('Logic block not found')
      for (const field of fields) if (typeof input[field] === 'string') block[field] = input[field]
      updated = structuredClone(block)
      return updated
    }, { expectedRevision: input.expectedRevision, actor: 'user', action: 'logic-block.updated' })
    return updated
  }

  // ─── Manuscript Operations ─────────────────────────────────────────────

  async setManuscriptBlocks(sessionId, input) {
    const project = await this.storage.getBoundProject(sessionId)
    if (!Array.isArray(input.blocks) || !input.blocks.length) throw new Error('At least one manuscript block is required')
    const replaceAll = input.replaceAll === true
    if (replaceAll && input.userConfirmed !== true) {
      throw new Error('Replacing the whole manuscript requires explicit user confirmation')
    }
    await this.storage.updateProject(project.id, (p) => {
      const current = p.manuscriptBlocks || []
      if (current.length && input.createSafetySnapshot !== false) {
        p.snapshots ||= []
        p.snapshots.push({ id: randomUUID(), name: `自动保护：正文写入前 ${new Date().toLocaleString('zh-CN')}`, blocks: structuredClone(current), blockCount: current.length, createdAt: new Date().toISOString(), reason: 'pre-manuscript-write' })
        if (p.snapshots.length > 50) p.snapshots.splice(0, p.snapshots.length - 50)
      }
      if (replaceAll) {
        p.manuscriptBlocks = input.blocks.map((block, index) => {
          const previous = current.find((item) => item.id === block.id) || current.find((item) => block.outlineNodeId && item.outlineNodeId === block.outlineNodeId)
          return { ...block, id: block.id || previous?.id || randomUUID(), order: index, revision: (previous?.revision || 0) + 1 }
        })
        return
      }
      // Safe default for LLM chunked generation: insert or update only the
      // submitted blocks. Never remove earlier chapters merely because the
      // model produced the next chapter in a separate tool call.
      const merged = [...current]
      for (const block of input.blocks) {
        const index = block.id ? merged.findIndex((item) => item.id === block.id) : merged.findIndex((item) => block.outlineNodeId && item.outlineNodeId === block.outlineNodeId)
        if (index >= 0) merged[index] = { ...merged[index], ...block, id: merged[index].id, order: merged[index].order, revision: (merged[index].revision || 0) + 1 }
        else merged.push({ ...block, id: block.id || randomUUID(), order: merged.length, revision: 1 })
      }
      p.manuscriptBlocks = merged
    }, { expectedRevision: input.expectedRevision })
    const updated = await this.storage.getProject(project.id)
    return { saved: true, mode: replaceAll ? 'replace_all' : 'upsert', submittedBlockCount: input.blocks.length, manuscriptBlockCount: updated.manuscriptBlocks.length, revision: updated.revision }
  }

  // ─── Domain fields / multimodal materials ────────────────────────────

  async setDomainFields(sessionId, fields) {
    const project = await this.storage.getBoundProject(sessionId)
    const schema = this.getBundle(project.taskType).framework?.projectFieldSchema || {}
    const allowed = new Set(Object.keys(schema))
    for (const key of Object.keys(fields || {})) {
      if (allowed.size && !allowed.has(key)) throw new Error(`Unknown domain field: ${key}`)
    }
    if (project.taskType === 'patent' && fields?.patentType && project.outlineProfile?.patentType && fields.patentType !== project.outlineProfile.patentType) {
      throw new Error('Changing patentType after outline generation requires an explicit outline regeneration preview; existing outline was not changed')
    }
    await this.storage.updateProject(project.id, (p) => { p.domainFields = { ...(p.domainFields || {}), ...fields } })
    return this.getWorkbench(sessionId)
  }

  async addMaterial(sessionId, input) {
    const project = await this.storage.getBoundProject(sessionId)
    const materialPlugin = this.getBundle(project.taskType).material
    const normalized = materialPlugin?.normalizeMaterial
      ? await materialPlugin.normalizeMaterial(input, { project })
      : { name: input.name, type: input.type || 'text', uri: input.uri || '', metadata: input.metadata || {} }
    if (!normalized?.name || !normalized?.type) throw new Error('Material must provide name and type')
    if (materialPlugin?.analyzeMaterial) Object.assign(normalized, await materialPlugin.analyzeMaterial(normalized, { project }))
    return this.storage.addMaterial(project.id, normalized)
  }

  async importMaterialFile(sessionId, filePath) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.#importMaterialFileToProject(project, filePath)
  }

  async importMaterialDirectory(sessionId, directoryPath, options = {}) {
    if (options.userConfirmed !== true) throw new Error('Directory import requires explicit user confirmation')
    const project = await this.storage.getBoundProject(sessionId)
    const root = path.resolve(directoryPath || '')
    const rootInfo = await stat(root)
    if (!rootInfo.isDirectory()) throw new Error('directoryPath must refer to a directory')
    const maxFiles = Math.min(500, Math.max(1, Number(options.maxFiles || 100)))
    const recursive = options.recursive !== false
    const candidates = []
    const skipped = []
    const visit = async (directory) => {
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const candidate = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          if (recursive) await visit(candidate)
          continue
        }
        if (!entry.isFile()) continue
        if (!isSupportedDocumentFile(candidate)) {
          skipped.push({ filePath: candidate, reason: 'unsupported_file_type' })
          continue
        }
        if (candidates.length >= maxFiles) {
          skipped.push({ filePath: candidate, reason: 'max_files_reached' })
          continue
        }
        candidates.push(candidate)
      }
    }
    await visit(root)
    const imported = []
    const failed = []
    for (const filePath of candidates) {
      try {
        const material = await this.#importMaterialFileToProject(project, filePath)
        imported.push({ filePath, materialId: material.id, name: material.name, type: material.type, extractionStatus: material.metadata?.extractionStatus || 'parsed' })
      } catch (error) {
        failed.push({ filePath, error: error.message })
      }
    }
    return { directoryPath: root, recursive, maxFiles, discovered: candidates.length + skipped.length, imported, failed, skipped }
  }

  async #importMaterialFileToProject(project, filePath) {
    const parsed = await parseDocumentFile(filePath, { ocr: this.ocr })
    const sourcePath = path.resolve(filePath)
    const materialDirectory = path.join(path.dirname(this.storage.storagePath), 'projects', project.id, 'materials')
    await mkdir(materialDirectory, { recursive: true })
    const managedPath = path.join(materialDirectory, `${randomUUID()}-${path.basename(sourcePath)}`)
    await copyFile(sourcePath, managedPath)
    const sha256 = createHash('sha256').update(await readFile(managedPath)).digest('hex')
    parsed.uri = managedPath
    parsed.metadata = { ...(parsed.metadata || {}), originalPath: sourcePath, managedCopy: true, sha256 }
    const materialPlugin = this.getBundle(project.taskType).material
    const normalized = materialPlugin?.normalizeMaterial
      ? await materialPlugin.normalizeMaterial(parsed, { project })
      : parsed
    if (materialPlugin?.analyzeMaterial) Object.assign(normalized, await materialPlugin.analyzeMaterial(normalized, { project }))
    const material = await this.storage.addMaterial(project.id, normalized)
    if (material.extractedText) await this.#indexMaterial(project.id, material, this.#getRetrievalService(project))
    return material
  }

  async searchMaterials(sessionId, query, limit = 8) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.#getRetrievalService(project).search(project.sourceChunks || [], query, limit)
  }

  /** Lightweight, paginated inspection view. Never returns extractedText. */
  async listMaterialSummaries(sessionId, options = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const pageSize = Math.min(100, Math.max(1, Number(options.pageSize || 20)))
    const page = Math.max(1, Number(options.page || 1))
    const keyword = String(options.keyword || '').trim().toLowerCase()
    const status = String(options.status || '').trim()
    const summaries = (project.materials || []).map((material) => this.#materialSummary(material, project.sourceChunks || []))
      .filter((item) => !keyword || `${item.name} ${item.type}`.toLowerCase().includes(keyword))
      .filter((item) => !status || item.extractionStatus === status)
    const start = (page - 1) * pageSize
    const all = (project.materials || []).map((material) => this.#materialSummary(material, project.sourceChunks || []))
    return {
      total: summaries.length, page, pageSize, items: summaries.slice(start, start + pageSize),
      summary: {
        materialCount: all.length,
        parsed: all.filter((item) => item.extractionStatus === 'parsed' || item.extractionStatus === 'ocr_completed').length,
        warning: all.filter((item) => item.warnings.length > 0).length,
        failed: all.filter((item) => /failed|empty/.test(item.extractionStatus)).length,
        indexed: all.filter((item) => item.indexedChunkCount > 0).length,
        totalCharacters: all.reduce((sum, item) => sum + item.characterCount, 0),
      },
    }
  }

  async getMaterialContent(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const material = (project.materials || []).find((item) => item.id === input.materialId)
    if (!material) throw new Error('Material not found')
    const limit = Math.min(20000, Math.max(1, Number(input.limit || 4000)))
    if (input.chunkId) {
      const chunk = (project.sourceChunks || []).find((item) => item.id === input.chunkId && item.materialId === material.id)
      if (!chunk) throw new Error('Chunk not found for this material')
      return { material: this.#materialSummary(material, project.sourceChunks || []), mode: 'chunk', chunk: { id: chunk.id, order: chunk.order, text: chunk.text, sourceLocator: chunk.sourceLocator, contentKind: chunk.contentKind || 'source' } }
    }
    const text = String(material.extractedText || '')
    const offset = Math.max(0, Number(input.offset || 0))
    return { material: this.#materialSummary(material, project.sourceChunks || []), mode: 'text', offset, limit, totalCharacters: text.length, content: text.slice(offset, offset + limit), hasMore: offset + limit < text.length }
  }

  async listMaterialChunks(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const material = (project.materials || []).find((item) => item.id === input.materialId)
    if (!material) throw new Error('Material not found')
    const pageSize = Math.min(30, Math.max(1, Number(input.pageSize || 10)))
    const page = Math.max(1, Number(input.page || 1))
    const chunks = (project.sourceChunks || []).filter((item) => item.materialId === material.id)
    const start = (page - 1) * pageSize
    return { material: this.#materialSummary(material, project.sourceChunks || []), total: chunks.length, page, pageSize, items: chunks.slice(start, start + pageSize).map(({ id, order, text, sourceLocator, contentKind }) => ({ id, order, characterCount: String(text || '').length, preview: String(text || '').slice(0, 240), sourceLocator, contentKind: contentKind || 'source' })) }
  }

  #materialSummary(material, sourceChunks) {
    const metadata = material.metadata || {}
    const document = metadata.document || {}
    const warnings = Array.isArray(metadata.warnings) ? metadata.warnings.map((item) => typeof item === 'string' ? item : (item.message || JSON.stringify(item))) : []
    return {
      id: material.id, name: material.name, type: material.type,
      pageCount: Number(document.pageCount ?? document.pages ?? metadata.pageCount) || null,
      characterCount: String(material.extractedText || '').length,
      extractionStatus: metadata.extractionStatus || (material.extractedText ? 'parsed' : 'metadata_only'),
      parser: metadata.parser || null, warnings, sha256: metadata.sha256 || null,
      materialRole: metadata.materialRole || null, indexedChunkCount: sourceChunks.filter((chunk) => chunk.materialId === material.id).length,
      createdAt: material.createdAt || null,
    }
  }

  async getRetrievalStatus(sessionId) {
    const project = await this.storage.getBoundProject(sessionId)
    const profile = this.#getEmbeddingProfile(project)
    return { ...(project.retrievalIndex || { state: 'empty', chunkCount: 0 }), provider: this.#getRetrievalService(project).metadata(), profile: this.#publicProfileStatus(profile), needsReindex: project.retrievalIndex?.configFingerprint !== contentHash(JSON.stringify(this.#getRetrievalService(project).metadata())) }
  }

  async listEmbeddingProfiles() {
    return [...this.embeddingProfiles.values()].map((profile) => this.#publicProfileStatus(profile))
  }

  async configureRetrieval(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    if (input.userConfirmed !== true) throw new Error('Changing the embedding profile requires explicit user confirmation')
    const profile = this.embeddingProfiles.get(input.profileId)
    if (!profile) throw new Error(`Unknown embedding profile: ${input.profileId}`)
    await this.storage.updateProject(project.id, (value) => {
      value.retrievalConfig = { ...(value.retrievalConfig || {}), embeddingProfileId: profile.id, configuredAt: new Date().toISOString() }
      value.retrievalIndex = { ...(value.retrievalIndex || {}), state: (value.sourceChunks || []).length ? 'stale' : 'empty', pendingProfileId: profile.id }
    })
    return this.getRetrievalStatus(sessionId)
  }

  async reindexMaterials(sessionId) {
    const project = await this.storage.getBoundProject(sessionId)
    const chunks = []
    for (const material of project.materials || []) {
      if (!material.extractedText) continue
      chunks.push(...chunkText(material.extractedText).map((chunk) => ({ ...chunk, materialId: material.id, materialName: material.name })))
      if (material.codeSemantic?.text) chunks.push(...chunkText(material.codeSemantic.text).map((chunk) => ({ ...chunk, materialId: material.id, materialName: material.name, contentKind: 'code_semantic', sourceLocator: material.codeSemantic.sourceLocator })))
    }
    const service = this.#getRetrievalService(project)
    const indexed = await service.indexChunks(chunks)
    const indexVersion = `idx-${randomUUID()}`
    await this.storage.updateProject(project.id, (value) => {
      value.sourceChunks = indexed
      value.retrievalIndex = this.#indexMetadata(indexed, indexVersion, service)
    })
    return this.getRetrievalStatus(sessionId)
  }

  // ─── Literature metadata: candidates stay outside RAG until explicitly confirmed. ──

  async searchLiterature(sessionId, input = {}) {
    await this.storage.getBoundProject(sessionId)
    const query = String(input.query || '').trim(); if (!query) throw new Error('Literature query is required')
    // DSH may provide an intent decomposition: translated query, synonyms,
    // domain terms and constraints. Core executes the plan deterministically.
    const intent = input.intent && typeof input.intent === 'object' ? input.intent : {}
    const queries = [...new Set([query, String(input.englishQuery || '').trim(), ...(Array.isArray(input.synonyms) ? input.synonyms : []), ...(Array.isArray(intent.queries) ? intent.queries : []), ...(Array.isArray(intent.synonyms) ? intent.synonyms : [])].map((value) => String(value || '').trim()).filter(Boolean))]
    const providerIds = input.providers?.length ? input.providers : ['openalex', 'crossref']
    const limit = Math.min(30, Math.max(1, Number(input.limit || 10)))
    const settled = await Promise.all(providerIds.flatMap((id) => queries.map(async (providerQuery) => {
      const provider = this.literatureProviders[id]
      if (!provider) return { id, query: providerQuery, candidates: [], error: 'Provider is not configured' }
      try { return { id, query: providerQuery, candidates: await provider.search({ ...input, query: providerQuery, limit }), error: null } } catch (error) { return { id, query: providerQuery, candidates: [], error: error.message } }
    })))
    const combined = settled.flatMap((entry) => entry.candidates)
    const { unique, duplicates } = deduplicateLiterature(combined)
    const terms = [...new Set([...(String(query).match(/[\p{L}\p{N}]{2,}/gu) || []), ...(String(input.englishQuery || '').match(/[\p{L}\p{N}]{3,}/gu) || []), ...(Array.isArray(input.domainTerms) ? input.domainTerms : []), ...(Array.isArray(intent.domainTerms) ? intent.domainTerms : [])].map((term) => term.toLowerCase()).filter(Boolean))]
    const scored = unique.map((candidate) => {
      const haystack = [candidate.title, candidate.abstract, candidate.venue, ...(candidate.authors || []).flatMap((author) => [author.family, author.given])].join(' ').toLowerCase()
      const matchedTerms = terms.filter((term) => haystack.includes(term))
      const title = String(candidate.title || '').toLowerCase()
      const titleMatches = terms.filter((term) => title.includes(term)).length
      const metadata = [candidate.doi, candidate.year, candidate.venue].filter(Boolean).length
      const recency = candidate.year && input.yearTo ? (candidate.year >= (input.yearFrom || 1900) && candidate.year <= input.yearTo ? 1 : 0) : 0
      const relevanceScore = Math.min(1, (titleMatches * 0.18) + (matchedTerms.length / Math.max(1, terms.length)) * 0.52 + metadata * 0.04 + recency * 0.08 + (candidate.citationCount ? Math.min(0.1, Math.log10(candidate.citationCount + 1) / 100) : 0))
      return { ...candidate, relevanceScore: Number(relevanceScore.toFixed(3)), matchedTerms }
    }).sort((a, b) => b.relevanceScore - a.relevanceScore || (b.citationCount || 0) - (a.citationCount || 0)).slice(0, limit)
    const trace = { queryHash: contentHash(queries.join('\n')), queries, intent: { domainTerms: intent.domainTerms || [], yearFrom: input.yearFrom, yearTo: input.yearTo }, providers: settled.map(({ id, query: providerQuery, candidates, error }) => ({ id, query: providerQuery, candidateCount: candidates.length, error })), returnedCount: scored.length, retrievedAt: new Date().toISOString() }
    await this.publishCollaborationEvent(sessionId, { kind: 'result', requestType: 'literature_search', visibleSummary: `文献检索完成：${scored.length} 条候选，已按相关性重排`, payload: trace })
    return { candidates: scored, duplicates: duplicates.map(({ candidate, canonicalKey, duplicateOf }) => ({ provider: candidate.provider, providerId: candidate.providerId, canonicalKey, duplicateOf })), trace }
  }

  async addLiterature(sessionId, input = {}) {
    if (input.userConfirmed !== true) throw new Error('Adding literature requires explicit user confirmation')
    const project = await this.storage.getBoundProject(sessionId)
    const record = normalizeLiteratureCandidate(input.record || input, input.record?.provider || input.provider || 'local')
    if (!record.title) throw new Error('Literature title is required')
    const canonicalKey = canonicalLiteratureKey(record)
    let result
    await this.storage.updateProject(project.id, (value) => {
      value.literature ||= []
      const existing = value.literature.find((item) => item.canonicalKey === canonicalKey)
      if (existing) { result = { ...existing, duplicate: true }; return }
      result = { id: randomUUID(), status: 'confirmed', canonicalKey, record, provenance: { provider: record.provider, providerId: record.providerId, retrievedAt: record.retrievedAt }, confirmation: { confirmedAt: new Date().toISOString(), confirmedBy: 'user' }, fulltextAction: 'metadata_only', fulltextMaterialId: null, bindings: [] }
      value.literature.push(result)
      value.literatureTraces ||= []; value.literatureTraces.push({ id: randomUUID(), action: 'literature-confirmed', literatureId: result.id, canonicalKey, createdAt: new Date().toISOString() })
    })
    return result
  }

  async listLiterature(sessionId) { const project = await this.storage.getBoundProject(sessionId); return project.literature || [] }

  async bindLiterature(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    if (!(project.manuscriptBlocks || []).some((item) => item.id === input.blockId)) throw new Error('Block not found')
    let binding
    await this.storage.updateProject(project.id, (value) => {
      const literature = (value.literature || []).find((item) => item.id === input.literatureId && item.status === 'confirmed')
      if (!literature) throw new Error('Confirmed literature not found')
      binding = { id: randomUUID(), blockId: input.blockId, note: String(input.note || ''), createdAt: new Date().toISOString() }
      literature.bindings ||= []; literature.bindings.push(binding)
    })
    return binding
  }

  async getLiteratureTrace(sessionId) { const project = await this.storage.getBoundProject(sessionId); return project.literatureTraces || [] }

  async importLiteratureFulltext(sessionId, input = {}) {
    if (input.userConfirmed !== true) throw new Error('Importing literature full text requires explicit user confirmation')
    const project = await this.storage.getBoundProject(sessionId)
    const literature = (project.literature || []).find((item) => item.id === input.literatureId && item.status === 'confirmed')
    if (!literature) throw new Error('Confirmed literature not found')
    if (!input.filePath) throw new Error('A user-selected full-text file is required')
    const material = await this.importMaterialFile(sessionId, input.filePath)
    await this.storage.updateProject(project.id, (value) => {
      const record = value.literature.find((item) => item.id === input.literatureId)
      const linked = value.materials.find((item) => item.id === material.id)
      if (linked) linked.metadata = { ...(linked.metadata || {}), literatureId: record.id, literatureCanonicalKey: record.canonicalKey, fulltextUserConfirmed: true }
      record.fulltextAction = 'imported'
      record.fulltextMaterialId = material.id
      value.literatureTraces.push({ id: randomUUID(), action: 'literature-fulltext-imported', literatureId: record.id, materialId: material.id, createdAt: new Date().toISOString() })
    })
    return { literatureId: input.literatureId, materialId: material.id, status: 'imported' }
  }

  async downloadLiteratureFulltext(sessionId, input = {}) {
    if (input.userConfirmed !== true) throw new Error('Downloading literature full text requires explicit user confirmation')
    const url = new URL(input.url)
    if (url.protocol !== 'https:') throw new Error('Only HTTPS full-text URLs are accepted')
    const project = await this.storage.getBoundProject(sessionId)
    if (!(project.literature || []).some((item) => item.id === input.literatureId && item.status === 'confirmed')) throw new Error('Confirmed literature not found')
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' })
    if (!response.ok) throw new Error(`Full-text download failed: HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 50 * 1024 * 1024) throw new Error('Full-text download exceeds 50 MB limit')
    const extension = path.extname(url.pathname) || (response.headers.get('content-type')?.includes('pdf') ? '.pdf' : '.bin')
    const tempPath = path.join(path.dirname(this.storage.storagePath), `literature-download-${randomUUID()}${extension}`)
    await writeFile(tempPath, bytes)
    try { return await this.importLiteratureFulltext(sessionId, { literatureId: input.literatureId, filePath: tempPath, userConfirmed: true }) } finally { await unlink(tempPath).catch(() => {}) }
  }

  async requestCodeSemanticInterpretation(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const material = (project.materials || []).find((item) => item.id === input.materialId && item.type === 'code')
    if (!material?.extractedText) throw new Error('A parsed code material is required')
    const request = { id: randomUUID(), materialId: material.id, sourceSha256: material.metadata?.sha256 || contentHash(material.extractedText), status: 'pending', instruction: String(input.instruction || '说明模块职责、输入输出、数据流和关键配置；仅基于原代码。'), createdAt: new Date().toISOString() }
    await this.storage.updateProject(project.id, (value) => { value.codeSemanticRequests ||= []; value.codeSemanticRequests.push(request) })
    return { ...request, dshPrompt: `【代码语义说明请求】请仅依据已导入代码材料 ${material.name}（ID: ${material.id}）生成 JSON 对象，字段为 summary、responsibilities、inputs、outputs、dataFlow、configuration、unsupportedClaims。不得猜测。随后调用 wb_save_code_semantic，传入 materialId=${material.id}、requestId=${request.id} 和该 JSON。` }
  }

  async saveCodeSemanticInterpretation(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const material = (project.materials || []).find((item) => item.id === input.materialId && item.type === 'code')
    if (!material?.extractedText) throw new Error('A parsed code material is required')
    const request = (project.codeSemanticRequests || []).find((item) => item.id === input.requestId && item.materialId === material.id)
    if (!request || request.status !== 'pending') throw new Error('Pending code semantic request not found')
    const currentHash = material.metadata?.sha256 || contentHash(material.extractedText)
    if (request.sourceSha256 !== currentHash) throw new Error('Code changed after the semantic request; create a new request')
    const semantic = input.semantic || {}; const text = String(semantic.summary || '').trim()
    if (!text) throw new Error('semantic.summary is required')
    const sourceLocator = { path: material.name, sha256: currentHash, lineStart: Number(input.lineStart || 1), lineEnd: Number(input.lineEnd || material.extractedText.split(/\r?\n/).length) }
    const normalized = { ...semantic, text, sourceLocator, generatedAt: new Date().toISOString(), requestId: request.id }
    await this.storage.updateProject(project.id, (value) => {
      const target = value.materials.find((item) => item.id === material.id)
      target.codeSemantic = normalized
      value.codeSemanticRequests.find((item) => item.id === request.id).status = 'completed'
    })
    await this.reindexMaterials(sessionId)
    return normalized
  }

  async #indexMaterial(projectId, material, service) {
    const chunks = chunkText(material.extractedText).map((chunk) => ({ ...chunk, materialId: material.id, materialName: material.name }))
    const indexed = await service.indexChunks(chunks)
    const indexVersion = `idx-${randomUUID()}`
    await this.storage.updateProject(projectId, (project) => {
      project.sourceChunks ||= []
      project.sourceChunks.push(...indexed)
      project.retrievalIndex = this.#indexMetadata(project.sourceChunks, indexVersion, service)
    })
    return indexed
  }

  #indexMetadata(chunks, indexVersion, service) {
    const provider = service.metadata()
    return {
      activeVersion: indexVersion,
      state: chunks.some((chunk) => chunk.embeddingMeta?.fallbackReason) ? 'fallback' : 'ready',
      chunkCount: chunks.length,
      configFingerprint: contentHash(JSON.stringify(provider)),
      provider,
      updatedAt: new Date().toISOString(),
    }
  }

  #getEmbeddingProfile(project) {
    const id = project?.retrievalConfig?.embeddingProfileId || this.defaultEmbeddingProfileId
    return this.embeddingProfiles.get(id) || this.embeddingProfiles.get('offline-hash')
  }

  #getRetrievalService(project) {
    return this.#getRetrievalServiceByProfile(this.#getEmbeddingProfile(project).id)
  }

  #getRetrievalServiceByProfile(profileId) {
    if (!this.retrievalServices.has(profileId)) {
      const profile = this.embeddingProfiles.get(profileId)
      this.retrievalServices.set(profileId, new RetrievalService({ ...this.retrievalOptions, embedding: profile.embedding }))
    }
    return this.retrievalServices.get(profileId)
  }

  #publicProfileStatus(profile) {
    const requiresCredential = profile.embedding.type !== 'hash'
    const credentialAvailable = !requiresCredential || Boolean(process.env[profile.embedding.apiKeyEnv || 'DASHSCOPE_API_KEY'])
    return { id: profile.id, name: profile.name, description: profile.description, dataBoundary: profile.dataBoundary, type: profile.embedding.type, model: profile.embedding.model || 'sha256-token-hash-v1', dimensions: profile.embedding.dimensions || 192, credentialAvailable }
  }

  async bindEvidence(sessionId, input) {
    const project = await this.storage.getBoundProject(sessionId)
    if (!(project.manuscriptBlocks || []).some((block) => block.id === input.blockId)) throw new Error('Block not found')
    const chunk = (project.sourceChunks || []).find((item) => item.id === input.chunkId)
    if (!chunk) throw new Error('Source chunk not found')
    return this.storage.addSourceBinding(project.id, { blockId: input.blockId, chunkId: chunk.id, materialId: chunk.materialId, note: input.note || '' })
  }

  async createSnapshot(sessionId, name) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.storage.saveSnapshot(project.id, createSnapshot(project, name))
  }

  async compareSnapshot(sessionId, snapshotId) {
    const project = await this.storage.getBoundProject(sessionId)
    const snapshot = (project.snapshots || []).find((item) => item.id === snapshotId)
    if (!snapshot) throw new Error('Snapshot not found')
    return compareSnapshot(project, snapshot)
  }

  async restoreSnapshot(sessionId, snapshotId) {
    const project = await this.storage.getBoundProject(sessionId)
    const snapshot = (project.snapshots || []).find((item) => item.id === snapshotId)
    if (!snapshot) throw new Error('Snapshot not found')
    await this.storage.updateProject(project.id, (value) => { value.manuscriptBlocks = structuredClone(snapshot.blocks) })
    return { restored: true, snapshotId, blockCount: snapshot.blockCount }
  }

  async exportDocument(sessionId, format = 'markdown') {
    const project = await this.storage.getBoundProject(sessionId)
    const exporter = resolveExporter(project.taskType, format)
    if (!exporter) throw new Error(`Unsupported export format "${format}" for task type "${project.taskType}". Available: ${listExporters(project.taskType).map((item) => item.format).join(', ') || 'none'}`)
    return exporter.export(project, { format })
  }

  async listExportFormats(sessionId) {
    const project = await this.storage.getBoundProject(sessionId)
    return listExporters(project.taskType).map(({ id, name, format, description }) => ({ id, name, format, description }))
  }

  // ─── Run (State Machine) Operations ────────────────────────────────────

  async createRun(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const sm = this.getStateMachine(project.taskType)
    const bundle = this.getBundle(project.taskType)
    const defaultSkip = bundle.framework?.defaultSkipStages || []
    const run = sm.createRun({
      ...input,
      taskType: project.taskType,
      skipStages: input.skipStages?.length ? input.skipStages : (input.mode === 'full' ? [] : defaultSkip),
    })
    await this.storage.saveRun(project.id, run)
    return { ...run, ...sm.getEventGuidance(run.state) }
  }

  async getRun(sessionId, runId) {
    const project = await this.storage.getBoundProject(sessionId)
    const sm = this.getStateMachine(project.taskType)
    const run = await this.storage.getRun(project.id, runId)
    return { ...run, ...sm.getEventGuidance(run.state) }
  }

  async advanceRun(sessionId, input) {
    const project = await this.storage.getBoundProject(sessionId)
    const sm = this.getStateMachine(project.taskType)
    let run = await this.storage.getRun(project.id, input.runId)
    run = sm.advance(run, input)
    await this.storage.saveRun(project.id, run)
    return { ...run, ...sm.getEventGuidance(run.state) }
  }

  async pauseRun(sessionId, input) {
    const project = await this.storage.getBoundProject(sessionId)
    const sm = this.getStateMachine(project.taskType)
    let run = await this.storage.getRun(project.id, input.runId)
    run = sm.pause(run, input.expectedRevision)
    await this.storage.saveRun(project.id, run)
    return run
  }

  async resumeRun(sessionId, input) {
    const project = await this.storage.getBoundProject(sessionId)
    const sm = this.getStateMachine(project.taskType)
    let run = await this.storage.getRun(project.id, input.runId)
    run = sm.resume(run, input.expectedRevision)
    await this.storage.saveRun(project.id, run)
    return run
  }

  async cancelRun(sessionId, input) {
    const project = await this.storage.getBoundProject(sessionId)
    const sm = this.getStateMachine(project.taskType)
    let run = await this.storage.getRun(project.id, input.runId)
    run = sm.cancel(run, input.expectedRevision)
    await this.storage.saveRun(project.id, run)
    return run
  }

  // ─── Template Operations ────────────────────────────────────────────────

  async saveTemplate(sessionId, input) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.storage.saveTemplate(project.id, input)
  }

  async importTemplateFile(sessionId, filePath, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const parsed = await parseDocumentFile(filePath, { maxBytes: 10 * 1024 * 1024, ocr: { enabled: false } })
    const extractedText = String(parsed.extractedText || '').trim()
    if (!extractedText) throw new Error('Template contains no extractable text')
    const outlineSkeleton = extractedText.split(/\r?\n/).flatMap((line, lineIndex) => {
      const match = /^(#{1,6})\s+(.+)$/.exec(line.trim())
      return match ? [{ id: `template-heading-${lineIndex + 1}`, level: match[1].length, title: match[2].trim(), locator: { startLine: lineIndex + 1 } }] : []
    })
    const sourceSha256 = createHash('sha256').update(await readFile(filePath)).digest('hex')
    const template = {
      name: input.name || parsed.name, type: input.type || 'both', sourceFormat: parsed.type, sourceSha256, extractedText,
      outlineSkeleton, styleRules: [], exampleFragments: extractedText.slice(0, 4000), status: outlineSkeleton.length ? 'ready' : 'warning', metadata: { warnings: parsed.metadata?.warnings || [], templateOnly: true },
    }
    const duplicate = (project.customTemplates || []).find((item) => item.sourceSha256 === template.sourceSha256)
    if (duplicate) return { ...duplicate, duplicate: true }
    return this.storage.saveTemplate(project.id, template)
  }

  async getTemplate(sessionId, templateId) {
    const project = await this.storage.getBoundProject(sessionId)
    const template = (project.customTemplates || []).find((item) => item.id === templateId)
    if (!template) throw new Error('Template not found')
    return template
  }

  async previewTemplateRestructure(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const template = (project.customTemplates || []).find((item) => item.id === input.templateId)
    if (!template) throw new Error('Template not found')
    if (input.kind === 'body') {
      if (!Array.isArray(input.proposedBlocks) || !input.proposedBlocks.length) throw new Error('Body restructure preview requires proposedBlocks from the DSH agent')
      const current = project.manuscriptBlocks || []
      const proposedBlocks = input.proposedBlocks.map((block, index) => ({ ...block, id: block.id || current[index]?.id || randomUUID(), order: index }))
      const preview = { id: randomUUID(), templateId: template.id, kind: 'body', baseRevision: project.revision + 1, createdAt: new Date().toISOString(), status: 'ready_for_confirmation', validation: { valid: true, issues: [] }, diff: { added: proposedBlocks.filter((block) => !current.some((old) => old.id === block.id)).map((block) => block.id), removed: current.filter((block) => !proposedBlocks.some((next) => next.id === block.id)).map((block) => block.id), changed: proposedBlocks.filter((block) => current.some((old) => old.id === block.id && old.markdown !== block.markdown)).map((block) => block.id) }, proposedBlocks }
      await this.storage.updateProject(project.id, (value) => { value.templateRestructurePreviews ||= []; value.templateRestructurePreviews.push(preview) })
      return preview
    }
    const headings = (template.outlineSkeleton || []).filter((item) => item.level === 1)
    if (!headings.length) throw new Error('Template has no top-level headings to use for an outline preview')
    const existingByTitle = new Map((project.outline || []).map((item) => [item.title.trim(), item]))
    const proposedOutline = headings.map((heading, index) => {
      const existing = existingByTitle.get(heading.title)
      return existing ? { ...existing, order: index } : { id: `template-${randomUUID()}`, title: heading.title, objective: '', targetWords: 0, expectedFigures: 0, expectedTables: 0, expectedMedia: '', order: index }
    })
    const validation = await this.getBundle(project.taskType).framework.validateOutline(proposedOutline)
    // Storing the preview itself increments the project revision once; the preview
    // must therefore target the revision visible immediately after this write.
    const preview = { id: randomUUID(), templateId: template.id, kind: input.kind === 'body' ? 'body' : 'outline', baseRevision: project.revision + 1, createdAt: new Date().toISOString(), status: validation.valid ? 'ready_for_confirmation' : 'blocked', validation, diff: { added: proposedOutline.filter((node) => !existingByTitle.has(node.title)).map((node) => node.title), removed: (project.outline || []).filter((node) => !proposedOutline.some((next) => next.title === node.title)).map((node) => node.title), retained: proposedOutline.filter((node) => existingByTitle.has(node.title)).map((node) => node.title) }, proposedOutline }
    await this.storage.updateProject(project.id, (value) => { value.templateRestructurePreviews ||= []; value.templateRestructurePreviews.push(preview) })
    return preview
  }

  async applyTemplateRestructure(sessionId, input = {}) {
    if (input.userConfirmed !== true) throw new Error('Applying a template restructure requires explicit user confirmation')
    const project = await this.storage.getBoundProject(sessionId)
    const preview = (project.templateRestructurePreviews || []).find((item) => item.id === input.previewId)
    if (!preview) throw new Error('Template restructure preview not found')
    if (preview.status !== 'ready_for_confirmation' || !preview.validation.valid) throw new Error('Template restructure preview is blocked by framework validation')
    if (preview.baseRevision !== project.revision) throw new Error('Project changed after preview; create a new preview before applying')
    const priorOutline = project.outline
    if (preview.kind === 'body') await this.setManuscriptBlocks(sessionId, { blocks: preview.proposedBlocks, expectedRevision: project.revision, replaceAll: true, userConfirmed: true })
    else await this.setOutline(sessionId, { outline: preview.proposedOutline, confirmed: true })
    await this.storage.updateProject(project.id, (value) => {
      if (preview.kind !== 'body') { value.outlineHistory ||= []; value.outlineHistory.push({ id: randomUUID(), reason: 'template-restructure', previewId: preview.id, outline: priorOutline, createdAt: new Date().toISOString() }) }
      value.templateRestructurePreviews.find((item) => item.id === preview.id).status = 'applied'
    })
    return this.getWorkbench(sessionId)
  }

  async listTemplates(sessionId) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.storage.listTemplates(project.id)
  }

  // ─── Regeneration Requests ──────────────────────────────────────────────

  async requestRegeneration(sessionId, input) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.storage.addRegenerationRequest(project.id, input)
  }

  async createChangeSet(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.storage.createChangeSet(project.id, input)
  }

  async getChangeSet(sessionId, changeSetId) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.storage.getChangeSet(project.id, changeSetId)
  }

  async applyChangeSet(sessionId, input = {}) {
    if (input.userConfirmed !== true) throw new Error('Applying a change set requires explicit user confirmation')
    const project = await this.storage.getBoundProject(sessionId)
    const changeSet = await this.storage.getChangeSet(project.id, input.changeSetId)
    if (changeSet.status !== 'awaiting_confirmation') throw new Error('Change set is no longer awaiting confirmation')
    if (changeSet.baseRevision !== project.revision) throw new Error('Change set is stale; create a new candidate')
    const selected = new Set(input.selectedItemIds || [])
    const pick = (items) => (items || []).filter((item, index) => selected.size === 0 ? false : selected.has(item.id || `${index}`))
    await this.storage.updateProject(project.id, (value) => {
      for (const item of pick(changeSet.outlineChanges)) { const node = value.outline.find((x) => x.id === item.entityId); if (node) Object.assign(node, item.after || {}) }
      for (const item of pick(changeSet.logicChanges)) { const block = (value.logicBlocks || []).find((x) => x.id === item.entityId); if (block) Object.assign(block, item.after || {}) }
      for (const item of pick(changeSet.manuscriptChanges)) { const block = (value.manuscriptBlocks || []).find((x) => x.id === item.entityId); if (block) Object.assign(block, item.after || {}); else value.manuscriptBlocks.push({ ...(item.after || {}), id: item.entityId || randomUUID(), order: value.manuscriptBlocks.length }) }
      for (const item of pick(changeSet.reviewChanges)) { value.reviewSuggestions ||= []; value.reviewSuggestions.push({ ...(item.after || {}), id: item.entityId || randomUUID(), status: 'open' }) }
    }, { expectedRevision: project.revision, actor: 'user', action: 'changeset.applied' })
    await this.storage.updateChangeSet(project.id, changeSet.id, (value) => { value.status = selected.size ? 'applied' : 'rejected'; value.selectedItemIds = [...selected]; value.resolvedAt = new Date().toISOString() })
    await this.publishCollaborationEvent(sessionId, { origin: 'page', kind: 'confirmation', visibleSummary: `变更集已${selected.size ? '应用' : '拒绝'}（${selected.size} 项）`, payload: { changeSetId: changeSet.id, selectedItemIds: [...selected] } })
    return { changeSetId: changeSet.id, applied: selected.size, status: selected.size ? 'applied' : 'rejected' }
  }

  /** Store a DSH-produced candidate. It is never written to the manuscript here. */
  async submitRegenerationCandidate(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const proposedBlocks = Array.isArray(input.proposedBlocks) ? input.proposedBlocks : []
    if (!proposedBlocks.length) throw new Error('A regeneration candidate requires proposedBlocks')
    const request = (project.regenerationRequests || []).find((item) => item.id === input.requestId && item.status === 'pending')
    if (!request) throw new Error('Pending regeneration request not found')
    const baseBlocks = structuredClone(project.manuscriptBlocks || [])
    const normalized = proposedBlocks.map((block, index) => ({
      ...block,
      id: block.id || baseBlocks[index]?.id || randomUUID(),
      order: index,
    }))
    const candidate = await this.storage.addRegenerationCandidate(project.id, {
      requestId: request.id,
      // addRegenerationCandidate does not change revision; the request status
      // update immediately below does, so this is the revision the user sees.
      baseRevision: project.revision + 1,
      baseBlocks,
      proposedBlocks: normalized,
      summary: String(input.summary || '').trim(),
      rationale: String(input.rationale || '').trim(),
      evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds : [],
    })
    await this.storage.updateProject(project.id, (value) => {
      const pending = value.regenerationRequests.find((item) => item.id === request.id)
      if (pending) { pending.status = 'candidate_ready'; pending.candidateId = candidate.id; pending.completedAt = new Date().toISOString() }
    })
    const latest = await this.storage.getProject(project.id)
    const beforeById = new Map(baseBlocks.map((block) => [block.id, block]))
    const changeSet = await this.storage.createChangeSet(project.id, {
      baseRevision: latest.revision,
      manuscriptChanges: normalized.map((block, index) => ({ id: block.id || `${index}`, entityId: block.id, before: beforeById.get(block.id) || null, after: block })),
      evidenceRefs: input.evidenceIds || [],
      rationale: String(input.rationale || '').trim(),
      taskId: input.taskId || null,
    })
    if (input.taskId) {
      await this.storage.updateAgentTask(project.id, input.taskId, (value) => {
        if (!['claimed', 'running'].includes(value.status)) throw new Error(`Task cannot receive a candidate from status ${value.status}`)
        value.status = 'candidate_ready'; value.result = { ...(value.result || {}), candidateId: candidate.id }; value.progress = { step: 'candidate_ready', message: '候选 Diff 已提交，等待用户确认', percent: 100 }
      })
    }
    await this.recordAgentTrace(sessionId, { kind: 'candidate_ready', label: '已提交再生成候选', detail: candidate.summary || '等待用户逐项确认', candidateId: candidate.id })
    await this.publishCollaborationEvent(sessionId, { kind: 'result', taskId: input.taskId || null, requestType: 'regenerate_diff', visibleSummary: '候选变更已生成，等待用户确认', payload: { candidateId: candidate.id, summary: candidate.summary, proposedBlockCount: normalized.length } })
    return { ...candidate, changeSetId: changeSet.id }
  }

  /** Apply only the candidate blocks selected by the user; rejected blocks stay unchanged. */
  async resolveRegenerationCandidate(sessionId, input = {}) {
    if (input.userConfirmed !== true) throw new Error('Applying a regeneration candidate requires explicit user confirmation')
    const project = await this.storage.getBoundProject(sessionId)
    const candidate = (project.regenerationCandidates || []).find((item) => item.id === input.candidateId)
    if (!candidate || candidate.status !== 'pending_review') throw new Error('Pending regeneration candidate not found')
    if (candidate.baseRevision !== project.revision) throw new Error('The manuscript changed after this candidate was created; request a new candidate')
    const accepted = new Set(Array.isArray(input.acceptedBlockIds) ? input.acceptedBlockIds : [])
    const current = project.manuscriptBlocks || []
    const proposedById = new Map((candidate.proposedBlocks || []).map((block) => [block.id, block]))
    const merged = current.map((block) => accepted.has(block.id) && proposedById.has(block.id) ? proposedById.get(block.id) : block)
    for (const block of candidate.proposedBlocks || []) if (accepted.has(block.id) && !current.some((item) => item.id === block.id)) merged.push(block)
    await this.setManuscriptBlocks(sessionId, { blocks: merged, expectedRevision: project.revision, replaceAll: true, userConfirmed: true })
    await this.storage.updateRegenerationCandidate(project.id, candidate.id, (value) => {
      value.status = accepted.size ? 'partially_or_fully_applied' : 'rejected'
      value.acceptedBlockIds = [...accepted]
      value.resolvedAt = new Date().toISOString()
    })
    await this.recordAgentTrace(sessionId, { kind: 'candidate_resolved', label: accepted.size ? '用户接受再生成候选' : '用户拒绝再生成候选', detail: `接受 ${accepted.size} 个文本块`, candidateId: candidate.id })
    await this.publishCollaborationEvent(sessionId, { origin: 'page', kind: 'confirmation', requestType: 'regenerate_diff', visibleSummary: accepted.size ? `用户接受 ${accepted.size} 个候选文本块` : '用户拒绝候选变更', payload: { candidateId: candidate.id, acceptedBlockIds: [...accepted] } })
    return { applied: accepted.size, rejected: Math.max(0, current.length - accepted.size), candidateId: candidate.id }
  }

  async recordAgentTrace(sessionId, trace = {}) {
    try {
      const project = await this.storage.getBoundProject(sessionId)
      return this.storage.addAgentTrace(project.id, trace)
    } catch { return null }
  }

  async createAgentTask(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const task = await this.storage.createAgentTask(project.id, input)
    await this.storage.addCollaborationEvent({ collaborationSessionId: sessionId, workspaceId: input.workspaceId || input.assistantKey || null, projectId: project.id, origin: input.requestedBy === 'page' ? 'page' : 'dsh', kind: 'user_request', requestType: task.type, taskId: task.id, visibleSummary: input.visibleSummary || `AI 请求：${task.type}`, payload: input.payload || {} })
    await this.recordAgentTrace(sessionId, { kind: 'task_created', label: `创建任务：${task.type}`, detail: task.progress.message, taskId: task.id })
    let delivery = { delivered: false, reason: '当前 Core 未连接 DSH 会话注入器。' }
    if (this.agentTaskNotifier) {
      try { delivery = await this.agentTaskNotifier({ sessionId, project, task }) || delivery } catch (error) { delivery = { delivered: false, reason: `DSH 注入失败：${error.message}` } }
    }
    await this.storage.addCollaborationEvent({
      collaborationSessionId: sessionId, workspaceId: input.workspaceId || input.assistantKey || null, projectId: project.id,
      origin: 'dsh', kind: delivery.delivered ? 'chat_injected' : 'chat_injection_unavailable', requestType: task.type, taskId: task.id,
      visibleSummary: delivery.delivered ? `已注入 DSH 对话：任务 #${task.id}` : `已写入协作事件，但未注入聊天消息：${delivery.reason || '目标会话不在线'}`,
      payload: { delivery: { delivered: Boolean(delivery.delivered), reason: delivery.reason || null } },
    })
    return { ...task, delivery }
  }

  async listCollaborationEvents(options = {}) { return this.storage.listCollaborationEvents(options) }
  async registerAgentWorker(input = {}) { return this.storage.registerAgentWorker(input) }
  async heartbeatAgentWorker(workerId, input = {}) { return this.storage.heartbeatAgentWorker(workerId, input) }
  async stopAgentWorker(workerId, input = {}) { return this.storage.stopAgentWorker(workerId, input) }
  async listAgentWorkers(options = {}) { return this.storage.listAgentWorkers(options) }
  async publishCollaborationEvent(sessionId, event = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.storage.addCollaborationEvent({ collaborationSessionId: sessionId, projectId: project.id, origin: event.origin || 'dsh', ...event })
  }

  async listAgentTasks(sessionId, options = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.storage.listAgentTasks(project.id, options)
  }

  /** Re-send one already durable queued task to the currently live DSH session. */
  async dispatchQueuedAgentTask(sessionId, taskId) {
    const project = await this.storage.getBoundProject(sessionId)
    const task = (await this.storage.listAgentTasks(project.id)).find((item) => item.id === taskId)
    if (!task) throw new Error('Agent task not found in the current project')
    if (task.status !== 'queued') throw new Error(`Only queued tasks can be dispatched; current status is ${task.status}`)
    let delivery = { delivered: false, reason: '当前 Core 未连接 DSH 会话注入器。' }
    if (this.agentTaskNotifier) {
      try { delivery = await this.agentTaskNotifier({ sessionId, project, task }) || delivery } catch (error) { delivery = { delivered: false, reason: `DSH 注入失败：${error.message}` } }
    }
    await this.storage.addCollaborationEvent({
      collaborationSessionId: sessionId, projectId: project.id, origin: 'dsh', kind: delivery.delivered ? 'chat_injected' : 'chat_injection_unavailable', requestType: task.type, taskId: task.id,
      visibleSummary: delivery.delivered ? `已重新注入 DSH 对话：任务 #${task.id}` : `未能注入 DSH 对话：${delivery.reason || '目标会话不在线'}`,
      payload: { delivery: { delivered: Boolean(delivery.delivered), reason: delivery.reason || null }, redispatched: true },
    })
    return { task, delivery }
  }

  async listAuditEvents(sessionId, options = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.storage.listAuditEvents(project.id, options)
  }

  async claimAgentTask(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const executor = String(input.executor || 'dsh-agent')
    const task = await this.storage.updateAgentTask(project.id, input.taskId, (value) => {
      if (value.status !== 'queued') throw new Error(`Task cannot be claimed from status ${value.status}`)
      value.status = 'claimed'; value.executor = executor; value.claimedAt = new Date().toISOString(); value.progress = { step: 'claimed', message: 'DSH 已领取任务', percent: 5 }
    })
    await this.recordAgentTrace(sessionId, { kind: 'task_claimed', label: `领取任务：${task.type}`, detail: executor, taskId: task.id })
    await this.publishCollaborationEvent(sessionId, { kind: 'agent_claimed', taskId: task.id, requestType: task.type, visibleSummary: `任务已由 ${executor} 领取` })
    return task
  }

  async updateAgentTaskProgress(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const task = await this.storage.updateAgentTask(project.id, input.taskId, (value) => {
      if (!['claimed', 'running'].includes(value.status)) throw new Error(`Task cannot report progress from status ${value.status}`)
      value.status = 'running'; value.progress = { step: String(input.step || 'running'), message: String(input.message || ''), percent: Math.min(99, Math.max(5, Number(input.percent || 10))) }
    })
    await this.recordAgentTrace(sessionId, { kind: 'task_progress', label: task.progress.step, detail: task.progress.message, taskId: task.id })
    await this.publishCollaborationEvent(sessionId, { kind: 'progress', taskId: task.id, requestType: task.type, visibleSummary: `${task.progress.step}：${task.progress.message}`, payload: task.progress })
    return task
  }

  async completeAgentTask(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const task = await this.storage.updateAgentTask(project.id, input.taskId, (value) => {
      if (!['claimed', 'running', 'candidate_ready'].includes(value.status)) throw new Error(`Task cannot complete from status ${value.status}`)
      value.status = input.awaitingUserConfirmation ? 'awaiting_user_confirmation' : 'completed'; value.result = input.result || {}; value.progress = { step: value.status, message: input.message || '任务完成', percent: 100 }; value.completedAt = new Date().toISOString()
    })
    await this.recordAgentTrace(sessionId, { kind: 'task_completed', label: `完成任务：${task.type}`, detail: task.progress.message, taskId: task.id })
    await this.publishCollaborationEvent(sessionId, { kind: 'result', taskId: task.id, requestType: task.type, visibleSummary: task.progress.message, payload: task.result })
    return task
  }

  async failAgentTask(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const task = await this.storage.updateAgentTask(project.id, input.taskId, (value) => { value.status = 'failed'; value.error = String(input.error || 'Unknown error'); value.progress = { step: 'failed', message: value.error, percent: 100 } })
    await this.recordAgentTrace(sessionId, { kind: 'task_failed', label: `任务失败：${task.type}`, detail: task.error, taskId: task.id })
    await this.publishCollaborationEvent(sessionId, { kind: 'error', taskId: task.id, requestType: task.type, visibleSummary: task.error, payload: { error: task.error } })
    return task
  }

  /** Persist an actionable finding returned by the DSH review agent. */
  async addReviewSuggestion(sessionId, input = {}) {
    const project = await this.storage.getBoundProject(sessionId)
    const suggestion = String(input.suggestion || '').trim()
    if (!suggestion) throw new Error('Review suggestion is required')
    const record = {
      id: randomUUID(),
      suggestion,
      category: String(input.category || 'general'),
      severity: input.severity || 'warning',
      blockId: input.blockId || null,
      source: 'dsh-review-agent',
      status: 'open',
      createdAt: new Date().toISOString(),
    }
    await this.storage.updateProject(project.id, (value) => {
      value.reviewSuggestions ||= []
      value.reviewSuggestions.push(record)
    })
    return record
  }

  async listPendingRegenerationRequests(sessionId) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.storage.listPendingRegenerationRequests(project.id)
  }

  // ─── Workbench State (for UI) ───────────────────────────────────────────

  async getWorkbench(sessionId) {
    const project = await this.storage.getBoundProject(sessionId)
    const bundle = this.getBundle(project.taskType)
    return {
      project: {
        id: project.id, name: project.name, taskType: project.taskType,
        title: project.title, status: project.status,
        outlineCount: project.outline.length,
        manuscriptBlockCount: project.manuscriptBlocks.length,
        literatureCount: project.literature.length,
        updatedAt: project.updatedAt,
      },
      bundle: {
        taskType: project.taskType,
        framework: bundle.framework ? { id: bundle.framework.id, name: bundle.framework.name } : null,
        logic: bundle.logic ? { id: bundle.logic.id, name: bundle.logic.name } : null,
        evidence: bundle.evidence ? { id: bundle.evidence.id, name: bundle.evidence.name } : null,
        material: bundle.material ? { id: bundle.material.id, name: bundle.material.name } : null,
      },
      exportFormats: await this.listExportFormats(sessionId),
      ui: bundle.framework?.ui || {},
      domainFieldSchema: bundle.framework?.projectFieldSchema || {},
      domainFields: project.domainFields || {},
      outline: project.outline,
      logicBlocks: project.logicBlocks,
      manuscriptBlocks: project.manuscriptBlocks,
      reviewSuggestions: project.reviewSuggestions,
      literature: project.literature,
      citations: project.citations,
      customTemplates: project.customTemplates || [],
      runs: (project.runs || []).map((r) => ({ id: r.id, taskType: r.taskType, state: r.state, revision: r.revision, updatedAt: r.updatedAt })),
      regenerationRequests: (project.regenerationRequests || []).filter((r) => r.status === 'pending'),
      regenerationCandidates: (project.regenerationCandidates || []).filter((item) => item.status === 'pending_review').map(({ baseBlocks, ...item }) => item),
      changeSets: (project.changeSets || []).filter((item) => item.status === 'awaiting_confirmation'),
      agentTrace: (project.agentTrace || []).slice(-100).reverse(),
      agentTasks: (project.agentTasks || []).slice().reverse(),
      agentWorkers: await this.listAgentWorkers(),
      // Do not return material extractedText in the aggregate workbench state:
      // dozens of documents can otherwise exceed host tool transport limits.
      materials: (project.materials || []).map((material) => this.#materialSummary(material, project.sourceChunks || [])),
      snapshots: (project.snapshots || []).map(({ blocks, ...snapshot }) => snapshot),
      sourceBindingCount: (project.sourceBindings || []).length,
    }
  }
}
