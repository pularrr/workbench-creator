/**
 * Plugin contract definitions and loader for the pluggable workbench framework.
 *
 * Three plugin layers:
 * - FrameworkPlugin: defines text skeleton (outline/structure), state machine table, expected media
 * - LogicPlugin: defines writing logic per block (purpose, transitions, style, rewrite suggestions)
 * - EvidencePlugin: defines citation/evidence mechanism (format, binding, evaluation, confidence)
 */

import { randomUUID } from 'node:crypto'

// ─── Plugin Contract Types ───────────────────────────────────────────────

/**
 * FrameworkPlugin contract — defines the text skeleton and task-type-specific state machine.
 * @typedef {Object} FrameworkPlugin
 * @property {string} id - Unique plugin ID (e.g. 'thesis-framework')
 * @property {string} name - Display name
 * @property {string} taskType - Task type this framework supports (e.g. 'thesis', 'patent')
 * @property {string} description - What this framework controls
 * @property {Object} stateTable - State machine definition: { state: { event: nextState } }
 * @property {string[]} defaultSkipStages - Stages to auto-skip in 'standard' mode
 * @property {Function} generateOutline - (input) => outline nodes array
 * @property {Function} validateOutline - (outline) => { valid, issues[] }
 * @property {Object} outlineNodeSchema - Expected fields per outline node
 */

/**
 * LogicPlugin contract — defines writing logic per text block.
 * @typedef {Object} LogicPlugin
 * @property {string} id - Unique plugin ID
 * @property {string} name - Display name
 * @property {string} taskType - Supported task type
 * @property {string} description - What this logic layer controls
 * @property {Function} generateLogic - (outlineNode, context) => logicBlock array
 * @property {Function} suggestRewrite - (block, feedback) => rewrite direction
 * @property {string[]} styleDimensions - Configurable style dimensions (e.g. ['academic_rigor', 'citation_density'])
 */

/**
 * EvidencePlugin contract — defines citation/evidence mechanism.
 * @typedef {Object} EvidencePlugin
 * @property {string} id - Unique plugin ID
 * @property {string} name - Display name
 * @property {string} taskType - Supported task type
 * @property {string} description - What this evidence layer controls
 * @property {string} citationStyle - Citation style key (e.g. 'gb-t-7714', 'ieee', 'patent-citation')
 * @property {Function} formatCitation - (source, style) => formatted citation string
 * @property {Function} evaluateEvidence - (block, bindings) => { sufficient, missingEvidence[], confidence }
 * @property {Function} buildReferenceList - (literature[]) => formatted reference entries
 */

// ─── Plugin Registry ──────────────────────────────────────────────────────

const builtinPlugins = {
  frameworks: [],
  logics: [],
  evidences: [],
  materials: [],
}
const exporters = []

const pluginBundles = new Map()
const MANIFEST_API_VERSION = 2

/**
 * Validate the declarative part of an external workbench plugin.  Runtime code
 * is registered separately; this makes a generated package inspectable before
 * it is allowed to affect the shared workbench registry.
 */
export function validatePluginManifest(manifest) {
  const issues = []
  if (!manifest || typeof manifest !== 'object') issues.push('manifest must be an object')
  if (!manifest?.id || !/^[a-z][a-z0-9-]*$/.test(manifest.id)) issues.push('id must be a kebab-case identifier')
  if (!manifest?.taskType || !/^[a-z][a-z0-9-]*$/.test(manifest.taskType)) issues.push('taskType must be a kebab-case identifier')
  if (!manifest?.name || typeof manifest.name !== 'string') issues.push('name is required')
  if (manifest?.apiVersion !== MANIFEST_API_VERSION) issues.push(`apiVersion must be ${MANIFEST_API_VERSION}`)
  if (!manifest?.entry || typeof manifest.entry !== 'string') issues.push('entry is required')
  if (manifest?.ui && typeof manifest.ui !== 'object') issues.push('ui must be an object')
  return { valid: issues.length === 0, issues }
}

/** Register an externally installed bundle after its manifest has passed validation. */
export function registerPluginBundle({ manifest, framework, logic, evidence, material = null, exporters: bundleExporters = [] }) {
  const validation = validatePluginManifest(manifest)
  if (!validation.valid) throw new Error(`Invalid plugin manifest: ${validation.issues.join('; ')}`)
  for (const [layer, plugin] of Object.entries({ framework, logic, evidence })) {
    if (!plugin) throw new Error(`Plugin bundle "${manifest.id}" is missing ${layer}`)
    if (plugin.taskType !== manifest.taskType) throw new Error(`${layer} taskType must match manifest.taskType`)
    registerPlugin(plugin, layer)
  }
  if (material) {
    if (material.taskType !== manifest.taskType) throw new Error('material taskType must match manifest.taskType')
    registerPlugin(material, 'material')
  }
  for (const exporter of bundleExporters) {
    if (exporter.taskType !== manifest.taskType) throw new Error(`exporter taskType must match manifest.taskType`)
    registerExporter(exporter)
  }
  pluginBundles.set(manifest.id, { manifest: structuredClone(manifest), material })
  return { id: manifest.id, taskType: manifest.taskType, version: manifest.version || '0.0.0' }
}

