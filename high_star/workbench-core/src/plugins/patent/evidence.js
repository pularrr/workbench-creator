/**
 * Patent Evidence Plugin — defines citation and evidence mechanism for patent applications.
 * Handles prior art citations, patent references, and enablement evidence.
 */

export const patentEvidence = {
  id: 'patent-evidence',
  name: '专利凭证机制',
  taskType: 'patent',
  description: '专利申请的现有技术引用、对比文件、法律状态和充分公开证据评估。',
  citationStyle: 'patent-citation',

  async formatCitation(source, style = 'patent-citation') {
    if (source.type === 'patent') {
      const country = source.country || 'CN'
      const patentNumber = source.patentNumber || source.number || ''
      const kind = source.kind || 'A'
      const date = source.date || source.publicationDate || ''
      const assignee = source.assignee || source.applicant || ''
      return `${country}${patentNumber}${kind} ${assignee}. ${source.title || ''}. ${date}`.trim()
    }
    if (source.type === 'journal' || source.type === 'paper') {
      const authors = (source.authors || []).slice(0, 3).join(', ')
      return `${authors}${(source.authors || []).length > 3 ? ', et al' : ''}. ${source.title}. ${source.journal || source.venue || ''}, ${source.year || ''}`
    }
    return `${source.title || source.citationKey || 'Unknown reference'}${source.year ? ` (${source.year})` : ''}`
  },

  async evaluateEvidence(block, bindings = []) {
    const issues = []
    let confidence = 1.0
    if (block.id?.includes('sec5') || block.title?.includes('具体实施')) {
      const wordCount = (block.markdown || '').length
      if (wordCount < 500) {
        issues.push({ severity: 'blocking', code: 'INSUFFICIENT_ENABLEMENT', message: '具体实施方式内容不足，可能无法满足充分公开要求' })
        confidence -= 0.3
      }
    }
    if (block.id?.includes('sec6') || block.title?.includes('权利要求')) {
      const text = block.markdown || ''
      if (!text.includes('1.') && !text.includes('根据权利要求')) {
        issues.push({ severity: 'warning', code: 'CLAIMS_STRUCTURE', message: '权利要求书应包含独立权利要求（序号1）和从属权利要求' })
        confidence -= 0.1
      }
    }
    if (block.id?.includes('sec2') || block.title?.includes('背景')) {
      const citationCount = (block.markdown || '').match(/\[|CN\d+|US\d+/g)?.length || 0
      if (citationCount === 0) {
        issues.push({ severity: 'warning', code: 'NO_PRIOR_ART', message: '背景技术应引证现有技术文件（专利号/文献）' })
        confidence -= 0.1
      }
    }
    if (/\[(待补充|TODO|待确认)\]/i.test(block.markdown || '')) {
      issues.push({ severity: 'blocking', code: 'PLACEHOLDER', message: '存在未填充的占位符' })
      confidence -= 0.2
    }
    return {
      sufficient: issues.every((i) => i.severity !== 'blocking'),
      missingEvidence: issues.filter((i) => i.severity === 'blocking'),
      confidence: Math.max(0, confidence),
      issues,
    }
  },

  async buildReferenceList(literature = [], style = 'patent-citation') {
    return Promise.all(
      literature.map(async (item, index) => ({
        index: index + 1,
        citationKey: item.citationKey || `ref-${index + 1}`,
        text: await this.formatCitation(item, style),
      }))
    )
  },
}
