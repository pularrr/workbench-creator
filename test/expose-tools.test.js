import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { WorkbenchRuntime } from '../src/core/runtime.js'
import { registerThesisPlugins } from '../src/plugins/thesis/index.js'
import { registerPatentPlugins } from '../src/plugins/patent/index.js'
import { exposeTools } from '../src/expose-tools.js'
import { getWorkbenchSessionId } from '../src/index.js'

registerThesisPlugins()
registerPatentPlugins()

test('DSH session resolver tolerates missing and variant execution contexts', () => {
  assert.equal(getWorkbenchSessionId({ session: { id: 'nested-session' } }), 'nested-session')
  assert.equal(getWorkbenchSessionId({ sessionId: 'flat-session' }), 'flat-session')
  assert.equal(getWorkbenchSessionId({ context: { session: { id: 'context-session' } } }), 'context-session')
  assert.equal(getWorkbenchSessionId({}), 'default')
  assert.equal(getWorkbenchSessionId(), 'default')
  console.log('  ✅ DSH session resolver handles missing/variant context')
})

async function makeRuntime() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wb-expose-'))
  const storagePath = path.join(tmpDir, 'state.json')
  return new WorkbenchRuntime({ storagePath })
}

// ─── 工具完整性 ─────────────────────────────────────────────────────────────

test('exposeTools: all 20+ tools are registered', async () => {
  const runtime = await makeRuntime()
  const { tools } = exposeTools(runtime, { platform: 'json' })
  assert.ok(tools.length >= 20, `should have at least 20 tools, got ${tools.length}`)

  const names = tools.map((t) => t.name)
  const expected = [
    'wb_list_projects', 'wb_create_project', 'wb_delete_project', 'wb_bind_project',
    'wb_get_workbench', 'wb_set_outline', 'wb_set_manuscript',
    'wb_create_run', 'wb_get_run', 'wb_advance_run', 'wb_cancel_run',
    'wb_list_templates', 'wb_save_template',
    'wb_request_regeneration', 'wb_list_regeneration_requests',
    'wb_list_task_types', 'wb_analyze_task_description', 'wb_generate_plugin_bundle',
    'wb_open_workbench',
  ]
  for (const name of expected) {
    assert.ok(names.includes(name), `missing tool: ${name}`)
  }
  console.log(`  ✅ ${tools.length} tools registered`)
})

test('exposeTools: every tool has name, description, parameters', async () => {
  const runtime = await makeRuntime()
  const { tools } = exposeTools(runtime, { platform: 'json' })
  for (const tool of tools) {
    assert.ok(typeof tool.name === 'string' && tool.name.length > 0, `${tool.name}: name missing`)
    assert.ok(typeof tool.description === 'string' && tool.description.length > 10, `${tool.name}: description too short`)
    assert.ok(tool.parameters && tool.parameters.type === 'object', `${tool.name}: parameters must be object type`)
    assert.ok(Array.isArray(tool.parameters.required), `${tool.name}: required must be array`)
  }
  console.log('  ✅ all tools have valid schema')
})

// ─── OpenAI 格式 ────────────────────────────────────────────────────────────

test('exposeTools: OpenAI format has type:function and execute', async () => {
  const runtime = await makeRuntime()
  const { tools, execute, executeAll } = exposeTools(runtime, { platform: 'openai' })

  // 格式验证
  assert.ok(Array.isArray(tools))
  for (const tool of tools) {
    assert.equal(tool.type, 'function')
    assert.ok(tool.function.name)
    assert.ok(tool.function.description)
    assert.ok(tool.function.parameters)
  }

  // execute 验证：模拟 OpenAI tool_call
  const result = await execute({
    id: 'call_123',
    type: 'function',
    function: { name: 'wb_list_projects', arguments: '{}' },
  })
  assert.ok(Array.isArray(result))

  // executeAll 验证
  const toolMessages = await executeAll([
    { id: 'call_1', type: 'function', function: { name: 'wb_list_projects', arguments: '{}' } },
  ])
  assert.equal(toolMessages.length, 1)
  assert.equal(toolMessages[0].role, 'tool')
  assert.equal(toolMessages[0].tool_call_id, 'call_1')

  console.log('  ✅ OpenAI format: type:function + execute + executeAll')
})

test('exposeTools: OpenAI execute throws on unknown tool', async () => {
  const runtime = await makeRuntime()
  const { execute } = exposeTools(runtime, { platform: 'openai' })
  await assert.rejects(
    () => execute({ function: { name: 'nonexistent_tool', arguments: '{}' } }),
    /Unknown tool/
  )
  console.log('  ✅ OpenAI: unknown tool throws')
})

// ─── Claude 格式 ────────────────────────────────────────────────────────────

test('exposeTools: Claude format has input_schema and execute', async () => {
  const runtime = await makeRuntime()
  const { tools, execute } = exposeTools(runtime, { platform: 'claude' })

  // 格式验证：Claude 用 input_schema 而不是 parameters
  for (const tool of tools) {
    assert.ok(tool.name)
    assert.ok(tool.description)
    assert.ok(tool.input_schema, 'Claude tools must have input_schema')
    assert.equal(tool.input_schema.type, 'object')
  }

  // execute 验证：模拟 Claude tool_use
  const result = await execute({
    id: 'toolu_123',
    type: 'tool_use',
    name: 'wb_list_projects',
    input: {},
  })
  assert.equal(result.type, 'tool_result')
  assert.equal(result.tool_use_id, 'toolu_123')
  assert.ok(typeof result.content === 'string')

  console.log('  ✅ Claude format: input_schema + execute returns tool_result')
})

