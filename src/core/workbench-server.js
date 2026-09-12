/**
 * Generic workbench HTTP server for the pluggable framework.
 * Serves the dual-pane 4:3 draggable editor UI and REST API.
 * Task-type-agnostic: all content comes from the runtime + plugins.
 */

import http from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createPluginSpecDraft, validatePluginSpec } from './plugin-spec.js'
import { generatePluginBundle } from '../generator.js'
import { assertToolAllowedForStage } from '../work-stage.js'
import { acquireServiceLock } from './service-lock.js'

export function createWorkbenchServer(runtime, options = {}) {
  const port = options.port ?? 3200
  const host = options.host || '127.0.0.1'
  const serviceLock = options.singleInstance === false ? null : acquireServiceLock(
    options.lockPath || `${runtime.storage.storagePath}.server.lock`,
    { storagePath: runtime.storage.storagePath, host, port },
  )
  const guard = async (sessionId, toolName) => {
    if (options.enforceStages !== false) await assertToolAllowedForStage(runtime, sessionId, toolName)
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${host}:${port}`)
    try {
      // ─── Page ───────────────────────────────────────────────────────
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self' 'unsafe-inline'; connect-src 'self'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' })
        response.end(pageHtml())
        return
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, { status: 'ready', service: 'workbench-core', storage: runtime.storage.isSqlite ? 'sqlite' : 'json', now: new Date().toISOString() })
      }

      if (request.method === 'GET' && url.pathname.startsWith('/api/workspaces/')) {
        const workspaceId = decodeURIComponent(url.pathname.split('/').pop())
        return json(response, 200, await runtime.getWorkspace(workspaceId))
      }
      if (request.method === 'PUT' && url.pathname.startsWith('/api/workspaces/')) {
        const workspaceId = decodeURIComponent(url.pathname.split('/').pop())
        const input = await body(request)
        return json(response, 200, await runtime.setActiveProject(workspaceId, input.projectId ?? null, { source: input.source || 'workbench-page' }))
      }

      // ─── Projects API ───────────────────────────────────────────────
      if (request.method === 'GET' && url.pathname === '/api/projects') {
        return json(response, 200, await runtime.listProjects())
      }
      if (request.method === 'POST' && url.pathname === '/api/projects') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_create_project')
        return json(response, 200, await runtime.createProject(input.sessionId, input))
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/projects/')) {
        const projectId = url.pathname.split('/').pop()
        await guard(url.searchParams.get('sessionId'), 'wb_delete_project')
        return json(response, 200, await runtime.deleteProject(projectId))
      }
      if (request.method === 'POST' && url.pathname === '/api/bind') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_bind_project')
        return json(response, 200, await runtime.bindProject(input.sessionId, input.projectId, { assistantKey: input.assistantKey }))
      }
      if (request.method === 'POST' && url.pathname === '/api/unbind') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_unbind_project')
        return json(response, 200, await runtime.unbindProject(input.sessionId, { assistantKey: input.assistantKey }))
      }
      if (request.method === 'GET' && url.pathname === '/api/session') {
        const sessionId = url.searchParams.get('sessionId')
        return json(response, 200, await runtime.getResumeState(sessionId, url.searchParams.get('assistantKey')))
      }
      if (request.method === 'GET' && url.pathname === '/api/project-limit') {
        return json(response, 200, await runtime.getProjectLimit())
      }
      if (request.method === 'GET' && url.pathname === '/api/archives') {
        return json(response, 200, await runtime.listArchivedProjects())
      }
      if (request.method === 'POST' && /^\/api\/archives\/[^/]+\/restore$/.test(url.pathname)) {
        const projectId = decodeURIComponent(url.pathname.split('/')[3])
        const input = await body(request)
        await guard(input.sessionId, 'wb_restore_archived_project')
        if (input.userConfirmed !== true) throw new Error('Restoring an archived project requires explicit user confirmation')
        return json(response, 200, await runtime.restoreArchivedProject(projectId, { sessionId: input.sessionId, assistantKey: input.assistantKey }))
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/archives/')) {
        const projectId = decodeURIComponent(url.pathname.split('/').pop())
        const input = await body(request)
        await guard(input.sessionId, 'wb_permanently_delete_archived_project')
        return json(response, 200, await runtime.permanentlyDeleteArchivedProject(projectId, { ...input, actor: 'user' }))
      }
      if (request.method === 'POST' && url.pathname === '/api/follow') {
        const input = await body(request)
        return json(response, 200, await runtime.followProject(input.sessionId))
      }

      // ─── Workbench State ────────────────────────────────────────────
      if (request.method === 'GET' && url.pathname === '/api/workbench') {
        return json(response, 200, await runtime.getWorkbench(url.searchParams.get('sessionId')))
      }

      // ─── Outline / Manuscript ────────────────────────────────────────
      if (request.method === 'POST' && url.pathname === '/api/plan') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_set_outline')
        return json(response, 200, await runtime.setOutline(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname.startsWith('/api/logic-blocks/')) {
        const logicBlockId = decodeURIComponent(url.pathname.split('/').pop())
        const input = await body(request)
        await guard(input.sessionId, 'wb_update_logic_block')
        return json(response, 200, await runtime.updateLogicBlock(input.sessionId, logicBlockId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/manuscript') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_set_manuscript')
        return json(response, 200, await runtime.setManuscriptBlocks(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/domain-fields') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_set_domain_fields')
        return json(response, 200, await runtime.setDomainFields(input.sessionId, input.fields || {}))
      }
      if (request.method === 'POST' && url.pathname === '/api/materials') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_add_material')
        return json(response, 200, await runtime.addMaterial(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/materials/import-file') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_import_material_file')
        return json(response, 200, await runtime.importMaterialFile(input.sessionId, input.filePath))
      }
      if (request.method === 'POST' && url.pathname === '/api/materials/import-directory') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_import_material_directory')
        return json(response, 200, await runtime.importMaterialDirectory(input.sessionId, input.directoryPath, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/materials/search') {
        const input = await body(request)
        return json(response, 200, await runtime.searchMaterials(input.sessionId, input.query, input.limit))
      }
      if (request.method === 'GET' && url.pathname === '/api/retrieval/profiles') {
        return json(response, 200, await runtime.listEmbeddingProfiles())
      }
      if (request.method === 'GET' && url.pathname === '/api/retrieval/status') {
        return json(response, 200, await runtime.getRetrievalStatus(url.searchParams.get('sessionId')))
      }
      if (request.method === 'POST' && url.pathname === '/api/retrieval/configure') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_configure_retrieval')
        return json(response, 200, await runtime.configureRetrieval(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/retrieval/reindex') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_reindex_materials')
        return json(response, 200, await runtime.reindexMaterials(input.sessionId))
      }
      if (request.method === 'GET' && url.pathname === '/api/material-summaries') {
        const sessionId = url.searchParams.get('sessionId')
        return json(response, 200, await runtime.listMaterialSummaries(sessionId, Object.fromEntries(url.searchParams)))
      }
      if (request.method === 'GET' && url.pathname === '/api/material-content') {
        const sessionId = url.searchParams.get('sessionId')
        return json(response, 200, await runtime.getMaterialContent(sessionId, Object.fromEntries(url.searchParams)))
      }
      if (request.method === 'GET' && url.pathname === '/api/material-chunks') {
        const sessionId = url.searchParams.get('sessionId')
        return json(response, 200, await runtime.listMaterialChunks(sessionId, Object.fromEntries(url.searchParams)))
      }
      if (request.method === 'POST' && url.pathname === '/api/evidence/bind') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_bind_evidence')
        return json(response, 200, await runtime.bindEvidence(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/literature/search') {
        const input = await body(request)
        return json(response, 200, await runtime.searchLiterature(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/literature') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_add_literature')
        return json(response, 200, await runtime.addLiterature(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/snapshots') {
        const input = await body(request)
        return json(response, 200, await runtime.createSnapshot(input.sessionId, input.name))
      }
      if (request.method === 'POST' && url.pathname === '/api/snapshots/restore') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_restore_snapshot')
        return json(response, 200, await runtime.restoreSnapshot(input.sessionId, input.snapshotId))
      }
      if (request.method === 'POST' && url.pathname === '/api/export') {
        const input = await body(request)
        return json(response, 200, await runtime.exportDocument(input.sessionId, input.format))
      }

      // ─── Spec Studio (JSON only until the user explicitly generates) ──
      if (request.method === 'POST' && url.pathname === '/api/plugin-spec/draft') {
        return json(response, 200, createPluginSpecDraft(await body(request)))
      }
      if (request.method === 'POST' && url.pathname === '/api/plugin-spec/validate') {
        const input = await body(request)
        return json(response, 200, validatePluginSpec(input.spec))
      }
      if (request.method === 'POST' && url.pathname === '/api/plugin-spec/generate') {
        const input = await body(request)
        return json(response, 200, await generatePluginBundle({ spec: input.spec, outputRoot: input.outputRoot, confirmedDestination: input.confirmedDestination === true }))
      }

      // ─── Runs (State Machine) ────────────────────────────────────────
      if (request.method === 'POST' && url.pathname === '/api/runs') {
        const input = await body(request)
        return json(response, 200, await runtime.createRun(input.sessionId, input))
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/runs/')) {
        const runId = url.pathname.split('/').pop()
        return json(response, 200, await runtime.getRun(url.searchParams.get('sessionId'), runId))
      }
      if (request.method === 'POST' && url.pathname === '/api/runs/advance') {
        const input = await body(request)
        return json(response, 200, await runtime.advanceRun(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/runs/cancel') {
        const input = await body(request)
        return json(response, 200, await runtime.cancelRun(input.sessionId, input))
      }

      // ─── Templates ───────────────────────────────────────────────────
      if (request.method === 'GET' && url.pathname === '/api/templates') {
        return json(response, 200, await runtime.listTemplates(url.searchParams.get('sessionId')))
      }
      if (request.method === 'POST' && url.pathname === '/api/templates') {
        const input = await body(request)
        return json(response, 200, await runtime.saveTemplate(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/templates/import-upload') {
        const sessionId = url.searchParams.get('sessionId')
        await guard(sessionId, 'wb_import_template_file')
        const filename = path.basename(decodeURIComponent(request.headers['x-file-name'] || 'template.txt')).replace(/[^\w.\-\u4e00-\u9fff]/g, '_')
        const bytes = await rawBody(request, 10 * 1024 * 1024)
        const uploadDirectory = path.join(path.dirname(runtime.storage.storagePath), 'uploads')
        await mkdir(uploadDirectory, { recursive: true })
        const filePath = path.join(uploadDirectory, `${randomUUID()}-${filename}`)
        await writeFile(filePath, bytes)
        return json(response, 200, await runtime.importTemplateFile(sessionId, filePath, { name: url.searchParams.get('name') || filename, type: url.searchParams.get('type') || 'both' }))
      }
      if (request.method === 'POST' && url.pathname === '/api/templates/preview-restructure') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_preview_template_restructure')
        return json(response, 200, await runtime.previewTemplateRestructure(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/templates/apply-restructure') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_apply_template_restructure')
        return json(response, 200, await runtime.applyTemplateRestructure(input.sessionId, input))
      }

      // ─── Regeneration ────────────────────────────────────────────────
      if (request.method === 'POST' && url.pathname === '/api/request-regeneration') {
        const input = await body(request)
        return json(response, 200, await runtime.requestRegeneration(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/agent-tasks') {
        const input = await body(request)
        return json(response, 200, await runtime.createAgentTask(input.sessionId, input))
      }
      if (request.method === 'GET' && url.pathname === '/api/agent-tasks') {
        return json(response, 200, await runtime.listAgentTasks(url.searchParams.get('sessionId'), { status: url.searchParams.get('status') || undefined }))
      }
      if (request.method === 'POST' && /^\/api\/agent-tasks\/[^/]+\/dispatch$/.test(url.pathname)) {
        const input = await body(request)
        const taskId = decodeURIComponent(url.pathname.split('/')[3])
        return json(response, 200, await runtime.dispatchQueuedAgentTask(input.sessionId, taskId))
      }
      if (request.method === 'GET' && url.pathname === '/api/collaboration-events') {
        return json(response, 200, await runtime.listCollaborationEvents({ sessionId: url.searchParams.get('sessionId') || undefined, projectId: url.searchParams.get('projectId') || undefined, after: url.searchParams.get('after') || undefined }))
      }
      if (request.method === 'GET' && url.pathname === '/api/collaboration-events/stream') {
        const filters = { sessionId: url.searchParams.get('sessionId') || undefined, projectId: url.searchParams.get('projectId') || undefined }
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' })
        let after = url.searchParams.get('after') || ''
        const publish = async () => {
          const events = await runtime.listCollaborationEvents({ ...filters, after })
          for (const event of events) {
            after = event.createdAt
            response.write(`event: collaboration\\ndata: ${JSON.stringify(event)}\\n\\n`)
          }
        }
        await publish()
        const timer = setInterval(() => publish().catch(() => {}), 1000)
        request.once('close', () => clearInterval(timer))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/agent-workers') return json(response, 200, await runtime.listAgentWorkers())
      if (request.method === 'POST' && url.pathname === '/api/agent-workers') return json(response, 200, await runtime.registerAgentWorker(await body(request)))
      if (request.method === 'POST' && /^\/api\/agent-workers\/[^/]+\/heartbeat$/.test(url.pathname)) {
        const workerId = decodeURIComponent(url.pathname.split('/')[3])
        return json(response, 200, await runtime.heartbeatAgentWorker(workerId, await body(request)))
      }
      if (request.method === 'POST' && /^\/api\/agent-workers\/[^/]+\/stop$/.test(url.pathname)) {
        const workerId = decodeURIComponent(url.pathname.split('/')[3])
        return json(response, 200, await runtime.stopAgentWorker(workerId, await body(request)))
      }
      if (request.method === 'POST' && url.pathname === '/api/change-sets') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_create_change_set')
        return json(response, 200, await runtime.createChangeSet(input.sessionId, input))
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/change-sets/')) {
        const changeSetId = url.pathname.split('/').pop()
        return json(response, 200, await runtime.getChangeSet(url.searchParams.get('sessionId'), changeSetId))
      }
      if (request.method === 'POST' && url.pathname.match(/^\/api\/change-sets\/[^/]+\/apply$/)) {
        const input = await body(request)
        await guard(input.sessionId, 'wb_apply_change_set')
        input.changeSetId = url.pathname.split('/')[3]
        return json(response, 200, await runtime.applyChangeSet(input.sessionId, input))
      }
      if (request.method === 'GET' && url.pathname === '/api/audit-events') {
        return json(response, 200, await runtime.listAuditEvents(url.searchParams.get('sessionId'), { limit: url.searchParams.get('limit') || undefined }))
      }
      if (request.method === 'POST' && url.pathname === '/api/regeneration-candidates/resolve') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_resolve_regeneration_candidate')
        return json(response, 200, await runtime.resolveRegenerationCandidate(input.sessionId, input))
      }

      // ─── 404 ─────────────────────────────────────────────────────────
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'Not found', path: url.pathname }))
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: error.message }))
    }
  })

  let resolveReady
  let rejectReady
  server.ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })

  const start = (listenPort) => server.listen(listenPort, host, () => {
    const address = server.address()
    server.port = typeof address === 'object' && address ? address.port : listenPort
    server.url = `http://${host}:${server.port}`
    console.log(`[workbench-core] Workbench UI running at ${server.url}`)
    resolveReady(server)
  })
  server.once('error', (error) => {
    if (error.code !== 'EADDRINUSE' || options.fallback === false) {
      serviceLock?.release()
      rejectReady(error)
      return
    }
    const fallbackPort = options.fallbackPort || (port + 1)
    console.warn(`[workbench-core] Port ${port} is busy; using ${fallbackPort}`)
    start(fallbackPort)
  })
  start(port)

  server.once('close', () => serviceLock?.release())
  server.coreLock = serviceLock

  return server
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(data))
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

