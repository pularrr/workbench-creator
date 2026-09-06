/**
 * exposeTools — 将 WorkbenchRuntime 的方法暴露为不同 LLM 平台的工具格式。
 *
 * 支持平台：dsh | openai | claude | langchain | json
 *
 * 用法：
 *   import { WorkbenchRuntime } from 'dsh-workbench-core/core'
 *   import { registerThesisPlugins } from 'dsh-workbench-core/plugin-thesis'
 *   import { exposeTools } from 'dsh-workbench-core/expose-tools'
 *
 *   registerThesisPlugins()
 *   const runtime = new WorkbenchRuntime({ storagePath: './state.json' })
 *
 *   // OpenAI 格式
 *   const { tools, execute } = exposeTools(runtime, { platform: 'openai', sessionId: 'sess-1' })
 *   // tools 直接传给 OpenAI Chat Completions 的 tools 参数
 *   // execute(toolCall) 处理 tool_calls
 *
 *   // Claude 格式
 *   const { tools, execute } = exposeTools(runtime, { platform: 'claude' })
 *
 *   // DSH 格式（直接返回工具数组）
 *   const tools = exposeTools(runtime, { platform: 'dsh' })
 */

// ─── 工具定义表 ────────────────────────────────────────────────────────────
// 每个工具：name / description / parameters(JSON Schema) / execute(args)

