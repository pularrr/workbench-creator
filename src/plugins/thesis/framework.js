/**
 * Thesis Framework Plugin — defines the text skeleton, state machine,
 * and outline structure for academic thesis writing.
 *
 * Migrated from dsh-thesis-agent v1.2.0.
 */

const THESIS_STATE_TABLE = {
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
}

const DEFAULT_THESIS_OUTLINE = [
  { id: 'ch1', title: '绪论', objective: '研究背景、意义、国内外研究现状、研究内容与方法、论文结构安排', targetWords: 6000, expectedFigures: 2, expectedTables: 1, expectedMedia: '研究框架图、技术路线图' },
  { id: 'ch2', title: '相关理论基础', objective: '毫米波雷达原理、介电常数与水分关系、信号处理方法、机器学习基础', targetWords: 8000, expectedFigures: 4, expectedTables: 2, expectedMedia: '雷达系统框图、介电常数模型公式' },
  { id: 'ch3', title: '系统设计与方法', objective: '硬件系统设计、信号处理流程、水分反演模型、实验方案设计', targetWords: 10000, expectedFigures: 6, expectedTables: 3, expectedMedia: '系统架构图、算法流程图、实验装置图' },
  { id: 'ch4', title: '实验结果与分析', objective: '数据采集、模型训练、对比实验、结果分析、误差讨论', targetWords: 10000, expectedFigures: 8, expectedTables: 5, expectedMedia: '实验结果图表、误差分析图、对比表格' },
  { id: 'ch5', title: '结论与展望', objective: '研究结论、创新点、不足与局限、未来工作展望', targetWords: 4000, expectedFigures: 0, expectedTables: 0, expectedMedia: '' },
]

export const thesisFramework = {
  id: 'thesis-framework',
  name: '学位论文框架',
  taskType: 'thesis',
  description: '学术学位论文的大纲结构、状态机和章节规划。支持硕士/博士论文，包含摘要、绪论、相关工作、方法、实验、结论、参考文献等标准章节。',
  stateTable: THESIS_STATE_TABLE,
  defaultSkipStages: ['planning', 'awaiting_plan_confirmation'],
  outlineNodeSchema: {
    id: 'string (UUID)',
    title: 'string (章节标题)',
    objective: 'string (章节写作目标)',
    targetWords: 'number (目标字数)',
    expectedFigures: 'number (预计图数量)',
    expectedTables: 'number (预计表数量)',
    expectedMedia: 'string (其他多模态需求描述)',
    order: 'number (章节顺序)',
    locked: 'boolean (是否锁定)',
  },
  ui: { outlineLabel: '论文大纲', logicLabel: '行文逻辑', evidenceLabel: '文献与证据', editorLabel: '论文正文' },
  projectFieldSchema: {
    degreeType: { label: '学位类型', type: 'select', options: ['bachelor', 'master', 'doctor'] },
    discipline: { label: '学科方向', type: 'text' },
    institution: { label: '学校/单位', type: 'text' },
  },

  async generateOutline(input = {}) {
    const targetWords = input.targetWords || 30000
    const degreeType = input.degreeType || 'master'
    const multiplier = degreeType === 'phd' ? 1.5 : 1
    return DEFAULT_THESIS_OUTLINE.map((node, i) => ({
      ...node,
      id: input.prefix ? `${input.prefix}-${node.id}` : node.id,
      targetWords: Math.round(node.targetWords * multiplier * (targetWords / 38000)),
      order: i,
    }))
  },

  async validateOutline(outline) {
    const issues = []
    if (!Array.isArray(outline) || outline.length === 0) {
      issues.push({ severity: 'blocking', code: 'EMPTY_OUTLINE', message: '大纲不能为空' })
      return { valid: false, issues }
    }
    for (let i = 0; i < outline.length; i++) {
      const node = outline[i]
      if (!node.title || !String(node.title).trim()) {
        issues.push({ severity: 'blocking', code: 'MISSING_TITLE', index: i, message: `第 ${i + 1} 章缺少标题` })
      }
      if (node.targetWords && node.targetWords < 500) {
        issues.push({ severity: 'warning', code: 'LOW_WORDCOUNT', index: i, message: `第 ${i + 1} 章目标字数过低 (${node.targetWords})` })
      }
    }
    const totalWords = outline.reduce((sum, n) => sum + (Number(n.targetWords) || 0), 0)
    if (totalWords > 0 && totalWords < 10000) {
      issues.push({ severity: 'warning', code: 'LOW_TOTAL_WORDS', message: `总目标字数过低 (${totalWords})，硕士论文通常不少于 3 万字` })
    }
    return { valid: issues.every((i) => i.severity !== 'blocking'), issues }
  },
}
