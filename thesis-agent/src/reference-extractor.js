/**
 * Reference metadata extractor (P2 · v0.8).
 *
 * Extracts structured metadata from parsed academic document text:
 * title, authors, year, abstract, keywords, venue/journal, DOI,
 * citation count (if present), and section headings.
 *
 * Uses regex-based heuristics — no external LLM dependency.
 * All returned values are lossless-JSON safe (no undefined, NaN).
 */

const FINITE = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

/**
 * Extract title from document text.
 * Heuristic: first non-empty line that is not an author/affiliation line,
 * or text between "Title:" marker and next line.
 */
function extractTitle(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  // Try explicit title marker
  for (const line of lines.slice(0, 20)) {
    const match = line.match(/^(?:title|标题|论文题目)[:：]\s*(.+)$/i)
    if (match) return clean(match[1])
  }
  // Heuristic: first line that looks like a title (not too short, not author-like)
  for (const line of lines.slice(0, 10)) {
    if (line.length < 8) continue
    if (line.length > 200) continue
    if (/^(author|作者|abstract|摘要|keywords|关键词|introduction|引言|目录|contents)/i.test(line)) continue
    if (/^\d+(\.\d+)*\s/.test(line)) continue // numbered section
    if (/[@\d]/.test(line) && line.length < 30) continue // likely author/email
    return clean(line)
  }
  return ''
}

/**
 * Extract authors from document text.
 */
function extractAuthors(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  // Try explicit author marker
  for (const line of lines.slice(0, 30)) {
    const match = line.match(/^(?:authors?|作者)[:：]\s*(.+)$/i)
    if (match) {
      return match[1].split(/[,，;；、]/).map(clean).filter(Boolean)
    }
  }
  // Heuristic: lines after title that look like author names
  // (contain capitalized words, no digits, reasonable length)
  const authors = []
  let foundTitle = false
  for (const line of lines.slice(0, 15)) {
    if (!foundTitle) {
      if (line.length > 8 && line.length < 200 && !/^(author|abstract|keywords)/i.test(line)) {
        foundTitle = true
      }
      continue
    }
    if (/^(abstract|摘要|keywords|关键词|introduction|引言|1[\.．])/i.test(line)) break
    if (line.length < 3 || line.length > 150) continue
    if (/[@\d]/.test(line)) continue
    if (/^(department|school|university|institute|college|系|学院|大学|研究所)/i.test(line)) continue
    // Split by common author separators
    const parts = line.split(/[,，;；、]/).map(clean).filter((p) => p.length > 1 && p.length < 60)
    if (parts.length > 0 && parts.length <= 10) {
      authors.push(...parts)
    }
    if (authors.length >= 10) break
  }
  return authors
}

/**
 * Extract publication year.
 */
function extractYear(text) {
  // Try explicit year marker
  const markerMatch = text.match(/(?:year|年份|published|发表)[:：]?\s*(19|20)\d{2}/i)
  if (markerMatch) return Number(markerMatch[0].match(/(19|20)\d{2}/)[0])
  // Find 4-digit year in first 500 chars
  const firstChunk = text.slice(0, 500)
  const yearMatch = firstChunk.match(/\b(19|20)\d{2}\b/)
  if (yearMatch) {
    const year = Number(yearMatch[0])
    if (year >= 1950 && year <= 2100) return year
  }
  return 0
}

/**
 * Extract abstract.
 */
function extractAbstract(text) {
  // Try explicit abstract marker
  const match = text.match(/(?:abstract|摘要)[:：]?\s*([\s\S]{20,2000}?)(?:\n\s*(?:keywords?|关键词|index terms|1[\.．]|introduction|引言|目录|contents)|$)/i)
  if (match) return clean(match[1])
  return ''
}

/**
 * Extract keywords.
 */
function extractKeywords(text) {
  const match = text.match(/(?:keywords?|关键词|index terms)[:：]?\s*(.+?)(?:\n\s*(?:1[\.．]|introduction|引言|abstract|摘要)|$)/i)
  if (match) {
    return match[1].split(/[,，;；、]/).map(clean).filter((k) => k.length > 0 && k.length < 100).slice(0, 20)
  }
  return []
}

/**
 * Extract venue / journal / conference.
 */
function extractVenue(text) {
  const match = text.match(/(?:journal|conference|proceedings|venue|发表于|期刊|会议)[:：]?\s*(.+?)(?:\n|$)/i)
  if (match) return clean(match[1])
  // Look for common venue patterns in first 30 lines
  const lines = text.split('\n').slice(0, 30)
  for (const line of lines) {
    if (/^(IEEE|ACM|Springer|Elsevier|Nature|Science|Journal|Conference|Proceedings|Transactions|学报|期刊|会议)/i.test(line.trim())) {
      return clean(line)
    }
  }
  return ''
}

/**
 * Extract DOI.
 */
function extractDoi(text) {
  const match = text.match(/\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i)
  return match ? match[1] : ''
}

/**
 * Extract section headings (for structure overview).
 */
function extractSections(text) {
  const headings = []
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    // Match numbered headings like "1. Introduction", "1.1 Background", "1 Introduction"
    const numbered = trimmed.match(/^(\d+(?:\.\d+)*)[.\s]+[A-Z\u4e00-\u9fa5].{2,80}$/)
    if (numbered) {
      headings.push({ number: numbered[1], title: clean(trimmed.replace(/^\d+(?:\.\d+)*[.\s]+/, '')) })
      continue
    }
    // Match Chinese numbered headings
    const cnNumbered = trimmed.match(/^[一二三四五六七八九十]+[、．.]\s*.{2,80}$/)
    if (cnNumbered) {
      headings.push({ number: trimmed.match(/^[一二三四五六七八九十]+/)[0], title: clean(trimmed.replace(/^[一二三四五六七八九十]+[、．.]\s*/, '')) })
    }
  }
  return headings.slice(0, 50)
}

/**
 * Main extraction function.
 * @param {string} text - parsed document text
 * @param {object} options - { sourceName, sourcePath }
 * @returns {object} structured metadata
 */
export function extractReferenceMetadata(text, options = {}) {
  const safeText = String(text || '')
  const metadata = {
    title: extractTitle(safeText),
    authors: extractAuthors(safeText),
    year: extractYear(safeText),
    abstract: extractAbstract(safeText),
    keywords: extractKeywords(safeText),
    venue: extractVenue(safeText),
    doi: extractDoi(safeText),
    sections: extractSections(safeText),
    sourceName: options.sourceName || '',
    sourcePath: options.sourcePath || '',
    extractedAt: new Date().toISOString(),
    confidence: {
      title: 0, authors: 0, year: 0, abstract: 0, keywords: 0,
    },
  }
  // Confidence scoring based on extraction success
  metadata.confidence.title = metadata.title ? 0.7 : 0
  metadata.confidence.authors = metadata.authors.length > 0 ? Math.min(0.8, 0.3 + metadata.authors.length * 0.1) : 0
  metadata.confidence.year = metadata.year > 0 ? 0.9 : 0
  metadata.confidence.abstract = metadata.abstract ? 0.8 : 0
  metadata.confidence.keywords = metadata.keywords.length > 0 ? 0.8 : 0
  // Ensure all confidence values are finite
  for (const key of Object.keys(metadata.confidence)) {
    metadata.confidence[key] = FINITE(metadata.confidence[key])
  }
  return metadata
}

export const __test__ = {
  extractTitle, extractAuthors, extractYear, extractAbstract,
  extractKeywords, extractVenue, extractDoi, extractSections,
}