function buildToolDefs(runtime, sessionId) {
  return [
    // ─── 项目管理 ────────────────────────────────────────────────────────
    {
      name: 'wb_list_projects',
      description: '列出所有工作台项目，返回项目数组（含 id、name、taskType、status 等）。',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: () => runtime.listProjects(),
    },
    {
      name: 'wb_create_project',
      description: '创建新的工作台项目。taskType 决定使用哪个插件包：thesis=学位论文, patent=专利撰写, contract=法律合同, tech-report=技术报告, generic=通用文本。创建后自动调用 wb_bind_project 绑定当前会话。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '项目名称，如"毫米波雷达水分检测研究"' },
          taskType: { type: 'string', description: '任务类型', enum: ['thesis', 'patent', 'contract', 'tech-report', 'research-proposal', 'clinical-trial', 'generic'] },
          title: { type: 'string', description: '文档正式标题（可选）' },
          targetWords: { type: 'number', description: '目标总字数（可选，默认 30000）' },
          metadata: { type: 'object', additionalProperties: true, description: '额外元数据（可选）' },
        },
        required: ['name', 'taskType'],
      },
      execute: async (args) => {
        const project = await runtime.createProject(sessionId, args)
        await runtime.bindProject(sessionId, project.id)
        return project
      },
    },
    {
      name: 'wb_delete_project',
      description: '永久删除指定项目。删除后应告知用户项目已删除，并提示选择或创建新项目。',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: '要删除的项目 ID' } },
        required: ['projectId'],
      },
      execute: (args) => runtime.deleteProject(args.projectId),
    },
    {
      name: 'wb_bind_project',
      description: '将当前会话绑定到指定项目。后续所有操作（大纲、正文、运行）都基于绑定的项目。创建项目后应自动调用此工具。',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: '要绑定的项目 ID' } },
        required: ['projectId'],
      },
      execute: (args) => runtime.bindProject(sessionId, args.projectId),
    },
    {
      name: 'wb_get_workbench',
      description: '获取当前绑定项目的完整工作台状态，包括项目信息、大纲、逻辑块、正文块、运行记录、模板、插件包信息。这是渲染工作台 UI 的数据源。',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: () => runtime.getWorkbench(sessionId),
    },
    {
      name: 'wb_list_export_formats',
      description: '列出当前绑定项目可用的导出格式。格式由核心或领域导出插件注册。',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: () => runtime.listExportFormats(sessionId),
    },
    {
      name: 'wb_export_document',
      description: '按当前工作台已注册的导出器导出项目文档。导出前先调用 wb_list_export_formats。',
      parameters: { type: 'object', properties: { format: { type: 'string' } }, required: ['format'] },
      execute: (args) => runtime.exportDocument(sessionId, args.format),
    },

    // ─── 大纲与正文 ──────────────────────────────────────────────────────
    {
      name: 'wb_set_outline',
      description: '设置项目大纲（章节/节结构）。Framework 插件会自动校验大纲，并为每个章节生成写作逻辑块。confirmed=true 时项目状态变为 ready_to_generate。',
      parameters: {
        type: 'object',
        properties: {
          outline: {
            type: 'array',
            description: '大纲节点数组',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '节点 ID，如 ch1' },
                title: { type: 'string', description: '章节标题' },
                objective: { type: 'string', description: '章节写作目标' },
                targetWords: { type: 'number', description: '目标字数' },
                expectedFigures: { type: 'number', description: '预计图数量' },
                expectedTables: { type: 'number', description: '预计表数量' },
                expectedMedia: { type: 'string', description: '其他多模态需求' },
                order: { type: 'number', description: '章节顺序' },
              },
              required: ['id', 'title'],
            },
          },
          confirmed: { type: 'boolean', description: '是否确认大纲（true=进入可生成状态）' },
        },
        required: ['outline'],
      },
      execute: (args) => runtime.setOutline(sessionId, args),
    },
    {
      name: 'wb_set_manuscript',
      description: '保存正文块（有序文本块数组）。每个块包含 markdown 内容、关联的大纲节点 ID、关联的逻辑块 ID。',
      parameters: {
        type: 'object',
        properties: {
          blocks: {
            type: 'array',
            description: '正文块数组',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '块 ID' },
                markdown: { type: 'string', description: 'Markdown 正文内容' },
                outlineNodeId: { type: 'string', description: '关联的大纲节点 ID' },
                logicBlockIds: { type: 'array', items: { type: 'string' }, description: '关联的逻辑块 ID 列表' },
                order: { type: 'number', description: '块顺序' },
              },
              required: ['markdown'],
            },
          },
        },
        required: ['blocks'],
      },
      execute: (args) => runtime.setManuscriptBlocks(sessionId, args),
    },

    // ─── 状态机运行 ───────────────────────────────────────────────────────
    {
      name: 'wb_create_run',
      description: '创建受控状态机运行（生成任务）。返回值包含 recommendedNextEvent——推进时必须使用此字段，禁止自行猜测事件名。mode=standard（默认）自动跳过规划阶段，mode=full 不跳过。',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['standard', 'full'], description: '跳过模式。standard=自动跳过规划阶段（推荐），full=不跳过任何阶段' },
          skipStages: { type: 'array', items: { type: 'string' }, description: '自定义要跳过的阶段（覆盖 mode）' },
          reviewEnabled: { type: 'boolean', description: '是否启用审查阶段' },
        },
        required: [],
      },
      execute: (args) => runtime.createRun(sessionId, args),
    },
    {
      name: 'wb_get_run',
      description: '获取运行详情，包括当前状态、步骤历史、预算、validEvents（合法事件列表）、recommendedNextEvent（推荐的下一步事件名）、guidance（文字指导）。推进运行前必须先调用此工具获取 recommendedNextEvent。',
      parameters: {
        type: 'object',
        properties: { runId: { type: 'string', description: '运行 ID' } },
        required: ['runId'],
      },
      execute: (args) => runtime.getRun(sessionId, args.runId),
    },
    {
      name: 'wb_advance_run',
      description: '推进状态机运行。CRITICAL：必须先调用 wb_get_run，然后使用返回值中的 recommendedNextEvent 作为 event 参数。禁止自行猜测事件名。expectedRevision 必须与 get_run 返回的 revision 一致（乐观锁）。',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: '运行 ID' },
          expectedRevision: { type: 'integer', description: '预期版本号（从 wb_get_run 获取）' },
          event: { type: 'string', description: '事件名（必须使用 recommendedNextEvent，禁止猜测）' },
          summary: { type: 'string', description: '步骤摘要' },
          observation: { type: 'object', additionalProperties: true, description: '观察数据' },
        },
        required: ['runId', 'expectedRevision', 'event'],
      },
      execute: (args) => runtime.advanceRun(sessionId, args),
    },
    {
      name: 'wb_cancel_run',
      description: '取消运行。取消后运行进入 cancelled 终态。',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          expectedRevision: { type: 'integer', description: '预期版本号（从 wb_get_run 获取）' },
        },
        required: ['runId', 'expectedRevision'],
      },
      execute: (args) => runtime.cancelRun(sessionId, args),
    },

    // ─── 模板 ─────────────────────────────────────────────────────────────
    {
      name: 'wb_list_templates',
      description: '列出当前项目的自定义模板（文本模板和格式模板）。',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: () => runtime.listTemplates(sessionId),
    },
    {
      name: 'wb_save_template',
      description: '保存或更新自定义模板。type=text 为写作结构模板（大纲/行文逻辑），type=format 为导出格式模板（字体/排版/引用格式）。更新时传入 templateId。',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: '已有模板 ID（更新时传入，新建时省略）' },
          name: { type: 'string', description: '模板名称' },
          type: { type: 'string', enum: ['text', 'format'], description: 'text=写作结构模板，format=导出格式模板' },
          description: { type: 'string', description: '模板描述' },
          content: { type: 'string', description: '模板内容' },
        },
        required: ['name', 'type', 'content'],
      },
      execute: (args) => runtime.saveTemplate(sessionId, args),
    },

    // ─── 重新生成 ─────────────────────────────────────────────────────────
    {
      name: 'wb_request_regeneration',
      description: '提交重新生成请求。基于当前编辑器中的修改内容和指令，LLM 可拾取此请求并重新生成相关章节。工作台 UI 的"重新生成"按钮调用此接口。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '当前编辑器中的正文内容' },
          instruction: { type: 'string', description: '重新生成指令，如"基于修改重写第2章"' },
          blockId: { type: 'string', description: '指定要重新生成的块 ID（可选）' },
        },
        required: ['content'],
      },
      execute: (args) => runtime.requestRegeneration(sessionId, args),
    },
    {
      name: 'wb_list_regeneration_requests',
      description: '列出当前项目待处理的重新生成请求。LLM 应定期检查并处理这些请求。',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: () => runtime.listPendingRegenerationRequests(sessionId),
    },

    // ─── 插件系统 ─────────────────────────────────────────────────────────
    {
      name: 'wb_list_task_types',
      description: '列出当前支持的所有任务类型（已注册的插件包），如 thesis、patent、contract 等。',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: () => runtime.listTaskTypes ? runtime.listTaskTypes() : { taskTypes: ['thesis', 'patent'] },
    },
    {
      name: 'wb_list_plugins',
      description: '列出所有已注册的插件，按层（framework/logic/evidence）分组。可按 taskType 过滤。',
      parameters: {
        type: 'object',
        properties: {
          layer: { type: 'string', enum: ['framework', 'logic', 'evidence'], description: '插件层（可选，省略则返回所有层）' },
          taskType: { type: 'string', description: '按任务类型过滤（可选）' },
        },
        required: [],
      },
      execute: () => ({ message: '使用 runtime 内部插件注册表查询' }),
    },
    {
      name: 'wb_analyze_task_description',
      description: '分析用户的自然语言描述，检测适合的任务类型和插件配置。在生成新任务类型插件包之前调用此工具。返回 detectedType、confidence、matchedKeywords、suggestedConfig。',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: '用户的自然语言描述，如"帮我写一个法律合同审查工作台"' },
        },
        required: ['description'],
      },
      execute: (args) => {
        // 延迟导入避免循环依赖
        return import('./generator.js').then(({ analyzeTaskDescription }) => analyzeTaskDescription(args.description))
      },
    },
    {
      name: 'wb_generate_plugin_bundle',
      description: '为新任务类型生成完整的插件包（6 个文件：package.json、README、framework.js、logic.js、evidence.js、index.js），写入本地目录。生成后告知用户运行安装命令。应先调用 wb_analyze_task_description 检测任务类型。',
      parameters: {
        type: 'object',
        properties: {
          taskType: { type: 'string', description: '任务类型标识符，如 contract、clinical-trial、bidding-doc' },
          name: { type: 'string', description: '插件显示名称，如"合同审查工作台"' },
          description: { type: 'string', description: '插件描述' },
          outputDir: { type: 'string', description: '输出目录（默认 ./generated-plugins/<taskType>-workbench）' },
        },
        required: ['taskType', 'name'],
      },
      execute: (args) => {
        return import('./generator.js').then(({ generatePluginBundle }) => generatePluginBundle(args))
      },
    },

    // ─── 工作台 UI ─────────────────────────────────────────────────────────
    {
      name: 'wb_open_workbench',
      description: '确保工作台 HTTP 服务运行（端口 3199），并返回访问 URL。告知用户在浏览器中打开 http://127.0.0.1:3199。',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: () => ({ url: 'http://127.0.0.1:3199', message: '工作台 UI 运行中，请在浏览器打开 http://127.0.0.1:3199' }),
    },
  ]
}

