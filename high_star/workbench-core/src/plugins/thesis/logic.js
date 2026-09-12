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

    const logicTemplates = {
      'abstract-zh': [
        { purpose: '摘要四要素：研究问题、方法、主要结果和结论', transition: '压缩全文证据链，不新增事实' },
      ],
      'abstract-en': [
        { purpose: '英文摘要与关键词：保持与中文摘要的术语和结论一致', transition: '使用领域通用译法' },
      ],
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
        { purpose: '实验平台与对象：说明装置、样本或数据来源及边界条件', transition: '建立可复现实验前提' },
        { purpose: '采集与处理协议：描述采样、标定、预处理和质量控制', transition: '从原始数据到可用数据' },
        { purpose: '对比与评价设计：说明基线、指标、统计方法和超参数', transition: '为结果解读建立标准' },
        { purpose: '本章小结', transition: '引出结果分析' },
      ],
      ch5: [
        { purpose: '主要结果：呈现核心结果并标明图表、数据与统计证据', transition: '从结果到解释' },
        { purpose: '对比与消融：与基线比较并分析关键设计的贡献', transition: '解释方法有效性的边界' },
        { purpose: '误差、不确定度与局限：说明偏差来源和适用范围', transition: '避免超出证据的结论' },
        { purpose: '本章小结', transition: '引出结论' },
      ],
      ch6: [
        { purpose: '研究结论：逐项回扣研究问题与已验证结果', transition: '从证据到结论' },
        { purpose: '创新点与贡献：只总结前文已论证的贡献', transition: '突出价值但不夸大' },
        { purpose: '局限与展望：说明限制条件和可验证的后续方向', transition: '结束全文' },
      ],
      refs: [
        { purpose: '参考文献一致性核验：正文引用、书目元数据和格式一一对应', transition: '完成交付前核验' },
      ],
      ack: [
        { purpose: '致谢', transition: '全文结束' },
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
