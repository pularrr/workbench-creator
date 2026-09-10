/** Material adapter for patent drafting and prior-art work. */
const classify = (name = '') => {
  const value = name.toLowerCase()
  if (/交底|disclosure|技术方案/.test(value)) return 'technical-disclosure'
  if (/现有技术|prior.art|专利|patent/.test(value)) return 'prior-art'
  if (/图|draw|figure|image/.test(value)) return 'drawing'
  if (/claim|权利要求/.test(value)) return 'claim-draft'
  return 'supporting-material'
}

export const patentMaterial = {
  id: 'patent-material', name: '专利材料适配器', taskType: 'patent',
  supportedTypes: ['text', 'pdf', 'docx', 'pptx', 'xlsx', 'image', 'binary'],
  async normalizeMaterial(input) {
    if (!this.supportedTypes.includes(input.type)) throw new Error(`Unsupported patent material type: ${input.type}`)
    return { ...input, metadata: { ...(input.metadata || {}), materialRole: classify(input.name) } }
  },
  async analyzeMaterial(material) {
    const role = material.metadata?.materialRole || 'supporting-material'
    const prompts = {
      'technical-disclosure': '用于核对技术问题、技术特征和实施方式。',
      'prior-art': '用于背景技术和新颖性/创造性对比；结论须由人工确认。',
      drawing: '用于生成附图说明，并核对附图标记一致性。',
      'claim-draft': '用于核对独立、从属权利要求与说明书支持关系。',
    }
    return { summary: (material.extractedText || `${material.name} (${material.type})`).replace(/\s+/g, ' ').slice(0, 500), suggestedEvidenceUse: prompts[role] || '用于补充技术方案的事实依据。' }
  },
}
