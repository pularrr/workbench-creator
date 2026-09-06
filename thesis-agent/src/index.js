import os from 'node:os'
import path from 'node:path'
import { ThesisDomainStore } from './domain-store.js'
import { startWorkbenchServer } from './workbench-server.js'
import { toLosslessJson } from './lossless.js'

export const name = 'thesis-agent-core'
export const inject = ['tools']

function defaultDataDir() {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(dshHome, 'storages', 'thesis-agent')
}

function sessionId(exec) {
  return String(exec.agent?.session?.id || exec.agent?.id || 'local-session')
}

// Attach the workbench URL to project/materials tool results so the
// client side-panel can auto-open the matching workbench after the user
// loads a project through natural language. Arrays (e.g. scan results)
// are left untouched. Accepts a value or a Promise of one.
function withWorkbenchUrl(config) {
  return async (value) => {
    const resolved = await value
    if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
      return { ...resolved, workbenchUrl: `http://127.0.0.1:${config.workbenchPort || 3199}` }
    }
    return resolved
  }
}

function output() {
  return {
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        data: {}, // any lossless JSON value: object or array
      },
      required: ['ok', 'data'],
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

function tool(name, description, parameters, execute, parallel = false) {
  return {
    name,
    description,
    parameters,
    output: output(),
    // Sanitize every tool result at the bridge boundary so no nested value
    // (undefined, NaN/Infinity/-0, non-plain object, sparse array, …) can
    // break the Harness "lossless JSON" round-trip check.
    execute: async (args, exec) => toLosslessJson({ ok: true, data: await execute(args, exec) }),
    isConcurrencySafe: parallel ? () => true : undefined,
  }
}

const objectParameters = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

export async function apply(ctx, config = {}) {
  if (config.mode === 'writer-policy') {
    ctx.tools.restrict({
      allow: [
        'thesis_create_project',
        'thesis_bind_project',
        'thesis_project_status',
        'thesis_set_plan',
        'thesis_apply_default_master_template',
        'thesis_import_reference_template',
        'thesis_import_source_text',
        'thesis_scan_directory',
        'thesis_import_source_file',
        'thesis_search_sources',
        'thesis_build_evidence_package',
        'thesis_bind_block_sources',
        'thesis_inspect_and_export',
        'thesis_submit_literature_candidates',
        'thesis_edit_literature',
        'thesis_decide_literature',
        'thesis_bind_citation',
        'thesis_format_references',
        'thesis_run_quality_checks',
        'thesis_create_manuscript_snapshot',
        'thesis_compare_manuscript_version',
        'thesis_restore_manuscript_version',
        'thesis_set_export_template',
        'thesis_export_current_docx',
        'thesis_export_current_latex',
        'thesis_get_embedding_status',
        'thesis_test_embedding_connection',
        'thesis_set_embedding_config',
        'thesis_rebuild_embeddings',
        'thesis_create_agent_run',
        'thesis_get_agent_run',
        'thesis_advance_agent_run',
        'thesis_pause_agent_run',
        'thesis_resume_agent_run',
        'thesis_cancel_agent_run',
        'thesis_prepare_generation',
        'thesis_confirm_generation',
        'thesis_submit_generated_scope',
        'thesis_decide_generated_scope',
        'thesis_get_workbench',
        'thesis_set_manuscript_blocks',
        'thesis_get_logic_for_block',
        'thesis_locate_blocks_for_logic',
        'thesis_edit_review_suggestion',
        'thesis_decide_review_suggestion',
        'thesis_create_revision_batch',
        'thesis_resolve_revision_batch',
        'thesis_confirm_revision_batch',
        'thesis_submit_patch_proposal',
        'thesis_decide_patch_proposal',
      ],
    })
    return
  }
  if (config.mode === 'review-policy') {
    ctx.tools.restrict({
      allow: [
        'thesis_project_status',
        'thesis_get_workbench',
        'thesis_submit_review_suggestions',
        'thesis_run_quality_checks',
      ],
    })
    return
  }

  const store = new ThesisDomainStore(config.dataDir?.trim() || defaultDataDir(), {
    embedding: config.embedding || { type: 'local-hash' },
    embeddingBatchSize: config.embeddingBatchSize || 32,
  })
  await store.initialize()
  if (config.enableWorkbench !== false && typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const workbench = startWorkbenchServer(store, { port: config.workbenchPort || 3199 })
      ctx.logger?.info?.(`thesis workbench: ${workbench.url}`)
      return () => workbench.close()
    }, 'thesis-agent: workbench server')
  }

  const attachWorkbench = withWorkbenchUrl(config)

  ctx.tools.register(tool(
    'thesis_create_project',
    'Create a thesis project and bind it to the current Harness session. After successful creation, ALWAYS call thesis_open_workbench to tell the user how to access the workbench UI.',
    objectParameters({
      name: { type: 'string', minLength: 1 },
      title: { type: 'string' },
      degreeType: { type: 'string', enum: ['bachelor', 'master', 'doctor'] },
      targetWords: { type: 'integer', minimum: 0 },
    }, ['name']),
    (args, exec) => attachWorkbench(store.createProject(sessionId(exec), args)),
  ))

  ctx.tools.register(tool(
    'thesis_bind_project',
    'Bind the current Harness session to an existing thesis project.',
    objectParameters({ projectId: { type: 'string', minLength: 1 } }, ['projectId']),
    (args, exec) => attachWorkbench(store.bindProject(sessionId(exec), args.projectId)),
  ))

  ctx.tools.register(tool(
    'thesis_follow_recent_project',
    'Bind the current session to the most recently updated thesis project if not already bound (auto-follow). Use when the user says "continue my latest project" or after loading project files, so the workbench tracks the right project.',
    objectParameters({}),
    (args, exec) => store.followRecentProject(sessionId(exec)),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_project_status',
    'Read the current thesis project status, revisions, and pending review counts.',
    objectParameters({}),
    (_args, exec) => store.projectStatus(sessionId(exec)),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_set_plan',
    'Replace the editable thesis outline and writing-logic plan using optimistic revision control.',
    objectParameters({
      expectedRevision: { type: 'integer', minimum: 0 },
      confirmed: { type: 'boolean' },
      outline: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string', minLength: 1 },
            objective: { type: 'string' },
            targetWords: { type: 'integer', minimum: 0 },
            locked: { type: 'boolean' },
            logic: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  purpose: { type: 'string', minLength: 1 },
                  transition: { type: 'string' },
                  targetWords: { type: 'integer', minimum: 0 },
                },
                required: ['purpose'],
                additionalProperties: false,
              },
            },
          },
          required: ['title', 'logic'],
          additionalProperties: false,
        },
      },
    }, ['expectedRevision', 'confirmed', 'outline']),
    (args, exec) => store.setPlan(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_apply_default_master_template',
    'Create an editable master-thesis outline and rich writing-logic plan when no reference thesis is provided. The plan remains unconfirmed. Optionally select a template pack by packId (builtin: generic-master, generic-bachelor, ieee-conference).',
    objectParameters({
      expectedRevision: { type: 'integer', minimum: 0 },
      targetWords: { type: 'integer', minimum: 0 },
      packId: { type: 'string' },
    }, ['expectedRevision']),
    (args, exec) => store.applyDefaultMasterTemplate(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_list_template_packs',
    'List all available template packs (builtin + project-imported) with id, name, degree type, and section count.',
    objectParameters({}),
    (_args, exec) => store.listTemplatePacks(sessionId(exec)),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_import_template_pack',
    'Import a school/journal template pack from a local JSON file into the current project. The pack must match docs/template-pack-schema.json.',
    objectParameters({
      filePath: { type: 'string', minLength: 1 },
    }, ['filePath']),
    (args, exec) => store.importTemplatePack(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_import_reference_template',
    'Save an Agent-extracted reference thesis outline and writing logic as an editable, unconfirmed plan.',
    objectParameters({
      sourceName: { type: 'string', minLength: 1 },
      extractionNotes: { type: 'string' },
      expectedRevision: { type: 'integer', minimum: 0 },
      outline: {
        type: 'array', minItems: 1, items: {
          type: 'object', properties: {
            id: { type: 'string' }, title: { type: 'string', minLength: 1 }, objective: { type: 'string' },
            targetWords: { type: 'integer', minimum: 0 }, locked: { type: 'boolean' },
            logic: { type: 'array', items: { type: 'object', properties: {
              id: { type: 'string' }, purpose: { type: 'string', minLength: 1 }, transition: { type: 'string' }, targetWords: { type: 'integer', minimum: 0 },
            }, required: ['purpose'], additionalProperties: false } },
          }, required: ['title', 'logic'], additionalProperties: false,
        },
      },
    }, ['sourceName', 'expectedRevision', 'outline']),
    (args, exec) => store.importReferenceTemplate(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_prepare_generation',
    'Prepare a chapter or full-thesis generation task and return its bounded outline, logic, and existing text context. Requires later confirmation.',
    objectParameters({
      scope: { type: 'string', enum: ['full', 'chapters'] },
      outlineNodeIds: { type: 'array', items: { type: 'string' } },
    }),
    (args, exec) => store.prepareGeneration(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_confirm_generation',
    'Confirm or cancel a prepared generation task before the writing Agent starts.',
    objectParameters({
      taskId: { type: 'string', minLength: 1 }, expectedRevision: { type: 'integer', minimum: 0 }, confirmed: { type: 'boolean' },
    }, ['taskId', 'expectedRevision', 'confirmed']),
    (args, exec) => store.confirmGeneration(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_submit_generated_scope',
    'Submit generated manuscript blocks as a candidate with explicit writing-logic bindings; this never overwrites the manuscript.',
    objectParameters({
      taskId: { type: 'string', minLength: 1 },
      blocks: { type: 'array', minItems: 1, items: { type: 'object', properties: {
        id: { type: 'string' }, outlineNodeId: { type: 'string', minLength: 1 }, logicBlockIds: { type: 'array', minItems: 1, items: { type: 'string' } },
        type: { type: 'string', enum: ['heading', 'paragraph', 'table', 'figure', 'code'] }, markdown: { type: 'string', minLength: 1 },
      }, required: ['outlineNodeId', 'logicBlockIds', 'markdown'], additionalProperties: false } },
    }, ['taskId', 'blocks']),
    (args, exec) => store.submitGeneratedScope(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_decide_generated_scope',
    'Accept or reject generated chapter/full-thesis candidates. Acceptance creates a manuscript version and preserves user-locked blocks.',
    objectParameters({
      taskId: { type: 'string', minLength: 1 }, expectedRevision: { type: 'integer', minimum: 0 }, decision: { type: 'string', enum: ['accept', 'reject'] },
    }, ['taskId', 'expectedRevision', 'decision']),
    (args, exec) => store.decideGeneratedScope(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_get_workbench',
    'Read the complete lightweight thesis workbench state for the current project.',
    objectParameters({}),
    (_args, exec) => attachWorkbench(store.getWorkbench(sessionId(exec))),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_open_workbench',
    'Open / reveal the thesis workbench UI and tell the user exactly how to access it. Returns the workbench URL, server status, current project, and step-by-step instructions. ALWAYS call this when the user says "打开工作台", "show workbench", "怎么打开论文工作台", "论文界面在哪", "workbench not showing", or asks how to access the writing interface. Also call it after project creation or material loading to proactively tell the user the workbench is ready.',
    objectParameters({}),
    async (_args, exec) => {
      const sid = sessionId(exec)
      let project = null
      try { project = store.projectStatus(sid) } catch (e) { project = null }
      return {
        workbenchUrl: `http://127.0.0.1:${config.workbenchPort || 3199}`,
        serverRunning: config.enableWorkbench !== false,
        project,
        instructions: [
          '方式一（推荐）：在 DSH 会话头部点击「📝 论文工作台」蓝色按钮，右侧弹出工作台面板',
          `方式二：浏览器直接打开 http://127.0.0.1:${config.workbenchPort || 3199} ，页面会自动选择最近项目`,
          '方式三：在对话中继续说"写论文/继续"，Agent 会自动读取工作台状态并推进',
        ],
        hint: '如果头部没有按钮，请确认插件已启用（dsh plugin --profile web list），或重启 DSH 后重试。',
      }
    },
    true,
  ))

  ctx.tools.register(tool(
    'thesis_request_regeneration',
    'Submit a regeneration request from the workbench UI. This is normally called by the workbench page when the user clicks "重新生成", not by the LLM directly. The request stores the modified text block and instruction, and the LLM later picks it up via thesis_list_regeneration_requests.',
    objectParameters({
      blockId: { type: 'string', description: 'Optional manuscript block ID being regenerated' },
      content: { type: 'string', description: 'The modified content to regenerate from' },
      instruction: { type: 'string', description: 'Instruction for regeneration' },
    }, []),
    (args, exec) => store.requestRegeneration(sessionId(exec), args),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_list_regeneration_requests',
    'List pending regeneration requests submitted from the workbench UI. The user modified content in the workbench and clicked "重新生成" — these requests contain the modified text block and instruction. ALWAYS call this when the user says "继续", "重新生成", "下一步", or asks what to do next. After regenerating the content, call thesis_set_manuscript_blocks to save it, then call thesis_resolve_regeneration to mark the request done.',
    objectParameters({}),
    (args, exec) => store.listRegenerationRequests(sessionId(exec)),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_resolve_regeneration',
    'Mark a regeneration request as completed or cancelled after the Agent has regenerated and saved the content.',
    objectParameters({
      requestId: { type: 'string', minLength: 1, description: 'The regeneration request ID from thesis_list_regeneration_requests' },
      status: { type: 'string', enum: ['completed', 'cancelled'], description: 'completed = regenerated and saved; cancelled = user cancelled the request' },
    }, ['requestId']),
    (args, exec) => store.resolveRegeneration(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_import_source_text',
    'Index user-approved text or Markdown in the current project using hash-based incremental updates, structure-aware chunks, and local batch embeddings. After successful import, call thesis_open_workbench to tell the user the workbench is ready.',
    objectParameters({
      sourceKey: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, content: { type: 'string', minLength: 1 },
      mediaType: { type: 'string' }, maxChars: { type: 'integer', minimum: 300 }, overlapChars: { type: 'integer', minimum: 0 },
    }, ['sourceKey', 'name', 'content']),
    (args, exec) => attachWorkbench(store.importSourceText(sessionId(exec), args)),
  ))

  ctx.tools.register(tool(
    'thesis_scan_directory',
    'Pre-scan an explicitly approved local directory and return metadata for supported files without reading their contents.',
    objectParameters({
      directory: { type: 'string', minLength: 1 }, approved: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 5000 },
      excludeNames: { type: 'array', items: { type: 'string' } },
    }, ['directory', 'approved']),
    (args, exec) => store.scanDirectory(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_import_source_file',
    'Parse and index one explicitly approved local TXT, Markdown, source-code, PDF, DOCX, PPTX, XLSX, CSV, ODF, RTF, HTML, or EPUB file.',
    objectParameters({
      filePath: { type: 'string', minLength: 1 }, sourceKey: { type: 'string' }, approved: { type: 'boolean' },
      maxBytes: { type: 'integer', minimum: 1 }, maxChars: { type: 'integer', minimum: 300 }, overlapChars: { type: 'integer', minimum: 0 },
    }, ['filePath', 'approved']),
    (args, exec) => attachWorkbench(store.importSourceFile(sessionId(exec), args)),
  ))

  ctx.tools.register(tool(
    'thesis_search_sources',
    'Search only the current project sources with fused keyword and local-vector relevance, returning source line ranges and scores. Optionally rerank top results with a cross-encoder-style provider (local/Cohere/Voyage).',
    objectParameters({
      query: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 30 },
      documentIds: { type: 'array', items: { type: 'string' } }, mediaTypes: { type: 'array', items: { type: 'string' } },
      rerank: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['local', 'cohere', 'voyage'] },
          topK: { type: 'integer', minimum: 1, maximum: 30 },
          apiKey: { type: 'string' },
          model: { type: 'string' },
          endpoint: { type: 'string' },
          fallbackToLocal: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    }, ['query']),
    (args, exec) => store.searchSources(sessionId(exec), args),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_build_evidence_package',
    'Build a deduplicated, project-isolated evidence package under an explicit context-character budget.',
    objectParameters({
      task: { type: 'string' }, query: { type: 'string', minLength: 1 }, characterBudget: { type: 'integer', minimum: 200 }, limit: { type: 'integer', minimum: 1, maximum: 30 },
      documentIds: { type: 'array', items: { type: 'string' } }, mediaTypes: { type: 'array', items: { type: 'string' } },
    }, ['query']),
    (args, exec) => store.buildEvidencePackage(sessionId(exec), args),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_bind_block_sources',
    'Privately bind manuscript blocks to retrieved source chunks for traceability. Bindings stay in the background rather than a visible evidence basket.',
    objectParameters({
      blockId: { type: 'string', minLength: 1 }, chunkIds: { type: 'array', items: { type: 'string' } },
    }, ['blockId', 'chunkIds']),
    (args, exec) => store.bindBlockSources(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_inspect_and_export',
    'Check stale sources, placeholders, and logic bindings, then return the current accepted manuscript as Markdown with an export gate.',
    objectParameters({}),
    (_args, exec) => store.inspectAndExport(sessionId(exec)),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_submit_literature_candidates',
    'Add deduplicated literature candidates discovered by an LLM-assisted search. Candidates are not citable until a user approves them.',
    objectParameters({
      discoverySource: { type: 'string' }, candidates: { type: 'array', minItems: 1, items: { type: 'object', properties: {
        title: { type: 'string', minLength: 1 }, doi: { type: 'string' }, authors: { type: 'array', items: { type: 'string' } },
        year: { type: 'integer' }, venue: { type: 'string' }, url: { type: 'string' }, relevanceReason: { type: 'string', minLength: 1 },
      }, required: ['title', 'relevanceReason'], additionalProperties: false } },
    }, ['candidates']),
    (args, exec) => store.submitLiteratureCandidates(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_edit_literature',
    'Edit candidate or approved literature metadata with revision control. Editing an approved item requires renewed approval.',
    objectParameters({
      literatureId: { type: 'string', minLength: 1 }, expectedRevision: { type: 'integer', minimum: 0 }, title: { type: 'string' }, doi: { type: 'string' },
      authors: { type: 'array', items: { type: 'string' } }, year: { type: 'integer' }, venue: { type: 'string' }, url: { type: 'string' }, metadataConflict: { type: 'boolean' },
    }, ['literatureId', 'expectedRevision']),
    (args, exec) => store.editLiterature(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_decide_literature',
    'Approve or reject literature after human metadata review. Only approved items may be cited.',
    objectParameters({ literatureId: { type: 'string', minLength: 1 }, expectedRevision: { type: 'integer', minimum: 0 }, decision: { type: 'string', enum: ['approve', 'reject'] } }, ['literatureId', 'expectedRevision', 'decision']),
    (args, exec) => store.decideLiterature(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_bind_citation',
    'Bind an approved literature entity to a manuscript block with an optional page or section locator.',
    objectParameters({ blockId: { type: 'string', minLength: 1 }, literatureId: { type: 'string', minLength: 1 }, locator: { type: 'string' } }, ['blockId', 'literatureId']),
    (args, exec) => store.bindCitation(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_format_references',
    'Format approved project literature as GB/T 7714 or APA references.',
    objectParameters({ style: { type: 'string', enum: ['gb-t-7714', 'apa'] } }),
    (args, exec) => store.formatReferences(sessionId(exec), args),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_run_quality_checks',
    'Run deterministic thesis checks for numeric evidence, duplicate paragraphs, chapter coverage, related-work comparison, and terminology consistency.',
    objectParameters({
      submitSuggestions: { type: 'boolean' }, terminology: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
    }),
    (args, exec) => store.runQualityChecks(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_create_manuscript_snapshot',
    'Create a named immutable snapshot of the current accepted manuscript.',
    objectParameters({ expectedRevision: { type: 'integer', minimum: 0 }, name: { type: 'string', minLength: 1 }, description: { type: 'string' } }, ['expectedRevision', 'name']),
    (args, exec) => store.createManuscriptSnapshot(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_compare_manuscript_version',
    'Compare one saved manuscript version with the current accepted manuscript at block level.',
    objectParameters({ versionId: { type: 'string', minLength: 1 } }, ['versionId']),
    (args, exec) => store.compareManuscriptVersion(sessionId(exec), args),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_restore_manuscript_version',
    'Restore a saved manuscript as a new version without deleting history. Evidence and citations become stale until revalidated.',
    objectParameters({ versionId: { type: 'string', minLength: 1 }, expectedRevision: { type: 'integer', minimum: 0 } }, ['versionId', 'expectedRevision']),
    (args, exec) => store.restoreManuscriptVersion(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_set_export_template',
    'Save a user-confirmed JSON export template extracted from school requirements or a reference document.',
    objectParameters({
      expectedRevision: { type: 'integer', minimum: 0 }, template: { type: 'object', properties: {
        name: { type: 'string', minLength: 1 }, fontFamily: { type: 'string' }, bodyFontSizeHalfPoints: { type: 'number', minimum: 0 },
        referenceFontSizeHalfPoints: { type: 'number', minimum: 0 }, firstLineIndentTwips: { type: 'number', minimum: 0 },
        lineSpacingTwips: { type: 'number', minimum: 0 }, referencesTitle: { type: 'string' }, includeTitlePage: { type: 'boolean' },
      }, required: ['name'], additionalProperties: true },
    }, ['expectedRevision', 'template']),
    (args, exec) => store.setExportTemplate(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_export_current_docx',
    'Run blocking checks and export the current accepted manuscript plus approved references as a DOCX file.',
    objectParameters({ expectedRevision: { type: 'integer', minimum: 0 }, filename: { type: 'string' }, referenceStyle: { type: 'string', enum: ['gb-t-7714', 'apa'] } }, ['expectedRevision']),
    (args, exec) => store.exportCurrentDocx(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_export_current_latex',
    'Export the accepted unified manuscript as a LaTeX project and optionally compile it to PDF with XeLaTeX.',
    objectParameters({ expectedRevision: { type: 'integer', minimum: 0 }, filename: { type: 'string' }, referenceStyle: { type: 'string', enum: ['gb-t-7714', 'apa'] }, compilePdf: { type: 'boolean' }, timeoutMs: { type: 'integer', minimum: 1000 } }, ['expectedRevision']),
    (args, exec) => store.exportCurrentLatex(sessionId(exec), args),
  ))

  ctx.tools.register(tool('thesis_get_embedding_status', 'Read the current project Embedding model, credential readiness, and index status.', objectParameters({}), (_args, exec) => store.getEmbeddingStatus(sessionId(exec)), true))
  ctx.tools.register(tool(
    'thesis_test_embedding_connection', 'Test an Embedding configuration without saving its API key.',
    objectParameters({ config: { type: 'object', additionalProperties: true } }, ['config']),
    (args, exec) => store.testEmbeddingConnection(sessionId(exec), args),
  ))
  ctx.tools.register(tool(
    'thesis_set_embedding_config', 'Save an explicit project Embedding configuration; API keys remain process-memory only and are never persisted.',
    objectParameters({ expectedRevision: { type: 'integer', minimum: 0 }, config: { type: 'object', additionalProperties: true } }, ['expectedRevision', 'config']),
    (args, exec) => store.setEmbeddingConfig(sessionId(exec), args),
  ))
  ctx.tools.register(tool(
    'thesis_rebuild_embeddings', 'Rebuild all current-project Chunk vectors after changing the Embedding model.',
    objectParameters({ expectedConfigRevision: { type: 'integer', minimum: 0 }, batchSize: { type: 'integer', minimum: 1, maximum: 256 } }, ['expectedConfigRevision']),
    (args, exec) => store.rebuildEmbeddings(sessionId(exec), args),
  ))
  ctx.tools.register(tool(
    'thesis_list_embedding_presets', 'List built-in embedding service presets (DeepSeek/OpenAI/通义/智谱/SiliconFlow/Ollama). Use when the user wants semantic search with a real embedding model described in natural language.',
    objectParameters({}),
    (_args, exec) => store.listEmbeddingPresets(),
    true,
  ))
  ctx.tools.register(tool(
    'thesis_set_embedding_preset', 'One-call conversational embedding setup. Resolve a named preset (deepseek/openai/qwen/zhipu/siliconflow/ollama), optionally test the connection, save the config, and rebuild existing chunk vectors. Use this when the user says something like "用 DeepSeek 的向量模型，Key 是 xxx" or "换成本地 Ollama 的 bge-m3". Requires provider; apiKey is optional (omit for local Ollama); endpoint/model override the preset defaults; test=false skips the pre-flight test; rebuild=false skips re-embedding existing chunks.',
    objectParameters({
      provider: { type: 'string', minLength: 1 },
      apiKey: { type: 'string' },
      model: { type: 'string' },
      endpoint: { type: 'string' },
      expectedRevision: { type: 'integer', minimum: 0 },
      batchSize: { type: 'integer', minimum: 1, maximum: 256 },
      test: { type: 'boolean' },
      rebuild: { type: 'boolean' },
    }, ['provider', 'expectedRevision']),
    (args, exec) => store.setEmbeddingPreset(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_delete_project',
    'Delete a thesis project permanently. After deletion, any session bound to that project will become unbound — tell the user the project was deleted and ask them to select or create another project via thesis_list_projects / thesis_create_project, or rebind via thesis_bind_project.',
    objectParameters({ projectId: { type: 'string', minLength: 1, description: 'The project ID to delete' } }, ['projectId']),
    (args, exec) => store.deleteProject(args.projectId),
  ))

  ctx.tools.register(tool(
    'thesis_list_templates',
    'List all custom templates (text templates and format templates) for the currently bound project. Text templates control writing structure/outline; format templates control export typography. Use this to show the user what templates exist before editing or applying one.',
    objectParameters({}, []),
    (_args, exec) => store.listCustomTemplates(exec.session.id),
  ))

  ctx.tools.register(tool(
    'thesis_save_template',
    'Create or update a custom template. When the user uploads a sample document (范文) or describes a template, parse its structure and call this to persist it. The user can then edit it in the workbench "模板" tab. Set type="text" for writing-structure templates (outline, section logic, citation style) or type="format" for export-format templates (font, spacing, margins, heading styles). After saving, tell the user the template is available in the workbench and can be applied to guide subsequent generation.',
    objectParameters({
      templateId: { type: 'string', description: 'Existing template ID to update; omit to create a new one' },
      name: { type: 'string', minLength: 1, description: 'Template display name' },
      description: { type: 'string', description: 'Short description of what this template controls' },
      type: { type: 'string', enum: ['text', 'format'], description: 'text = writing structure template; format = export typography template' },
      content: { type: 'string', description: 'Template body: Markdown structure for text templates, or JSON/key-value format parameters for format templates' },
    }, ['name', 'type', 'content']),
    (args, exec) => store.saveCustomTemplate(exec.session.id, args),
  ))

  ctx.tools.register(tool(
    'thesis_get_template',
    'Get the full content of a custom template by ID, including its content field. Use this when you need to read a template before applying it or showing it to the user.',
    objectParameters({ templateId: { type: 'string', minLength: 1, description: 'The template ID' } }, ['templateId']),
    (args, exec) => store.getCustomTemplate(exec.session.id, args),
  ))

  ctx.tools.register(tool(
    'thesis_delete_template',
    'Delete a custom template by ID.',
    objectParameters({ templateId: { type: 'string', minLength: 1, description: 'The template ID to delete' } }, ['templateId']),
    (args, exec) => store.deleteCustomTemplate(exec.session.id, args),
  ))

  ctx.tools.register(tool(
    'thesis_create_agent_run', 'Create a governed ReAct run for thesis generation. Supports mode presets to skip redundant stages: "standard" (default, skips planning + awaiting_plan_confirmation since plan is already confirmed at project level), "fast" (also skips applying), "full" (no skips). Or pass skipStages array to customize. After creation, state is "created" — the return value contains recommendedNextEvent="start". ALWAYS use the recommendedNextEvent from the return value to advance, do NOT invent event names. See thesis_advance_agent_run for the full state-event table.',
    objectParameters({ taskType: { type: 'string' }, mode: { type: 'string', enum: ['full', 'standard', 'fast'], description: 'Preset for which stages to auto-skip. Default: standard' }, skipStages: { type: 'array', items: { type: 'string', enum: ['planning', 'awaiting_plan_confirmation', 'applying'] }, description: 'Custom list of stages to auto-skip (overrides mode)' }, scope: { type: 'object', additionalProperties: true }, reviewEnabled: { type: 'boolean' }, budget: { type: 'object', additionalProperties: true } }),
    (args, exec) => store.createAgentRun(sessionId(exec), args),
  ))
  ctx.tools.register(tool('thesis_get_agent_run', 'Read one ReAct run with steps, observations, budget, state, AND recommendedNextEvent. The return value contains a "recommendedNextEvent" field telling you exactly which event name to use next with thesis_advance_agent_run. Always call this before advancing, and use recommendedNextEvent directly — do NOT guess event names.', objectParameters({ runId: { type: 'string', minLength: 1 } }, ['runId']), (args, exec) => store.getAgentRun(sessionId(exec), args.runId), true))
  ctx.tools.register(tool(
    'thesis_advance_agent_run',
    'Advance a governed ReAct run through a VALIDATED state-machine event. CRITICAL: Always call thesis_get_agent_run FIRST and use the recommendedNextEvent field from its return value as the event name. Do NOT invent event names — arbitrary names like "plan", "retrieve", "draft", "generate" will be rejected. The return value also contains recommendedNextEvent for the NEXT step after this advance.\n\nVALID EVENTS BY STATE:\n- created → start → planning\n- planning → plan_ready → awaiting_plan_confirmation\n- awaiting_plan_confirmation → plan_confirmed → retrieving | plan_rejected → cancelled\n- retrieving → retrieval_completed → evaluating_evidence | fail → failed\n- evaluating_evidence → evidence_sufficient → drafting | evidence_insufficient → retrieving\n- drafting → draft_completed → validating | fail → failed\n- validating → validation_passed → reviewing | validation_failed → drafting\n- reviewing → review_completed → awaiting_user_decision | fail → failed\n- awaiting_user_decision → user_accepted → applying | user_requested_revision → drafting | user_rejected → cancelled\n- applying → apply_completed → completed | fail → failed\n\nFor control operations (pause/resume/cancel) use the dedicated thesis_pause_agent_run / thesis_resume_agent_run / thesis_cancel_agent_run tools, not this one.',
    objectParameters({ runId: { type: 'string', minLength: 1 }, expectedRevision: { type: 'integer', minimum: 0 }, event: { type: 'string', minLength: 1, description: 'Must be a valid event for the current state — see validEvents from thesis_get_agent_run' }, summary: { type: 'string' }, observation: { type: 'object', additionalProperties: true }, artifactId: { type: 'string' } }, ['runId', 'expectedRevision', 'event']),
    (args, exec) => store.advanceAgentRun(sessionId(exec), args),
  ))
  ctx.tools.register(tool('thesis_pause_agent_run', 'Pause a non-terminal ReAct run at a resumable checkpoint.', objectParameters({ runId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 0 } }, ['runId', 'expectedRevision']), (args, exec) => store.pauseAgentRun(sessionId(exec), args)))
  ctx.tools.register(tool('thesis_resume_agent_run', 'Resume a paused ReAct run from its previous state.', objectParameters({ runId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 0 } }, ['runId', 'expectedRevision']), (args, exec) => store.resumeAgentRun(sessionId(exec), args)))
  ctx.tools.register(tool('thesis_cancel_agent_run', 'Cancel a non-terminal ReAct run without deleting its history.', objectParameters({ runId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 0 } }, ['runId', 'expectedRevision']), (args, exec) => store.cancelAgentRun(sessionId(exec), args)))

  ctx.tools.register(tool(
    'thesis_set_manuscript_blocks',
    'Save ordered manuscript blocks and their stable writing-logic bindings with optimistic revision control.',
    objectParameters({
      expectedRevision: { type: 'integer', minimum: 0 },
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            outlineNodeId: { type: 'string', minLength: 1 },
            logicBlockIds: { type: 'array', items: { type: 'string' } },
            type: { type: 'string', enum: ['heading', 'paragraph', 'table', 'figure', 'code'] },
            markdown: { type: 'string' },
            userLocked: { type: 'boolean' },
            revision: { type: 'integer', minimum: 0 },
          },
          required: ['outlineNodeId', 'logicBlockIds', 'markdown'],
          additionalProperties: false,
        },
      },
    }, ['expectedRevision', 'blocks']),
    (args, exec) => store.setManuscriptBlocks(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_get_logic_for_block',
    'Resolve the writing-logic blocks corresponding to the manuscript block under the editor cursor.',
    objectParameters({ blockId: { type: 'string', minLength: 1 } }, ['blockId']),
    (args, exec) => store.getLogicForBlock(sessionId(exec), args.blockId),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_locate_blocks_for_logic',
    'Resolve all manuscript blocks corresponding to one writing-logic block for reverse navigation.',
    objectParameters({ logicBlockId: { type: 'string', minLength: 1 } }, ['logicBlockId']),
    (args, exec) => store.locateBlocksForLogic(sessionId(exec), args.logicBlockId),
    true,
  ))

  ctx.tools.register(tool(
    'thesis_submit_review_suggestions',
    'Submit structured suggestions from the independent thesis review agent. This never edits the manuscript.',
    objectParameters({
      suggestions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            targetType: { type: 'string' },
            targetId: { type: 'string' },
            category: { type: 'string' },
            severity: { type: 'string', enum: ['info', 'suggestion', 'warning', 'blocking'] },
            text: { type: 'string', minLength: 1 },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
    }, ['suggestions']),
    async (args, exec) => ({ suggestions: await store.submitReviewSuggestions(sessionId(exec), args) }),
  ))

  ctx.tools.register(tool(
    'thesis_edit_review_suggestion',
    'Edit a review suggestion. The edited suggestion remains pending until explicitly accepted or rejected.',
    objectParameters({
      suggestionId: { type: 'string', minLength: 1 },
      expectedRevision: { type: 'integer', minimum: 0 },
      text: { type: 'string', minLength: 1 },
    }, ['suggestionId', 'expectedRevision', 'text']),
    (args, exec) => store.editReviewSuggestion(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_decide_review_suggestion',
    'Accept or reject the current revision of a review suggestion.',
    objectParameters({
      suggestionId: { type: 'string', minLength: 1 },
      expectedRevision: { type: 'integer', minimum: 0 },
      decision: { type: 'string', enum: ['accept', 'reject'] },
      reason: { type: 'string' },
    }, ['suggestionId', 'expectedRevision', 'decision']),
    (args, exec) => store.decideReviewSuggestion(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_create_revision_batch',
    'Combine accepted review suggestions with direct user changes into one revision batch. This does not edit the manuscript.',
    objectParameters({
      userChanges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            targetType: { type: 'string' },
            targetId: { type: 'string' },
            instruction: { type: 'string', minLength: 1 },
          },
          required: ['instruction'],
          additionalProperties: false,
        },
      },
    }),
    (args, exec) => store.createRevisionBatch(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_resolve_revision_batch',
    'Resolve conflicting instructions in a revision batch before confirmation.',
    objectParameters({
      batchId: { type: 'string', minLength: 1 },
      expectedRevision: { type: 'integer', minimum: 0 },
      resolutions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            conflictId: { type: 'string', minLength: 1 },
            instruction: { type: 'string', minLength: 1 },
          },
          required: ['conflictId', 'instruction'],
          additionalProperties: false,
        },
      },
    }, ['batchId', 'expectedRevision', 'resolutions']),
    (args, exec) => store.resolveRevisionBatch(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_confirm_revision_batch',
    'Confirm or reject a conflict-free revision batch. Confirmation authorizes generation, not manuscript modification.',
    objectParameters({
      batchId: { type: 'string', minLength: 1 },
      expectedRevision: { type: 'integer', minimum: 0 },
      confirmed: { type: 'boolean' },
    }, ['batchId', 'expectedRevision', 'confirmed']),
    (args, exec) => store.confirmRevisionBatch(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_submit_patch_proposal',
    'Submit a candidate manuscript patch for a confirmed revision batch. This never applies the patch.',
    objectParameters({
      batchId: { type: 'string', minLength: 1 },
      baseManuscriptRevision: { type: 'integer', minimum: 0 },
      changes: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            blockId: { type: 'string', minLength: 1 },
            expectedBlockRevision: { type: 'integer', minimum: 0 },
            markdown: { type: 'string', minLength: 1 },
            reason: { type: 'string' },
          },
          required: ['blockId', 'expectedBlockRevision', 'markdown'],
          additionalProperties: false,
        },
      },
    }, ['batchId', 'baseManuscriptRevision', 'changes']),
    (args, exec) => store.submitPatchProposal(sessionId(exec), args),
  ))

  ctx.tools.register(tool(
    'thesis_decide_patch_proposal',
    'Accept or reject a generated manuscript patch. Only acceptance updates the manuscript and creates a version.',
    objectParameters({
      patchId: { type: 'string', minLength: 1 },
      expectedRevision: { type: 'integer', minimum: 0 },
      decision: { type: 'string', enum: ['accept', 'reject'] },
    }, ['patchId', 'expectedRevision', 'decision']),
    (args, exec) => store.decidePatchProposal(sessionId(exec), args),
  ))
}
