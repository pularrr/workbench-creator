/**
 * Patent Framework Plugin — defines the text skeleton and state machine
 * for patent application writing (发明专利/实用新型).
 *
 * First non-thesis task type to validate the pluggable framework.
 */

const PATENT_STATE_TABLE = {
  created: { start: 'planning' },
  planning: { plan_ready: 'awaiting_plan_confirmation' },
  awaiting_plan_confirmation: { plan_confirmed: 'prior_art_search', plan_rejected: 'cancelled' },
  prior_art_search: { search_completed: 'evaluating_patentability', fail: 'failed' },
  evaluating_patentability: { patentable: 'drafting', not_patentable: 'needs_user_material', fail: 'failed' },
  drafting: { draft_completed: 'validating', fail: 'failed' },
  validating: { validation_passed: 'reviewing', validation_failed: 'drafting' },
  reviewing: { review_completed: 'awaiting_user_decision', fail: 'failed' },
  awaiting_user_decision: { user_accepted: 'applying', user_requested_revision: 'drafting', user_rejected: 'cancelled' },
  applying: { apply_completed: 'completed', fail: 'failed' },
}

const DEFAULT_PATENT_OUTLINE = [
  { id: 'sec1', title: '技术领域', objective: '写明发明或实用新型所属或直接应用的技术领域', targetWords: 200, expectedFigures: 0, expectedTables: 0, expectedMedia: '' },
  { id: 'sec2', title: '背景技术', objective: '写明对发明或实用新型的理解、检索、审查有用的背景技术，有可能的话，并引证反映这些背景技术的文件', targetWords: 800, expectedFigures: 1, expectedTables: 0, expectedMedia: '现有技术示意图' },
  { id: 'sec3', title: '发明内容', objective: '写明发明或实用新型所要解决的技术问题以及解决其技术问题采用的技术方案，并对照现有技术写明发明或实用新型的有益效果', targetWords: 1500, expectedFigures: 2, expectedTables: 1, expectedMedia: '技术方案流程图、效果对比表' },
  { id: 'sec4', title: '附图说明', objective: '写明各幅附图的图名，并且对图示的内容作简要说明', targetWords: 300, expectedFigures: 0, expectedTables: 0, expectedMedia: '附图清单' },
  { id: 'sec5', title: '具体实施方式', objective: '详细写明申请人认为实现发明或实用新型的优选方式；必要时，举例说明；有附图的，对照附图', targetWords: 3000, expectedFigures: 5, expectedTables: 2, expectedMedia: '实施例附图、实验数据表格' },
  { id: 'sec6', title: '权利要求书', objective: '以说明书为依据，清楚、简要地限定要求专利保护的范围；包括独立权利要求和从属权利要求', targetWords: 1500, expectedFigures: 0, expectedTables: 0, expectedMedia: '权利要求结构' },
  { id: 'sec7', title: '说明书摘要', objective: '写明发明或实用新型的名称和所属技术领域，清楚地反映所要解决的技术问题、解决该问题的技术方案的要点以及主要用途', targetWords: 300, expectedFigures: 0, expectedTables: 0, expectedMedia: '' },
]

export const patentFramework = {
  id: 'patent-framework',
  name: '专利撰写框架',
  taskType: 'patent',
  description: '发明专利/实用新型专利申请文件的大纲结构和状态机。包含技术领域、背景技术、发明内容、附图说明、具体实施方式、权利要求书、说明书摘要等标准章节。',
  stateTable: PATENT_STATE_TABLE,
  defaultSkipStages: ['planning', 'awaiting_plan_confirmation'],
  outlineNodeSchema: {
    id: 'string',
    title: 'string (章节标题，如"权利要求书")',
    objective: 'string (章节写作目标，需符合专利法实施细则要求)',
    targetWords: 'number',
    expectedFigures: 'number',
    expectedTables: 'number',
    expectedMedia: 'string',
  },
  ui: { outlineLabel: '专利结构', logicLabel: '权利要求与行文逻辑', evidenceLabel: '现有技术与凭证', editorLabel: '专利申请文本' },
  projectFieldSchema: {
    patentType: { label: '专利类型', type: 'select', options: ['invention', 'utility_model'] },
    applicant: { label: '申请人', type: 'text' },
    inventors: { label: '发明人', type: 'text' },
  },

  async generateOutline(input = {}) {
    const patentType = input.patentType || 'invention' // invention | utility_model
    return DEFAULT_PATENT_OUTLINE.map((node, i) => ({
      ...node,
      id: input.prefix ? `${input.prefix}-${node.id}` : node.id,
      order: i,
      targetWords: patentType === 'utility_model' ? Math.round(node.targetWords * 0.7) : node.targetWords,
    }))
  },

  async validateOutline(outline) {
    const issues = []
    const requiredSections = ['技术领域', '背景技术', '发明内容', '附图说明', '具体实施方式', '权利要求书']
    const titles = (outline || []).map((n) => n.title)
    for (const req of requiredSections) {
      if (!titles.some((t) => t.includes(req))) {
        issues.push({ severity: 'blocking', code: 'MISSING_REQUIRED_SECTION', message: `缺少必要章节：${req}` })
      }
    }
    // Check claims section exists
    const claims = outline?.find((n) => n.title.includes('权利要求'))
    if (claims && !claims.objective?.includes('独立权利要求')) {
      issues.push({ severity: 'warning', code: 'CLAIMS_STRUCTURE', message: '权利要求书应包含独立权利要求和从属权利要求' })
    }
    return { valid: issues.every((i) => i.severity !== 'blocking'), issues }
  },
}
