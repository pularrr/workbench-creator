const sections = [
  {
    title: '绪论',
    ratio: 0.1,
    objective: '说明研究背景、意义、问题、研究内容与论文组织。',
    logic: ['从应用或学术背景引出问题', '说明研究意义和现实价值', '界定研究问题与目标', '概括研究内容、方法与创新点', '说明论文结构安排'],
  },
  {
    title: '国内外研究现状与相关工作',
    ratio: 0.16,
    objective: '系统比较现有工作，识别不足并引出本文切入点。',
    logic: ['界定研究范围和评价维度', '按技术路线或观点分类代表性工作', '横向比较同类方法的能力、代价和适用场景', '纵向梳理关键技术或观点的演进', '总结现有工作的不足、争议和证据缺口', '说明本文与现有工作的关系及研究切入点'],
  },
  {
    title: '理论基础与关键技术',
    ratio: 0.1,
    objective: '解释后续方法和系统设计所依赖的概念、模型与技术。',
    logic: ['定义核心术语与符号', '说明关键理论或算法原理', '比较可选技术并解释选型', '建立理论基础与本文方案的对应关系'],
  },
  {
    title: '问题分析与需求设计',
    ratio: 0.1,
    objective: '将研究问题转化为明确需求、约束和评价目标。',
    logic: ['描述研究对象和使用场景', '分析现有流程及关键痛点', '提出功能需求和非功能需求', '说明约束、假设和验收指标'],
  },
  {
    title: '方法或系统总体设计',
    ratio: 0.16,
    objective: '给出总体方案、模块关系、数据流和核心方法。',
    logic: ['提出总体设计目标和原则', '说明系统架构或方法框架', '解释模块职责与交互关系', '详细说明核心算法或处理流程', '分析关键设计选择及其合理性'],
  },
  {
    title: '系统实现或方法实现',
    ratio: 0.12,
    objective: '说明关键模块、算法和工程实现如何落地。',
    logic: ['交代开发与运行环境', '按模块说明实现过程', '解释关键数据结构、接口和算法', '说明异常、性能和一致性处理', '总结实现与设计目标的对应关系'],
  },
  {
    title: '实验设计、结果与讨论',
    ratio: 0.2,
    objective: '用可复现的实验验证方案效果并讨论边界。',
    logic: ['提出实验问题和评价假设', '说明数据集、环境、参数与对比基线', '定义评价指标和实验步骤', '客观呈现主要结果', '进行横向对比、消融或敏感性分析', '解释结果原因、异常与限制', '总结实验结论和适用边界'],
  },
  {
    title: '总结与展望',
    ratio: 0.06,
    objective: '总结研究贡献、限制和后续工作。',
    logic: ['回顾研究问题和主要工作', '概括核心结果和贡献', '诚实说明局限性', '提出有依据的后续研究方向'],
  },
]

export function createMasterThesisTemplate(targetWords = 30000) {
  const total = Math.max(0, Math.round(targetWords || 30000))
  return sections.map((section) => {
    const sectionWords = Math.round(total * section.ratio)
    const logicWords = Math.floor(sectionWords / section.logic.length)
    return {
      title: section.title,
      objective: section.objective,
      targetWords: sectionWords,
      locked: false,
      logic: section.logic.map((purpose, index) => ({
        purpose,
        transition: index === 0 ? '' : '承接上一论证动作并推进本节目标。',
        targetWords: index === section.logic.length - 1
          ? sectionWords - logicWords * (section.logic.length - 1)
          : logicWords,
      })),
    }
  })
}
