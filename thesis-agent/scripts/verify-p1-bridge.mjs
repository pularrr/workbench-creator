import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { apply } from '../src/index.js'
import { isLosslessJson } from '../src/lossless.js'

const dshToolsPath = 'C:/Users/kuroko131/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
const { validateJsonSchemaValue } = await import(pathToFileURL(dshToolsPath).href)

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'p1-bridge-'))
const defs = new Map()
const ctx = { tools: { register(d) { defs.set(d.name, d); return () => defs.delete(d.name) } } }
await apply(ctx, { dataDir })

const exec = { agent: { session: { id: 'session-p1' } } }
const results = []
function check(name, value) {
  const tool = defs.get(name)
  if (!tool) { results.push({ name, lossless: false, violations: 1, note: 'TOOL NOT REGISTERED' }); return }
  const lossless = isLosslessJson(value)
  const violations = validateJsonSchemaValue(tool.output.schema, value, 'value')
  results.push({ name, lossless, violations: violations.length, dataType: Array.isArray(value.data) ? `array[${value.data.length}]` : typeof value.data })
}

check('thesis_create_project', await defs.get('thesis_create_project').execute({ name: 'P1验证' }, exec))
check('thesis_list_template_packs', await defs.get('thesis_list_template_packs').execute({}, exec))
check('thesis_apply_default_master_template', await defs.get('thesis_apply_default_master_template').execute({ expectedRevision: 0, packId: 'ieee-conference' }, exec))
await defs.get('thesis_import_source_text').execute({ sourceKey: 's1', name: '材料', content: '毫米波雷达检测烟草水分含量的研究方法。\n'.repeat(60) }, exec)
check('thesis_search_sources', await defs.get('thesis_search_sources').execute({ query: '雷达 水分', rerank: { provider: 'local', topK: 3 } }, exec))
check('thesis_get_workbench', await defs.get('thesis_get_workbench').execute({}, exec))
check('thesis_list_embedding_presets', await defs.get('thesis_list_embedding_presets').execute({}, exec))
check('thesis_set_embedding_preset', await defs.get('thesis_set_embedding_preset').execute({ provider: 'ollama', test: false, rebuild: false }, exec))
check('thesis_follow_recent_project', await defs.get('thesis_follow_recent_project').execute({}, exec))
check('thesis_open_workbench', await defs.get('thesis_open_workbench').execute({}, exec))
check('thesis_request_regeneration', await defs.get('thesis_request_regeneration').execute({ content: 'test' }, exec))
check('thesis_list_regeneration_requests', await defs.get('thesis_list_regeneration_requests').execute({}, exec))

let fail = 0
for (const r of results) {
  const ok = r.lossless && r.violations === 0
  if (!ok) fail++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${r.name}  (data: ${r.dataType}, lossless: ${r.lossless}, schema violations: ${r.violations}${r.note ? ', ' + r.note : ''})`)
}
console.log(fail === 0 ? '\nALL P1 BRIDGE CHECKS PASSED' : `\n${fail} FAILURES`)
process.exit(fail === 0 ? 0 : 1)
