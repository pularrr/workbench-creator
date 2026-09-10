/**
 * Generic JSON-file storage for the pluggable workbench.
 * Abstracted from the thesis storage-backend; supports projects, runs, templates, and custom data.
 */

import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, copyFile, unlink } from 'node:fs/promises'
import path from 'node:path'

const CURRENT_SCHEMA_VERSION = 2
const DEFAULT_MAX_PROJECTS = 10
const WORK_STAGES = new Set(['design', 'write', 'review'])

export class WorkbenchStorage {
  constructor(storagePath, options = {}) {
    this.storagePath = storagePath
    this.backupPath = `${storagePath}.bak`
    this.maxProjects = Number.isInteger(options.maxProjects) ? options.maxProjects : DEFAULT_MAX_PROJECTS
    this.state = null
    this._loaded = false
    this._persistQueue = Promise.resolve()
  }

  async #ensureLoaded() {
    if (this._loaded) return
    try {
      const raw = await readFile(this.storagePath, 'utf8')
      this.state = this.#migrate(JSON.parse(raw))
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.state = this.#emptyState()
        await this.#persist()
      } else {
        try {
          const backup = await readFile(this.backupPath, 'utf8')
          this.state = this.#migrate(JSON.parse(backup))
          this.state.audit.push(this.#audit('storage-recovered', { source: this.backupPath }))
          await this.#persist({ skipBackup: true })
        } catch (backupError) {
          throw new Error(`Workbench storage is unreadable; refusing to replace it. Primary: ${error.message}. Backup: ${backupError.message}`)
        }
      }
    }
    this._loaded = true
  }

  #emptyState() {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projects: {},
      sessionBindings: {},
      assistantBindings: {},
      assistantContexts: {},
      workContexts: {},
      archives: {},
      audit: [],
      customTemplates: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  #migrate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Storage root must be an object')
    if (!input.projects || typeof input.projects !== 'object') throw new Error('Storage has no projects map')
    const state = {
      ...this.#emptyState(),
      ...input,
      sessionBindings: input.sessionBindings || {},
      assistantBindings: input.assistantBindings || {},
      assistantContexts: input.assistantContexts || {},
      workContexts: input.workContexts || {},
      archives: input.archives || {},
      audit: Array.isArray(input.audit) ? input.audit : [],
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }
    return state
  }

  #audit(action, details = {}) {
    return { id: randomUUID(), action, timestamp: new Date().toISOString(), ...details }
  }

  async #persist(options = {}) {
    const operation = async () => {
      await mkdir(path.dirname(this.storagePath), { recursive: true })
      this.state.updatedAt = new Date().toISOString()
      const serialized = JSON.stringify(this.state, null, 2)
      JSON.parse(serialized)
      const temporaryPath = `${this.storagePath}.${process.pid}.tmp`
      await writeFile(temporaryPath, serialized, 'utf8')
      if (!options.skipBackup) {
        try { await copyFile(this.storagePath, this.backupPath) } catch (error) { if (error?.code !== 'ENOENT') throw error }
      }
      try {
        await rename(temporaryPath, this.storagePath)
      } catch (error) {
        try { await unlink(this.storagePath) } catch (unlinkError) { if (unlinkError?.code !== 'ENOENT') throw unlinkError }
        await rename(temporaryPath, this.storagePath)
      }
    }
    this._persistQueue = this._persistQueue.then(operation, operation)
    return this._persistQueue
  }

  // ─── Projects ──────────────────────────────────────────────────────────

  async createProject(sessionId, input) {
    await this.#ensureLoaded()
    const activeProjects = Object.values(this.state.projects)
    let evictedProject = null
    if (activeProjects.length >= this.maxProjects) {
      if (input.confirmedEviction !== true) {
        const oldest = this.#oldestProject(activeProjects)
        const error = new Error(`Creating another project requires archiving the oldest project "${oldest.name}" (${oldest.id}). Confirm eviction before retrying.`)
        error.code = 'PROJECT_LIMIT_CONFIRMATION_REQUIRED'
        error.evictionCandidate = this.#projectSummary(oldest)
        throw error
      }
      const oldest = this.#oldestProject(activeProjects)
      evictedProject = this.#archiveProjectInState(oldest.id, 'project-limit')
    }
    const projectId = randomUUID()
    const now = new Date().toISOString()
    const project = {
      id: projectId,
      name: String(input.name || 'Untitled Project'),
      taskType: String(input.taskType || 'generic'),
      title: typeof input.title === 'string' ? input.title.trim() : '',
      status: 'planning',
      outline: [],
      logicBlocks: [],
      manuscriptBlocks: [],
      reviewSuggestions: [],
      literature: [],
      citations: [],
      sourceChunks: [],
      sourceBindings: [],
      snapshots: [],
      customTemplates: [],
      runs: [],
      regenerationRequests: [],
      materials: [],
      domainFields: input.domainFields || {},
      metadata: input.metadata || {},
      revision: 1,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    }
    this.state.projects[projectId] = project
    if (sessionId) this.state.sessionBindings[sessionId] = projectId
    if (input.assistantKey) {
      this.state.assistantBindings[input.assistantKey] = projectId
      this.state.assistantContexts[input.assistantKey] = { stage: 'design', projectId, updatedAt: now }
    }
    this.state.audit.push(this.#audit('project-created', { projectId, sessionId: sessionId || null, assistantKey: input.assistantKey || null }))
    await this.#persist()
    return { ...this.#clone(project), evictedProject }
  }

  async getProject(projectId) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    return this.#clone(project)
  }

  async listProjects() {
    await this.#ensureLoaded()
    return Object.values(this.state.projects).map((p) => ({
      id: p.id, name: p.name, taskType: p.taskType, status: p.status,
      outlineCount: p.outline.length, manuscriptBlockCount: p.manuscriptBlocks.length,
      createdAt: p.createdAt, updatedAt: p.updatedAt, lastOpenedAt: p.lastOpenedAt || null,
    }))
  }

  async getProjectLimit() {
    await this.#ensureLoaded()
    const projects = Object.values(this.state.projects)
    return {
      limit: this.maxProjects,
      activeCount: projects.length,
      remaining: Math.max(0, this.maxProjects - projects.length),
      evictionCandidate: projects.length >= this.maxProjects ? this.#projectSummary(this.#oldestProject(projects)) : null,
    }
  }

  async listArchivedProjects() {
    await this.#ensureLoaded()
    return Object.values(this.state.archives).map((entry) => ({
      id: entry.project.id, name: entry.project.name, taskType: entry.project.taskType,
      createdAt: entry.project.createdAt, archivedAt: entry.archivedAt, reason: entry.reason,
    }))
  }

  async archiveProject(projectId, reason = 'user-request') {
    await this.#ensureLoaded()
    const result = this.#archiveProjectInState(projectId, reason)
    await this.#persist()
    return result
  }

  async restoreArchivedProject(projectId, options = {}) {
    await this.#ensureLoaded()
    const entry = this.state.archives[projectId]
    if (!entry) throw new Error('Archived project not found')
    if (Object.keys(this.state.projects).length >= this.maxProjects) {
      throw new Error('Project limit reached. Archive an active project before restoring this archive.')
    }
    this.state.projects[projectId] = entry.project
    delete this.state.archives[projectId]
    if (options.sessionId) this.state.sessionBindings[options.sessionId] = projectId
    if (options.assistantKey) this.state.assistantBindings[options.assistantKey] = projectId
    this.state.audit.push(this.#audit('project-restored', { projectId, sessionId: options.sessionId || null }))
    await this.#persist()
    return this.#clone(entry.project)
  }

  async deleteProject(projectId) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    const name = project.name
    delete this.state.projects[projectId]
    for (const [sid, pid] of Object.entries(this.state.sessionBindings)) {
      if (pid === projectId) delete this.state.sessionBindings[sid]
    }
    for (const [key, pid] of Object.entries(this.state.assistantBindings)) {
      if (pid === projectId) { delete this.state.assistantBindings[key]; delete this.state.assistantContexts[key] }
    }
    for (const context of Object.values(this.state.workContexts)) {
      if (context.projectId === projectId) Object.assign(context, { projectId: null, stage: 'design', updatedAt: new Date().toISOString() })
    }
    this.state.audit.push(this.#audit('project-permanently-deleted', { projectId, name }))
    await this.#persist()
    return { deleted: true, id: projectId, name, remainingProjects: Object.keys(this.state.projects).length }
  }

  async bindProject(sessionId, projectId, options = {}) {
    await this.#ensureLoaded()
    if (!this.state.projects[projectId]) throw new Error('Project not found')
    this.state.sessionBindings[sessionId] = projectId
    if (options.assistantKey) {
      this.state.assistantBindings[options.assistantKey] = projectId
      const previousStage = this.state.assistantContexts[options.assistantKey]?.stage || 'design'
      this.state.assistantContexts[options.assistantKey] = { stage: previousStage, projectId, updatedAt: new Date().toISOString() }
    }
    this.state.workContexts[sessionId] = { stage: 'design', projectId, assistantKey: options.assistantKey || null, updatedAt: new Date().toISOString() }
    const project = this.state.projects[projectId]
    project.lastOpenedAt = new Date().toISOString()
    this.state.audit.push(this.#audit('project-bound', { projectId, sessionId, assistantKey: options.assistantKey || null }))
    await this.#persist()
    return { bound: true, projectId }
  }

  async getBoundProject(sessionId) {
    await this.#ensureLoaded()
    const projectId = this.state.sessionBindings[sessionId]
    if (!projectId || !this.state.projects[projectId]) {
      const available = await this.listProjects()
      const hint = available.length
        ? ` Available projects: ${available.map((p) => `"${p.name}"`).join(', ')}.`
        : ' No projects exist yet.'
      throw new Error(`No project bound to this session.${hint}`)
    }
    return this.getProject(projectId)
  }

  async unbindProject(sessionId, options = {}) {
    await this.#ensureLoaded()
    const projectId = this.state.sessionBindings[sessionId] || null
    delete this.state.sessionBindings[sessionId]
    if (options.assistantKey && this.state.assistantBindings[options.assistantKey] === projectId) delete this.state.assistantBindings[options.assistantKey]
    if (options.assistantKey) delete this.state.assistantContexts[options.assistantKey]
    const context = this.state.workContexts[sessionId]
    if (context) Object.assign(context, { projectId: null, stage: 'design', updatedAt: new Date().toISOString() })
    this.state.audit.push(this.#audit('project-unbound', { projectId, sessionId }))
    await this.#persist()
    return { unbound: true, projectId }
  }

  async getResumeState(sessionId, assistantKey) {
    await this.#ensureLoaded()
    const projectId = this.state.sessionBindings[sessionId] || (assistantKey ? this.state.assistantBindings[assistantKey] : null)
    const project = projectId ? this.state.projects[projectId] : null
    const context = this.state.workContexts[sessionId]
    const assistantContext = assistantKey ? this.state.assistantContexts[assistantKey] : null
    return {
      hasPreviousProject: Boolean(project),
      project: project ? this.#projectSummary(project) : null,
      stage: context?.projectId === projectId ? context.stage : assistantContext?.projectId === projectId ? assistantContext.stage : 'design',
      source: this.state.sessionBindings[sessionId] ? 'session' : project ? 'assistant' : null,
    }
  }

  async getWorkStage(sessionId) {
    await this.#ensureLoaded()
    return this.state.workContexts[sessionId]?.stage || 'design'
  }

  async setWorkStage(sessionId, stage, options = {}) {
    await this.#ensureLoaded()
    if (!WORK_STAGES.has(stage)) throw new Error(`Unknown work stage: ${stage}`)
    const projectId = this.state.sessionBindings[sessionId] || null
    if ((stage === 'write' || stage === 'review') && !projectId) throw new Error(`${stage} stage requires a bound project`)
    if (options.userConfirmed !== true && stage !== 'design') throw new Error(`Switching to ${stage} requires explicit user confirmation`)
    const previous = this.state.workContexts[sessionId]?.stage || 'design'
    const assistantKey = options.assistantKey || this.state.workContexts[sessionId]?.assistantKey || null
    this.state.workContexts[sessionId] = { stage, projectId, assistantKey, reason: options.reason || '', updatedAt: new Date().toISOString() }
    if (assistantKey) this.state.assistantContexts[assistantKey] = { stage, projectId, reason: options.reason || '', updatedAt: new Date().toISOString() }
    this.state.audit.push(this.#audit('work-stage-changed', { sessionId, projectId, from: previous, to: stage, reason: options.reason || '' }))
    await this.#persist()
    return this.#clone(this.state.workContexts[sessionId])
  }

  async updateProject(projectId, updater, options = {}) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    if (options.expectedRevision !== undefined && Number(options.expectedRevision) !== Number(project.revision || 1)) {
      throw new Error(`Project revision conflict: expected ${options.expectedRevision}, current ${project.revision || 1}`)
    }
    const result = updater(project)
    project.updatedAt = new Date().toISOString()
    project.revision = (project.revision || 0) + 1
    await this.#persist()
    return result !== undefined ? result : this.#clone(project)
  }

  // ─── Runs ──────────────────────────────────────────────────────────────

  async saveRun(projectId, run) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    project.runs ||= []
    const idx = project.runs.findIndex((r) => r.id === run.id)
    if (idx >= 0) project.runs[idx] = run
    else project.runs.push(run)
    project.updatedAt = new Date().toISOString()
    await this.#persist()
    return this.#clone(run)
  }

  async getRun(projectId, runId) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    const run = (project.runs || []).find((r) => r.id === runId)
    if (!run) throw new Error('Run not found')
    return this.#clone(run)
  }

  // ─── Templates ─────────────────────────────────────────────────────────

  async saveTemplate(projectId, template) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    project.customTemplates ||= []
    if (template.id) {
      const existing = project.customTemplates.find((t) => t.id === template.id)
      if (existing) Object.assign(existing, template, { revision: (existing.revision || 0) + 1, updatedAt: new Date().toISOString() })
      else project.customTemplates.push(template)
    } else {
      template.id = randomUUID()
      template.revision = 1
      template.createdAt = new Date().toISOString()
      template.updatedAt = template.createdAt
      project.customTemplates.push(template)
    }
    project.updatedAt = new Date().toISOString()
    await this.#persist()
    return this.#clone(template)
  }

  async listTemplates(projectId) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    return (project.customTemplates || []).map(({ id, name, type, description, revision, createdAt, updatedAt }) => ({ id, name, type, description, revision, createdAt, updatedAt }))
  }

  // ─── Regeneration Requests ─────────────────────────────────────────────

  async addRegenerationRequest(projectId, request) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    project.regenerationRequests ||= []
    const req = { id: randomUUID(), status: 'pending', createdAt: new Date().toISOString(), ...request }
    project.regenerationRequests.push(req)
    project.updatedAt = new Date().toISOString()
    await this.#persist()
    return this.#clone(req)
  }

  async listPendingRegenerationRequests(projectId) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    return (project.regenerationRequests || []).filter((r) => r.status === 'pending')
  }

  async addMaterial(projectId, material) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    project.materials ||= []
    const record = { id: randomUUID(), createdAt: new Date().toISOString(), status: 'ready', ...material }
    project.materials.push(record)
    project.updatedAt = new Date().toISOString()
    await this.#persist()
    return this.#clone(record)
  }

  async addSourceChunks(projectId, chunks) {
    return this.updateProject(projectId, (project) => { project.sourceChunks ||= []; project.sourceChunks.push(...chunks); return this.#clone(chunks) })
  }

  async addSourceBinding(projectId, binding) {
    return this.updateProject(projectId, (project) => { project.sourceBindings ||= []; const record = { id: randomUUID(), createdAt: new Date().toISOString(), ...binding }; project.sourceBindings.push(record); return this.#clone(record) })
  }

  async saveSnapshot(projectId, snapshot) {
    return this.updateProject(projectId, (project) => { project.snapshots ||= []; project.snapshots.push(snapshot); return this.#clone(snapshot) })
  }

  // ─── Utilities ──────────────────────────────────────────────────────────

  #clone(obj) {
    return JSON.parse(JSON.stringify(obj))
  }

  #projectSummary(project) {
    return { id: project.id, name: project.name, taskType: project.taskType, createdAt: project.createdAt, updatedAt: project.updatedAt, revision: project.revision || 1 }
  }

  #oldestProject(projects) {
    return [...projects].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id))[0]
  }

  #archiveProjectInState(projectId, reason) {
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    const archivedAt = new Date().toISOString()
    this.state.archives[projectId] = { project: this.#clone(project), archivedAt, reason }
    delete this.state.projects[projectId]
    for (const [sid, pid] of Object.entries(this.state.sessionBindings)) if (pid === projectId) delete this.state.sessionBindings[sid]
    for (const [key, pid] of Object.entries(this.state.assistantBindings)) {
      if (pid === projectId) { delete this.state.assistantBindings[key]; delete this.state.assistantContexts[key] }
    }
    for (const context of Object.values(this.state.workContexts)) {
      if (context.projectId === projectId) Object.assign(context, { projectId: null, stage: 'design', updatedAt: archivedAt })
    }
    this.state.audit.push(this.#audit('project-archived', { projectId, name: project.name, reason }))
    return { id: project.id, name: project.name, taskType: project.taskType, createdAt: project.createdAt, archivedAt, reason }
  }
}
