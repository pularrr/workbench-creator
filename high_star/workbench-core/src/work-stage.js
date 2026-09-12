const STAGES = ['design', 'write', 'review']

const COMMON_TOOLS = [
  'wb_get_work_stage', 'wb_set_work_stage', 'wb_list_projects',
  'wb_bind_project', 'wb_get_workbench', 'wb_list_task_types',
  'wb_list_plugin_bundles', 'wb_open_workbench', 'wb_get_project_limit',
  'wb_get_resume_state', 'wb_resume_project', 'wb_unbind_project', 'wb_get_retrieval_status', 'wb_list_embedding_profiles',
  'wb_list_archived_projects', 'wb_restore_archived_project', 'wb_delete_project', 'wb_permanently_delete_archived_project', 'wb_list_collaboration_events',
  'wb_list_literature', 'wb_add_literature',
]

const STAGE_TOOLS = {
  design: [
    'wb_list_plugins', 'wb_create_project',
    'wb_analyze_task_description',
    'wb_create_plugin_spec_draft', 'wb_validate_plugin_spec',
    'wb_generate_plugin_bundle', 'wb_verify_generated_plugin_bundle',
    'wb_install_generated_plugin',
  ],
  write: [
    'wb_create_project', 'wb_set_outline', 'wb_update_logic_block',
    'wb_set_manuscript', 'wb_set_domain_fields', 'wb_add_material',
    'wb_import_material_file', 'wb_import_material_directory', 'wb_search_materials', 'wb_bind_evidence',
    'wb_list_material_summaries', 'wb_list_material_chunks', 'wb_get_material_content',
    'wb_reindex_materials',
    'wb_configure_retrieval',
    'wb_search_literature', 'wb_add_literature', 'wb_list_literature', 'wb_bind_literature', 'wb_import_literature_fulltext', 'wb_download_literature_fulltext',
    'wb_create_snapshot', 'wb_compare_snapshot', 'wb_restore_snapshot',
    'wb_export_document', 'wb_list_export_formats', 'wb_create_run',
    'wb_get_run', 'wb_advance_run', 'wb_cancel_run', 'wb_list_templates',
    'wb_save_template', 'wb_request_regeneration',
    'wb_submit_regeneration_candidate', 'wb_resolve_regeneration_candidate',
    'wb_import_template_file', 'wb_get_template', 'wb_preview_template_restructure', 'wb_apply_template_restructure',
    'wb_request_code_semantic', 'wb_save_code_semantic',
    'wb_list_regeneration_requests',
    'wb_list_agent_tasks', 'wb_claim_agent_task', 'wb_update_agent_task_progress', 'wb_complete_agent_task', 'wb_fail_agent_task',
    'wb_publish_collaboration_progress',
  ],
  review: [
    'wb_search_materials', 'wb_compare_snapshot', 'wb_export_document',
    'wb_list_material_summaries', 'wb_list_material_chunks', 'wb_get_material_content',
    'wb_list_export_formats', 'wb_get_run', 'wb_list_templates', 'wb_get_template',
    'wb_add_review_suggestion',
    'wb_list_agent_tasks', 'wb_claim_agent_task', 'wb_update_agent_task_progress', 'wb_complete_agent_task', 'wb_fail_agent_task',
    'wb_publish_collaboration_progress',
    'wb_list_literature', 'wb_get_literature_trace',
  ],
}

export function getAllowedTools(stage) {
  if (!STAGES.includes(stage)) throw new Error(`Unknown work stage: ${stage}`)
  return [...new Set([...COMMON_TOOLS, ...STAGE_TOOLS[stage]])]
}

export async function getWorkStageInfo(runtime, sessionId = 'default') {
  const stage = await runtime.storage.getWorkStage(sessionId)
  return { stage, allowedTools: getAllowedTools(stage) }
}

export async function setWorkStage(runtime, sessionId = 'default', stage, options = {}) {
  if (!STAGES.includes(stage)) throw new Error(`Unknown work stage: ${stage}. Expected one of: ${STAGES.join(', ')}`)
  await runtime.storage.setWorkStage(sessionId, stage, options)
  return getWorkStageInfo(runtime, sessionId)
}

export async function assertToolAllowedForStage(runtime, sessionId, toolName) {
  const stage = await runtime.storage.getWorkStage(sessionId)
  if (!getAllowedTools(stage).includes(toolName)) {
    throw new Error(`Tool ${toolName} is not available during the ${stage} stage. Ask the user before switching stage with wb_set_work_stage.`)
  }
}
