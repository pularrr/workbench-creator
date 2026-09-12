/**
 * Declarative domain specification.  A Plugin Spec is the source of truth for
 * a generated workbench; generated JavaScript only loads this JSON and wires
 * it into the generic runtime.
 */
const identifier = /^[a-z][a-z0-9-]*$/

const DEFAULT_STATE_TABLE = {
  created: { start: 'planning' }, planning: { plan_ready: 'awaiting_confirmation' },
  awaiting_confirmation: { confirmed: 'drafting', rejected: 'cancelled' },
  drafting: { draft_ready: 'validating', fail: 'failed' }, validating: { passed: 'reviewing', failed: 'drafting' },
  reviewing: { accepted: 'completed', revise: 'drafting', rejected: 'cancelled' },
}

/** Create an editable JSON draft; callers may replace every default. */
export function createPluginSpecDraft(input = {}) {
  const taskType = String(input.taskType || 'generic-workbench').toLowerCase().trim()
  return {
    taskType, name: input.name || '新文本工作台', description: input.description || '', version: '1.0.0',
    ui: { outlineLabel: '文档结构', logicLabel: '生成逻辑', evidenceLabel: '内容凭证', editorLabel: '正文', ...(input.ui || {}) },
    documentSchema: { fields: input.fields || {}, sections: input.sections || [
      { id: 'overview', title: '概述', objective: '说明任务背景和目标', weight: 1 },
      { id: 'body', title: '主体内容', objective: '完成核心文本', weight: 7 },
      { id: 'conclusion', title: '结论', objective: '总结结论和后续事项', weight: 2 },
    ] },
    workflow: { stateTable: input.stateTable || DEFAULT_STATE_TABLE, defaultSkipStages: input.defaultSkipStages || ['planning', 'awaiting_confirmation'] },
    logic: { styleDimensions: input.styleDimensions || ['clarity', 'completeness', 'consistency'], rules: input.logicRules || [], rewriteSuggestions: input.rewriteSuggestions || [] },
    evidence: { citationStyle: input.citationStyle || 'generic', requiredPatterns: input.requiredEvidencePatterns || [] },
    materialSchema: { supportedTypes: input.materialTypes || ['text', 'pdf', 'docx', 'image'], roles: input.materialRoles || [], roleGuidance: input.roleGuidance || {}, defaultGuidance: input.defaultMaterialGuidance || '' },
    templates: input.templates || [],
  }
}

export function validatePluginSpec(spec) {
  const issues = []
  if (!spec || typeof spec !== 'object') issues.push('spec must be an object')
  if (!identifier.test(spec?.taskType || '')) issues.push('taskType must be a kebab-case identifier')
  if (typeof spec?.name !== 'string' || !spec.name.trim()) issues.push('name is required')
  if (!Array.isArray(spec?.documentSchema?.sections) || !spec.documentSchema.sections.length) issues.push('documentSchema.sections must contain at least one section')
  for (const section of spec?.documentSchema?.sections || []) {
    if (!section.id || !section.title) issues.push('every document section requires id and title')
  }
  if (!spec?.workflow?.stateTable || typeof spec.workflow.stateTable !== 'object') issues.push('workflow.stateTable is required')
  if (!Array.isArray(spec?.materialSchema?.supportedTypes)) issues.push('materialSchema.supportedTypes is required')
  return { valid: issues.length === 0, issues }
}

export function createPluginBundleFromSpec(spec) {
  const validation = validatePluginSpec(spec)
  if (!validation.valid) throw new Error(`Invalid Plugin Spec: ${validation.issues.join('; ')}`)
  const taskType = spec.taskType
  const sections = spec.documentSchema.sections
  const styleDimensions = spec.logic?.styleDimensions || ['clarity', 'completeness', 'consistency']
  const fieldSchema = spec.documentSchema.fields || {}
  const framework = {
    id: `${taskType}-framework`, name: `${spec.name} Framework`, taskType,
    description: spec.description || '', stateTable: spec.workflow.stateTable,
    defaultSkipStages: spec.workflow.defaultSkipStages || [], outlineNodeSchema: spec.documentSchema.outlineNodeSchema || {},
    ui: spec.ui || {}, projectFieldSchema: fieldSchema,
    async generateOutline(input = {}) {
      const requestedWords = input.targetWords || 0
      const totalWeight = sections.reduce((sum, section) => sum + (section.weight || 1), 0)
      return sections.map((section, index) => ({
        id: section.id, title: section.title, objective: section.objective || '', order: index,
        targetWords: section.targetWords || (requestedWords ? Math.round(requestedWords * (section.weight || 1) / totalWeight) : 0),
        expectedFigures: section.expectedFigures || 0, expectedTables: section.expectedTables || 0,
        expectedMedia: section.expectedMedia || '', required: section.required !== false,
      }))
    },
    async validateOutline(outline) {
      const titles = new Set((outline || []).map((node) => node.title))
      const issues = sections.filter((section) => section.required !== false && !titles.has(section.title))
        .map((section) => ({ severity: 'blocking', code: 'MISSING_REQUIRED_SECTION', message: `缺少必要章节：${section.title}` }))
      return { valid: issues.length === 0, issues }
    },
  }
  const logic = {
    id: `${taskType}-logic`, name: `${spec.name} Logic`, taskType, description: spec.logic?.description || '', styleDimensions,
    async generateLogic(node) { return [{ id: `${node.id}-logic-0`, outlineNodeId: node.id, purpose: node.objective || `完成${node.title}`, transition: node.transition || '', targetWords: node.targetWords || 0, order: 0, status: 'confirmed', rules: spec.logic?.rules || [] }] },
    async suggestRewrite(block, feedback) { return { blockId: block.id, direction: feedback?.direction || 'improve', suggestions: spec.logic?.rewriteSuggestions || ['检查结构完整性与上下文衔接'] } },
  }
  const evidence = {
    id: `${taskType}-evidence`, name: `${spec.name} Evidence`, taskType, description: spec.evidence?.description || '', citationStyle: spec.evidence?.citationStyle || 'generic',
    async formatCitation(source) { return source.text || source.title || source.name || '' },
    async evaluateEvidence(block) { const missing = (spec.evidence?.requiredPatterns || []).filter((pattern) => !(new RegExp(pattern, 'i').test(block.markdown || ''))); return { sufficient: missing.length === 0, missingEvidence: missing, confidence: missing.length ? 0.5 : 1, issues: missing.map((item) => ({ severity: 'warning', code: 'MISSING_EVIDENCE_PATTERN', message: item })) } },
    async buildReferenceList(items = []) { return items.map((item, index) => ({ index: index + 1, text: item.text || item.title || item.name || '' })) },
  }
  const material = {
    id: `${taskType}-material`, name: `${spec.name} Materials`, taskType, supportedTypes: spec.materialSchema.supportedTypes,
    async normalizeMaterial(input) {
      if (!this.supportedTypes.includes(input.type)) throw new Error(`Unsupported material type: ${input.type}`)
      const role = (spec.materialSchema.roles || []).find((item) => new RegExp(item.namePattern || '^$', 'i').test(input.name || ''))?.id || 'supporting-material'
      return { ...input, metadata: { ...(input.metadata || {}), materialRole: role } }
    },
    async analyzeMaterial(input) { return { summary: (input.extractedText || `${input.name} (${input.type})`).replace(/\s+/g, ' ').slice(0, 500), suggestedEvidenceUse: spec.materialSchema.roleGuidance?.[input.metadata?.materialRole] || spec.materialSchema.defaultGuidance || '' } },
  }
  return { framework, logic, evidence, material }
}
