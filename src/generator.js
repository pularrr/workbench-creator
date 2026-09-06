/**
 * Plugin Generator — LLM-driven generation of new task-type plugin bundles.
 *
 * When the user says "基于论文工作台架构，帮我生成一个面向专利撰写的工作台",
 * this module produces a scaffold plugin bundle that the LLM can customize.
 */

import { generatePluginScaffold } from './core/plugin-loader.js'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, realpath, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { validatePluginManifest } from './core/plugin-loader.js'
import { validatePluginSpec } from './core/plugin-spec.js'

/** Verify a generated package without importing or executing its plugin code. */
export async function verifyGeneratedPluginBundle(outputDir) {
  const root = path.resolve(outputDir)
  const requiredFiles = ['package.json', 'plugin.manifest.json', 'plugin-spec.json', 'cordis.patch.yml', 'src/index.js', 'src/framework.js', 'src/logic.js', 'src/evidence.js', 'src/material.js']
  const missing = []
  for (const file of requiredFiles) {
    try { await access(path.join(root, file)) } catch { missing.push(file) }
  }
  if (missing.length) return { valid: false, issues: [`Missing files: ${missing.join(', ')}`] }
  let manifest
  try { manifest = JSON.parse(await readFile(path.join(root, 'plugin.manifest.json'), 'utf8')) } catch { return { valid: false, issues: ['plugin.manifest.json is not valid JSON'] } }
  const manifestValidation = validatePluginManifest(manifest)
  let spec
  try { spec = JSON.parse(await readFile(path.join(root, 'plugin-spec.json'), 'utf8')) } catch { return { valid: false, issues: ['plugin-spec.json is not valid JSON'] } }
  const specValidation = validatePluginSpec(spec)
  const index = await readFile(path.join(root, 'src', 'index.js'), 'utf8')
  const issues = [...manifestValidation.issues, ...specValidation.issues]
  if (!index.includes('export async function apply')) issues.push('src/index.js must export DSH apply()')
  if (!index.includes('registerPluginBundle')) issues.push('src/index.js must register a plugin bundle')
  return { valid: issues.length === 0, issues, manifest, spec }
}

/**
 * Analyze a user's task description and determine the appropriate task type
 * and plugin configuration.
 * @param {string} description - User's natural language description
 * @returns {Object} task type analysis
 */
export function analyzeTaskDescription(description) {
  const desc = String(description || '').toLowerCase()
  const analysis = {
    rawDescription: description,
    detectedType: null,
    confidence: 0,
    keywords: [],
    suggestedConfig: {},
  }

  // Keyword-based task type detection
  const typePatterns = [
    { type: 'thesis', keywords: ['论文', '学位', 'thesis', 'dissertation', '学术', '硕士', '博士'], config: { citationStyle: 'gb-t-7714', outlineType: 'academic' } },
    { type: 'patent', keywords: ['专利', 'patent', '权利要求', '发明', '实用新型', '申请文件'], config: { citationStyle: 'patent-citation', outlineType: 'patent' } },
    { type: 'contract', keywords: ['合同', 'contract', '法律文书', '协议', '条款', '法务'], config: { citationStyle: 'legal-citation', outlineType: 'contract' } },
    { type: 'tech-report', keywords: ['技术报告', 'tech report', '技术方案', '可研', '可行性研究', '项目报告'], config: { citationStyle: 'ieee', outlineType: 'technical' } },
    { type: 'research-proposal', keywords: ['开题报告', 'research proposal', '基金申请', '项目申请', '申报书'], config: { citationStyle: 'gb-t-7714', outlineType: 'proposal' } },
    { type: 'clinical-trial', keywords: ['临床试验', 'clinical trial', '医学报告', '病例', '临床研究'], config: { citationStyle: 'ama', outlineType: 'clinical' } },
  ]

  for (const pattern of typePatterns) {
    const matches = pattern.keywords.filter((k) => desc.includes(k.toLowerCase()))
    if (matches.length > 0) {
      analysis.keywords.push(...matches)
      if (!analysis.detectedType) {
        analysis.detectedType = pattern.type
        analysis.confidence = Math.min(1, matches.length / 2)
        analysis.suggestedConfig = pattern.config
      }
    }
  }

  if (!analysis.detectedType) {
    analysis.detectedType = 'generic'
    analysis.confidence = 0.3
    analysis.suggestedConfig = { citationStyle: 'generic', outlineType: 'generic' }
  }

  return analysis
}

