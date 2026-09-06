/**
 * Generic JSON-file storage for the pluggable workbench.
 * Abstracted from the thesis storage-backend; supports projects, runs, templates, and custom data.
 */

import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export class WorkbenchStorage {
  constructor(storagePath) {
    this.storagePath = storagePath
    this.state = null
    this._loaded = false
  }

  async #ensureLoaded() {
    if (this._loaded) return
    try {
      const raw = await readFile(this.storagePath, 'utf8')
      this.state = JSON.parse(raw)
    } catch {
      this.state = this.#emptyState()
      await this.#persist()
    }
    this._loaded = true
  }

  #emptyState() {
    return {
      schemaVersion: 1,
      projects: {},
      sessionBindings: {},
      customTemplates: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  async #persist() {
    await mkdir(path.dirname(this.storagePath), { recursive: true })
    this.state.updatedAt = new Date().toISOString()
    await writeFile(this.storagePath, JSON.stringify(this.state, null, 2), 'utf8')
  }

  // ─── Projects ──────────────────────────────────────────────────────────

  async createProject(sessionId, input) {
    await this.#ensureLoaded()
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
      createdAt: now,
      updatedAt: now,
    }
    this.state.projects[projectId] = project
    this.state.sessionBindings[sessionId] = projectId
    await this.#persist()
    return this.#clone(project)
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
      updatedAt: p.updatedAt,
    }))
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
    await this.#persist()
    return { deleted: true, id: projectId, name, remainingProjects: Object.keys(this.state.projects).length }
  }

  async bindProject(sessionId, projectId) {
    await this.#ensureLoaded()
    if (!this.state.projects[projectId]) throw new Error('Project not found')
    this.state.sessionBindings[sessionId] = projectId
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

  async updateProject(projectId, updater) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    const result = updater(project)
    project.updatedAt = new Date().toISOString()
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
}
