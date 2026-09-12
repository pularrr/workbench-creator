/**
 * Thesis Framework Plugin — defines the text skeleton, state machine,
 * and outline structure for academic thesis writing.
 *
 * Built-in profile v2: evidence-aware Chinese degree thesis writing.
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
  { id: 'abstract-zh', title: '中文摘要', objective: '凝练研究问题、方法、主要结果与结论；不引入正文未出现的论断，并给出关键词。', targetWords: 800, expectedFigures: 0, expectedTables: 0, expectedMedia: '' },
  { id: 'abstract-en', title: 'Abstract', objective: '与中文摘要严格对应，采用领域通用英文术语并给出 Keywords。', targetWords: 600, expectedFigures: 0, expectedTables: 0, expectedMedia: '' },
  { id: 'ch1', title: '绪论', objective: '研究背景与意义、国内外研究现状（有述有评）、研究空白、研究内容与技术路线、论文结构安排。', targetWords: 4500, expectedFigures: 2, expectedTables: 1, expectedMedia: '研究框架图、技术路线图' },
  { id: 'ch2', title: '相关理论基础', objective: '核心概念、物理或数学原理、相关方法比较、评价指标与误差来源，为后续方法选择提供依据。', targetWords: 6000, expectedFigures: 4, expectedTables: 2, expectedMedia: '原理图、公式与方法比较表' },
  { id: 'ch3', title: '系统设计与实现', objective: '总体方案与指标分解、软硬件或算法设计、关键参数、标定流程和方法实现，给出可复现信息。', targetWords: 6500, expectedFigures: 4, expectedTables: 2, expectedMedia: '系统架构图、算法流程图、装置图' },
  { id: 'ch4', title: '实验方案与数据处理', objective: '实验平台、样本或数据来源、采集协议、预处理、对比设置、评价指标和统计方法。', targetWords: 4500, expectedFigures: 3, expectedTables: 3, expectedMedia: '实验流程图、数据集说明表' },
  { id: 'ch5', title: '实验结果与分析', objective: '结果呈现、与基线方法对比、消融或敏感性分析、误差与不确定度讨论，结论须与证据对应。', targetWords: 7000, expectedFigures: 8, expectedTables: 5, expectedMedia: '结果图表、误差分析图、对比表' },
  { id: 'ch6', title: '结论与展望', objective: '总结研究结论与创新点，说明局限与未来工作；不得超出前文证据。', targetWords: 2500, expectedFigures: 0, expectedTables: 0, expectedMedia: '' },
  { id: 'refs', title: '参考文献', objective: '按所选引用规范统一著录，并与正文引用点一一对应。', targetWords: 0, expectedFigures: 0, expectedTables: 0, expectedMedia: '' },
  { id: 'ack', title: '致谢', objective: '致谢。', targetWords: 300, expectedFigures: 0, expectedTables: 0, expectedMedia: '' },
]

export const thesisFramework = {
  id: 'thesis-framework',
  name: '学位论文框架 v2',
  taskType: 'thesis',
  version: '2.0.0',
  description: '证据优先的学术学位论文大纲、字段和状态机。包含双语摘要、绪论、理论、系统实现、实验方案、结果分析、结论、参考文献与致谢。',
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
    advisor: { label: '指导教师', type: 'text' },
    researchType: { label: '研究形态', type: 'select', options: ['theory', 'engineering', 'experimental'] },
    language: { label: '写作语言', type: 'select', options: ['zh', 'en'] },
    citationStyle: { label: '引用规范', type: 'select', options: ['gb-t-7714', 'ieee'] },
  },

  async generateOutline(input = {}) {
    const targetWords = input.targetWords || 30000
    const degreeType = input.degreeType || 'master'
    const multiplier = degreeType === 'doctor' ? 1.5 : degreeType === 'bachelor' ? 0.7 : 1
    return DEFAULT_THESIS_OUTLINE.map((node, i) => ({
      ...node,
      id: input.prefix ? `${input.prefix}-${node.id}` : node.id,
      targetWords: node.targetWords === 0 ? 0 : Math.round(node.targetWords * multiplier * (targetWords / 32700)),
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
    for (const expected of ['摘要', '绪论', '参考文献']) {
      if (!outline.some((node) => String(node.title || '').includes(expected))) {
        issues.push({ severity: 'warning', code: 'RECOMMENDED_SECTION_MISSING', message: `建议保留“${expected}”章节，或在项目模板中明确替代结构。` })
      }
    }
    return { valid: issues.every((i) => i.severity !== 'blocking'), issues }
  },
}