/**
 * Generate a complete plugin bundle for a new task type.
 * @param {Object} options - { taskType, name, description, outputDir, stateTable, customConfig }
 * @returns {Object} generated bundle info
 */
export async function generatePluginBundle(options = {}) {
  const suppliedSpec = options.spec || null
  if (suppliedSpec && !validatePluginSpec(suppliedSpec).valid) {
    throw new Error(`Invalid Plugin Spec: ${validatePluginSpec(suppliedSpec).issues.join('; ')}`)
  }
  const taskType = String(suppliedSpec?.taskType || options.taskType || 'generic').toLowerCase().trim()
  if (!/^[a-z][a-z0-9-]*$/.test(taskType)) {
    throw new Error('taskType must be a kebab-case identifier')
  }
  const symbolName = taskType.replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase())
  const name = suppliedSpec?.name || options.name || `${taskType.charAt(0).toUpperCase() + taskType.slice(1)} Workbench`
  const description = suppliedSpec?.description || options.description || `Auto-generated plugin for ${taskType} text generation`
  // Generated packages are deliberately isolated from this framework.  Never
  // use the workbench source directory as an output destination.
  // An explicit outputDir keeps backward compatibility; its parent becomes
  // the isolated output root unless the caller supplied outputRoot as well.
  const outputRoot = path.resolve(options.outputRoot || (options.outputDir ? path.dirname(options.outputDir) : './generated-plugins'))
  const outputDir = path.resolve(options.outputDir || path.join(outputRoot, `${taskType}-workbench`))
  if (outputDir !== outputRoot && !outputDir.startsWith(`${outputRoot}${path.sep}`)) {
    throw new Error('outputDir must be a child directory of outputRoot')
  }
  await mkdir(outputRoot, { recursive: true })
  const resolvedRoot = await realpath(outputRoot)
  if (path.resolve(outputDir) === resolvedRoot) {
    throw new Error('outputDir must be a new child directory, not outputRoot itself')
  }

  const scaffold = generatePluginScaffold(taskType, {
    name,
    description,
    stateTable: options.stateTable,
    citationStyle: options.customConfig?.citationStyle,
    styleDimensions: options.customConfig?.styleDimensions,
  })

  // Create an independent, installable package. No generated file is written
  // into workbench-core itself.
  await mkdir(path.join(outputDir, 'src', 'presets'), { recursive: true })

  // Write package.json
  const pkg = {
    name: `dsh-${taskType}-workbench`,
    version: '0.1.0',
    description,
    type: 'module',
    main: 'src/index.js',
    peerDependencies: {
      'dsh-workbench-core': '^0.1.0',
    },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    scripts: {
      test: 'node --test',
      check: 'node --check src/index.js && node scripts/verify.mjs',
    },
  }
  await writeFile(path.join(outputDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8')

  const manifest = {
    id: `${taskType}-workbench`, taskType, name, version: '0.1.0', apiVersion: 2,
    entry: './src/index.js', description,
    capabilities: { outline: true, evidence: true, templates: true, regeneration: true, exports: suppliedSpec?.exports || options.exportFormats || ['markdown', 'text'], multimodalMaterials: suppliedSpec?.materialSchema?.supportedTypes || options.materialTypes || [] },
    ui: {
      outlineLabel: suppliedSpec?.ui?.outlineLabel || options.ui?.outlineLabel || '文档结构',
      logicLabel: suppliedSpec?.ui?.logicLabel || options.ui?.logicLabel || '生成逻辑',
      evidenceLabel: suppliedSpec?.ui?.evidenceLabel || options.ui?.evidenceLabel || '内容凭证',
      editorLabel: suppliedSpec?.ui?.editorLabel || options.ui?.editorLabel || '正文',
    },
  }
  await writeFile(path.join(outputDir, 'plugin.manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  const pluginSpec = suppliedSpec || {
    taskType, name, description, version: '1.0.0',
    ui: manifest.ui,
    documentSchema: {
      fields: options.fieldSchema || {}, outlineNodeSchema: scaffold.framework.outlineNodeSchema,
      sections: options.sections || [
        { id: 'overview', title: '概述', objective: '任务背景和目标', weight: 1 },
        { id: 'body', title: '主体内容', objective: '核心内容论述', weight: 7 },
        { id: 'conclusion', title: '结论', objective: '总结和后续事项', weight: 2 },
      ],
    },
    workflow: { stateTable: scaffold.framework.stateTable, defaultSkipStages: scaffold.framework.defaultSkipStages },
    logic: { styleDimensions: scaffold.logic.styleDimensions, rules: options.logicRules || [], rewriteSuggestions: options.rewriteSuggestions || [] },
    evidence: { citationStyle: scaffold.evidence.citationStyle, requiredPatterns: options.requiredEvidencePatterns || [] },
    materialSchema: { supportedTypes: options.materialTypes || ['text', 'pdf', 'docx', 'pptx', 'xlsx', 'image', 'binary'], roles: options.materialRoles || [], roleGuidance: options.roleGuidance || {}, defaultGuidance: options.defaultMaterialGuidance || '' },
    templates: options.templates || [], generatedBy: 'dsh-workbench-core', generatedAt: new Date().toISOString(),
  }
  await writeFile(path.join(outputDir, 'plugin-spec.json'), JSON.stringify(pluginSpec, null, 2), 'utf8')
  await writeFile(path.join(outputDir, 'cordis.patch.yml'), `- insert:\n    - id: ${taskType}-workbench\n      name: dsh-${taskType}-workbench\n      config: {}\n`, 'utf8')
  await mkdir(path.join(outputDir, 'scripts'), { recursive: true })
  await writeFile(path.join(outputDir, 'scripts', 'verify.mjs'), `import { readFile, access } from 'node:fs/promises'\nimport path from 'node:path'\nimport { fileURLToPath } from 'node:url'\nimport { validatePluginSpec } from 'dsh-workbench-core/core'\nconst root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')\nconst required = ['package.json', 'plugin.manifest.json', 'plugin-spec.json', 'cordis.patch.yml', 'src/index.js', 'src/framework.js', 'src/logic.js', 'src/evidence.js', 'src/material.js']\nfor (const file of required) await access(path.join(root, file))\nconst manifest = JSON.parse(await readFile(path.join(root, 'plugin.manifest.json'), 'utf8'))\nconst spec = JSON.parse(await readFile(path.join(root, 'plugin-spec.json'), 'utf8'))\nif (manifest.apiVersion !== 2 || !manifest.id || !manifest.taskType || !manifest.entry) throw new Error('Invalid plugin manifest')\nconst validation = validatePluginSpec(spec); if (!validation.valid) throw new Error(validation.issues.join('; '))\nconsole.log('Plugin package verified:', manifest.id)\n`, 'utf8')

  // Write framework plugin
  const frameworkCode = `/**
 * ${name} Framework Plugin
 * Auto-generated by dsh-workbench-core plugin generator.
 * Customize the stateTable, outline template, and validation rules below.
 */

export const ${symbolName}Framework = {
  id: '${taskType}-framework',
  name: '${name} Framework',
  taskType: '${taskType}',
  description: '${description}',
  stateTable: ${JSON.stringify(scaffold.framework.stateTable, null, 2)},
  defaultSkipStages: ${JSON.stringify(scaffold.framework.defaultSkipStages)},
  outlineNodeSchema: ${JSON.stringify(scaffold.framework.outlineNodeSchema, null, 2)},

  async generateOutline(input = {}) {
    // TODO: Customize default outline for ${taskType}
    const targetWords = input.targetWords || 10000
    return [
      { id: 'sec1', title: '概述', objective: '任务背景和目标', targetWords: Math.round(targetWords * 0.1), order: 0 },
      { id: 'sec2', title: '主体内容', objective: '核心内容论述', targetWords: Math.round(targetWords * 0.7), order: 1 },
      { id: 'sec3', title: '结论', objective: '总结和展望', targetWords: Math.round(targetWords * 0.2), order: 2 },
    ]
  },

  async validateOutline(outline) {
    const issues = []
    if (!Array.isArray(outline) || outline.length === 0) {
      issues.push({ severity: 'blocking', code: 'EMPTY_OUTLINE', message: '大纲不能为空' })
    }
    return { valid: issues.every((i) => i.severity !== 'blocking'), issues }
  },
}
`
  await writeFile(path.join(outputDir, 'src', 'framework.js'), frameworkCode, 'utf8')

  // Write logic plugin
  const logicCode = `/**
 * ${name} Logic Plugin
 * Auto-generated. Customize writing logic per block.
 */

export const ${symbolName}Logic = {
  id: '${taskType}-logic',
  name: '${name} Logic',
  taskType: '${taskType}',
  description: 'Writing logic for ${taskType}',
  styleDimensions: ${JSON.stringify(scaffold.logic.styleDimensions)},

  async generateLogic(outlineNode, context = {}) {
    return [
      {
        id: \`\${outlineNode.id}-logic-0\`,
        outlineNodeId: outlineNode.id,
        purpose: outlineNode.objective || \`撰写\${outlineNode.title}\`,
        transition: '承接上文',
        targetWords: outlineNode.targetWords || 500,
        order: 0,
        status: 'confirmed',
      },
    ]
  },

  async suggestRewrite(block, feedback) {
    return {
      blockId: block.id,
      direction: feedback?.direction || 'improve',
      suggestions: ['检查内容完整性', '优化逻辑衔接', '确保格式规范'],
    }
  },
}
`
  await writeFile(path.join(outputDir, 'src', 'logic.js'), logicCode, 'utf8')

  // Write evidence plugin
  const evidenceCode = `/**
 * ${name} Evidence Plugin
 * Auto-generated. Customize citation format and evidence evaluation.
 */

export const ${symbolName}Evidence = {
  id: '${taskType}-evidence',
  name: '${name} Evidence',
  taskType: '${taskType}',
  description: 'Citation and evidence mechanism for ${taskType}',
  citationStyle: '${scaffold.evidence.citationStyle}',

  async formatCitation(source, style = '${scaffold.evidence.citationStyle}') {
    const authors = (source.authors || []).slice(0, 3).join(', ')
    return \`\${authors}\${(source.authors || []).length > 3 ? ', et al' : ''}. \${source.title}. \${source.venue || ''}, \${source.year || ''}\`
  },

  async evaluateEvidence(block, bindings = []) {
    const issues = []
    if (/\\[(待补充|TODO)\\]/i.test(block.markdown || '')) {
      issues.push({ severity: 'blocking', code: 'PLACEHOLDER', message: '存在未填充的占位符' })
    }
    return { sufficient: issues.length === 0, missingEvidence: issues, confidence: issues.length ? 0.5 : 1.0, issues }
  },

  async buildReferenceList(literature = [], style = '${scaffold.evidence.citationStyle}') {
    return Promise.all(literature.map(async (item, i) => ({
      index: i + 1, citationKey: item.citationKey || \`ref-\${i + 1}\`,
      text: await this.formatCitation(item, style),
    })))
  },
}
`
  await writeFile(path.join(outputDir, 'src', 'evidence.js'), evidenceCode, 'utf8')

  const materialCode = `/** Generic material boundary for ${name}. Customize parsing outside the shared runtime. */
export const ${symbolName}Material = {
  id: '${taskType}-material', name: '${name} Materials', taskType: '${taskType}',
  supportedTypes: ${JSON.stringify(options.materialTypes || ['text', 'pdf', 'docx', 'image'])},
  async normalizeMaterial(input) {
    if (!this.supportedTypes.includes(input.type)) throw new Error(\`Unsupported material type: \${input.type}\`)
    return { name: String(input.name || '').trim(), type: input.type, uri: String(input.uri || ''), metadata: input.metadata || {} }
  },
}
`
  await writeFile(path.join(outputDir, 'src', 'material.js'), materialCode, 'utf8')

  // Write a DSH entry point.  Installing this package activates registration
  // in the already-installed workbench-core process.
  const indexCode = `/**
 * ${name} Plugin Bundle
 * Auto-generated by dsh-workbench-core.
 *
 * Installation:
 *   1. cd ${outputDir}
 *   2. npm install
 *   3. dsh plugin --profile web add .
 *   4. Restart DSH
 */

import { registerPluginBundle, createPluginBundleFromSpec } from 'dsh-workbench-core/core'
import manifest from '../plugin.manifest.json' with { type: 'json' }
import spec from '../plugin-spec.json' with { type: 'json' }

const bundle = createPluginBundleFromSpec(spec)

export function register${symbolName.charAt(0).toUpperCase() + symbolName.slice(1)}Plugins() {
  return registerPluginBundle({ manifest, ...bundle })
}

// DSH calls apply() when it activates an installed package.
export async function apply() { return register${symbolName.charAt(0).toUpperCase() + symbolName.slice(1)}Plugins() }

export { bundle, spec }
`
  await writeFile(path.join(outputDir, 'src', 'index.js'), indexCode, 'utf8')

  // Write README
  const readme = `# ${name}

> Auto-generated by dsh-workbench-core plugin generator.
> Task type: ${taskType}
> Generated at: ${new Date().toISOString()}

## 安装

\`\`\`bash
cd ${outputDir}
npm install
dsh plugin --profile web add .
# 重启 DSH
\`\`\`

## 使用

在 DSH 对话中创建项目时指定 taskType 为 \`${taskType}\`：

\`\`\`
用户: 创建一个${name}项目
DSH: wb_create_project({ name: "...", taskType: "${taskType}" })
\`\`\`

## 自定义

- \`src/framework.js\`: 修改大纲模板、状态机、校验规则
- \`src/logic.js\`: 修改写作逻辑、重写建议
- \`src/evidence.js\`: 修改引用格式、证据评估

## 插件结构

\`\`\`
${outputDir}/
├── package.json
├── plugin.manifest.json       # validated plugin identity / UI capabilities
├── plugin-spec.json           # LLM-generated, user-reviewable domain specification
├── cordis.patch.yml
├── README.md
└── src/
    ├── index.js       # 插件入口
    ├── framework.js   # 框架插件（大纲/状态机）
    ├── logic.js       # 逻辑插件（写作逻辑）
    ├── evidence.js    # 凭证插件（引用/证据）
    └── material.js    # 多模态材料边界
\`\`\`
`
  await writeFile(path.join(outputDir, 'README.md'), readme, 'utf8')

  const verification = await verifyGeneratedPluginBundle(outputDir)
  if (!verification.valid) throw new Error(`Generated plugin verification failed: ${verification.issues.join('; ')}`)

  return {
    taskType,
    name,
    outputDir,
    files: ['package.json', 'plugin.manifest.json', 'plugin-spec.json', 'cordis.patch.yml', 'README.md', 'scripts/verify.mjs', 'src/index.js', 'src/framework.js', 'src/logic.js', 'src/evidence.js', 'src/material.js'],
    scaffold,
    verification,
    installationGuide: `cd ${outputDir} && npm install && dsh plugin --profile web add . && 重启 DSH`,
  }
}