// ─── 平台格式转换器 ────────────────────────────────────────────────────────

function toOpenAI(defs) {
  return {
    tools: defs.map((d) => ({
      type: 'function',
      function: { name: d.name, description: d.description, parameters: d.parameters },
    })),
    /**
     * 处理 OpenAI tool_calls。
     * @param {Object} toolCall - OpenAI 返回的 tool_calls[0]
     * @returns {Promise<*>} 工具执行结果
     */
    execute: async (toolCall) => {
      const def = defs.find((d) => d.name === toolCall.function?.name)
      if (!def) throw new Error(`Unknown tool: ${toolCall.function?.name}`)
      const args = JSON.parse(toolCall.function.arguments || '{}')
      return await def.execute(args)
    },
    /**
     * 批量处理所有 tool_calls。
     * @param {Array} toolCalls - OpenAI 返回的 tool_calls 数组
     * @returns {Promise<Array>} 执行结果数组，可直接作为 tool role messages
     */
    executeAll: async (toolCalls) => {
      return Promise.all(
        toolCalls.map(async (call) => ({
          tool_call_id: call.id,
          role: 'tool',
          name: call.function.name,
          content: JSON.stringify(await toOpenAI(defs).execute(call)),
        }))
      )
    },
  }
}

function toClaude(defs) {
  return {
    tools: defs.map((d) => ({
      name: d.name,
      description: d.description,
      input_schema: d.parameters,
    })),
    /**
     * 处理 Claude tool_use。
     * @param {Object} toolUse - Claude 返回的 content 中 type=tool_use 的块
     * @returns {Promise<Object>} {type: 'tool_result', tool_use_id, content}
     */
    execute: async (toolUse) => {
      const def = defs.find((d) => d.name === toolUse.name)
      if (!def) throw new Error(`Unknown tool: ${toolUse.name}`)
      const result = await def.execute(toolUse.input || {})
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      }
    },
    /**
     * 批量处理所有 tool_use 块。
     */
    executeAll: async (contentBlocks) => {
      const toolUses = contentBlocks.filter((b) => b.type === 'tool_use')
      return Promise.all(toolUses.map((b) => toClaude(defs).execute(b)))
    },
  }
}

