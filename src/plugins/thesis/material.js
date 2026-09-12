/** Material adapter for evidence-aware academic writing. */
const classify = (name = '') => {
  const value = name.toLowerCase()
  if (/paper|论文|文献|reference|journal/.test(value)) return 'literature'
  if (/dataset|数据|实验|测量|measurement/.test(value)) return 'experiment-data'
  if (/figure|图|image|照片|drawing/.test(value)) return 'figure'
  if (/template|模板/.test(value)) return 'template-reference'
  return 'supporting-material'
}

export const thesisMaterial = {
  id: 'thesis-material', name: '论文材料适配器', taskType: 'thesis',
  supportedTypes: ['text', 'code', 'pdf', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'rtf', 'html', 'epub', 'image', 'binary'],
  async normalizeMaterial(input) {
    if (!this.supportedTypes.includes(input.type)) throw new Error(`Unsupported thesis material type: ${input.type}`)
    return { ...input, metadata: { ...(input.metadata || {}), materialRole: classify(input.name) } }
  },
  async analyzeMaterial(material) {
    const text = material.extractedText || ''
    return {
      summary: text ? text.replace(/\s+/g, ' ').slice(0, 500) : `${material.name} (${material.type})`,
      suggestedEvidenceUse: material.metadata?.materialRole === 'literature' ? '可作为文献/引用候选，需人工核验书目信息。' : material.metadata?.materialRole === 'template-reference' ? '仅作为结构与写作风格参考，不得作为事实证据或进入 RAG 引用。' : '可作为章节论述或实验结果的来源材料。',
    }
  },
}