async function rawBody(request, maxBytes) {
  const chunks = []; let total = 0
  for await (const chunk of request) { total += chunk.length; if (total > maxBytes) throw new Error(`Upload exceeds ${maxBytes} byte limit`); chunks.push(chunk) }
  return Buffer.concat(chunks)
}

function pageHtml() {
  // Keep backslash escapes in embedded JavaScript (for example "\\n" inside
  // a browser string literal) intact. A normal template literal consumes them
  // and can emit an illegal literal newline into the served script.
  return String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pluggable Workbench</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI','PingFang SC',sans-serif;background:#f4f3ee;color:#1a1b1c;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.top{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fff;border-bottom:1px solid #e4e3dd;flex-wrap:wrap}
.top strong{font-size:14px;margin-right:8px}
.top select{padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:12px}
.top button{padding:4px 12px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;white-space:nowrap}
.top button:hover{background:#f3f4f6}
.status{margin-left:auto;font-size:11px;color:#6b7280;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:1;min-width:0}
.layout{flex:1;display:flex;overflow:hidden}
.paper{flex:0 0 57%;display:flex;flex-direction:column;border-right:1px solid #e4e3dd;min-width:0}
.paper textarea{flex:1;border:none;outline:none;padding:16px;font-size:14px;line-height:1.7;resize:none;background:#fff;font-family:'Georgia',serif}
.resizer{width:5px;background:#e4e3dd;cursor:col-resize;flex-shrink:0;transition:background .2s}
.resizer:hover,.resizer.active{background:#3b82f6}
.side{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.tabs{display:flex;gap:0;border-bottom:1px solid #e4e3dd;background:#fff;overflow-x:auto}
.tabs button{padding:8px 14px;border:none;background:transparent;cursor:pointer;font-size:12px;color:#6b7280;white-space:nowrap;border-bottom:2px solid transparent}
.tabs button.active{color:#1f6feb;border-bottom-color:#1f6feb;font-weight:600}
.panel{flex:1;overflow-y:auto;padding:12px;display:none}
.panel.active{display:block}
.card{background:#fff;border:1px solid #e4e3dd;border-radius:8px;padding:10px;margin-bottom:10px}
.card h3{font-size:13px;margin-bottom:6px}
.card input,.card textarea{width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;margin-top:4px}
.card textarea{min-height:60px;resize:vertical}
.badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;background:#e8f0fe;color:#1f6feb;margin-right:6px}
.muted{font-size:11px;color:#6b7280;margin-top:4px}
.empty{text-align:center;color:#9ca3af;padding:40px 20px;font-size:13px}
.material-table{width:100%;border-collapse:collapse;font-size:11px;margin:8px 0}.material-table th,.material-table td{border-bottom:1px solid #e4e3dd;padding:5px;text-align:left;vertical-align:top}.material-table button{border:0;background:none;color:#1f6feb;cursor:pointer;text-align:left;padding:0;font-size:11px}
  .diff{white-space:pre-wrap;max-height:180px;overflow:auto;padding:7px;border-radius:4px;font:11px/1.5 ui-monospace,Consolas,monospace;margin:3px 0 7px}.diff.remove{background:#fff0f0;color:#9d1c1c}.diff.add{background:#ecfdf3;color:#146c3a}
  dialog{width:min(720px,calc(100vw - 32px));max-height:80vh;border:0;border-radius:10px;padding:0;box-shadow:0 20px 60px #0004}dialog::backdrop{background:#1118}.dialog-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #e4e3dd}.dialog-body{padding:14px 16px;overflow:auto;max-height:65vh}.archive-actions{display:flex;gap:8px;margin-top:9px}.danger{color:#a61b1b;border-color:#d14343;background:#fff}.task-progress{height:6px;border-radius:5px;background:#e5e7eb;overflow:hidden;margin-top:7px}.task-progress i{display:block;height:100%;background:#2563eb}.task-waiting{border-left:3px solid #d97706}.literature-result{border-left:3px solid #1f6feb}.provider{font-size:10px;border-radius:9px;padding:2px 6px;background:#e8f0fe;color:#1f6feb}.task-help{font-size:11px;background:#fff7ed;border:1px solid #fed7aa;padding:8px;border-radius:6px;margin:7px 0}
</style>
</head>
<body>
<header class="top">
<strong>Pluggable Workbench</strong>
<select id="projects"></select>
  <button id="create">新建</button>
  <button id="deleteProject" style="color:#c0392b;border-color:#e74c3c">删除</button>
  <button id="archives">归档项目</button>
<button id="refresh">刷新</button>
<button id="save">保存正文</button>
<button id="savePlan">保存大纲</button>
<button id="regenerate" style="background:linear-gradient(135deg,#1f6feb,#3b82f6);color:#fff;border-color:#1f6feb">基于 Diff 请求重新生成</button>
<span class="status" id="status">等待连接</span>
</header>
<dialog id="archivesDialog"><div class="dialog-head"><strong>归档项目管理</strong><button id="closeArchives">关闭</button></div><div class="dialog-body"><p class="muted">归档项目可恢复。永久删除必须输入完整项目名称，且不可恢复。</p><div id="archiveList"></div></div></dialog>
<dialog id="literatureDialog"><div class="dialog-head"><strong>中英文文献检索</strong><button id="closeLiterature">关闭</button></div><div class="dialog-body"><div class="card"><label>中文关键词<input id="literatureQueryZh" placeholder="例如：FMCW 雷达 水分测量"></label><label>英文关键词<input id="literatureQueryEn" placeholder="例如：FMCW radar moisture measurement"></label><label>年份范围<input id="literatureYearFrom" type="number" placeholder="起始年份"> <input id="literatureYearTo" type="number" placeholder="结束年份"></label><label><input type="checkbox" data-literature-provider="openalex" checked> OpenAlex</label> <label><input type="checkbox" data-literature-provider="crossref" checked> Crossref</label> <label><input type="checkbox" data-literature-provider="google_scholar"> Google Scholar（需配置 SerpApi）</label><button id="searchLiterature" style="margin-top:8px">同时检索中英文</button><div id="literatureSearchStatus" class="muted"></div></div><div id="literatureResults"></div></div></dialog>
<main class="layout">
<section class="paper"><textarea id="editor" placeholder="选择或创建项目后，在这里编辑正文。"></textarea></section>
<div class="resizer" title="拖拽调整左右宽度"></div>
<aside class="side">
<nav class="tabs">
<button data-tab="outline" class="active">大纲</button>
<button data-tab="logic">逻辑</button>
<button data-tab="sources">引用</button>
<button data-tab="review">审查</button>
<button data-tab="candidates">候选 Diff</button>
<button data-tab="runs">任务</button>
<button data-tab="trace">Agent 轨迹</button>
<button data-tab="templates">模板</button>
<button data-tab="versions">版本</button>
<button data-tab="spec">规格</button>
<button data-tab="settings">设置</button>
</nav>
<div id="outline" class="panel active"></div>
<div id="logic" class="panel"></div>
<div id="sources" class="panel"></div>
<div id="review" class="panel"></div>
<div id="candidates" class="panel"></div>
<div id="runs" class="panel"></div>
<div id="trace" class="panel"></div>
<div id="templates" class="panel"></div>
<div id="versions" class="panel"></div>
<div id="spec" class="panel"></div>
<div id="settings" class="panel"></div>
</aside>
</main>
<script>
// The DSH tool that opens this page passes its session id in the URL. Keeping
// it makes browser actions operate on exactly the same shared project binding.
const requestedSessionId=new URLSearchParams(location.search).get('sessionId');
const requestedProjectId=new URLSearchParams(location.search).get('projectId');
// A directly opened local workbench must not receive a fresh random session on
// every browser profile/tab. DSH may still supply its explicit sessionId.
const sessionId=requestedSessionId||localStorage.wbWorkspaceId||(localStorage.wbWorkspaceId='local:default-workspace');
const workspaceId=new URLSearchParams(location.search).get('workspaceId')||sessionId;
const assistantKey=new URLSearchParams(location.search).get('assistantKey')||'web:text-workbench-assistant-v0';
const homeMode=new URLSearchParams(location.search).get('home')==='1';
let wb=null;let selectedBlock=null;let materialPage=1;
const el=id=>document.getElementById(id);
 function status(t){el('status').textContent=t}
 async function api(path,options={}){const r=await fetch('/api'+path,{headers:{'content-type':'application/json'},...options});const v=await r.json();if(!r.ok)throw new Error(v.error||'请求失败');return v}
 async function openArchives(){try{const rows=await api('/archives');const list=el('archiveList');if(!rows.length)list.innerHTML='<div class="empty">没有归档项目。</div>';else list.innerHTML=rows.map(item=>'<article class="card"><strong>'+escapeHtml(item.name)+'</strong><div class="muted">类型：'+escapeHtml(item.taskType)+' · 归档于：'+new Date(item.archivedAt).toLocaleString()+'</div><div class="muted">原因：'+escapeHtml(item.reason||'user-request')+'</div><div class="archive-actions"><button data-restore-archive="'+item.id+'">恢复</button><button class="danger" data-permanently-delete-archive="'+item.id+'" data-archive-name="'+escapeHtml(item.name)+'">永久删除</button></div></article>').join('');document.querySelectorAll('[data-restore-archive]').forEach(button=>button.onclick=async()=>{if(!confirm('确认恢复此项目吗？'))return;try{await api('/archives/'+encodeURIComponent(button.dataset.restoreArchive)+'/restore',{method:'POST',body:JSON.stringify({sessionId,assistantKey,userConfirmed:true})});await projects();await openArchives();status('项目已恢复')}catch(e){status(e.message)}});document.querySelectorAll('[data-permanently-delete-archive]').forEach(button=>button.onclick=async()=>{const name=button.dataset.archiveName;const typed=prompt('此操作不可恢复。请输入完整项目名称以永久删除：\n'+name);if(typed===null)return;if(typed!==name)return status('项目名称不匹配，未执行永久删除');if(!confirm('最后确认：永久删除“'+name+'”及其材料、正文、版本和任务？'))return;try{const result=await api('/archives/'+encodeURIComponent(button.dataset.permanentlyDeleteArchive),{method:'DELETE',body:JSON.stringify({sessionId,projectNameConfirmation:typed,userConfirmed:true})});await openArchives();status('项目已永久删除；已清理 '+result.deletedEntityCounts.materials+' 份材料')}catch(e){status(e.message)}});el('archivesDialog').showModal()}catch(e){status(e.message)}}
 let literatureCandidates=[];
 function renderLiteratureResults(result){const root=el('literatureResults');const trace=result.trace||{};const providerText=(trace.providers||[]).map(x=>x.id+' / '+x.query+'：'+x.candidateCount+(x.error?'（'+x.error+'）':'')).join('；');root.innerHTML='<div class="muted">检索词：'+escapeHtml((trace.queries||[]).join(' ｜ '))+'<br>'+escapeHtml(providerText)+'<br>已按相关性重排；分数越高表示与检索意图的词项匹配越多。</div>'+((result.candidates||[]).map((item,index)=>'<article class="card literature-result"><span class="provider">'+escapeHtml(item.provider||'unknown')+'</span> <strong>'+escapeHtml(item.title||'无标题')+'</strong><div class="muted">相关性 '+escapeHtml(item.relevanceScore??'—')+' · 命中：'+escapeHtml((item.matchedTerms||[]).join(', ')||'无')+'</div><div class="muted">'+escapeHtml((item.authors||[]).map(a=>a.family||a.given||'').filter(Boolean).join(', ')||'作者未知')+' · '+escapeHtml(item.year||'年份未知')+' · 被引 '+escapeHtml(item.citationCount??'—')+'</div><div class="muted">'+escapeHtml(item.venue||'')+(item.doi?' · DOI: '+escapeHtml(item.doi):'')+'</div><button data-add-literature="'+index+'" style="margin-top:7px">加入项目书目</button></article>').join('')||'<div class="empty">没有检索到候选。请调整中英文关键词。</div>');document.querySelectorAll('[data-add-literature]').forEach(button=>button.onclick=async()=>{const record=literatureCandidates[Number(button.dataset.addLiterature)];if(!record)return;if(!confirm('确认仅保存该文献的元数据，不下载全文吗？'))return;try{await api('/literature',{method:'POST',body:JSON.stringify({sessionId,record,userConfirmed:true})});await load();status('文献已加入项目书目')}catch(e){status(e.message)}})}
 async function searchLiteratureBilingual(){const zh=el('literatureQueryZh').value.trim(),en=el('literatureQueryEn').value.trim(),providers=[...document.querySelectorAll('[data-literature-provider]:checked')].map(x=>x.dataset.literatureProvider),yearFrom=Number(el('literatureYearFrom').value)||undefined,yearTo=Number(el('literatureYearTo').value)||undefined;if(!zh||!en){el('literatureSearchStatus').textContent='请同时填写中文和英文关键词，以便两路检索。';return}if(!providers.length){el('literatureSearchStatus').textContent='请至少选择一个数据源。';return}el('literatureSearchStatus').textContent='正在检索 '+providers.join('、')+' 的中英文结果…';el('literatureResults').innerHTML='<div class="empty">正在检索，请稍候…</div>';try{const result=await api('/literature/search',{method:'POST',body:JSON.stringify({sessionId,query:zh,englishQuery:en,providers,yearFrom,yearTo,limit:10})});literatureCandidates=result.candidates||[];el('literatureSearchStatus').textContent='检索完成：去重后 '+literatureCandidates.length+' 条候选。';renderLiteratureResults(result)}catch(e){el('literatureSearchStatus').textContent='检索失败：'+e.message;el('literatureResults').innerHTML=''}}
 async function openLiteratureDialog(){el('literatureDialog').showModal();el('literatureSearchStatus').textContent='填写两个关键词后将同时检索 OpenAlex 与 Crossref。';el('literatureResults').innerHTML=''}
 async function projects(){const rows=await api('/projects');el('projects').innerHTML='<option value="">选择项目</option>'+rows.map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name)+' ('+x.taskType+')</option>').join('');const workspace=await api('/workspaces/'+encodeURIComponent(workspaceId));const active=requestedProjectId||workspace.activeProjectId||localStorage.wbProjectId;if(active&&rows.some(x=>x.id===active)){el('projects').value=active;await bind(active)}else if(homeMode){status(rows.length?'请选择项目或点击「新建」':'暂无项目，请点击「新建」')}else if(rows.length){el('projects').value=rows[0].id;await bind(rows[0].id)}else{status('暂无项目，请点击「新建」')}}
async function bind(id){await api('/workspaces/'+encodeURIComponent(workspaceId),{method:'PUT',body:JSON.stringify({projectId:id,source:'workbench-page'})});await api('/bind',{method:'POST',body:JSON.stringify({sessionId,projectId:id,assistantKey})});localStorage.wbProjectId=id;await load()}
async function load(){try{wb=await api('/workbench?sessionId='+encodeURIComponent(sessionId));render();status('已加载 · '+wb.project.taskType+' · '+wb.project.name)}catch(e){status(e.message)}}
function escapeHtml(t){return String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function manuscriptText(){return (wb?.manuscriptBlocks||[]).slice().sort((a,b)=>a.order-b.order).map(x=>x.markdown).join('\n\n')}
function describeDiff(before,after){let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;let endBefore=before.length-1,endAfter=after.length-1;while(endBefore>=start&&endAfter>=start&&before[endBefore]===after[endAfter]){endBefore--;endAfter--}return {before:before.slice(start,endBefore+1),after:after.slice(start,endAfter+1),unchangedPrefix:before.slice(Math.max(0,start-120),start),unchangedSuffix:before.slice(endBefore+1,endBefore+121)}}
function diffHtml(before,after){const d=describeDiff(before||'',after||'');if(!d.before&&!d.after)return '<div class="muted">此文本块没有变化</div>';return '<div class="muted">原文</div><pre class="diff remove">'+escapeHtml(d.before||'（空）')+'</pre><div class="muted">候选</div><pre class="diff add">'+escapeHtml(d.after||'（空）')+'</pre>'}
async function queueAgentTask(type,payload={}){
  // The page never depends on a browser parent. Every AI request is a durable
  // Core task, so it remains visible and claimable after either side restarts.
  const task=await api('/agent-tasks',{method:'POST',body:JSON.stringify({sessionId,type,payload,requestedBy:'workbench-page'})});
  status('AI 请求 #'+task.id.slice(0,8)+' 已记录。等待 DSH 执行器领取；可在任务队列查看状态。');
  await pollTasks();
  return task;
}
async function loadMaterialChecklist(page=materialPage){if(!wb||!el('materialChecklist'))return;try{const data=await api('/material-summaries?sessionId='+encodeURIComponent(sessionId)+'&page='+page+'&pageSize=20');materialPage=data.page;const rows=data.items.map(item=>'<tr><td><button data-material-detail="'+escapeHtml(item.id)+'">'+escapeHtml(item.name)+'</button></td><td>'+escapeHtml(item.type)+'</td><td>'+escapeHtml(item.pageCount??'—')+'</td><td>'+item.characterCount+'</td><td>'+escapeHtml(item.extractionStatus)+'</td><td>'+item.indexedChunkCount+'</td><td>'+escapeHtml(item.warnings.length?item.warnings.join('；'):'—')+'</td></tr>').join('')||'<tr><td colspan="7" class="muted">暂无材料</td></tr>';el('materialChecklist').innerHTML='<div class="muted">共 '+data.summary.materialCount+' 份 · 已解析 '+data.summary.parsed+' · 有警告 '+data.summary.warning+' · 已索引 '+data.summary.indexed+' · '+data.summary.totalCharacters+' 字符<br>上次读取：'+new Date().toLocaleTimeString()+'（仅在手动刷新或材料操作后更新）</div><table class="material-table"><thead><tr><th>文件</th><th>类型</th><th>页数</th><th>字符</th><th>状态</th><th>分块</th><th>Warnings</th></tr></thead><tbody>'+rows+'</tbody></table><button id="materialPrev" '+(data.page<=1?'disabled':'')+'>上一页</button> <span class="muted">第 '+data.page+' 页 / '+Math.max(1,Math.ceil(data.total/data.pageSize))+' 页</span> <button id="materialNext" '+(data.page*data.pageSize>=data.total?'disabled':'')+'>下一页</button> <button id="materialRefresh">刷新材料状态</button>';const prev=el('materialPrev'),next=el('materialNext'),refresh=el('materialRefresh');if(prev)prev.onclick=()=>loadMaterialChecklist(data.page-1);if(next)next.onclick=()=>loadMaterialChecklist(data.page+1);if(refresh)refresh.onclick=()=>loadMaterialChecklist(data.page);document.querySelectorAll('[data-material-detail]').forEach(button=>button.onclick=async()=>{try{const detail=await api('/material-content?sessionId='+encodeURIComponent(sessionId)+'&materialId='+encodeURIComponent(button.dataset.materialDetail)+'&limit=1200');alert(detail.material.name+'\n字符数：'+detail.totalCharacters+'\n\n'+(detail.content||'（无可提取文本）'))}catch(e){status(e.message)}})}catch(e){status(e.message)}}
function renderTaskQueue(tasks){const root=el('taskQueue');if(!root)return;const workers=wb.agentWorkers||[];const online=workers.filter(x=>x.status==='online');const workerInfo=online.length?'<div class="task-help">常驻执行器在线：'+online.map(x=>escapeHtml(x.name)+'（心跳 '+new Date(x.lastHeartbeatAt).toLocaleTimeString()+'）').join('、')+'</div>':'<div class="task-help">当前没有在线常驻执行器。任务会明确保持“等待 DSH 执行器领取”，不会伪装为正在执行。</div>';const waiting=tasks.filter(t=>t.status==='queued').length;root.innerHTML='<button id="createRun">新建生成任务</button><h3 style="margin:10px 0 6px">AI 任务队列</h3>'+workerInfo+(waiting?'<div class="task-help">有 '+waiting+' 个任务等待 DSH 执行器领取。</div>':'')+(tasks.map(t=>'<article class="card '+(t.status==='queued'?'task-waiting':'')+'"><span class="badge">'+escapeHtml(t.status)+'</span><h3>'+escapeHtml(t.type)+'</h3><div class="muted">'+escapeHtml(t.progress?.step||'queued')+' · '+escapeHtml(t.progress?.message||'')+'</div><div class="task-progress"><i style="width:'+Math.max(0,Math.min(100,Number(t.progress?.percent||0)))+'%"></i></div><div class="muted">创建：'+new Date(t.createdAt).toLocaleString()+(t.executor?' · 执行器：'+escapeHtml(t.executor):'')+'</div>'+(t.status==='queued'?'<button data-dispatch-task="'+escapeHtml(t.id)+'" style="margin-top:7px">发送到当前 DSH 对话</button>':'')+'</article>').join('')||'<div class="empty">暂无 AI 任务</div>');document.querySelectorAll('[data-dispatch-task]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const result=await api('/agent-tasks/'+encodeURIComponent(button.dataset.dispatchTask)+'/dispatch',{method:'POST',body:JSON.stringify({sessionId})});status(result.delivery?.delivered?'任务已发送到当前 DSH 对话。':'未能发送：'+(result.delivery?.reason||'请从 DSH 重新打开工作台'));await load()}catch(e){status(e.message)}finally{button.disabled=false}})}
async function pollTasks(){if(!wb)return;try{const [tasks,workers]=await Promise.all([api('/agent-tasks?sessionId='+encodeURIComponent(sessionId)),api('/agent-workers')]);wb.agentTasks=tasks;wb.agentWorkers=workers;renderTaskQueue(tasks)}catch(e){/* Keep the last visible queue while a transient poll fails. */}}
function render(){
const labels=wb.ui||{};
document.querySelector('[data-tab="outline"]').textContent=labels.outlineLabel||'大纲';document.querySelector('[data-tab="logic"]').textContent=labels.logicLabel||'逻辑';document.querySelector('[data-tab="sources"]').textContent=labels.evidenceLabel||'引用';el('editor').placeholder=labels.editorLabel||'在这里编辑正文。';
el('outline').innerHTML=(wb.outline||[]).map(x=>'<article class="card"><input data-title="'+x.id+'" value="'+escapeHtml(x.title)+'" style="width:100%;font-weight:600"><textarea data-objective="'+x.id+'" style="width:100%;margin-top:6px">'+escapeHtml(x.objective||'')+'</textarea><div class="muted">目标 '+(x.targetWords||0)+' 字 · 图 '+(x.expectedFigures||0)+' · 表 '+(x.expectedTables||0)+'</div></article>').join('')||'<div class="empty">尚未建立大纲</div>';
const blocks=[...(wb.manuscriptBlocks||[])].sort((a,b)=>a.order-b.order);
el('editor').value=blocks.map(x=>x.markdown).join('\\n\\n');
if(!selectedBlock&&blocks[0])selectedBlock=blocks[0].id;
 el('logic').innerHTML=(wb.logicBlocks||[]).filter(x=>!selectedBlock||(wb.manuscriptBlocks.find(b=>b.id===selectedBlock)?.logicBlockIds||[]).includes(x.id)).map(x=>'<article class="card"><label class="muted">写作目标<input data-logic-purpose="'+x.id+'" value="'+escapeHtml(x.purpose||'')+'"></label><label class="muted">核心论点<textarea data-logic-claim="'+x.id+'">'+escapeHtml(x.claim||'')+'</textarea></label><label class="muted">前后过渡<textarea data-logic-transition="'+x.id+'">'+escapeHtml(x.transition||'')+'</textarea></label><label class="muted">证据要求<textarea data-logic-evidence="'+x.id+'">'+escapeHtml(x.evidenceRequirement||'')+'</textarea></label><label class="muted">风格约束<textarea data-logic-style="'+x.id+'">'+escapeHtml(x.styleConstraint||'')+'</textarea></label><button data-save-logic="'+x.id+'" style="margin-top:7px">保存行文逻辑</button></article>').join('')||'<div class="empty">在正文中选择段落后显示对应逻辑</div>';
 document.querySelectorAll('[data-save-logic]').forEach(button=>button.onclick=async()=>{const id=button.dataset.saveLogic;const value=key=>document.querySelector('[data-logic-'+key+'="'+id+'"]').value;try{await api('/logic-blocks/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify({sessionId,purpose:value('purpose'),claim:value('claim'),transition:value('transition'),evidenceRequirement:value('evidence'),styleConstraint:value('style'),expectedRevision:wb.project.revision})});await load();status('行文逻辑已保存并记录审计')}catch(e){status(e.message)}});
 el('sources').innerHTML='<article class="card"><h3>RAG 与文献操作</h3><button id="requestMaterialSearch">检索材料并绑定证据</button> <button id="requestLiterature">中英文在线检索文献</button> <button id="requestRetrieval">配置 / 重建 Embedding</button><div class="muted">检索、文献和索引操作会在本页显示明确结果；涉及 AI 的请求会显示任务状态与执行器等待信息。</div></article>'+((wb.citations||[]).map(x=>'<article class="card"><span class="badge">'+escapeHtml(x.status||'cited')+'</span><div>'+escapeHtml(x.text||x.citationKey||'')+'</div></article>').join('')||'<div class="empty">暂无引用</div>');
el('review').innerHTML='<button id="askReviewAgent">请 DSH 审查当前文本</button><div class="muted" style="margin:6px 0 10px">审查只纠错和给建议，不直接生成或改写正文。勾选并可编辑建议后，再用“基于 Diff 请求重新生成”。</div>'+((wb.reviewSuggestions||[]).map(x=>'<article class="card"><label><input type="checkbox" data-review-id="'+escapeHtml(x.id||'')+'"> 接受此建议</label><textarea data-review-text="'+escapeHtml(x.id||'')+'">'+escapeHtml(x.editedSuggestion||x.suggestion||'')+'</textarea><div class="muted">'+escapeHtml(x.category||'')+' · '+escapeHtml(x.severity||x.status||'')+'</div></article>').join('')||'<div class="empty">暂无审查建议</div>');
const currentById=new Map((wb.manuscriptBlocks||[]).map(x=>[x.id,x]));
el('candidates').innerHTML=(wb.regenerationCandidates||[]).map(c=>'<article class="card"><h3>再生成候选</h3><div class="muted">'+escapeHtml(c.summary||'等待逐项确认')+' · '+new Date(c.createdAt).toLocaleString()+'</div>'+(c.rationale?'<div class="muted">依据：'+escapeHtml(c.rationale)+'</div>':'')+(c.proposedBlocks||[]).map((block,index)=>'<section class="card" style="margin-top:8px"><label><input type="checkbox" data-candidate="'+escapeHtml(c.id)+'" data-candidate-block="'+escapeHtml(block.id)+'" checked> 接受第 '+(index+1)+' 项变更</label>'+diffHtml(currentById.get(block.id)?.markdown||'',block.markdown||'')+'</section>').join('')+'<button data-resolve-candidate="'+escapeHtml(c.id)+'">按所选项写入正文</button> <button data-reject-candidate="'+escapeHtml(c.id)+'">全部拒绝</button></article>').join('')||'<div class="empty">暂无等待确认的再生成候选。DSH 生成后会自动显示在这里。</div>';
document.querySelectorAll('[data-resolve-candidate]').forEach(button=>button.onclick=async()=>{const candidateId=button.dataset.resolveCandidate;const acceptedBlockIds=[...document.querySelectorAll('[data-candidate="'+candidateId+'"]:checked')].map(x=>x.dataset.candidateBlock);if(!confirm('确认将 '+acceptedBlockIds.length+' 项候选变更写入正文吗？未选项将保持原文。'))return;try{const result=await api('/regeneration-candidates/resolve',{method:'POST',body:JSON.stringify({sessionId,candidateId,acceptedBlockIds,userConfirmed:true})});await load();status('已写入 '+result.applied+' 项候选变更')}catch(e){status(e.message)}});
document.querySelectorAll('[data-reject-candidate]').forEach(button=>button.onclick=async()=>{const candidateId=button.dataset.rejectCandidate;if(!confirm('确认拒绝此候选的全部变更吗？正文不会被修改。'))return;try{await api('/regeneration-candidates/resolve',{method:'POST',body:JSON.stringify({sessionId,candidateId,acceptedBlockIds:[],userConfirmed:true})});await load();status('已拒绝该候选')}catch(e){status(e.message)}});
const askReviewAgent=el('askReviewAgent');if(askReviewAgent)askReviewAgent.onclick=async()=>{try{await queueAgentTask('review_manuscript',{instruction:'审查当前项目正文的结构、证据、引用和术语一致性；只保存 ReviewSuggestion，不得修改正文。',userConfirmed:true});}catch(e){status(e.message)}};
const materialSearch=el('requestMaterialSearch');if(materialSearch)materialSearch.onclick=async()=>{const query=prompt('请输入材料检索问题');if(!query)return;try{const matches=await api('/materials/search',{method:'POST',body:JSON.stringify({sessionId,query,limit:8})});if(!matches.length)return status('未命中材料分块');const choices=matches.map((item,index)=>(index+1)+'. '+(item.materialName||item.materialId||'未知材料')+'\n'+String(item.text||item.content||'').slice(0,180)).join('\n\n');const selected=Number(prompt('命中结果：\n\n'+choices+'\n\n输入要绑定到当前正文块的序号；取消则只查看结果。'));if(!selected)return status('已完成 RAG 检索，未写入证据绑定');const chunk=matches[selected-1];if(!chunk||!selectedBlock)return status('请选择有效结果和正文块后再绑定');if(!confirm('确认将该材料证据绑定到当前正文块吗？'))return;await api('/evidence/bind',{method:'POST',body:JSON.stringify({sessionId,blockId:selectedBlock,chunkId:chunk.id,note:'页面 RAG 检索：'+query})});await load();status('证据已绑定')}catch(e){status(e.message)}};
const literatureSearch=el('requestLiterature');if(literatureSearch)literatureSearch.onclick=async()=>{const query=prompt('请输入文献检索词');if(!query)return;try{const result=await api('/literature/search',{method:'POST',body:JSON.stringify({sessionId,query,limit:10})});if(!result.candidates?.length)return status('未找到文献候选');const choices=result.candidates.map((item,index)=>(index+1)+'. '+item.title+' ('+(item.year||'未知年份')+')').join('\n');const selected=Number(prompt('文献候选：\n'+choices+'\n\n输入要加入书目库的序号；取消则不写入。'));if(!selected)return status('已展示文献候选，未写入项目');const record=result.candidates[selected-1];if(!record)return status('无效的候选序号');if(!confirm('确认仅保存该文献的元数据，不下载全文吗？'))return;await api('/literature',{method:'POST',body:JSON.stringify({sessionId,record,userConfirmed:true})});await load();status('文献已加入项目书目库')}catch(e){status(e.message)}};
 if(literatureSearch)literatureSearch.onclick=openLiteratureDialog;
 const retrievalConfig=el('requestRetrieval');if(retrievalConfig)retrievalConfig.onclick=async()=>{try{const profiles=await api('/retrieval/profiles');if(!profiles.length)return status('当前没有可用 Embedding 配置');const choice=prompt('可用 Embedding 配置：\n'+profiles.map((item,index)=>(index+1)+'. '+item.id+' — '+(item.model||item.name||'')).join('\n')+'\n\n输入序号以配置当前项目');const profile=profiles[Number(choice)-1];if(!profile)return;const boundary=profile.dataBoundary||'请确认材料文本可发送至该模型服务。';if(!confirm('数据边界：'+boundary+'\n\n确认选择 '+profile.id+' 并将现有索引标记为待重建吗？'))return;await api('/retrieval/configure',{method:'POST',body:JSON.stringify({sessionId,profileId:profile.id,userConfirmed:true})});if(!confirm('确认立即重建当前项目的材料索引吗？'))return;await api('/retrieval/reindex',{method:'POST',body:JSON.stringify({sessionId})});await load();status('Embedding 配置与索引重建已完成')}catch(e){status(e.message)}};
el('runs').innerHTML='<button id="createRun">新建生成任务</button><h3 style="margin:10px 0 6px">AI 任务队列</h3>'+((wb.agentTasks||[]).map(t=>'<article class="card"><span class="badge">'+escapeHtml(t.status)+'</span><h3>'+escapeHtml(t.type)+'</h3><div class="muted">'+escapeHtml(t.progress?.step||'queued')+' · '+escapeHtml(t.progress?.message||'')+'</div></article>').join('')||'<div class="empty">暂无 AI 任务</div>')+'<h3 style="margin:10px 0 6px">流程运行记录</h3>'+((wb.runs||[]).map(x=>'<article class="card"><span class="badge">'+escapeHtml(x.state)+'</span><h3>'+escapeHtml(x.taskType)+'</h3><div class="muted">revision '+x.revision+' · '+new Date(x.updatedAt).toLocaleString()+'</div></article>').join('')||'<div class="empty">暂无运行记录</div>');
 el('runs').innerHTML='<div id="taskQueue"></div><h3 style="margin:10px 0 6px">流程运行记录</h3>'+((wb.runs||[]).map(x=>'<article class="card"><span class="badge">'+escapeHtml(x.state)+'</span><h3>'+escapeHtml(x.taskType)+'</h3><div class="muted">revision '+x.revision+' · '+new Date(x.updatedAt).toLocaleString()+'</div></article>').join('')||'<div class="empty">暂无运行记录</div>');renderTaskQueue(wb.agentTasks||[]);
 el('trace').innerHTML='<article class="card"><h3>AI Agent 行动轨迹</h3><div class="muted">显示本项目近期的 DSH 工具调用、候选生成与用户确认；不保存提示词全文或密钥。</div></article>'+((wb.agentTrace||[]).map(item=>'<article class="card"><span class="badge">'+escapeHtml(item.kind||'action')+'</span><strong>'+escapeHtml(item.label||'Agent 操作')+'</strong><div class="muted">'+new Date(item.timestamp).toLocaleString()+'</div><div class="muted">'+escapeHtml(item.detail||'')+'</div></article>').join('')||'<div class="empty">尚无轨迹。通过页面功能键或 DSH 调用工作台工具后会在这里记录。</div>');
el('templates').innerHTML='<article class="card"><h3>导入模板</h3><input id="templateFile" type="file" accept=".md,.markdown,.txt,.html,.htm,.docx"><button id="uploadTemplate" style="margin-left:6px">导入并预览</button><div class="muted" style="margin-top:6px">模板仅用于结构和样式参考，不会作为 RAG 事实证据。</div></article>'+((wb.customTemplates||[]).map(t=>'<article class="card"><span class="badge">'+escapeHtml(t.type||'text')+'</span><h3>'+escapeHtml(t.name||'未命名模板')+'</h3><div class="muted">rev '+(t.revision||1)+'</div><button data-template-preview="'+t.id+'">生成大纲差异预览</button><textarea readonly style="width:100%;margin-top:6px;min-height:80px;font-family:monospace;font-size:11px">'+escapeHtml(t.extractedText||t.content||'')+'</textarea></article>').join('')||'<div class="empty">暂无自定义模板</div>');
const uploadTemplate=el('uploadTemplate');if(uploadTemplate)uploadTemplate.onclick=async()=>{const file=el('templateFile').files[0];if(!file)return status('请先选择模板文件');try{const result=await fetch('/api/templates/import-upload?sessionId='+encodeURIComponent(sessionId)+'&name='+encodeURIComponent(file.name),{method:'POST',headers:{'x-file-name':encodeURIComponent(file.name),'content-type':'application/octet-stream'},body:await file.arrayBuffer()});const value=await result.json();if(!result.ok)throw new Error(value.error||'模板导入失败');await load();status(value.duplicate?'已存在相同模板':'模板已导入，可生成差异预览')}catch(e){status(e.message)}};
document.querySelectorAll('[data-template-preview]').forEach(button=>button.onclick=async()=>{try{const preview=await api('/templates/preview-restructure',{method:'POST',body:JSON.stringify({sessionId,templateId:button.dataset.templatePreview})});const message='新增：'+(preview.diff.added.join('、')||'无')+'\\n移除：'+(preview.diff.removed.join('、')||'无')+'\\n保留：'+(preview.diff.retained.join('、')||'无')+'\\n\\n'+(preview.validation.issues||[]).map(x=>x.message).join('；');if(preview.status!=='ready_for_confirmation')return status('预览被框架校验阻止：'+message);if(confirm('大纲差异预览：\\n'+message+'\\n\\n确认应用吗？')){await api('/templates/apply-restructure',{method:'POST',body:JSON.stringify({sessionId,previewId:preview.id,userConfirmed:true})});await load();status('已应用模板结构；原大纲已保留在版本历史中')}else status('仅生成预览，项目未修改')}catch(e){status(e.message)}});
 const exportButtons=(wb.exportFormats||[]).map(x=>'<button data-export-format="'+escapeHtml(x.format)+'" style="margin-left:6px">导出 '+escapeHtml(x.name||x.format)+'</button>').join('');el('versions').innerHTML='<button id="createSnapshot">保存当前版本</button>'+exportButtons+(wb.snapshots||[]).map(s=>'<article class="card"><h3>'+escapeHtml(s.name)+'</h3><div class="muted">'+new Date(s.createdAt).toLocaleString()+' · '+s.blockCount+' 个文本块</div><button data-restore="'+s.id+'" style="margin-top:6px">恢复此版本</button></article>').join('')||'<div class="empty">暂无已保存版本</div>';
const createSnapshot=el('createSnapshot');if(createSnapshot)createSnapshot.onclick=async()=>{const name=prompt('版本名称','保存版本');if(!name)return;try{await api('/snapshots',{method:'POST',body:JSON.stringify({sessionId,name})});await load();status('版本已保存')}catch(e){status(e.message)}};
 document.querySelectorAll('[data-export-format]').forEach(button=>button.onclick=async()=>{const format=button.dataset.exportFormat;try{const result=await api('/export',{method:'POST',body:JSON.stringify({sessionId,format})});const bytes=result.data?Uint8Array.from(atob(result.data),c=>c.charCodeAt(0)):result.content;const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([bytes],{type:result.mimeType||'application/octet-stream'}));link.download=result.filename||('export.'+format);link.click();URL.revokeObjectURL(link.href);status('已导出 '+format)}catch(e){status(e.message)}});
document.querySelectorAll('[data-restore]').forEach(button=>button.onclick=async()=>{if(!confirm('恢复后将覆盖当前正文，是否继续？'))return;try{await api('/snapshots/restore',{method:'POST',body:JSON.stringify({sessionId,snapshotId:button.dataset.restore})});await load();status('版本已恢复')}catch(e){status(e.message)}});
if((wb.changeSets||[]).length){const html=wb.changeSets.map(cs=>{const groups=[['outlineChanges','大纲'],['logicChanges','行文逻辑'],['manuscriptChanges','正文'],['reviewChanges','审查意见']];const items=groups.flatMap(([key,label])=>(cs[key]||[]).map((item,index)=>({item,label,index})));return '<article class="card"><h3>统一 Diff：'+escapeHtml(cs.rationale||'待确认变更')+'</h3><div class="muted">基线 revision '+cs.baseRevision+' · '+new Date(cs.createdAt).toLocaleString()+'</div>'+items.map(({item,label,index})=>'<section class="card" style="margin-top:8px"><label><input type="checkbox" data-changeset="'+escapeHtml(cs.id)+'" data-change-item="'+escapeHtml(item.id||item.entityId||String(index))+'" checked> 接受'+label+'变更</label>'+diffHtml(JSON.stringify(item.before||{},null,2),JSON.stringify(item.after||{},null,2))+'</section>').join('')+'<button data-apply-changeset="'+escapeHtml(cs.id)+'">应用所选变更</button> <button data-reject-changeset="'+escapeHtml(cs.id)+'">全部拒绝</button></article>'}).join('');el('candidates').insertAdjacentHTML('afterbegin','<h2>统一变更审查</h2>'+html);document.querySelectorAll('[data-apply-changeset]').forEach(button=>button.onclick=async()=>{const id=button.dataset.applyChangeset;const selected=[...document.querySelectorAll('[data-changeset="'+id+'"]:checked')].map(x=>x.dataset.changeItem);if(!confirm('确认应用所选大纲、行文逻辑、正文和审查意见变更？'))return;try{const result=await api('/change-sets/'+encodeURIComponent(id)+'/apply',{method:'POST',body:JSON.stringify({sessionId,selectedItemIds:selected,userConfirmed:true})});await load();status('已应用 '+result.applied+' 项统一变更')}catch(e){status(e.message)}});document.querySelectorAll('[data-reject-changeset]').forEach(button=>button.onclick=async()=>{const id=button.dataset.rejectChangeset;if(!confirm('确认拒绝此统一变更集？'))return;try{await api('/change-sets/'+encodeURIComponent(id)+'/apply',{method:'POST',body:JSON.stringify({sessionId,selectedItemIds:[],userConfirmed:true})});await load();status('已拒绝统一变更集')}catch(e){status(e.message)}})}
renderSpecStudio();
const domainInputs=Object.entries(wb.domainFieldSchema||{}).map(([key,spec])=>'<label class="muted" style="display:block;margin-top:8px">'+escapeHtml(spec.label||key)+'<input data-domain-field="'+escapeHtml(key)+'" value="'+escapeHtml(wb.domainFields?.[key]||'')+'" style="width:100%;margin-top:3px"></label>').join('');
el('settings').innerHTML='<article class="card"><h3>插件信息</h3><div class="muted">任务类型: '+escapeHtml(wb.project.taskType)+'</div><div class="muted">框架: '+escapeHtml(wb.bundle.framework?.name||'未加载')+'</div><div class="muted">逻辑: '+escapeHtml(wb.bundle.logic?.name||'未加载')+'</div><div class="muted">凭证: '+escapeHtml(wb.bundle.evidence?.name||'未加载')+'</div></article><article class="card"><h3>领域字段</h3>'+domainInputs+'<button id="saveDomain" style="margin-top:10px">保存领域字段</button></article><article class="card"><h3>材料验收清单</h3><div id="materialChecklist" class="muted">正在加载轻量清单…</div><button id="addMaterial" style="margin-top:10px">登记材料</button> <button id="importMaterial" style="margin-top:10px">导入本地文件</button> <button id="importDirectory" style="margin-top:10px">批量导入资料目录</button></article>';
loadMaterialChecklist(1);
const saveDomain=el('saveDomain');if(saveDomain)saveDomain.onclick=async()=>{const fields={};document.querySelectorAll('[data-domain-field]').forEach(input=>fields[input.dataset.domainField]=input.value);try{await api('/domain-fields',{method:'POST',body:JSON.stringify({sessionId,fields})});await load();status('领域字段已保存')}catch(e){status(e.message)}};
const addMaterial=el('addMaterial');if(addMaterial)addMaterial.onclick=async()=>{const name=prompt('材料名称');if(!name)return;const type=prompt('材料类型 (text/pdf/docx/image/table)','text');if(!type)return;try{await api('/materials',{method:'POST',body:JSON.stringify({sessionId,name,type})});await load();status('材料已登记')}catch(e){status(e.message)}};
const importMaterial=el('importMaterial');if(importMaterial)importMaterial.onclick=async()=>{const filePath=prompt('请输入已选择的本地文件完整路径');if(!filePath)return;try{await api('/materials/import-file',{method:'POST',body:JSON.stringify({sessionId,filePath})});await load();status('材料已导入')}catch(e){status(e.message)}};
const importDirectory=el('importDirectory');if(importDirectory)importDirectory.onclick=async()=>{const directoryPath=prompt('请输入已确认的资料目录完整路径');if(!directoryPath)return;const recursive=confirm('是否递归导入子目录？');const maxFiles=Number(prompt('最多导入文件数（1-500）','100')||100);if(!confirm('确认导入目录：'+directoryPath+'\n递归：'+recursive+'\n上限：'+maxFiles+' 个文件？'))return;try{const result=await api('/materials/import-directory',{method:'POST',body:JSON.stringify({sessionId,directoryPath,recursive,maxFiles,userConfirmed:true})});await load();status('材料导入完成：'+result.imported.length+' 成功，'+result.skipped.length+' 跳过，'+result.failed.length+' 失败')}catch(e){status(e.message)}};
const createRunBtn=el('createRun');if(createRunBtn)createRunBtn.onclick=async()=>{try{await api('/runs',{method:'POST',body:JSON.stringify({sessionId,reviewEnabled:true})});await load();status('任务已创建')}catch(e){status(e.message)}};
}
function renderSpecStudio(){const saved=localStorage.wbPluginSpec||'';el('spec').innerHTML='<article class="card"><h3>领域工作台规格（JSON）</h3><div class="muted">修改规格、校验后，生成的插件包将与本工作台隔离。</div><textarea id="specEditor" style="width:100%;min-height:330px;margin-top:8px;font-family:monospace;font-size:12px">'+escapeHtml(saved)+'</textarea><button id="newSpec" style="margin-top:8px">新建规格</button> <button id="validateSpec" style="margin-top:8px">校验</button> <button id="generateSpec" style="margin-top:8px">生成独立插件包</button><div id="specStatus" class="muted" style="margin-top:8px"></div></article>';const value=()=>{try{return JSON.parse(el('specEditor').value)}catch(e){throw new Error('JSON 格式错误：'+e.message)}};el('newSpec').onclick=async()=>{const taskType=prompt('任务类型，例如 legal-contract','generic-workbench');const name=prompt('工作台名称','新文本工作台');if(!taskType||!name)return;const spec=await api('/plugin-spec/draft',{method:'POST',body:JSON.stringify({taskType,name})});el('specEditor').value=JSON.stringify(spec,null,2);localStorage.wbPluginSpec=el('specEditor').value};el('validateSpec').onclick=async()=>{try{const spec=value();localStorage.wbPluginSpec=JSON.stringify(spec,null,2);const result=await api('/plugin-spec/validate',{method:'POST',body:JSON.stringify({spec})});el('specStatus').textContent=result.valid?'规格校验通过':'规格问题：'+result.issues.join('；')}catch(e){el('specStatus').textContent=e.message}};el('generateSpec').onclick=async()=>{try{if(!confirm('将生成到默认 DSH 工作台插件目录。确认继续吗？'))return;const spec=value();const result=await api('/plugin-spec/generate',{method:'POST',body:JSON.stringify({spec,confirmedDestination:true})});localStorage.wbPluginSpec=JSON.stringify(spec,null,2);el('specStatus').textContent='已生成并验证：'+result.outputDir}catch(e){el('specStatus').textContent=e.message}}}
el('create').onclick=async()=>{const name=prompt('项目名称');if(!name)return;const taskType=prompt('任务类型 (thesis/patent/contract/generic)','thesis')||'thesis';let confirmedEviction=false;try{const limit=await api('/project-limit');if(limit.activeCount>=limit.limit){const old=limit.evictionCandidate;if(!confirm('当前已有 '+limit.limit+' 个项目。继续将归档最早项目“'+old.name+'”。是否继续？'))return;confirmedEviction=true}const created=await api('/projects',{method:'POST',body:JSON.stringify({sessionId,name,taskType,assistantKey,workspaceId,confirmedEviction})});localStorage.wbProjectId=created.id;await projects();await bind(created.id)}catch(e){status(e.message)}};
 el('deleteProject').onclick=async()=>{const sel=el('projects').value;if(!sel)return status('请先选择要删除的项目');if(!confirm('确定归档此项目？项目仍可从归档中恢复。'))return;try{await api('/projects/'+sel+'?sessionId='+encodeURIComponent(sessionId),{method:'DELETE'});delete localStorage.wbProjectId;wb=null;el('editor').value='';status('项目已归档');await projects()}catch(e){status(e.message)}};
 el('archives').onclick=openArchives;el('closeArchives').onclick=()=>el('archivesDialog').close();
 el('closeLiterature').onclick=()=>el('literatureDialog').close();el('searchLiterature').onclick=searchLiteratureBilingual;
el('projects').onchange=e=>e.target.value&&bind(e.target.value);
el('refresh').onclick=load;
el('save').onclick=async()=>{if(!wb)return;const texts=el('editor').value.split(/\\n\\s*\\n/).filter(Boolean);if(!texts.length)return status('正文不能为空；如需清空整篇，请使用版本恢复或专用清空操作');const existing=wb.manuscriptBlocks||[];if(texts.length<existing.length&&!confirm('本次保存会使正文块从 '+existing.length+' 项减少为 '+texts.length+' 项，可能删除章节。确认整篇替换吗？'))return;const blocks=texts.map((markdown,i)=>({...(existing[i]||{}),markdown}));try{await api('/manuscript',{method:'POST',body:JSON.stringify({sessionId,blocks,replaceAll:true,userConfirmed:true})});await load();status('正文已保存')}catch(e){status(e.message)}};
el('savePlan').onclick=async()=>{if(!wb)return;const outline=(wb.outline||[]).map(node=>({...node,title:document.querySelector('[data-title="'+node.id+'"]')?.value||node.title,objective:document.querySelector('[data-objective="'+node.id+'"]')?.value||node.objective}));try{await api('/plan',{method:'POST',body:JSON.stringify({sessionId,confirmed:true,outline})});await load();status('大纲已保存')}catch(e){status(e.message)}};
el('regenerate').onclick=async()=>{if(!wb)return status('请先选择项目');const draft=el('editor').value;const diff=describeDiff(manuscriptText(),draft);if(!diff.before&&!diff.after)return status('尚未检测到相对已保存正文的差异');const instruction=prompt('请说明希望如何调整这次差异','保留用户修改意图，补足证据、结构衔接和术语一致性');if(!instruction)return;const accepted=[...document.querySelectorAll('[data-review-id]:checked')].map(x=>document.querySelector('[data-review-text="'+x.dataset.reviewId+'"]').value).filter(Boolean);try{const request=await api('/request-regeneration',{method:'POST',body:JSON.stringify({sessionId,content:draft,instruction,blockId:selectedBlock||undefined})});await queueAgentTask('regenerate_diff',{requestId:request.id,instruction,acceptedReviewSuggestions:accepted,blockId:selectedBlock||null});}catch(e){status(e.message)}};
 setInterval(pollTasks,3000);
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button,.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');el(b.dataset.tab).classList.add('active')});
(function initResizer(){const resizer=document.querySelector('.resizer');const paper=document.querySelector('.paper');if(!resizer||!paper)return;let isResizing=false;resizer.addEventListener('mousedown',e=>{isResizing=true;resizer.classList.add('active');document.body.style.cursor='col-resize';document.body.style.userSelect='none';e.preventDefault()});document.addEventListener('mousemove',e=>{if(!isResizing)return;const layout=document.querySelector('.layout');const rect=layout.getBoundingClientRect();const percent=((e.clientX-rect.left)/rect.width)*100;paper.style.flex='0 0 '+Math.max(30,Math.min(75,percent))+'%'});document.addEventListener('mouseup',()=>{if(isResizing){isResizing=false;resizer.classList.remove('active');document.body.style.cursor='';document.body.style.userSelect=''}})})();
projects().catch(e=>status(e.message));
</script>
</body>
</html>`
}
