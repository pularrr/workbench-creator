/**
 * Thesis Evidence Plugin — defines citation and evidence mechanism for academic thesis.
 * Migrated from dsh-thesis-agent v1.2.0 citation-engine.
 */

const GB_T_7714_TYPES = {
  journal: 'J',
  conference: 'C',
  book: 'M',
  thesis: 'D',
  report: 'R',
  standard: 'S',
  patent: 'P',
  webpage: 'EB/OL',
}

export const thesisEvidence = {
  id: 'thesis-evidence',
  name: '学位论文凭证机制',
  taskType: 'thesis',
  description: '学术论文的引用格式（GB/T 7714）、来源绑定、证据评估和参考文献生成。',
  citationStyle: 'gb-t-7714',

  async formatCitation(source, style = 'gb-t-7714') {
    const authors = (source.authors || []).slice(0, 3).map((a) => a).join(', ')
    const more = (source.authors || []).length > 3 ? ', 等' : ''
    const type = GB_T_7714_TYPES[source.type] || 'J'
    const year = source.year || ''
    const venue = source.venue || source.journal || ''
    const volume = source.volume ? `, ${source.volume}` : ''
    const issue = source.issue ? `(${source.issue})` : ''
    const pages = source.pages ? `: ${source.pages}` : ''
    const doi = source.doi ? `. DOI: ${source.doi}` : ''

    if (style === 'ieee') {
      return `${authors}${more}, "${source.title}," ${venue}${volume}${issue}${pages}, ${year}${doi}.`
    }
    return `${authors}${more}. ${source.title}[${type}]. ${venue}${volume}${issue}${pages}, ${year}${doi}.`
  },

  async evaluateEvidence(block, bindings = []) {
    const issues = []
    let confidence = 1.0
    if (block.bindingStatus && block.bindingStatus !== 'linked') {
      issues.push({ severity: 'blocking', code: 'LOGIC_BINDING_INVALID', message: '行文逻辑绑定无效' })
      confidence -= 0.3
    }
    if (/\[(待补充|TODO|待确认)\]/i.test(block.markdown || '')) {
      issues.push({ severity: 'blocking', code: 'PLACEHOLDER', message: '存在未填充的占位符' })
      confidence -= 0.2
    }
    const citationCount = (block.markdown || '').match(/\[\d+\]/g)?.length || 0
    const wordCount = (block.markdown || '').length
    if (wordCount > 500 && citationCount === 0) {
      issues.push({ severity: 'warning', code: 'NO_CITATIONS', message: '段落超过500字但无引用' })
      confidence -= 0.1
    }
    const staleCount = bindings.filter((b) => b.status === 'stale').length
    if (staleCount > 0) {
      issues.push({ severity: 'blocking', code: 'SOURCE_STALE', message: `${staleCount} 个来源绑定已过期` })
      confidence -= 0.2
    }
    return {
      sufficient: issues.every((i) => i.severity !== 'blocking'),
      missingEvidence: issues.filter((i) => i.severity === 'blocking'),
      confidence: Math.max(0, confidence),
      issues,
    }
  },

  async buildReferenceList(literature = [], style = 'gb-t-7714') {
    return Promise.all(
      literature.map(async (item, index) => ({
        index: index + 1,
        citationKey: item.citationKey || `ref-${index + 1}`,
        text: await this.formatCitation(item, style),
      }))
    )
  },
}
