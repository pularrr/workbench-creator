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
import { parseDocumentFile } from '../services/document-service.js'
import { chunkText, searchChunks } from '../services/retrieval-service.js'
import { createSnapshot, compareSnapshot } from '../services/version-service.js'
import { markdownExporter, textExporter } from '../services/export-service.js'
import { randomUUID } from 'node:crypto'

export class WorkbenchRuntime {
  constructor(options = {}) {
    this.storage = options.storage || new WorkbenchStorage(options.storagePath || './workbench-state.json')
    this._stateMachines = new Map() // taskType -> stateMachine
    registerExporter(markdownExporter)
    registerExporter(textExporter)
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
    const project = await this.storage.createProject(sessionId, { ...input, taskType })
    // Auto-generate default outline if framework supports it and no outline provided
    if (bundle.framework.generateOutline && !input.outline) {
      const outline = await bundle.framework.generateOutline({ taskType, targetWords: input.targetWords || 30000 })
      await this.storage.updateProject(project.id, (p) => { p.outline = outline })
    }
    // Re-fetch to include auto-generated outline
    return this.storage.getProject(project.id)
  }

  async getProject(projectId) {
    return this.storage.getProject(projectId)
  }

  async listProjects() {
    return this.storage.listProjects()
  }

  async deleteProject(projectId) {
    return this.storage.deleteProject(projectId)
  }

  async bindProject(sessionId, projectId) {
    return this.storage.bindProject(sessionId, projectId)
  }

  async getBoundProject(sessionId) {
    return this.storage.getBoundProject(sessionId)
  }

  /**
   * Auto-follow: if the session has no bound project, bind it to the
   * most recently updated project. Used by the client-side panel to
   * auto-open when a project is created via natural language.
   */
  async followProject(sessionId) {
    let existing = null
    try {
      existing = await this.storage.getBoundProject(sessionId)
    } catch (e) {
      // No project bound yet — that's fine, we'll auto-bind below
    }
    if (existing) {
      return { bound: true, id: existing.id, name: existing.name, taskType: existing.taskType }
    }
    const projects = await this.storage.listProjects()
    if (projects.length === 0) {
      return { bound: false }
    }
    // Sort by updatedAt descending, pick the most recent
    const sorted = [...projects].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    const latest = sorted[0]
    await this.storage.bindProject(sessionId, latest.id)
    return { bound: true, id: latest.id, name: latest.name, taskType: latest.taskType }
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

  // ─── Manuscript Operations ─────────────────────────────────────────────

  async setManuscriptBlocks(sessionId, input) {
    const project = await this.storage.getBoundProject(sessionId)
    await this.storage.updateProject(project.id, (p) => {
      p.manuscriptBlocks = input.blocks.map((b, i) => ({ ...b, order: i, revision: (p.manuscriptBlocks[i]?.revision || 0) + 1 }))
    })
    return { saved: true, blockCount: input.blocks.length }
  }

  // ─── Domain fields / multimodal materials ────────────────────────────

  async setDomainFields(sessionId, fields) {
    const project = await this.storage.getBoundProject(sessionId)
    const schema = this.getBundle(project.taskType).framework?.projectFieldSchema || {}
    const allowed = new Set(Object.keys(schema))
    for (const key of Object.keys(fields || {})) {
      if (allowed.size && !allowed.has(key)) throw new Error(`Unknown domain field: ${key}`)
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
    const parsed = await parseDocumentFile(filePath)
    const project = await this.storage.getBoundProject(sessionId)
    const materialPlugin = this.getBundle(project.taskType).material
    const normalized = materialPlugin?.normalizeMaterial
      ? await materialPlugin.normalizeMaterial(parsed, { project })
      : parsed
    if (materialPlugin?.analyzeMaterial) Object.assign(normalized, await materialPlugin.analyzeMaterial(normalized, { project }))
    const material = await this.storage.addMaterial(project.id, normalized)
    if (material.extractedText) await this.storage.addSourceChunks(project.id, chunkText(material.extractedText).map((chunk) => ({ ...chunk, materialId: material.id, materialName: material.name })))
    return material
  }

  async searchMaterials(sessionId, query, limit = 8) {
    const project = await this.storage.getBoundProject(sessionId)
    return searchChunks(project.sourceChunks || [], query, limit)
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

  async listTemplates(sessionId) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.storage.listTemplates(project.id)
  }

  // ─── Regeneration Requests ──────────────────────────────────────────────

  async requestRegeneration(sessionId, input) {
    const project = await this.storage.getBoundProject(sessionId)
    return this.storage.addRegenerationRequest(project.id, input)
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
      materials: project.materials || [],
      snapshots: (project.snapshots || []).map(({ blocks, ...snapshot }) => snapshot),
      sourceBindingCount: (project.sourceBindings || []).length,
    }
  }
}
