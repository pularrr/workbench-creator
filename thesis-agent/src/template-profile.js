/**
 * Template Profile architecture (P3 · v1.0).
 *
 * Extends template-pack with a full, hot-swappable profile that includes:
 *   - section templates (from template-pack)
 *   - typography (fonts, sizes, line spacing, margins)
 *   - citation style (APA/GB7714/IEEE/MLA/Chicago)
 *   - export rules (docx/latex/html specific settings)
 *   - heading numbering style
 *   - page setup (A4/letter, margins)
 *
 * Profiles are versioned, can be imported/exported as JSON, and
 * hot-swapped at runtime without restarting the plugin.
 */

import { expandTemplatePack, getBuiltinPack, listBuiltinPacks, validateTemplatePack } from './template-pack.js'

const FINITE = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

// Built-in citation style definitions
const CITATION_STYLES = {
  'gb7714': {
    name: 'GB/T 7714-2015',
    inText: '[1]',
    bibliography: '顺序编码制',
    example: '[1] 作者. 题名[J]. 刊名, 年, 卷(期): 页码.',
  },
  'apa': {
    name: 'APA 7th',
    inText: '(Author, Year)',
    bibliography: '作者-年份制',
    example: 'Author, A. A. (Year). Title. Journal, Vol(Issue), Pages.',
  },
  'ieee': {
    name: 'IEEE',
    inText: '[1]',
    bibliography: '顺序编码制',
    example: '[1] A. A. Author, "Title," Journal, vol. V, no. N, pp. Pages, Year.',
  },
  'mla': {
    name: 'MLA 9th',
    inText: '(Author Page)',
    bibliography: '作者-页码制',
    example: 'Author, A. A. "Title." Journal, vol. V, no. N, Year, pp. Pages.',
  },
  'chicago': {
    name: 'Chicago 17th',
    inText: '(Author Year, Page)',
    bibliography: '注释-参考文献制',
    example: 'Author, A. A. "Title." Journal Volume, no. Issue (Year): Pages.',
  },
}

// Built-in typography presets
const TYPOGRAPHY_PRESETS = {
  'chinese-thesis': {
    fontFamily: 'SimSun, "Times New Roman", serif',
    headingFont: 'SimHei, "Arial Black", sans-serif',
    bodyFontSize: 12,
    headingFontSize: { h1: 16, h2: 14, h3: 13 },
    lineSpacing: 1.5,
    paragraphIndent: '2em',
    margins: { top: 2.54, bottom: 2.54, left: 3.17, right: 3.17 },
    pageSize: 'A4',
  },
  'ieee-conference': {
    fontFamily: '"Times New Roman", serif',
    headingFont: '"Times New Roman", serif',
    bodyFontSize: 10,
    headingFontSize: { h1: 12, h2: 11, h3: 10 },
    lineSpacing: 1.0,
    paragraphIndent: '0',
    margins: { top: 0.75, bottom: 1.0, left: 0.625, right: 0.625 },
    pageSize: 'letter',
  },
  'generic': {
    fontFamily: '"Times New Roman", serif',
    headingFont: '"Times New Roman", serif',
    bodyFontSize: 12,
    headingFontSize: { h1: 14, h2: 13, h3: 12 },
    lineSpacing: 1.5,
    paragraphIndent: '2em',
    margins: { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 },
    pageSize: 'A4',
  },
}

/**
 * Create a template profile from a template pack + profile options.
 * @param {object} options - { packId, pack, citationStyle, typography, headingNumbering, exportRules, name, description }
 * @returns {object} profile
 */