export function registerExporter(exporter) {
  if (!exporter?.id || !exporter?.format || !exporter?.taskType || typeof exporter.export !== 'function') {
    throw new Error('Invalid exporter: id, format, taskType and export() are required')
  }
  const existing = exporters.findIndex((item) => item.id === exporter.id)
  if (existing >= 0) exporters[existing] = exporter
  else exporters.push(exporter)
  return exporter
}

export function listExporters(taskType = null) {
  return taskType
    ? exporters.filter((item) => item.taskType === taskType || item.taskType === '*')
    : [...exporters]
}

export function resolveExporter(taskType, format) {
  return exporters.find((item) => item.taskType === taskType && item.format === format)
    || exporters.find((item) => item.taskType === '*' && item.format === format)
    || null
}

export function listPluginBundles() {
  return [...pluginBundles.values()].map(({ manifest, material }) => ({
    ...manifest,
    hasMaterialPlugin: Boolean(material),
  }))
}

export function getPluginBundleManifest(id) {
  return pluginBundles.get(id)?.manifest || null
}

export function registerPlugin(plugin, layer) {
  if (!plugin?.id || !plugin?.taskType) throw new Error(`Invalid ${layer} plugin: missing id or taskType`)
  const list = builtinPlugins[`${layer}s`]
  if (!list) throw new Error(`Unknown plugin layer: ${layer}`)
  const existing = list.findIndex((p) => p.id === plugin.id)
  if (existing >= 0) list[existing] = plugin
  else list.push(plugin)
  return plugin
}

export function listPlugins(layer, taskType = null) {
  const list = builtinPlugins[`${layer}s`] || []
  return taskType ? list.filter((p) => p.taskType === taskType) : [...list]
}

export function getPlugin(layer, id) {
  const list = builtinPlugins[`${layer}s`] || []
  return list.find((p) => p.id === id) || null
}

export function resolvePluginBundle(taskType) {
  /**
   * Resolve the complete Framework+Logic+Evidence bundle for a task type.
   * Returns the first matching plugin for each layer, or null if not found.
   */
  return {
    taskType,
    framework: listPlugins('framework', taskType)[0] || null,
    logic: listPlugins('logic', taskType)[0] || null,
    evidence: listPlugins('evidence', taskType)[0] || null,
    material: listPlugins('material', taskType)[0] || null,
    exporters: listExporters(taskType),
  }
}

export function listSupportedTaskTypes() {
  const types = new Set()
  for (const layer of ['frameworks', 'logics', 'evidences', 'materials']) {
    for (const p of builtinPlugins[layer]) types.add(p.taskType)
  }
  return [...types].sort()
}

// ─── Plugin Bundle (combines all three layers) ────────────────────────────

export function createPluginBundle(taskType, plugins = {}) {
  const bundle = resolvePluginBundle(taskType)
  if (plugins.framework) bundle.framework = plugins.framework
  if (plugins.logic) bundle.logic = plugins.logic
  if (plugins.evidence) bundle.evidence = plugins.evidence
  if (plugins.material) bundle.material = plugins.material
  if (!bundle.framework) throw new Error(`No Framework plugin found for task type: ${taskType}`)
  return bundle
}

export function generatePluginScaffold(taskType, options = {}) {
  /**
   * Generate a scaffold for a new task-type plugin bundle.
   * Used by the LLM plugin generator to produce starter code.
   */
  const id = `${taskType}-plugin`
  const name = options.name || `${taskType.charAt(0).toUpperCase() + taskType.slice(1)} Writing Workbench`
  return {
    taskType,
    id,
    name,
    description: options.description || `Auto-generated plugin bundle for ${taskType} text generation`,
    framework: {
      id: `${taskType}-framework`,
      name: `${name} Framework`,
      taskType,
      description: 'Text skeleton and outline structure',
      stateTable: options.stateTable || {
        created: { start: 'planning' },
        planning: { plan_ready: 'awaiting_plan_confirmation' },
        awaiting_plan_confirmation: { plan_confirmed: 'retrieving', plan_rejected: 'cancelled' },
        retrieving: { retrieval_completed: 'evaluating_evidence', fail: 'failed' },
        evaluating_evidence: { evidence_sufficient: 'drafting', evidence_insufficient: 'retrieving' },
        drafting: { draft_completed: 'validating', fail: 'failed' },
        validating: { validation_passed: 'reviewing', validation_failed: 'drafting' },
        reviewing: { review_completed: 'awaiting_user_decision', fail: 'failed' },
        awaiting_user_decision: { user_accepted: 'applying', user_requested_revision: 'drafting', user_rejected: 'cancelled' },
        applying: { apply_completed: 'completed', fail: 'failed' },
      },
      defaultSkipStages: options.defaultSkipStages || ['planning', 'awaiting_plan_confirmation'],
      outlineNodeSchema: {
        id: 'string', title: 'string', objective: 'string', targetWords: 'number',
        expectedFigures: 'number', expectedTables: 'number', expectedMedia: 'string',
      },
    },
    logic: {
      id: `${taskType}-logic`,
      name: `${name} Logic`,
      taskType,
      description: 'Writing logic and block-level guidance',
      styleDimensions: options.styleDimensions || ['clarity', 'completeness', 'consistency'],
    },
    evidence: {
      id: `${taskType}-evidence`,
      name: `${name} Evidence`,
      taskType,
      description: 'Citation and evidence mechanism',
      citationStyle: options.citationStyle || 'generic',
    },
    generatedAt: new Date().toISOString(),
    generatorVersion: 'workbench-core-0.1.0',
  }
}
