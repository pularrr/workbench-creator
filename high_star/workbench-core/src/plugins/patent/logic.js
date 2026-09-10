/**
 * Patent Logic Plugin — defines writing logic per section for patent applications.
 */

export const patentLogic = {
  id: 'patent-logic',
  name: '专利撰写逻辑',
  taskType: 'patent',
  description: '专利申请各章节的写作目标、承接关系和专利法合规指导。',
  styleDimensions: ['clarity', 'brevity', 'enablement', 'claim_scope'],

  async generateLogic(outlineNode, context = {}) {
    const sectionId = outlineNode.id
    const logicTemplates = {
      sec1: [
        { purpose: '明确技术领域：应是发明或实用新型所属或直接应用的具体技术领域，不是上位的相邻领域', transition: '开门见山' },
      ],
      sec2: [
        { purpose: '描述现有技术：客观描述与本发明最接近的现有技术方案', transition: '从技术领域引入现有技术' },
        { purpose: '指出现有技术缺陷：客观分析现有技术存在的问题和不足', transition: '通过缺陷引出本发明的必要性' },
      ],
      sec3: [
        { purpose: '技术问题：明确本发明要解决的技术问题', transition: '承接背景技术的缺陷' },
        { purpose: '技术方案：完整描述解决技术问题的技术方案，包括必要技术特征', transition: '从问题到方案' },
        { purpose: '有益效果：对照现有技术说明本发明的有益效果，最好有数据支撑', transition: '突出发明价值' },
      ],
      sec4: [
        { purpose: '附图清单：逐一列出各幅附图的图名和简要说明', transition: '为具体实施方式做铺垫' },
      ],
      sec5: [
        { purpose: '优选实施例：详细描述实现本发明的优选方式，对照附图说明', transition: '从技术方案到具体实现' },
        { purpose: '替代实施例：如有必要，描述替代实施方式', transition: '扩大保护范围' },
        { purpose: '实验验证：如有实验数据，描述实验方法和结果', transition: '支撑有益效果' },
      ],
      sec6: [
        { purpose: '独立权利要求：从整体上反映发明的技术方案，记载解决技术问题的必要技术特征', transition: '核心保护范围' },
        { purpose: '从属权利要求：用附加技术特征对引用的权利要求作进一步限定', transition: '层层限定，形成保护梯度' },
      ],
      sec7: [
        { purpose: '摘要撰写：简明扼要地说明技术方案要点和主要用途', transition: '全文概括' },
      ],
    }

    const templates = logicTemplates[sectionId] || [
      { purpose: outlineNode.objective || `撰写${outlineNode.title}`, transition: '承接上文' },
    ]

    return templates.map((t, i) => ({
      id: `${sectionId}-logic-${i}`,
      outlineNodeId: sectionId,
      purpose: t.purpose,
      transition: t.transition,
      targetWords: Math.round((outlineNode.targetWords || 500) / templates.length),
      order: i,
      status: 'confirmed',
    }))
  },

  async suggestRewrite(block, feedback) {
    return {
      blockId: block.id,
      direction: feedback?.direction || 'improve_clarity',
      suggestions: [
        '检查权利要求是否以说明书为依据',
        '确保技术方案完整、能够实现',
        '优化独立权利要求的保护范围',
        '检查是否符合专利法实施细则格式要求',
      ],
    }
  },
}