function toDSH(defs) {
  // DSH 格式：直接返回工具定义数组，execute 签名为 (args, exec) => ...
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.parameters,
    // Preserve the host execution context.  Some definitions use it for
    // session scoping; dropping it silently collapses all callers to the
    // default session.
    execute: async (args, exec) => await d.execute(args, exec),
  }))
}

function toLangChain(defs) {
  // LangChain DynamicTool 格式（可直接用于 new DynamicTool()）
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    schema: d.parameters,
    func: async (args) => await d.execute(args),
  }))
}

function toJSON(defs) {
  // 通用 JSON 格式 + 通用 execute(name, args)
  return {
    tools: defs.map((d) => ({
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    })),
    execute: async (name, args) => {
      const def = defs.find((d) => d.name === name)
      if (!def) throw new Error(`Unknown tool: ${name}. Available: ${defs.map((d) => d.name).join(', ')}`)
      return await def.execute(args || {})
    },
    listTools: () => defs.map((d) => d.name),
  }
}

// ─── 主函数 ─────────────────────────────────────────────────────────────────

/**
 * 将 WorkbenchRuntime 暴露为指定 LLM 平台的工具格式。
 *
 * @param {WorkbenchRuntime} runtime - WorkbenchRuntime 实例
 * @param {Object} options
 * @param {string} options.platform - 目标平台：'openai' | 'claude' | 'dsh' | 'langchain' | 'json'（默认 'openai'）
 * @param {string} options.sessionId - 会话 ID（用于绑定项目，默认 'default'）
 * @param {string[]} options.include - 白名单：只包含指定工具（可选）
 * @param {string[]} options.exclude - 黑名单：排除指定工具（可选，默认 []）
 * @returns {Object} 平台特定的工具定义 + execute 函数
 *
 * @example
 * // OpenAI
 * const { tools, execute, executeAll } = exposeTools(runtime, { platform: 'openai' })
 * const response = await openai.chat.completions.create({ model: 'gpt-4', messages, tools })
 * if (response.choices[0].message.tool_calls) {
 *   const toolMessages = await executeAll(response.choices[0].message.tool_calls)
 *   // 把 toolMessages 加回 messages 继续对话
 * }
 *
 * @example
 * // Claude
 * const { tools, execute } = exposeTools(runtime, { platform: 'claude' })
 * const response = await anthropic.messages.create({ model: 'claude-3-opus', max_tokens: 1024, messages, tools })
 * const toolResults = await Promise.all(response.content.filter(b => b.type === 'tool_use').map(execute))
 *
 * @example
 * // 通用 JSON（任何平台都能用）
 * const { tools, execute, listTools } = exposeTools(runtime, { platform: 'json' })
 * const result = await execute('wb_create_project', { name: '测试', taskType: 'thesis' })
 */
export function exposeTools(runtime, options = {}) {
  const platform = options.platform || 'openai'
  const sessionId = options.sessionId || 'default'
  const include = options.include || null
  const exclude = options.exclude || []

  let defs = buildToolDefs(runtime, sessionId)

  // 过滤
  if (include && Array.isArray(include)) {
    defs = defs.filter((d) => include.includes(d.name))
  }
  if (exclude && Array.isArray(exclude)) {
    defs = defs.filter((d) => !exclude.includes(d.name))
  }

  switch (platform) {
    case 'openai':
      return toOpenAI(defs)
    case 'claude':
      return toClaude(defs)
    case 'dsh':
      return toDSH(defs)
    case 'langchain':
      return toLangChain(defs)
    case 'json':
    default:
      return toJSON(defs)
  }
}

export default exposeTools
