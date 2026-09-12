import { createHash, randomUUID } from 'node:crypto'

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const doi = (value) => clean(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase()
const keyOf = (record) => record.doi ? `doi:${doi(record.doi)}` : `title-sha256:${createHash('sha256').update(`${clean(record.title).toLowerCase()}|${record.year || ''}|${clean(record.authors?.[0]?.family).toLowerCase()}`).digest('hex')}`

export function normalizeLiteratureCandidate(input = {}, provider = 'local') {
  return {
    provider: input.provider || provider, providerId: String(input.providerId || input.id || randomUUID()),
    title: clean(input.title), authors: Array.isArray(input.authors) ? input.authors.map((author) => typeof author === 'string' ? { family: author } : { family: clean(author.family), given: clean(author.given) }) : [],
    year: Number.isInteger(input.year) ? input.year : Number.parseInt(input.year, 10) || undefined,
    doi: doi(input.doi) || undefined, venue: clean(input.venue || input.journal) || undefined,
    volume: clean(input.volume) || undefined, issue: clean(input.issue) || undefined, pages: clean(input.pages) || undefined,
    url: clean(input.url) || undefined, abstract: clean(input.abstract) || undefined,
    citationCount: Number.isFinite(input.citationCount) ? input.citationCount : undefined,
    openAccessUrl: clean(input.openAccessUrl) || undefined, license: clean(input.license) || undefined,
    retrievedAt: input.retrievedAt || new Date().toISOString(),
  }
}

export function canonicalLiteratureKey(record) { return keyOf(record) }

export function deduplicateLiterature(candidates = []) {
  const seen = new Map(); const duplicates = []
  for (const candidate of candidates) {
    const key = keyOf(candidate)
    if (seen.has(key)) duplicates.push({ candidate, canonicalKey: key, duplicateOf: seen.get(key).providerId })
    else seen.set(key, candidate)
  }
  return { unique: [...seen.values()], duplicates }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(options.timeoutMs || 8000) })
  if (!response.ok) throw new Error(`Literature provider request failed: HTTP ${response.status}`)
  return response.json()
}

export function createOpenAlexProvider(options = {}) {
  return {
    id: 'openalex',
    async search(input) {
      const query = clean(input.query); if (!query) throw new Error('Literature query is required')
      const params = new URLSearchParams({ search: query, per_page: String(Math.min(50, Math.max(1, input.limit || 10))) })
      const filters = []; if (input.yearFrom) filters.push(`from_publication_date:${input.yearFrom}-01-01`); if (input.yearTo) filters.push(`to_publication_date:${input.yearTo}-12-31`); if (filters.length) params.set('filter', filters.join(','))
      const payload = await fetchJson(`${options.endpoint || 'https://api.openalex.org/works'}?${params}`, options)
      return (payload.results || []).map((item) => normalizeLiteratureCandidate({ provider: 'openalex', providerId: item.id, title: item.title, authors: (item.authorships || []).map((a) => ({ family: a.author?.display_name })), year: item.publication_year, doi: item.doi, venue: item.primary_location?.source?.display_name, url: item.doi || item.id, abstract: '', citationCount: item.cited_by_count, openAccessUrl: item.open_access?.oa_url, license: item.primary_location?.license, retrievedAt: new Date().toISOString() }, 'openalex'))
    },
  }
}

export function createCrossrefProvider(options = {}) {
  return {
    id: 'crossref',
    async search(input) {
      const query = clean(input.query); if (!query) throw new Error('Literature query is required')
      const params = new URLSearchParams({ query, rows: String(Math.min(50, Math.max(1, input.limit || 10))) })
      const payload = await fetchJson(`${options.endpoint || 'https://api.crossref.org/works'}?${params}`, options)
      return (payload.message?.items || []).map((item) => normalizeLiteratureCandidate({ provider: 'crossref', providerId: item.DOI, title: item.title?.[0], authors: item.author, year: item.published?.['date-parts']?.[0]?.[0], doi: item.DOI, venue: item['container-title']?.[0], volume: item.volume, issue: item.issue, pages: item.page, url: item.URL, citationCount: item['is-referenced-by-count'], retrievedAt: new Date().toISOString() }, 'crossref'))
    },
  }
}

/**
 * Google Scholar has no supported public search API.  This adapter uses a
 * configured SerpApi account, which is an authorised Google Scholar search
 * provider; it deliberately never scrapes Scholar HTML or bypasses access
 * controls.  Leave it unconfigured and Core reports a visible provider error.
 */
export function createGoogleScholarProvider(options = {}) {
  return {
    id: 'google_scholar',
    async search(input) {
      const query = clean(input.query); if (!query) throw new Error('Literature query is required')
      const apiKey = options.apiKey || process.env.SERPAPI_API_KEY
      if (!apiKey) throw new Error('Google Scholar provider is not configured (set SERPAPI_API_KEY)')
      const params = new URLSearchParams({ engine: 'google_scholar', q: query, api_key: apiKey, num: String(Math.min(20, Math.max(1, input.limit || 10))) })
      if (input.yearFrom) params.set('as_ylo', String(input.yearFrom))
      if (input.yearTo) params.set('as_yhi', String(input.yearTo))
      const payload = await fetchJson(`${options.endpoint || 'https://serpapi.com/search.json'}?${params}`, options)
      return (payload.organic_results || []).map((item) => normalizeLiteratureCandidate({
        provider: 'google_scholar', providerId: item.result_id || item.link, title: item.title,
        authors: String(item.publication_info?.authors || '').split(',').map((family) => ({ family })),
        year: String(item.publication_info?.summary || '').match(/(?:19|20)\d{2}/)?.[0],
        venue: item.publication_info?.summary, url: item.link, abstract: item.snippet,
        citationCount: Number(item.inline_links?.cited_by?.total) || undefined, retrievedAt: new Date().toISOString(),
      }, 'google_scholar'))
    },
  }
}
