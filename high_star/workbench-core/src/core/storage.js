/**
 * Generic JSON-file storage for the pluggable workbench.
 * Abstracted from the thesis storage-backend; supports projects, runs, templates, and custom data.
 */

import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, copyFile, unlink, rm } from 'node:fs/promises'
import { mkdirSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const CURRENT_SCHEMA_VERSION = 5
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
    this.isSqlite = path.extname(storagePath).toLowerCase() === '.db'
    this.database = null
    if (this.isSqlite) {
      mkdirSync(path.dirname(storagePath), { recursive: true })
      this.database = new DatabaseSync(storagePath)
      this.database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS storage_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          project_id TEXT,
          before_revision INTEGER,
          after_revision INTEGER,
          trace_id TEXT,
          timestamp TEXT NOT NULL,
          details_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS audit_events_project_timestamp ON audit_events(project_id, timestamp DESC);

        -- The state snapshot remains the backwards-compatible recovery source,
        -- while these entity tables provide durable, queryable Core records.
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          active_project_id TEXT,
          updated_at TEXT,
          source TEXT,
          payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          task_type TEXT NOT NULL,
          status TEXT,
          revision INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS materials (
          project_id TEXT NOT NULL,
          id TEXT NOT NULL,
          status TEXT,
          created_at TEXT,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (project_id, id)
        );
        CREATE TABLE IF NOT EXISTS material_chunks (
          project_id TEXT NOT NULL,
          chunk_key TEXT NOT NULL,
          material_id TEXT,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (project_id, chunk_key)
        );
        CREATE TABLE IF NOT EXISTS source_bindings (
          project_id TEXT NOT NULL,
          id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (project_id, id)
        );
        CREATE TABLE IF NOT EXISTS manuscript_blocks (
          project_id TEXT NOT NULL,
          id TEXT NOT NULL,
          outline_node_id TEXT,
          block_revision INTEGER,
          block_order INTEGER,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (project_id, id)
        );
        CREATE TABLE IF NOT EXISTS manuscript_versions (
          project_id TEXT NOT NULL,
          id TEXT NOT NULL,
          created_at TEXT,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (project_id, id)
        );
        CREATE TABLE IF NOT EXISTS review_suggestions (
          project_id TEXT NOT NULL,
          id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (project_id, id)
        );
        CREATE TABLE IF NOT EXISTS regeneration_candidates (
          project_id TEXT NOT NULL,
          id TEXT NOT NULL,
          status TEXT,
          created_at TEXT,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (project_id, id)
        );
        CREATE TABLE IF NOT EXISTS agent_tasks (
          project_id TEXT NOT NULL,
          id TEXT NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          trace_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (project_id, id)
        );
        CREATE TABLE IF NOT EXISTS agent_traces (
          project_id TEXT NOT NULL,
          id TEXT NOT NULL,
          timestamp TEXT,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (project_id, id)
        );
        CREATE TABLE IF NOT EXISTS session_bindings (
          session_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assistant_bindings (
          assistant_key TEXT PRIMARY KEY,
          project_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assistant_contexts (
          assistant_key TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS work_contexts (
          session_id TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS archived_projects (
          project_id TEXT PRIMARY KEY,
          archived_at TEXT NOT NULL,
          reason TEXT NOT NULL,
          project_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collaboration_events (
          id TEXT PRIMARY KEY,
          collaboration_session_id TEXT,
          workspace_id TEXT,
          project_id TEXT,
          origin TEXT NOT NULL,
          kind TEXT NOT NULL,
          request_type TEXT,
          task_id TEXT,
          visible_summary TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_workers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          last_heartbeat_at TEXT,
          stopped_at TEXT,
          error TEXT,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS collaboration_events_session_time ON collaboration_events(collaboration_session_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS materials_project_id ON materials(project_id);
        CREATE INDEX IF NOT EXISTS material_chunks_project_id ON material_chunks(project_id);
        CREATE INDEX IF NOT EXISTS manuscript_blocks_project_order ON manuscript_blocks(project_id, block_order);
        CREATE INDEX IF NOT EXISTS agent_tasks_project_status ON agent_tasks(project_id, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS regeneration_candidates_project_status ON regeneration_candidates(project_id, status);
      `)
    }
  }

  close() {
    if (this.database) {
      this.database.close()
      this.database = null
    }
  }

  async #ensureLoaded() {
    if (this._loaded) return
    if (this.isSqlite) {
      this.state = this.#loadSqliteState()
      if (!this.state) {
        // Version 0.1 stored a complete snapshot in this table. Import it once
        // then continue exclusively from the entity tables.
        let legacyState = this.#readLegacySqliteSnapshot()
        if (!legacyState) {
          const legacyPath = path.join(path.dirname(this.storagePath), 'state.json')
          if (existsSync(legacyPath)) legacyState = JSON.parse(await readFile(legacyPath, 'utf8'))
        }
        this.state = legacyState ? this.#migrate(legacyState) : this.#emptyState()
        this._loaded = true
        await this.#persist()
        return
      }
      this._loaded = true
      return
    }
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
      collaborationEvents: [],
      agentWorkers: {},
      customTemplates: {},
      workspaces: {},
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
      collaborationEvents: Array.isArray(input.collaborationEvents) ? input.collaborationEvents : [],
      agentWorkers: input.agentWorkers || {},
      workspaces: input.workspaces || {},
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }
    for (const project of Object.values(state.projects)) {
      project.literature ||= []
      project.literatureTraces ||= []
      project.outlineProfile ||= null
      project.agentTasks ||= []
      project.agentTrace ||= []
      project.changeSets ||= []
    }
    return state
  }

  #audit(action, details = {}) {
    return {
      id: randomUUID(),
      actor: details.actor || 'system',
      action,
      projectId: details.projectId || null,
      beforeRevision: details.beforeRevision ?? null,
      afterRevision: details.afterRevision ?? null,
      traceId: details.traceId || null,
      timestamp: new Date().toISOString(),
      ...details,
    }
  }

  #readLegacySqliteSnapshot() {
    try {
      const row = this.database.prepare('SELECT state_json FROM workbench_state WHERE id = 1').get()
      return row?.state_json ? JSON.parse(row.state_json) : null
    } catch { return null }
  }

  #loadSqliteState() {
    const projects = this.database.prepare('SELECT payload_json FROM projects').all()
    const metadata = this.database.prepare('SELECT schema_version, created_at, updated_at FROM storage_metadata WHERE id = 1').get()
    if (!metadata && projects.length === 0) return null
    const state = this.#emptyState()
    state.schemaVersion = metadata?.schema_version || CURRENT_SCHEMA_VERSION
    state.createdAt = metadata?.created_at || state.createdAt
    state.updatedAt = metadata?.updated_at || state.updatedAt
    for (const row of projects) {
      const project = JSON.parse(row.payload_json)
      state.projects[project.id] = project
    }
    for (const row of this.database.prepare('SELECT id, payload_json FROM workspaces').all()) state.workspaces[row.id] = JSON.parse(row.payload_json)
    for (const row of this.database.prepare('SELECT session_id, project_id FROM session_bindings').all()) state.sessionBindings[row.session_id] = row.project_id
    for (const row of this.database.prepare('SELECT assistant_key, project_id FROM assistant_bindings').all()) state.assistantBindings[row.assistant_key] = row.project_id
    for (const row of this.database.prepare('SELECT assistant_key, payload_json FROM assistant_contexts').all()) state.assistantContexts[row.assistant_key] = JSON.parse(row.payload_json)
    for (const row of this.database.prepare('SELECT session_id, payload_json FROM work_contexts').all()) state.workContexts[row.session_id] = JSON.parse(row.payload_json)
    for (const row of this.database.prepare('SELECT project_id, archived_at, reason, project_json FROM archived_projects').all()) state.archives[row.project_id] = { project: JSON.parse(row.project_json), archivedAt: row.archived_at, reason: row.reason }
    state.collaborationEvents = this.database.prepare('SELECT payload_json FROM collaboration_events ORDER BY created_at').all().map((row) => JSON.parse(row.payload_json))
    for (const row of this.database.prepare('SELECT id, payload_json FROM agent_workers').all()) state.agentWorkers[row.id] = JSON.parse(row.payload_json)
    // Audit is intentionally loaded from its own append-only table rather
    // than duplicated inside a project snapshot.
    state.audit = this.database.prepare('SELECT id, actor, action, project_id, before_revision, after_revision, trace_id, timestamp, details_json FROM audit_events ORDER BY timestamp').all().map((row) => ({ ...JSON.parse(row.details_json), id: row.id, actor: row.actor, action: row.action, projectId: row.project_id, beforeRevision: row.before_revision, afterRevision: row.after_revision, traceId: row.trace_id, timestamp: row.timestamp }))
    return this.#migrate(state)
  }

  #syncSqliteEntityTables() {
    const clearOrder = ['collaboration_events', 'agent_workers', 'agent_traces', 'agent_tasks', 'regeneration_candidates', 'review_suggestions', 'manuscript_versions', 'manuscript_blocks', 'source_bindings', 'material_chunks', 'materials', 'archived_projects', 'assistant_contexts', 'assistant_bindings', 'work_contexts', 'session_bindings', 'projects', 'workspaces']
    for (const table of clearOrder) this.database.exec(`DELETE FROM ${table}`)
    const insert = (sql, values) => this.database.prepare(sql).run(...values)
    const json = (value) => JSON.stringify(value)

    for (const workspace of Object.values(this.state.workspaces || {})) {
      insert('INSERT INTO workspaces (id, active_project_id, updated_at, source, payload_json) VALUES (?, ?, ?, ?, ?)', [workspace.id, workspace.activeProjectId || null, workspace.updatedAt || null, workspace.source || null, json(workspace)])
    }
    for (const [sessionId, projectId] of Object.entries(this.state.sessionBindings || {})) insert('INSERT INTO session_bindings (session_id, project_id) VALUES (?, ?)', [sessionId, projectId])
    for (const [assistantKey, projectId] of Object.entries(this.state.assistantBindings || {})) insert('INSERT INTO assistant_bindings (assistant_key, project_id) VALUES (?, ?)', [assistantKey, projectId])
    for (const [assistantKey, context] of Object.entries(this.state.assistantContexts || {})) insert('INSERT INTO assistant_contexts (assistant_key, payload_json) VALUES (?, ?)', [assistantKey, json(context)])
    for (const [sessionId, context] of Object.entries(this.state.workContexts || {})) insert('INSERT INTO work_contexts (session_id, payload_json) VALUES (?, ?)', [sessionId, json(context)])
    for (const [projectId, archive] of Object.entries(this.state.archives || {})) insert('INSERT INTO archived_projects (project_id, archived_at, reason, project_json) VALUES (?, ?, ?, ?)', [projectId, archive.archivedAt, archive.reason, json(archive.project)])
    for (const event of this.state.collaborationEvents || []) insert('INSERT INTO collaboration_events (id, collaboration_session_id, workspace_id, project_id, origin, kind, request_type, task_id, visible_summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [event.id, event.collaborationSessionId || null, event.workspaceId || null, event.projectId || null, event.origin, event.kind, event.requestType || null, event.taskId || null, event.visibleSummary, json(event), event.createdAt])
    for (const worker of Object.values(this.state.agentWorkers || {})) insert('INSERT INTO agent_workers (id, name, status, last_heartbeat_at, stopped_at, error, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)', [worker.id, worker.name, worker.status, worker.lastHeartbeatAt || null, worker.stoppedAt || null, worker.error || null, json(worker)])
    for (const project of Object.values(this.state.projects || {})) {
      insert('INSERT INTO projects (id, name, task_type, status, revision, created_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [project.id, project.name, project.taskType, project.status || null, project.revision || 1, project.createdAt, project.updatedAt, json(project)])
      for (const material of project.materials || []) insert('INSERT INTO materials (project_id, id, status, created_at, payload_json) VALUES (?, ?, ?, ?, ?)', [project.id, material.id, material.status || null, material.createdAt || null, json(material)])
      for (const [index, chunk] of (project.sourceChunks || []).entries()) insert('INSERT INTO material_chunks (project_id, chunk_key, material_id, payload_json) VALUES (?, ?, ?, ?)', [project.id, chunk.id || `${index}`, chunk.materialId || null, json(chunk)])
      for (const [index, binding] of (project.sourceBindings || []).entries()) insert('INSERT INTO source_bindings (project_id, id, payload_json) VALUES (?, ?, ?)', [project.id, binding.id || `${index}`, json(binding)])
      for (const [index, block] of (project.manuscriptBlocks || []).entries()) insert('INSERT INTO manuscript_blocks (project_id, id, outline_node_id, block_revision, block_order, payload_json) VALUES (?, ?, ?, ?, ?, ?)', [project.id, block.id || `${index}`, block.outlineNodeId || null, block.revision || 1, block.order ?? index, json(block)])
      for (const [index, snapshot] of (project.snapshots || []).entries()) insert('INSERT INTO manuscript_versions (project_id, id, created_at, payload_json) VALUES (?, ?, ?, ?)', [project.id, snapshot.id || `${index}`, snapshot.createdAt || null, json(snapshot)])
      for (const [index, suggestion] of (project.reviewSuggestions || []).entries()) insert('INSERT INTO review_suggestions (project_id, id, payload_json) VALUES (?, ?, ?)', [project.id, suggestion.id || `${index}`, json(suggestion)])
      for (const [index, candidate] of (project.regenerationCandidates || []).entries()) insert('INSERT INTO regeneration_candidates (project_id, id, status, created_at, payload_json) VALUES (?, ?, ?, ?, ?)', [project.id, candidate.id || `${index}`, candidate.status || null, candidate.createdAt || null, json(candidate)])
      for (const task of project.agentTasks || []) insert('INSERT INTO agent_tasks (project_id, id, type, status, trace_id, created_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [project.id, task.id, task.type, task.status, task.traceId || null, task.createdAt, task.updatedAt, json(task)])
      for (const [index, trace] of (project.agentTrace || []).entries()) insert('INSERT INTO agent_traces (project_id, id, timestamp, payload_json) VALUES (?, ?, ?, ?)', [project.id, trace.id || `${index}`, trace.timestamp || null, json(trace)])
    }
  }

  async #persist(options = {}) {
    const operation = async () => {
      if (this.isSqlite) {
        const now = new Date().toISOString()
        this.state.updatedAt = now
        this.database.exec('BEGIN IMMEDIATE')
        try {
          this.database.prepare('INSERT INTO storage_metadata (id, schema_version, created_at, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version, updated_at = excluded.updated_at').run(CURRENT_SCHEMA_VERSION, this.state.createdAt || now, now)
          const insertAudit = this.database.prepare(`
            INSERT OR IGNORE INTO audit_events
              (id, actor, action, project_id, before_revision, after_revision, trace_id, timestamp, details_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          for (const event of this.state.audit) {
            insertAudit.run(event.id, event.actor || 'system', event.action || 'unknown', event.projectId || null, event.beforeRevision ?? null, event.afterRevision ?? null, event.traceId || null, event.timestamp || now, JSON.stringify(event))
          }
          this.#syncSqliteEntityTables()
          this.database.exec('COMMIT')
        } catch (error) {
          this.database.exec('ROLLBACK')
          throw error
        }
        return
      }
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
      agentTasks: [],
      agentTrace: [],
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

  async permanentlyDeleteArchivedProject(projectId, options = {}) {
    await this.#ensureLoaded()
    const entry = this.state.archives[projectId]
    if (!entry) throw new Error('Only an archived project can be permanently deleted')
    const project = entry.project
    if (options.userConfirmed !== true) throw new Error('Permanently deleting a project requires explicit user confirmation')
    if (String(options.projectNameConfirmation || '').trim() !== project.name) throw new Error('Project name confirmation does not match')
    const deletedEntityCounts = {
      materials: (project.materials || []).length,
      materialChunks: (project.sourceChunks || []).length,
      manuscriptBlocks: (project.manuscriptBlocks || []).length,
      manuscriptVersions: (project.snapshots || []).length,
      sourceBindings: (project.sourceBindings || []).length,
      reviewSuggestions: (project.reviewSuggestions || []).length,
      regenerationCandidates: (project.regenerationCandidates || []).length,
      agentTasks: (project.agentTasks || []).length,
      agentTraces: (project.agentTrace || []).length,
    }
    delete this.state.archives[projectId]
    this.state.audit.push(this.#audit('project.permanently_deleted', {
      actor: options.actor || 'user', projectId, projectName: project.name,
      deletedEntityCounts, reason: options.reason || 'user-confirmed-permanent-delete',
    }))
    await this.#persist()
    // Material files are not database rows. They are removed only after the
    // SQLite transaction commits, so a failed confirmation can never remove
    // files while retaining an archive record.
    const materialDirectory = path.join(path.dirname(this.storagePath), 'projects', projectId)
    let materialDirectoryDeleted = false
    try {
      await rm(materialDirectory, { recursive: true, force: true })
      materialDirectoryDeleted = true
    } catch (error) {
      // The project data is already deleted. Surface this as an operational
      // warning so an administrator can remove an orphaned directory safely.
      return { deleted: true, id: projectId, name: project.name, deletedEntityCounts, materialDirectoryDeleted, warning: `Project data was deleted, but material directory cleanup failed: ${error.message}` }
    }
    return { deleted: true, id: projectId, name: project.name, deletedEntityCounts, materialDirectoryDeleted }
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
    const priorSession = this.state.workContexts[sessionId]
    const priorAssistant = options.assistantKey ? this.state.assistantContexts[options.assistantKey] : null
    const sameProject = priorSession?.projectId === projectId || priorAssistant?.projectId === projectId
    const inheritedStage = sameProject ? (priorSession?.stage || priorAssistant?.stage || 'design') : 'design'
    if (options.assistantKey) {
      this.state.assistantBindings[options.assistantKey] = projectId
      const previousStage = this.state.assistantContexts[options.assistantKey]?.stage || 'design'
      this.state.assistantContexts[options.assistantKey] = { stage: sameProject ? previousStage : 'design', projectId, updatedAt: new Date().toISOString() }
    }
    this.state.workContexts[sessionId] = { stage: inheritedStage, projectId, assistantKey: options.assistantKey || priorSession?.assistantKey || null, updatedAt: new Date().toISOString() }
    const project = this.state.projects[projectId]
    project.lastOpenedAt = new Date().toISOString()
    this.state.audit.push(this.#audit('project-bound', { projectId, sessionId, assistantKey: options.assistantKey || null }))
    await this.#persist()
    return { bound: true, projectId }
  }

  async getWorkspace(workspaceId) {
    await this.#ensureLoaded()
    const id = String(workspaceId || 'local:default-workspace')
    const workspace = this.state.workspaces[id] || { id, activeProjectId: null, updatedAt: null }
    const project = workspace.activeProjectId ? this.state.projects[workspace.activeProjectId] : null
    return this.#clone({ ...workspace, activeProject: project ? this.#projectSummary(project) : null })
  }

  async setActiveProject(workspaceId, projectId, options = {}) {
    await this.#ensureLoaded()
    const id = String(workspaceId || 'local:default-workspace')
    if (projectId !== null && !this.state.projects[projectId]) throw new Error('Project not found')
    const now = new Date().toISOString()
    this.state.workspaces[id] = { id, activeProjectId: projectId || null, updatedAt: now, source: options.source || 'unknown' }
    this.state.audit.push(this.#audit('workspace-active-project-set', { workspaceId: id, projectId: projectId || null, source: options.source || 'unknown' }))
    await this.#persist()
    return this.getWorkspace(id)
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
    const beforeRevision = project.revision || 1
    const result = updater(project)
    project.updatedAt = new Date().toISOString()
    project.revision = beforeRevision + 1
    this.state.audit.push(this.#audit(options.action || 'project.updated', { actor: options.actor || 'system', projectId, beforeRevision, afterRevision: project.revision, traceId: options.traceId || null }))
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

  async addRegenerationCandidate(projectId, candidate) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    project.regenerationCandidates ||= []
    const record = { id: randomUUID(), status: 'pending_review', createdAt: new Date().toISOString(), ...candidate }
    project.regenerationCandidates.push(record)
    project.updatedAt = new Date().toISOString()
    await this.#persist()
    return this.#clone(record)
  }

  async createChangeSet(projectId, input = {}) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    const changeSet = { id: randomUUID(), projectId, baseRevision: input.baseRevision ?? project.revision, status: 'awaiting_confirmation', outlineChanges: input.outlineChanges || [], logicChanges: input.logicChanges || [], manuscriptChanges: input.manuscriptChanges || [], reviewChanges: input.reviewChanges || [], evidenceRefs: input.evidenceRefs || [], rationale: input.rationale || '', taskId: input.taskId || null, createdAt: new Date().toISOString() }
    project.changeSets ||= []; project.changeSets.push(changeSet)
    await this.#persist()
    return this.#clone(changeSet)
  }

  async getChangeSet(projectId, changeSetId) {
    await this.#ensureLoaded(); const project = this.state.projects[projectId]; if (!project) throw new Error('Project not found')
    const value = (project.changeSets || []).find((item) => item.id === changeSetId); if (!value) throw new Error('Change set not found'); return this.#clone(value)
  }

  async updateChangeSet(projectId, changeSetId, updater) {
    await this.#ensureLoaded(); const project = this.state.projects[projectId]; if (!project) throw new Error('Project not found')
    const value = (project.changeSets || []).find((item) => item.id === changeSetId); if (!value) throw new Error('Change set not found'); const result = updater(value); await this.#persist(); return this.#clone(result || value)
  }

  async updateRegenerationCandidate(projectId, candidateId, updater) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    const candidate = (project.regenerationCandidates || []).find((item) => item.id === candidateId)
    if (!candidate) throw new Error('Regeneration candidate not found')
    const result = updater(candidate, project)
    project.updatedAt = new Date().toISOString()
    project.revision = (project.revision || 0) + 1
    await this.#persist()
    return result === undefined ? this.#clone(candidate) : result
  }

  async addAgentTrace(projectId, trace) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) return null
    project.agentTrace ||= []
    project.agentTrace.push({ id: randomUUID(), timestamp: new Date().toISOString(), ...trace })
    // Keep the workbench readable and storage bounded during long-running work.
    if (project.agentTrace.length > 200) project.agentTrace.splice(0, project.agentTrace.length - 200)
    project.updatedAt = new Date().toISOString()
    await this.#persist()
    return this.#clone(project.agentTrace.at(-1))
  }

  async listPendingRegenerationRequests(projectId) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    return (project.regenerationRequests || []).filter((r) => r.status === 'pending')
  }

  async createAgentTask(projectId, input = {}) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    const task = { id: randomUUID(), projectId, type: String(input.type || 'general'), payload: input.payload || {}, requestedBy: input.requestedBy || 'page', status: 'queued', progress: { step: 'queued', message: '等待 Agent 领取', percent: 0 }, traceId: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    project.agentTasks ||= []
    project.agentTasks.push(task)
    this.state.audit.push(this.#audit('agent-task-created', { projectId, taskId: task.id, type: task.type, requestedBy: task.requestedBy }))
    await this.#persist()
    return this.#clone(task)
  }

  async addCollaborationEvent(event) {
    await this.#ensureLoaded()
    const record = { id: randomUUID(), origin: 'system', kind: 'progress', visibleSummary: '', createdAt: new Date().toISOString(), ...event }
    this.state.collaborationEvents ||= []
    this.state.collaborationEvents.push(record)
    if (this.state.collaborationEvents.length > 2000) this.state.collaborationEvents.splice(0, this.state.collaborationEvents.length - 2000)
    await this.#persist()
    return this.#clone(record)
  }

  async listCollaborationEvents(options = {}) {
    await this.#ensureLoaded()
    const after = options.after ? String(options.after) : ''
    return this.#clone((this.state.collaborationEvents || []).filter((event) => (!options.sessionId || event.collaborationSessionId === options.sessionId) && (!options.projectId || event.projectId === options.projectId) && (!after || event.createdAt > after)).slice(-Math.min(500, Math.max(1, Number(options.limit || 100)))))
  }

  async registerAgentWorker(input = {}) {
    await this.#ensureLoaded()
    const id = String(input.id || randomUUID())
    const now = new Date().toISOString()
    const existing = this.state.agentWorkers[id]
    const worker = {
      id,
      name: String(input.name || existing?.name || 'DSH Agent Worker'),
      status: 'online',
      capabilities: Array.isArray(input.capabilities) ? input.capabilities.map(String) : (existing?.capabilities || ['claim_agent_task', 'publish_progress']),
      registeredAt: existing?.registeredAt || now,
      lastHeartbeatAt: now,
      stoppedAt: null,
      error: null,
    }
    this.state.agentWorkers[id] = worker
    this.state.audit.push(this.#audit('agent-worker-registered', { workerId: id, workerName: worker.name }))
    await this.#persist()
    return this.#clone(worker)
  }

  async heartbeatAgentWorker(workerId, input = {}) {
    await this.#ensureLoaded()
    const worker = this.state.agentWorkers[String(workerId)]
    if (!worker) throw new Error('Agent worker not found')
    worker.status = 'online'
    worker.lastHeartbeatAt = new Date().toISOString()
    worker.error = input.error ? String(input.error) : null
    await this.#persist()
    return this.#clone(worker)
  }

  async stopAgentWorker(workerId, input = {}) {
    await this.#ensureLoaded()
    const worker = this.state.agentWorkers[String(workerId)]
    if (!worker) throw new Error('Agent worker not found')
    worker.status = 'stopped'
    worker.stoppedAt = new Date().toISOString()
    worker.error = input.reason ? String(input.reason) : null
    this.state.audit.push(this.#audit('agent-worker-stopped', { workerId: worker.id, reason: worker.error }))
    await this.#persist()
    return this.#clone(worker)
  }

  async listAgentWorkers(options = {}) {
    await this.#ensureLoaded()
    const staleAfterMs = Math.max(5_000, Number(options.staleAfterMs || 30_000))
    const now = Date.now()
    let changed = false
    for (const worker of Object.values(this.state.agentWorkers || {})) {
      if (worker.status === 'online' && (!worker.lastHeartbeatAt || now - Date.parse(worker.lastHeartbeatAt) > staleAfterMs)) {
        worker.status = 'stale'
        worker.error = worker.error || '心跳超时；执行器可能已停止。'
        changed = true
      }
    }
    if (changed) await this.#persist()
    return this.#clone(Object.values(this.state.agentWorkers || {}).sort((a, b) => String(b.lastHeartbeatAt || '').localeCompare(String(a.lastHeartbeatAt || ''))))
  }

  async listAgentTasks(projectId, options = {}) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    const status = options.status || null
    return this.#clone((project.agentTasks || []).filter((task) => !status || task.status === status))
  }

  async updateAgentTask(projectId, taskId, updater) {
    await this.#ensureLoaded()
    const project = this.state.projects[projectId]
    if (!project) throw new Error('Project not found')
    const task = (project.agentTasks || []).find((item) => item.id === taskId)
    if (!task) throw new Error('Agent task not found')
    const result = updater(task)
    task.updatedAt = new Date().toISOString()
    project.updatedAt = task.updatedAt
    this.state.audit.push(this.#audit('agent-task-updated', { projectId, taskId, status: task.status }))
    await this.#persist()
    return result === undefined ? this.#clone(task) : result
  }

  async listAuditEvents(projectId, options = {}) {
    await this.#ensureLoaded()
    const limit = Math.min(500, Math.max(1, Number(options.limit || 100)))
    if (this.isSqlite) {
      const rows = this.database.prepare('SELECT id, actor, action, project_id, before_revision, after_revision, trace_id, timestamp, details_json FROM audit_events WHERE (? IS NULL OR project_id = ?) ORDER BY timestamp DESC LIMIT ?').all(projectId || null, projectId || null, limit)
      return rows.map((row) => ({ ...JSON.parse(row.details_json), id: row.id, actor: row.actor, action: row.action, projectId: row.project_id, beforeRevision: row.before_revision, afterRevision: row.after_revision, traceId: row.trace_id, timestamp: row.timestamp }))
    }
    return this.state.audit.filter((event) => !projectId || event.projectId === projectId).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, limit).map((event) => this.#clone(event))
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
    for (const workspace of Object.values(this.state.workspaces)) {
      if (workspace.activeProjectId === projectId) Object.assign(workspace, { activeProjectId: null, updatedAt: archivedAt, source: 'project-archived' })
    }
    this.state.audit.push(this.#audit('project-archived', { projectId, name: project.name, reason }))
    return { id: project.id, name: project.name, taskType: project.taskType, createdAt: project.createdAt, archivedAt, reason }
  }
}
