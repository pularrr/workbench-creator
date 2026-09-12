/**
 * dsh-workbench-core — Pluggable Text-Processing Workbench Framework
 *
 * A DSH plugin that provides a task-type-agnostic workbench runtime,
 * supporting thesis, patent, legal-contract, tech-report and other
 * structured text generation tasks via pluggable Framework/Logic/Evidence layers.
 *
 * Architecture:
 * - Core Runtime: state machine, storage, on-demand workbench server, plugin loader
 * - Built-in Plugins: thesis, patent
 * - Plugin Generator: LLM-driven creation of new task-type plugins
 */

import { WorkbenchRuntime } from './core/runtime.js'
import { WorkbenchStorage } from './core/storage.js'
import { createWorkbenchServer } from './core/workbench-server.js'
import { registerThesisPlugins } from './plugins/thesis/index.js'
import { registerPatentPlugins } from './plugins/patent/index.js'
import { analyzeTaskDescription, generatePluginBundle, verifyGeneratedPluginBundle, installGeneratedPlugin, getDefaultWorkbenchPluginRoot } from './generator.js'
import { listSupportedTaskTypes, listPlugins, listPluginBundles, resolvePluginBundle } from './core/plugin-loader.js'
import { createPluginSpecDraft, validatePluginSpec } from './core/plugin-spec.js'
import { assertToolAllowedForStage, getAllowedTools, getWorkStageInfo, setWorkStage } from './work-stage.js'
import path from 'node:path'
import os from 'node:os'

// DSH execution context has changed shape across host versions.  Keep the
// session lookup in one place so a missing optional context cannot prevent a
// tool from reaching the runtime.
export function getWorkbenchSessionId(exec) {
  const sessionId = exec?.session?.id ?? exec?.sessionId ?? exec?.context?.session?.id
  return typeof sessionId === 'string' && sessionId.trim() ? sessionId : 'default'
}

// ─── DSH tool bridge ───────────────────────────────────────────────────────
// Expose the wb_* tool definitions declared on the plugin to the shared tool
// registry (ctx.tools). The unified assistant policy exposes the complete
// governed surface while stage guards enforce design/write/review boundaries.

function toDshTool(def) {
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, data: {} },
        required: ['ok', 'data'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      await assertToolAllowedForStage(getRuntime(), getWorkbenchSessionId(exec), def.name)
      const value = await def.execute(args, exec)
      return JSON.parse(JSON.stringify({ ok: true, data: value === undefined ? null : value }))
    },
  }
}

