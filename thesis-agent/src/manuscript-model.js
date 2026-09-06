function citationKey(item, used) {
  const author = String(item.authors?.[0] || 'ref').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'ref'
  const base = `${author}${item.year || 'nd'}`
  let key = base; let suffix = 1
  while (used.has(key)) key = `${base}${suffix++}`
  used.add(key); return key
}

export function buildManuscriptModel(project, formattedReferences = []) {
  const used = new Set()
  const literature = (project.literature || []).filter((item) => item.status === 'approved_for_citation').map((item) => ({ ...item, citationKey: citationKey(item, used) }))
  const keyById = new Map(literature.map((item) => [item.id, item.citationKey]))
  const citationsByBlock = new Map()
  for (const citation of project.citations || []) {
    if (citation.status === 'stale' || !keyById.has(citation.literatureId)) continue
    const values = citationsByBlock.get(citation.blockId) || []
    values.push({ ...citation, citationKey: keyById.get(citation.literatureId) }); citationsByBlock.set(citation.blockId, values)
  }
  return {
    title: project.title || project.name, name: project.name,
    blocks: [...project.manuscriptBlocks].sort((a, b) => a.order - b.order).map((block) => ({ ...block, citations: citationsByBlock.get(block.id) || [] })),
    literature, formattedReferences, template: project.exportTemplate || {},
  }
}
