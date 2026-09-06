/**
 * Embedding provider presets (v1.1 · 对话引导配置).
 *
 * Built-in convenience presets so the Agent can configure real semantic
 * embeddings from natural language ("用 DeepSeek 的向量模型", "用 Ollama
 * 本地 bge-m3"…) in a single thesis_set_embedding_preset call instead of
 * exposing raw endpoint/model/apiKey fields.
 *
 * Presets are *convenient defaults only* — endpoint/model can always be
 * overridden per call. All values are lossless-JSON safe.
 */

const PRESETS = {
  'deepseek': {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-embedding',
    dimensions: 1024,
    note: 'DeepSeek OpenAI 兼容端点（若你的账号提供 embedding 模型则可用）',
    requiresKey: true,
  },
  'openai': {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
    dimensions: 1536,
    note: 'OpenAI 官方 embedding API',
    requiresKey: true,
  },
  'qwen': {
    name: '通义千问（阿里云百炼）',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'text-embedding-v3',
    dimensions: 1024,
    note: 'DashScope OpenAI 兼容模式',
    requiresKey: true,
  },
  'zhipu': {
    name: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'embedding-3',
    dimensions: 2048,
    note: '智谱开放平台 embedding-3',
    requiresKey: true,
  },
  'siliconflow': {
    name: '硅基流动 SiliconFlow',
    endpoint: 'https://api.siliconflow.cn/v1',
    model: 'BAAI/bge-m3',
    dimensions: 1024,
    note: '开源模型托管，bge-m3 中文检索效果好',
    requiresKey: true,
  },
  'ollama': {
    name: 'Ollama（本地）',
    endpoint: 'http://127.0.0.1:11434/v1',
    model: 'bge-m3',
    dimensions: 1024,
    note: '本地零成本，需先 ollama pull bge-m3 并启动服务',
    requiresKey: false,
  },
}

/**
 * Resolve an embedding preset by key (case-insensitive, trims whitespace).
 * @param {string} key
 * @returns {{key:string, name:string, endpoint:string, model:string, dimensions:number, note:string}|null}
 */
export function resolveEmbeddingPreset(key) {
  if (!key) return null
  const normalized = String(key).trim().toLowerCase()
  // Accept aliases: "dashscope" -> qwen, "阿里" -> qwen, "本地"/"local" -> ollama
  const alias = {
    dashscope: 'qwen', aliyun: 'qwen', 阿里: 'qwen', 通义: 'qwen', 千问: 'qwen',
    bigmodel: 'zhipu', glm: 'zhipu', 智谱: 'zhipu',
    sile: 'siliconflow', 硅基: 'siliconflow',
    local: 'ollama', 本地: 'ollama',
  }
  const finalKey = PRESETS[normalized] ? normalized : (alias[normalized] || null)
  if (!finalKey) return null
  return { key: finalKey, ...PRESETS[finalKey] }
}

/**
 * List all available presets (for thesis_list_embedding_presets).
 * @returns {Array<{key, name, endpoint, model, dimensions, note}>}
 */
export function listEmbeddingPresets() {
  return Object.entries(PRESETS).map(([key, preset]) => ({ key, ...preset }))
}

/**
 * Verify whether a preset key exists.
 */
export function isEmbeddingPreset(key) {
  return resolveEmbeddingPreset(key) !== null
}

export const __test__ = { PRESETS }
