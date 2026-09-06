import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply } from '../src/index.js'

test('registers the core thesis tool catalog and executes the first project flow', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-thesis-plugin-'))
  const definitions = new Map()
  const ctx = {
    tools: {
      register(definition) {
        definitions.set(definition.name, definition)
        return () => definitions.delete(definition.name)
      },
    },
  }

  await apply(ctx, { dataDir })
  const expectedTools = [
    'thesis_advance_agent_run',
    'thesis_apply_default_master_template',
    'thesis_bind_block_sources',
    'thesis_bind_project',
    'thesis_build_evidence_package',
    'thesis_cancel_agent_run',
    'thesis_compare_manuscript_version',
    'thesis_bind_citation',
    'thesis_confirm_generation',
    'thesis_confirm_revision_batch',
    'thesis_create_agent_run',
    'thesis_create_manuscript_snapshot',
    'thesis_create_project',
    'thesis_delete_project',
    'thesis_list_templates',
    'thesis_save_template',
    'thesis_get_template',
    'thesis_delete_template',
    'thesis_create_revision_batch',
    'thesis_decide_generated_scope',
    'thesis_decide_literature',
    'thesis_decide_patch_proposal',
    'thesis_decide_review_suggestion',
    'thesis_edit_review_suggestion',
    'thesis_export_current_docx',
    'thesis_export_current_latex',
    'thesis_edit_literature',
    'thesis_follow_recent_project',
    'thesis_format_references',
    'thesis_get_agent_run',
    'thesis_get_embedding_status',
    'thesis_get_logic_for_block',
    'thesis_get_workbench',
    'thesis_open_workbench',
    'thesis_request_regeneration',
    'thesis_list_regeneration_requests',
    'thesis_resolve_regeneration',
    'thesis_import_reference_template',
    'thesis_import_source_file',
    'thesis_import_source_text',
    'thesis_import_template_pack',
    'thesis_inspect_and_export',
    'thesis_list_embedding_presets',
    'thesis_list_template_packs',
    'thesis_locate_blocks_for_logic',
    'thesis_pause_agent_run',
    'thesis_prepare_generation',
    'thesis_project_status',
    'thesis_rebuild_embeddings',
    'thesis_resolve_revision_batch',
    'thesis_restore_manuscript_version',
    'thesis_resume_agent_run',
    'thesis_run_quality_checks',
    'thesis_scan_directory',
    'thesis_search_sources',
    'thesis_set_embedding_config',
    'thesis_set_embedding_preset',
    'thesis_set_export_template',
    'thesis_set_manuscript_blocks',
    'thesis_set_plan',
    'thesis_submit_generated_scope',
    'thesis_submit_literature_candidates',
    'thesis_submit_patch_proposal',
    'thesis_submit_review_suggestions',
    'thesis_test_embedding_connection',
  ]
  assert.deepEqual([...definitions.keys()].sort(), expectedTools.sort())

  const exec = { agent: { session: { id: 'session-test' } } }
  const created = await definitions.get('thesis_create_project').execute({ name: '测试论文' }, exec)
  assert.equal(created.ok, true)
  assert.equal(created.data.name, '测试论文')

  const status = await definitions.get('thesis_project_status').execute({}, exec)
  assert.equal(status.data.id, created.data.id)
  assert.equal(status.data.status, 'planning')
})

test('writer and reviewer preset policies expose different tool sets', async () => {
  const restrictions = []
  const ctx = {
    tools: {
      restrict(filter) {
        restrictions.push(filter)
        return () => undefined
      },
    },
  }

  await apply(ctx, { mode: 'writer-policy' })
  await apply(ctx, { mode: 'review-policy' })

  assert.equal(restrictions.length, 2)
  assert.ok(restrictions[0].allow.includes('thesis_create_revision_batch'))
  assert.ok(!restrictions[0].allow.includes('thesis_submit_review_suggestions'))
  assert.deepEqual(restrictions[1].allow.sort(), [
    'thesis_get_workbench',
    'thesis_project_status',
    'thesis_run_quality_checks',
    'thesis_submit_review_suggestions',
  ].sort())
})
