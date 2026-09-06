import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { expandTemplatePack, getBuiltinPack, listBuiltinPacks, loadTemplatePack, validateTemplatePack } from '../src/template-pack.js'

test('listBuiltinPacks returns 3 packs', () => {
  const packs = listBuiltinPacks()
  assert.equal(packs.length, 3)
  const ids = packs.map((p) => p.id)
  assert.deepEqual(ids, ['generic-master', 'generic-bachelor', 'ieee-conference'])
})

test('getBuiltinPack returns clone (mutation safe)', () => {
  const pack = getBuiltinPack('generic-master')
  assert.equal(pack.id, 'generic-master')
  pack.id = 'mutated'
  const again = getBuiltinPack('generic-master')
  assert.equal(again.id, 'generic-master', 'must return a clone, not a reference')
})

test('getBuiltinPack returns null for unknown id', () => {
  assert.equal(getBuiltinPack('nonexistent'), null)
})

test('validateTemplatePack accepts a valid pack', () => {
  const pack = getBuiltinPack('generic-master')
  const { valid, errors } = validateTemplatePack(pack)
  assert.equal(valid, true, `expected valid, got errors: ${JSON.stringify(errors)}`)
  assert.deepEqual(errors, [])
})

test('validateTemplatePack rejects missing id', () => {
  const pack = { ...getBuiltinPack('generic-master'), id: undefined }
  const { valid, errors } = validateTemplatePack(pack)
  assert.equal(valid, false)
  assert.ok(errors.some((e) => /id/.test(e)))
})

test('validateTemplatePack rejects bad degreeType', () => {
  const pack = { ...getBuiltinPack('generic-master'), degreeType: 'phd' }
  const { valid, errors } = validateTemplatePack(pack)
  assert.equal(valid, false)
  assert.ok(errors.some((e) => /degreeType/.test(e)))
})

test('validateTemplatePack rejects empty sections', () => {
  const pack = { ...getBuiltinPack('generic-master'), sections: [] }
  const { valid, errors } = validateTemplatePack(pack)
  assert.equal(valid, false)
  assert.ok(errors.some((e) => /sections/.test(e)))
})

test('validateTemplatePack rejects logic step without purpose', () => {
  const pack = getBuiltinPack('generic-master')
  pack.sections[0].logic[0].purpose = ''
  const { valid, errors } = validateTemplatePack(pack)
  assert.equal(valid, false)
  assert.ok(errors.some((e) => /purpose/.test(e)))
})

test('expandTemplatePack produces outline compatible with setPlan', () => {
  const pack = getBuiltinPack('generic-master')
  const outline = expandTemplatePack(pack, 30000)
  assert.equal(outline.length, pack.sections.length)
  for (const node of outline) {
    assert.equal(typeof node.title, 'string')
    assert.equal(typeof node.objective, 'string')
    assert.equal(typeof node.targetWords, 'number')
    assert.equal(node.locked, false)
    assert.ok(Array.isArray(node.logic))
    assert.ok(node.logic.length > 0)
    for (const step of node.logic) {
      assert.equal(typeof step.purpose, 'string')
      assert.equal(typeof step.transition, 'string')
      assert.equal(typeof step.targetWords, 'number')
    }
  }
  // Word counts should sum approximately to target.
  const total = outline.reduce((sum, n) => sum + n.targetWords, 0)
  assert.ok(Math.abs(total - 30000) < 100, `total words ${total} should be ~30000`)
})

test('expandTemplatePack with ieee-conference pack', () => {
  const pack = getBuiltinPack('ieee-conference')
  const outline = expandTemplatePack(pack)
  assert.equal(outline.length, 5)
  assert.equal(outline[0].title, 'Introduction')
})

test('loadTemplatePack from file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'thesis-pack-'))
  const pack = getBuiltinPack('generic-bachelor')
  const filePath = path.join(dir, 'pack.json')
  await writeFile(filePath, JSON.stringify(pack), 'utf8')
  const loaded = await loadTemplatePack(filePath)
  assert.equal(loaded.id, 'generic-bachelor')
  assert.equal(loaded.name, '通用本科毕业论文')
})

test('loadTemplatePack rejects invalid JSON', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'thesis-pack-'))
  const filePath = path.join(dir, 'bad.json')
  await writeFile(filePath, '{not valid json', 'utf8')
  await assert.rejects(() => loadTemplatePack(filePath), /not valid JSON/)
})

test('loadTemplatePack rejects schema-invalid pack', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'thesis-pack-'))
  const filePath = path.join(dir, 'invalid.json')
  await writeFile(filePath, JSON.stringify({ id: 'bad', name: 'x' }), 'utf8')
  await assert.rejects(() => loadTemplatePack(filePath), /Invalid template pack/)
})

test('template pack results pass lossless JSON check', async () => {
  const { isLosslessJson } = await import('../src/lossless.js')
  const packs = listBuiltinPacks()
  assert.ok(isLosslessJson(packs), 'builtin packs must be lossless JSON')
  const outline = expandTemplatePack(getBuiltinPack('generic-master'), 30000)
  assert.ok(isLosslessJson(outline), 'expanded outline must be lossless JSON')
})