function registerWorkbenchTools(ctx) {
  const toolsService = ctx?.tools
  if (!toolsService || typeof toolsService.register !== 'function') return () => {}
  const disposers = []
  for (const def of plugin.tools || []) {
    try {
      const dispose = toolsService.register(toDshTool(def))
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (error) {
      ctx.logger?.warn?.('[workbench-core] failed to register tool', def && def.name, error && error.message)
    }
  }
  return () => {
    for (const dispose of disposers) {
      try { dispose() } catch { /* ignore */ }
    }
  }
}

// ─── Plugin State ──────────────────────────────────────────────────────────

let runtime = null
let server = null
let pluginConfig = {}

function configurePlugin(config = {}) {
  if (runtime && config.storagePath && path.resolve(config.storagePath) !== runtime.storage.storagePath) {
    throw new Error('storagePath cannot change after the shared workbench runtime has been initialized')
  }
  pluginConfig = { ...pluginConfig, ...config }
}

function getRuntime() {
  if (!runtime) {
    // This is the single durable project store consumed by both DSH tools and
    // the optional browser workbench. A host may point storagePath at its own
    // shared persistent store location.
    const storagePath = pluginConfig.storagePath || path.join(os.homedir(), '.dsh', 'storages', 'workbench-core', 'state.json')
    runtime = new WorkbenchRuntime({ storagePath })
  }
  return runtime
}

function ensureServer(config = {}) {
  if (!server) {
    server = createWorkbenchServer(getRuntime(), { port: Number(config.workbenchPort || pluginConfig.workbenchPort) || 3200, fallback: true })
  }
  return server
}

// ─── DSH Plugin Definition ─────────────────────────────────────────────────

const plugin = {
  name: 'dsh-workbench-core',
  version: '0.1.0',
  description: 'Pluggable text-processing workbench framework. Supports thesis, patent, legal-contract, tech-report and other structured text generation tasks via Framework/Logic/Evidence plugin layers.',
  inject: ['tools'],

  // DSH/Cordis plugin contract. The loader invokes apply(ctx); keep
  // activate as a compatibility alias for hosts that use that convention.
  async apply(ctx, config = {}) {
    configurePlugin(config)
    if (config.mode === 'assistant-policy') {
      ctx.tools.restrict?.({ allow: [...new Set([...getAllowedTools('design'), ...getAllowedTools('write'), ...getAllowedTools('review')])] })
      return
    }
    // Expose the wb_* tools in the shared registry. The assistant-policy
    // composition is installed independently by text-workbench-assistant.
    ctx.effect?.(() => registerWorkbenchTools(ctx), 'workbench-core: wb tools')

    // Register built-in plugins
    registerThesisPlugins()
    registerPatentPlugins()

    ctx.logger.info('[workbench-core] Activated. Built-in task types:', listSupportedTaskTypes())
    ctx.logger.info('[workbench-core] Builder/runtime activated. UI server remains stopped until wb_open_workbench is explicitly called.')
  },

  async activate(ctx) { return this.apply(ctx) },

  tools: [
    {
      name: 'wb_get_work_stage',
      description: 'Get the unified text-workbench assistant stage and the tools currently allowed for this session.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async (_args, exec) => getWorkStageInfo(getRuntime(), getWorkbenchSessionId(exec)),
    },
    {
      name: 'wb_set_work_stage',
      description: 'Switch between design, write, and review after the user requests or confirms the next stage. write and review require a bound project.',
      parameters: {
        type: 'object',
        properties: {
          stage: { type: 'string', enum: ['design', 'write', 'review'] },
          reason: { type: 'string', description: 'Short user-facing reason for the transition' },
          userConfirmed: { type: 'boolean', description: 'True only after the user explicitly confirms the transition.' },
          assistantKey: { type: 'string', description: 'Stable profile and assistant key used for restart recovery.' },
        },
        required: ['stage', 'userConfirmed'],
      },
      execute: async (args, exec) => {
        const sessionId = getWorkbenchSessionId(exec)
        return setWorkStage(getRuntime(), sessionId, args.stage, { reason: args.reason, userConfirmed: args.userConfirmed, assistantKey: args.assistantKey })
      },
    },
    // ─── Project Management ───────────────────────────────────────────
    {
      name: 'wb_list_projects',
      description: 'List all workbench projects across all task types.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => getRuntime().listProjects(),
    },
    {
      name: 'wb_create_project',
      description: `Create a new workbench project. taskType determines which plugin bundle is used. Supported task types: ${listSupportedTaskTypes().join(', ')}. Use "thesis" for academic papers, "patent" for patent applications.`,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project name' },
          taskType: { type: 'string', description: `Task type. Supported: ${listSupportedTaskTypes().join(', ')}`, enum: listSupportedTaskTypes() },
          title: { type: 'string', description: 'Document title' },
          targetWords: { type: 'number', description: 'Target word count' },
          metadata: { type: 'object', additionalProperties: true, description: 'Additional metadata' },
          assistantKey: { type: 'string', description: 'Stable profile and assistant key used for restart recovery.' },
          confirmedEviction: { type: 'boolean', description: 'Required when project creation would archive the oldest active project.' },
        },
        required: ['name', 'taskType'],
      },
      execute: async (args, exec) => getRuntime().createProject(getWorkbenchSessionId(exec), args),
    },
    {
      name: 'wb_get_project_limit',
      description: 'Get the ten-project active limit and the oldest project that would be archived when the limit is reached.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => getRuntime().getProjectLimit(),
    },
    {
      name: 'wb_delete_project',
      description: 'Archive a workbench project after explicit user confirmation. The project leaves the active list but remains recoverable.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: 'Project ID to archive' }, userConfirmed: { type: 'boolean', description: 'True only after the user confirms removal from active projects.' } },
        required: ['projectId', 'userConfirmed'],
      },
      execute: async (args) => {
        if (args.userConfirmed !== true) throw new Error('Archiving a project requires explicit user confirmation')
        return getRuntime().deleteProject(args.projectId)
      },
    },
    {
      name: 'wb_bind_project',
      description: 'Bind the current session to a project. Call this after creating or selecting a project.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: 'Project ID to bind' }, assistantKey: { type: 'string', description: 'Stable profile and assistant key used for restart recovery.' } },
        required: ['projectId'],
      },
      execute: async (args, exec) => getRuntime().bindProject(getWorkbenchSessionId(exec), args.projectId, { assistantKey: args.assistantKey }),
    },
    {
      name: 'wb_unbind_project',
      description: 'Unbind this conversation from its project and return it to the design stage.',
      parameters: { type: 'object', properties: { assistantKey: { type: 'string' } }, required: [] },
      execute: async (args, exec) => getRuntime().unbindProject(getWorkbenchSessionId(exec), args),
    },
    {
      name: 'wb_get_resume_state',
      description: 'Find a project previously associated with this session or a stable assistant key after DSH restarts.',
      parameters: { type: 'object', properties: { assistantKey: { type: 'string' } }, required: ['assistantKey'] },
      execute: async (args, exec) => getRuntime().getResumeState(getWorkbenchSessionId(exec), args.assistantKey),
    },
    {
      name: 'wb_resume_project',
      description: 'Resume a previous project after explicit user confirmation.',
      parameters: { type: 'object', properties: { assistantKey: { type: 'string' }, userConfirmed: { type: 'boolean' } }, required: ['assistantKey', 'userConfirmed'] },
      execute: async (args, exec) => {
        if (args.userConfirmed !== true) throw new Error('Resuming a previous project requires explicit user confirmation')
        return getRuntime().resumeProject(getWorkbenchSessionId(exec), args.assistantKey)
      },
    },
    {
      name: 'wb_list_archived_projects',
      description: 'List projects archived manually or because the active project limit was reached.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => getRuntime().listArchivedProjects(),
    },
    {
      name: 'wb_restore_archived_project',
      description: 'Restore an archived project after explicit user confirmation when capacity is available.',
      parameters: { type: 'object', properties: { projectId: { type: 'string' }, assistantKey: { type: 'string' }, userConfirmed: { type: 'boolean' } }, required: ['projectId', 'userConfirmed'] },
      execute: async (args, exec) => {
        if (args.userConfirmed !== true) throw new Error('Restoring an archived project requires explicit user confirmation')
        return getRuntime().restoreArchivedProject(args.projectId, { sessionId: getWorkbenchSessionId(exec), assistantKey: args.assistantKey })
      },
    },
    {
      name: 'wb_get_workbench',
      description: 'Get the full workbench state for the currently bound project, including outline, logic blocks, manuscript, runs, templates, and plugin bundle info.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async (_args, exec) => getRuntime().getWorkbench(getWorkbenchSessionId(exec)),
    },

    // ─── Outline & Manuscript ─────────────────────────────────────────
    {
      name: 'wb_set_outline',
      description: 'Set the outline (chapter/section structure) for the bound project. The Framework plugin will validate the outline and auto-generate logic blocks.',
      parameters: {
        type: 'object',
        properties: {
          outline: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Outline nodes with title, objective, targetWords, expectedFigures, expectedTables' },
          confirmed: { type: 'boolean', description: 'Whether the outline is confirmed (moves project to ready_to_generate)' },
        },
        required: ['outline'],
      },
      execute: async (args, exec) => getRuntime().setOutline(getWorkbenchSessionId(exec), args),
    },
    {
      name: 'wb_set_manuscript',
      description: 'Save manuscript blocks (ordered text blocks) for the bound project.',
      parameters: {
        type: 'object',
        properties: {
          blocks: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Manuscript blocks with markdown, outlineNodeId, logicBlockIds' },
          expectedRevision: { type: 'number', description: 'Current project revision; stale writes are rejected.' },
        },
        required: ['blocks'],
      },
      execute: async (args, exec) => getRuntime().setManuscriptBlocks(getWorkbenchSessionId(exec), args),
    },
    {
      name: 'wb_set_domain_fields',
      description: 'Save task-type-specific project fields declared by the active Framework plugin, such as patent type or contract parties.',
      parameters: { type: 'object', properties: { fields: { type: 'object', additionalProperties: true } }, required: ['fields'] },
      execute: async (args, exec) => getRuntime().setDomainFields(getWorkbenchSessionId(exec), args.fields),
    },
    {
      name: 'wb_add_material',
      description: 'Register a source material for the bound project. Materials may be text, PDF, DOCX, image, table, or task-plugin-defined types; this records metadata and does not read arbitrary local files.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, uri: { type: 'string' }, metadata: { type: 'object', additionalProperties: true } }, required: ['name', 'type'] },
      execute: async (args, exec) => getRuntime().addMaterial(getWorkbenchSessionId(exec), args),
    },
    {
      name: 'wb_import_material_file',
      description: 'Import one user-selected local material file into the bound project. Text formats are extracted up to 2 MB; PDF, Office and image files are recorded as metadata until a task Material plugin provides rich parsing. Never use this to scan directories.',
      parameters: { type: 'object', properties: { filePath: { type: 'string', description: 'Exact local file path selected by the user' } }, required: ['filePath'] },
      execute: async (args, exec) => getRuntime().importMaterialFile(getWorkbenchSessionId(exec), args.filePath),
    },
    {
      name: 'wb_search_materials',
      description: 'Search extracted project material chunks using local hybrid keyword/vector retrieval.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['query'] },
      execute: async (args, exec) => getRuntime().searchMaterials(getWorkbenchSessionId(exec), args.query, args.limit),
    },
    {
      name: 'wb_bind_evidence',
      description: 'Bind a manuscript block to one retrieved source chunk, preserving traceability for any task type.',
      parameters: { type: 'object', properties: { blockId: { type: 'string' }, chunkId: { type: 'string' }, note: { type: 'string' } }, required: ['blockId', 'chunkId'] },
      execute: async (args, exec) => getRuntime().bindEvidence(getWorkbenchSessionId(exec), args),
    },
    {
      name: 'wb_create_snapshot',
      description: 'Create a named immutable snapshot of the current document blocks.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: [] },
      execute: async (args, exec) => getRuntime().createSnapshot(getWorkbenchSessionId(exec), args.name),
    },
    {
      name: 'wb_compare_snapshot',
      description: 'Compare the current document against a prior snapshot at block level.',
      parameters: { type: 'object', properties: { snapshotId: { type: 'string' } }, required: ['snapshotId'] },
      execute: async (args, exec) => getRuntime().compareSnapshot(getWorkbenchSessionId(exec), args.snapshotId),
    },
    {
      name: 'wb_restore_snapshot',
      description: 'Restore document blocks from a named snapshot.',
      parameters: { type: 'object', properties: { snapshotId: { type: 'string' } }, required: ['snapshotId'] },
      execute: async (args, exec) => getRuntime().restoreSnapshot(getWorkbenchSessionId(exec), args.snapshotId),
    },
    {
      name: 'wb_export_document',
      description: 'Export the bound document using an exporter registered by the active workbench/plugin. Call wb_list_export_formats first when the format is unknown.',
      parameters: { type: 'object', properties: { format: { type: 'string', description: 'Registered export format, such as markdown, text, docx, latex, or pdf' } }, required: [] },
      execute: async (args, exec) => getRuntime().exportDocument(getWorkbenchSessionId(exec), args.format),
    },
    {
      name: 'wb_list_export_formats',
      description: 'List export formats available for the currently bound workbench project.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async (_args, exec) => getRuntime().listExportFormats(getWorkbenchSessionId(exec)),
    },

    // ─── State Machine Runs ────────────────────────────────────────────
    {
      name: 'wb_create_run',
      description: `Create a governed state-machine run for the bound project. The return value contains recommendedNextEvent — ALWAYS use that event name to advance, do NOT invent event names. Mode: "standard" (default, auto-skips planning) or "full" (no skips).`,
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['standard', 'full'], description: 'Skip mode. standard auto-skips planning stages.' },
          skipStages: { type: 'array', items: { type: 'string' }, description: 'Custom stages to skip (overrides mode)' },
          reviewEnabled: { type: 'boolean', description: 'Enable review stage' },
        },
        required: [],
      },
      execute: async (args, exec) => getRuntime().createRun(getWorkbenchSessionId(exec), args),
    },
    {
      name: 'wb_get_run',
      description: 'Get a run by ID, including current state, steps, budget, and recommendedNextEvent.',
      parameters: {
        type: 'object',
        properties: { runId: { type: 'string', description: 'Run ID' } },
        required: ['runId'],
      },
      execute: async (args, exec) => getRuntime().getRun(getWorkbenchSessionId(exec), args.runId),
    },
    {
      name: 'wb_advance_run',
      description: `Advance a run through a validated state-machine event. CRITICAL: Always call wb_get_run FIRST and use the recommendedNextEvent field from its return value. Do NOT invent event names.`,
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run ID' },
          expectedRevision: { type: 'integer', description: 'Expected revision (from get_run)' },
          event: { type: 'string', description: 'Event name (use recommendedNextEvent from get_run)' },
          summary: { type: 'string', description: 'Step summary' },
          idempotencyKey: { type: 'string', description: 'Stable key preventing a recovered step from being applied twice.' },
          checkpoint: { type: 'object', additionalProperties: true, description: 'Durable recovery data saved with this completed step.' },
          observation: { type: 'object', additionalProperties: true, description: 'Observation data' },
        },
        required: ['runId', 'expectedRevision', 'event'],
      },
      execute: async (args, exec) => getRuntime().advanceRun(getWorkbenchSessionId(exec), args),
    },
    {
      name: 'wb_cancel_run',
      description: 'Cancel a run.',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          expectedRevision: { type: 'integer' },
        },
        required: ['runId', 'expectedRevision'],
      },
      execute: async (args, exec) => getRuntime().cancelRun(getWorkbenchSessionId(exec), args),
    },

    // ─── Templates ─────────────────────────────────────────────────────
    {
      name: 'wb_list_templates',
      description: 'List custom templates for the bound project.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async (_args, exec) => getRuntime().listTemplates(getWorkbenchSessionId(exec)),
    },
    {
      name: 'wb_save_template',
      description: 'Save or update a custom template (text template or format template).',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'Existing template ID to update (omit to create new)' },
          name: { type: 'string', description: 'Template name' },
          type: { type: 'string', enum: ['text', 'format'], description: 'text = writing structure template; format = export typography template' },
          description: { type: 'string', description: 'Template description' },
          content: { type: 'string', description: 'Template content' },
        },
        required: ['name', 'type', 'content'],
      },
      execute: async (args, exec) => getRuntime().saveTemplate(getWorkbenchSessionId(exec), args),
    },

    // ─── Regeneration ──────────────────────────────────────────────────
    {
      name: 'wb_request_regeneration',
      description: 'Submit a regeneration request based on current editor content. The LLM can pick this up and regenerate relevant sections.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Current editor content' },
          instruction: { type: 'string', description: 'Regeneration instruction' },
          blockId: { type: 'string', description: 'Specific block to regenerate (optional)' },
        },
        required: ['content'],
      },
      execute: async (args, exec) => getRuntime().requestRegeneration(getWorkbenchSessionId(exec), args),
    },
    {
      name: 'wb_list_regeneration_requests',
      description: 'List pending regeneration requests for the bound project.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async (_args, exec) => getRuntime().listPendingRegenerationRequests(getWorkbenchSessionId(exec)),
    },
    {
      name: 'wb_add_review_suggestion',
      description: 'Persist one concrete review finding from the review stage so the workbench can show it beside the document. This does not modify manuscript text.',
      parameters: {
        type: 'object',
        properties: {
          suggestion: { type: 'string', description: 'Concrete, actionable review finding' },
          category: { type: 'string', description: 'For example: structure, evidence, citation, terminology' },
          severity: { type: 'string', enum: ['info', 'warning', 'blocking'] },
          blockId: { type: 'string', description: 'Related manuscript block ID when known' },
        },
        required: ['suggestion'],
      },
      execute: async (args, exec) => getRuntime().addReviewSuggestion(getWorkbenchSessionId(exec), args),
    },

    // ─── Plugin System ─────────────────────────────────────────────────
    {
      name: 'wb_list_task_types',
      description: `List all supported task types (plugin bundles). Currently: ${listSupportedTaskTypes().join(', ')}.`,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({ taskTypes: listSupportedTaskTypes() }),
    },
    {
      name: 'wb_list_plugins',
      description: 'List all registered plugins by layer (framework/logic/evidence).',
      parameters: {
        type: 'object',
        properties: {
          layer: { type: 'string', enum: ['framework', 'logic', 'evidence', 'material'], description: 'Plugin layer (optional, omit for all)' },
          taskType: { type: 'string', description: 'Filter by task type (optional)' },
        },
        required: [],
      },
      execute: async (args) => {
        const layers = args.layer ? [args.layer] : ['framework', 'logic', 'evidence', 'material']
        const result = {}
        for (const layer of layers) {
          result[layer] = listPlugins(layer, args.taskType || null).map((p) => ({ id: p.id, name: p.name, taskType: p.taskType, description: p.description }))
        }
        return result
      },
    },
    {
      name: 'wb_list_plugin_bundles',
      description: 'List external workbench plugin bundles that have been installed and activated, including their manifest metadata and UI capabilities.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => listPluginBundles(),
    },
    {
      name: 'wb_analyze_task_description',
      description: 'Analyze a user natural language description to detect the appropriate task type and plugin configuration. Use this before generating a new plugin bundle.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: "User's natural language description of the task" },
        },
        required: ['description'],
      },
      execute: async (args) => analyzeTaskDescription(args.description),
    },
    {
      name: 'wb_create_plugin_spec_draft',
      description: 'Create an editable JSON Plugin Spec draft for any template/fixed-process text workbench. Review and customize this JSON before generating a plugin package.',
      parameters: { type: 'object', properties: { taskType: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, materialTypes: { type: 'array', items: { type: 'string' } }, fields: { type: 'object', additionalProperties: true }, sections: { type: 'array', items: { type: 'object', additionalProperties: true } } }, required: ['taskType', 'name'] },
      execute: async (args) => createPluginSpecDraft(args),
    },
    {
      name: 'wb_validate_plugin_spec',
      description: 'Validate an editable Plugin Spec JSON without generating or executing code. Fix all returned issues before creating an installable package.',
      parameters: { type: 'object', properties: { spec: { type: 'object', additionalProperties: true } }, required: ['spec'] },
      execute: async (args) => validatePluginSpec(args.spec),
    },
    {
      name: 'wb_generate_plugin_bundle',
      description: `Generate and verify an isolated installable workbench plugin package. Before calling this, ask the user whether to use the default directory (${getDefaultWorkbenchPluginRoot()}) or provide a custom directory, and obtain an explicit confirmation. This operation only generates; ask separately whether to install it.`,
      parameters: {
        type: 'object',
        properties: {
          taskType: { type: 'string', description: 'Task type identifier (e.g. "contract", "clinical-trial")' },
          name: { type: 'string', description: 'Plugin display name' },
          description: { type: 'string', description: 'Plugin description' },
          outputRoot: { type: 'string', description: 'Parent directory for generated packages (default: ~/.dsh/workbench-plugins, outside this package)' },
          outputDir: { type: 'string', description: 'Child directory within outputRoot (default: <outputRoot>/<taskType>-workbench)' },
          confirmedDestination: { type: 'boolean', description: 'Must be true only after the user explicitly confirms this output directory.' },
          materialTypes: { type: 'array', items: { type: 'string' }, description: 'Supported material types, e.g. pdf, docx, image' },
          spec: { type: 'object', additionalProperties: true, description: 'Validated Plugin Spec JSON. When supplied, it is the single source of truth for this generated package.' },
        },
        required: ['taskType', 'name', 'confirmedDestination'],
      },
      execute: async (args) => generatePluginBundle({ ...args, outputRoot: args.outputRoot || pluginConfig.generatedOutputRoot }),
    },
    {
      name: 'wb_verify_generated_plugin_bundle',
      description: 'Inspect a generated plugin package before installation. This does not import or execute plugin code.',
      parameters: { type: 'object', properties: { outputDir: { type: 'string' } }, required: ['outputDir'] },
      execute: async (args) => verifyGeneratedPluginBundle(args.outputDir),
    },
    {
      name: 'wb_install_generated_plugin',
      description: 'Install one previously generated and verified workbench plugin into DSH. Call this only after asking the user whether to install now and receiving an explicit yes. It runs `dsh plugin --profile <profile> add <outputDir>` and never installs an unverified package.',
      parameters: { type: 'object', properties: { outputDir: { type: 'string', description: 'Verified generated plugin directory' }, profile: { type: 'string', description: 'DSH profile, defaults to web' }, confirmedInstall: { type: 'boolean', description: 'Must be true only after the user explicitly confirms installation.' } }, required: ['outputDir', 'confirmedInstall'] },
      execute: async (args) => {
        if (args.confirmedInstall !== true) throw new Error('Installation requires explicit user confirmation. Ask whether to install now before calling this tool.')
        return installGeneratedPlugin(args)
      },
    },

    // ─── Workbench UI ───────────────────────────────────────────────────
    {
      name: 'wb_open_workbench',
      description: 'Start and open the shared workbench UI after an explicit user request. Omit projectId to open the home page for project creation or selection; provide it to bind that project before opening.',
      parameters: { type: 'object', properties: { projectId: { type: 'string', description: 'Optional existing project ID to bind before opening' }, assistantKey: { type: 'string', description: 'Stable profile and assistant key used for restart recovery.' } }, required: [] },
      execute: async (args, exec) => {
        const sessionId = getWorkbenchSessionId(exec)
        const assistantKey = args.assistantKey || 'web:text-workbench-assistant-v0'
        if (args.projectId) await getRuntime().bindProject(sessionId, args.projectId, { assistantKey })
        const active = ensureServer()
        const baseUrl = active.url || `http://127.0.0.1:${active.port || 3200}`
        const url = `${baseUrl}/?sessionId=${encodeURIComponent(sessionId)}&assistantKey=${encodeURIComponent(assistantKey)}${args.projectId ? '' : '&home=1'}`
        return {
          url,
          projectId: args.projectId || null,
          mode: args.projectId ? 'project' : 'home',
          message: args.projectId
            ? `Workbench UI is running for the selected project. Open ${url} in your browser.`
            : `Workbench home is running. Open ${url} to create, select, or bind a project.`,
        }
      },
    },
  ],
}

export default plugin