export function createTemplateProfile(options = {}) {
  const packId = options.packId || 'generic-master'
  const pack = options.pack || getBuiltinPack(packId)
  if (!pack) throw new Error(`Template pack not found: ${packId}`)

  const citationStyleKey = options.citationStyle || 'gb7714'
  const citationStyle = CITATION_STYLES[citationStyleKey] || CITATION_STYLES['gb7714']

  const typographyKey = options.typography || (packId.includes('ieee') ? 'ieee-conference' : packId.includes('bachelor') ? 'chinese-thesis' : 'chinese-thesis')
  const typography = { ...TYPOGRAPHY_PRESETS[typographyKey], ...(options.typographyOverrides || {}) }

  return {
    id: options.id || `profile-${packId}-${Date.now()}`,
    name: options.name || pack.name,
    description: options.description || pack.description || '',
    version: options.version || '1.0.0',
    packId: pack.id,
    pack: clone(pack),
    citationStyle: {
      key: citationStyleKey,
      ...citationStyle,
    },
    typography,
    headingNumbering: options.headingNumbering || 'numeric', // 'numeric' | 'chapter' | 'none'
    exportRules: {
      docx: { ...(options.exportRules?.docx || {}) },
      latex: { ...(options.exportRules?.latex || {}) },
      html: { ...(options.exportRules?.html || {}) },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Validate a template profile.
 */
export function validateTemplateProfile(profile) {
  const errors = []
  if (!profile || typeof profile !== 'object') {
    return { valid: false, errors: ['Profile must be an object'] }
  }
  if (!profile.id || typeof profile.id !== 'string') errors.push('profile.id is required')
  if (!profile.name || typeof profile.name !== 'string') errors.push('profile.name is required')
  if (!profile.pack || typeof profile.pack !== 'object') errors.push('profile.pack is required')
  if (profile.pack) {
    const packValidation = validateTemplatePack(profile.pack)
    if (!packValidation.valid) errors.push(...packValidation.errors.map((e) => `pack: ${e}`))
  }
  if (!profile.citationStyle || !profile.citationStyle.key) errors.push('profile.citationStyle.key is required')
  if (!profile.typography || typeof profile.typography !== 'object') errors.push('profile.typography is required')
  if (profile.typography) {
    if (!profile.typography.fontFamily) errors.push('typography.fontFamily is required')
    if (!FINITE(profile.typography.bodyFontSize)) errors.push('typography.bodyFontSize must be a finite number')
  }
  return { valid: errors.length === 0, errors }
}

/**
 * List available citation styles.
 */
export function listCitationStyles() {
  return Object.entries(CITATION_STYLES).map(([key, style]) => ({ key, ...style }))
}

/**
 * List available typography presets.
 */
export function listTypographyPresets() {
  return Object.entries(TYPOGRAPHY_PRESETS).map(([key, preset]) => ({ key, ...preset }))
}

/**
 * Expand a profile's section templates into an outline (delegates to template-pack).
 */
export function expandProfileOutline(profile, targetWords) {
  return expandTemplatePack(profile.pack, targetWords || profile.pack.targetWords)
}

/**
 * Serialize a profile to JSON (for export).
 */
export function serializeProfile(profile) {
  return JSON.stringify(profile, null, 2)
}

/**
 * Deserialize a profile from JSON (for import).
 */
export function deserializeProfile(json) {
  const profile = JSON.parse(json)
  const validation = validateTemplateProfile(profile)
  if (!validation.valid) {
    throw new Error(`Invalid template profile: ${validation.errors.join('; ')}`)
  }
  return profile
}

/**
 * Apply a profile's typography to a docx export config.
 */
export function applyTypographyToDocx(profile) {
  const t = profile.typography
  return {
    font: t.fontFamily,
    headingFont: t.headingFont,
    fontSize: t.bodyFontSize,
    headingFontSize: t.headingFontSize,
    lineSpacing: t.lineSpacing,
    paragraphIndent: t.paragraphIndent,
    margins: t.margins,
    pageSize: t.pageSize,
  }
}

/**
 * Apply a profile's typography to a LaTeX export config.
 */
export function applyTypographyToLatex(profile) {
  const t = profile.typography
  return {
    documentClass: t.pageSize === 'letter' ? 'article' : 'ctexart',
    fontSize: `${t.bodyFontSize}pt`,
    lineSpacing: t.lineSpacing,
    margins: t.margins,
    citationPackage: profile.citationStyle.key === 'gb7714' ? 'gbt7714' : 'biblatex',
    citationStyle: profile.citationStyle.key,
  }
}

function clone(value) {
  return structuredClone(value)
}

export const __test__ = {
  CITATION_STYLES, TYPOGRAPHY_PRESETS, createTemplateProfile, validateTemplateProfile,
}