// ─── DSH 格式 ───────────────────────────────────────────────────────────────

test('exposeTools: DSH format returns array with execute', async () => {
  const runtime = await makeRuntime()
  const tools = exposeTools(runtime, { platform: 'dsh' })

  assert.ok(Array.isArray(tools))
  for (const tool of tools) {
    assert.ok(tool.name)
    assert.ok(tool.description)
    assert.ok(tool.parameters)
    assert.equal(typeof tool.execute, 'function')
  }

  // 直接调用 execute
  const result = await tools[0].execute({})
  assert.ok(result !== undefined)

  console.log('  ✅ DSH format: array of {name, description, parameters, execute}')
})

// ─── LangChain 格式 ─────────────────────────────────────────────────────────

test('exposeTools: LangChain format has func and schema', async () => {
  const runtime = await makeRuntime()
  const tools = exposeTools(runtime, { platform: 'langchain' })

  assert.ok(Array.isArray(tools))
  for (const tool of tools) {
    assert.ok(tool.name)
    assert.ok(tool.description)
    assert.ok(tool.schema, 'LangChain tools must have schema')
    assert.equal(typeof tool.func, 'function')
  }

  // 调用 func
  const result = await tools[0].func({})
  assert.ok(Array.isArray(result))

  console.log('  ✅ LangChain format: {name, description, schema, func}')
})

// ─── JSON 通用格式 ───────────────────────────────────────────────────────────

test('exposeTools: JSON format has execute(name, args) and listTools', async () => {
  const runtime = await makeRuntime()
  const { tools, execute, listTools } = exposeTools(runtime, { platform: 'json' })

  assert.ok(Array.isArray(tools))
  assert.equal(typeof execute, 'function')
  assert.equal(typeof listTools, 'function')

  // listTools
  const names = listTools()
  assert.ok(names.length >= 20)

  // execute by name
  const result = await execute('wb_list_projects', {})
  assert.ok(Array.isArray(result))

  // unknown tool throws with available list
  await assert.rejects(
    () => execute('nonexistent', {}),
    /Unknown tool/
  )

  console.log('  ✅ JSON format: tools + execute(name,args) + listTools')
})

// ─── 过滤功能 ────────────────────────────────────────────────────────────────

test('exposeTools: include whitelist filters tools', async () => {
  const runtime = await makeRuntime()
  const { tools } = exposeTools(runtime, {
    platform: 'json',
    include: ['wb_create_project', 'wb_get_workbench'],
  })
  assert.equal(tools.length, 2)
  assert.equal(tools[0].name, 'wb_create_project')
  assert.equal(tools[1].name, 'wb_get_workbench')
  console.log('  ✅ include whitelist works')
})

test('exposeTools: exclude blacklist filters tools', async () => {
  const runtime = await makeRuntime()
  const all = exposeTools(runtime, { platform: 'json' })
  const { tools } = exposeTools(runtime, {
    platform: 'json',
    exclude: ['wb_open_workbench', 'wb_list_task_types'],
  })
  assert.equal(tools.length, all.tools.length - 2)
  assert.ok(!tools.map((t) => t.name).includes('wb_open_workbench'))
  console.log('  ✅ exclude blacklist works')
})

// ─── 端到端：用 exposeTools 跑完整流程 ──────────────────────────────────────

test('exposeTools: end-to-end create project via OpenAI execute', async () => {
  const runtime = await makeRuntime()
  const { execute } = exposeTools(runtime, { platform: 'openai', sessionId: 'e2e-session' })

  // 1. 创建项目（模拟 OpenAI tool_call）
  const project = await execute({
    function: { name: 'wb_create_project', arguments: JSON.stringify({ name: 'E2E测试论文', taskType: 'thesis' }) },
  })
  assert.ok(project.id)
  assert.equal(project.name, 'E2E测试论文')

  // 2. 获取工作台状态
  const wb = await execute({
    function: { name: 'wb_get_workbench', arguments: '{}' },
  })
  assert.ok(wb.project)
  assert.equal(wb.project.id, project.id)
  assert.ok(wb.outline && wb.outline.length >= 5, 'auto-generated outline should exist')

  // 3. 创建运行
  const run = await execute({
    function: { name: 'wb_create_run', arguments: JSON.stringify({ mode: 'standard' }) },
  })
  assert.ok(run.id)
  assert.equal(run.recommendedNextEvent, 'start')

  // 4. 推进运行
  const advanced = await execute({
    function: {
      name: 'wb_advance_run',
      arguments: JSON.stringify({ runId: run.id, expectedRevision: run.revision, event: 'start', summary: '启动' }),
    },
  })
  assert.ok(advanced.state)

  console.log('  ✅ E2E: create_project → get_workbench → create_run → advance_run via OpenAI execute')
})

test('exposeTools: analyze_task_description via JSON execute', async () => {
  const runtime = await makeRuntime()
  const { execute } = exposeTools(runtime, { platform: 'json' })

  const result = await execute('wb_analyze_task_description', { description: '帮我写一个法律合同审查工作台' })
  assert.equal(result.detectedType, 'contract')
  assert.ok(result.confidence > 0)
  console.log('  ✅ analyze_task_description works via exposeTools')
})
