/**
 * Thesis Logic Plugin — defines writing logic per block for academic thesis.
 * Migrated from dsh-thesis-agent v1.2.0 logicBlocks.
 */

export const thesisLogic = {
  id: 'thesis-logic',
  name: '学位论文写作逻辑',
  taskType: 'thesis',
  description: '论文章节的写作目标、承接关系、论证链和学术风格指导。',
  styleDimensions: ['academic_rigor', 'citation_density', 'argument_chain', 'literature_coverage'],

  async generateLogic(outlineNode, context = {}) {
    const chapterId = outlineNode.id
    const basePurpose = outlineNode.objective || `撰写${outlineNode.title}章节`

    // Default logic blocks per chapter type
    const logicTemplates = {
      ch1: [
        { purpose: '研究背景与意义：阐述研究领域的重要性和现实需求', transition: '从宏观背景引入具体研究问题' },
        { purpose: '国内外研究现状：梳理相关领域的研究进展和不足', transition: '通过文献综述引出研究空白' },
        { purpose: '研究内容与方法：明确本文的研究目标、技术路线和创新点', transition: '承上启下，说明本文如何填补研究空白' },
        { purpose: '论文组织结构：概述各章节的主要内容和逻辑关系', transition: '引导读者进入后续章节' },
      ],
      ch2: [
        { purpose: '核心概念定义：明确本章涉及的关键术语和理论基础', transition: '从基本概念逐步深入' },
        { purpose: '理论原理推导：详细阐述相关理论的数学原理和物理意义', transition: '从理论推导到实际应用' },
        { purpose: '相关方法综述：比较现有方法的优缺点和适用场景', transition: '为后续方法选择提供依据' },
        { purpose: '本章小结：总结本章要点并引出下一章', transition: '承上启下' },
      ],
      ch3: [
        { purpose: '系统总体设计：描述系统架构和各模块功能', transition: '从整体到局部' },
        { purpose: '硬件/算法设计：详细描述核心模块的设计思路和实现细节', transition: '从设计到实现' },
        { purpose: '关键技术难点：分析实现过程中的技术挑战和解决方案', transition: '突出创新点' },
        { purpose: '实验方案设计：说明实验设置、数据采集和评估指标', transition: '为下一章实验结果做铺垫' },
      ],
      ch4: [
        { purpose: '实验数据与设置：描述实验数据来源、预处理和实验环境', transition: '从数据到结果' },
        { purpose: '主要实验结果：展示核心实验结果并进行初步分析', transition: '从结果到分析' },
        { purpose: '对比实验与分析：与现有方法进行定量对比，分析优劣', transition: '突出本文方法优势' },
        { purpose: '误差分析与讨论：分析实验误差来源和方法局限性', transition: '客观评价' },
      ],
      ch5: [
        { purpose: '研究结论：总结本文的主要研究成果和贡献', transition: '从具体到概括' },
        { purpose: '创新点总结：明确列出本文的创新之处', transition: '突出学术价值' },
        { purpose: '不足与局限：客观分析研究的局限性', transition: '从成果到不足' },
        { purpose: '未来工作展望：提出后续研究方向和改进思路', transition: '展望未来' },
      ],
    }

    const templates = logicTemplates[chapterId] || [
      { purpose: basePurpose, transition: '承接上文' },
      { purpose: `${outlineNode.title}的详细论述`, transition: '展开论述' },
      { purpose: '本章小结', transition: '承上启下' },
    ]

    return templates.map((t, i) => ({
      id: `${chapterId}-logic-${i}`,
      outlineNodeId: chapterId,
      purpose: t.purpose,
      transition: t.transition,
      targetWords: Math.round((outlineNode.targetWords || 5000) / templates.length),
      order: i,
      status: 'confirmed',
    }))
  },

  async suggestRewrite(block, feedback) {
    return {
      blockId: block.id,
      direction: feedback?.direction || 'improve_clarity',
      suggestions: [
        '检查论证链是否完整',
        '确保引用密度符合学术规范',
        '优化段落间的过渡衔接',
      ],
    }
  },
}
