import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTemplateProfile, validateTemplateProfile, listCitationStyles,
  listTypographyPresets, expandProfileOutline, serializeProfile, deserializeProfile,
  applyTypographyToDocx, applyTypographyToLatex,
} from '../src/template-profile.js'

test('createTemplateProfile creates a valid profile', () => {
  const profile = createTemplateProfile({ packId: 'generic-master' })
  assert.equal(profile.packId, 'generic-master')
  assert.equal(profile.citationStyle.key, 'gb7714')
  assert.ok(profile.typography.fontFamily)
  assert.ok(profile.typography.bodyFontSize > 0)
  assert.equal(profile.headingNumbering, 'numeric')
})

test('createTemplateProfile with ieee pack uses ieee typography', () => {
  const profile = createTemplateProfile({ packId: 'ieee-conference' })
  assert.equal(profile.citationStyle.key, 'gb7714') // default
  assert.equal(profile.typography.pageSize, 'letter')
  assert.equal(profile.typography.bodyFontSize, 10)
})

test('createTemplateProfile accepts custom citation style', () => {
  const profile = createTemplateProfile({ packId: 'generic-master', citationStyle: 'ieee' })
  assert.equal(profile.citationStyle.key, 'ieee')
  assert.equal(profile.citationStyle.name, 'IEEE')
})

test('createTemplateProfile accepts typography overrides', () => {
  const profile = createTemplateProfile({
    packId: 'generic-master',
    typographyOverrides: { bodyFontSize: 14, lineSpacing: 2.0 },
  })
  assert.equal(profile.typography.bodyFontSize, 14)
  assert.equal(profile.typography.lineSpacing, 2.0)
})

test('validateTemplateProfile accepts valid profile', () => {
  const profile = createTemplateProfile({ packId: 'generic-master' })
  const result = validateTemplateProfile(profile)
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test('validateTemplateProfile rejects missing id', () => {
  const profile = createTemplateProfile({ packId: 'generic-master' })
  delete profile.id
  const result = validateTemplateProfile(profile)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /id/.test(e)))
})

test('listCitationStyles returns 5 styles', () => {
  const styles = listCitationStyles()
  assert.equal(styles.length, 5)
  const keys = styles.map((s) => s.key)
  assert.ok(keys.includes('gb7714'))
  assert.ok(keys.includes('apa'))
  assert.ok(keys.includes('ieee'))
  assert.ok(keys.includes('mla'))
  assert.ok(keys.includes('chicago'))
})

test('listTypographyPresets returns 3 presets', () => {
  const presets = listTypographyPresets()
  assert.equal(presets.length, 3)
  const keys = presets.map((p) => p.key)
  assert.ok(keys.includes('chinese-thesis'))
  assert.ok(keys.includes('ieee-conference'))
  assert.ok(keys.includes('generic'))
})

test('expandProfileOutline generates outline', () => {
  const profile = createTemplateProfile({ packId: 'generic-bachelor' })
  const outline = expandProfileOutline(profile, 12000)
  assert.ok(outline.length > 0)
  assert.equal(outline[0].locked, false)
})

test('serialize and deserialize round-trip', () => {
  const profile = createTemplateProfile({ packId: 'generic-master', name: '测试配置' })
  const json = serializeProfile(profile)
  const restored = deserializeProfile(json)
  assert.equal(restored.id, profile.id)
  assert.equal(restored.name, '测试配置')
  assert.equal(restored.packId, 'generic-master')
})

test('deserializeProfile rejects invalid JSON', () => {
  assert.throws(() => deserializeProfile('{"id":"x"}'), /Invalid template profile/)
})

test('applyTypographyToDocx returns docx config', () => {
  const profile = createTemplateProfile({ packId: 'generic-master' })
  const config = applyTypographyToDocx(profile)
  assert.ok(config.font)
  assert.ok(config.fontSize > 0)
  assert.ok(config.margins)
  assert.ok(config.pageSize)
})

test('applyTypographyToLatex returns latex config', () => {
  const profile = createTemplateProfile({ packId: 'generic-master' })
  const config = applyTypographyToLatex(profile)
  assert.ok(config.documentClass)
  assert.ok(config.fontSize)
  assert.ok(config.citationStyle)
})

test('applyTypographyToLatex with gb7714 uses gbt7714 package', () => {
  const profile = createTemplateProfile({ packId: 'generic-master', citationStyle: 'gb7714' })
  const config = applyTypographyToLatex(profile)
  assert.equal(config.citationPackage, 'gbt7714')
})

test('profile result is lossless JSON', async () => {
  const { isLosslessJson } = await import('../src/lossless.js')
  const profile = createTemplateProfile({ packId: 'generic-master' })
  assert.ok(isLosslessJson(profile), 'profile must be lossless JSON')
})
