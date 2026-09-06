import assert from 'node:assert/strict'
import test from 'node:test'
import { isEmbeddingPreset, listEmbeddingPresets, resolveEmbeddingPreset, __test__ } from '../src/embedding-presets.js'

test('listEmbeddingPresets returns 6 presets', () => {
  const presets = listEmbeddingPresets()
  assert.equal(presets.length, 6)
  const keys = presets.map((p) => p.key)
  assert.deepEqual(keys, ['deepseek', 'openai', 'qwen', 'zhipu', 'siliconflow', 'ollama'])
  for (const preset of presets) {
    assert.ok(preset.endpoint.startsWith('http'))
    assert.ok(preset.model)
    assert.ok(preset.dimensions > 0)
  }
})

test('resolveEmbeddingPreset resolves by exact key', () => {
  const preset = resolveEmbeddingPreset('deepseek')
  assert.equal(preset.key, 'deepseek')
  assert.ok(preset.endpoint)
})

test('resolveEmbeddingPreset is case-insensitive and trims', () => {
  const preset = resolveEmbeddingPreset('  OpenAI ')
  assert.equal(preset.key, 'openai')
})

test('resolveEmbeddingPreset resolves Chinese aliases', () => {
  assert.equal(resolveEmbeddingPreset('通义').key, 'qwen')
  assert.equal(resolveEmbeddingPreset('阿里').key, 'qwen')
  assert.equal(resolveEmbeddingPreset('智谱').key, 'zhipu')
  assert.equal(resolveEmbeddingPreset('硅基').key, 'siliconflow')
  assert.equal(resolveEmbeddingPreset('本地').key, 'ollama')
})

test('resolveEmbeddingPreset returns null for unknown', () => {
  assert.equal(resolveEmbeddingPreset('nonexistent'), null)
  assert.equal(resolveEmbeddingPreset(''), null)
  assert.equal(resolveEmbeddingPreset(null), null)
})

test('isEmbeddingPreset works', () => {
  assert.equal(isEmbeddingPreset('ollama'), true)
  assert.equal(isEmbeddingPreset('bad'), false)
})

test('presets are lossless JSON', async () => {
  const { isLosslessJson } = await import('../src/lossless.js')
  assert.ok(isLosslessJson(listEmbeddingPresets()), 'presets must be lossless JSON')
})

test('all preset endpoints are http(s) without embedded credentials', () => {
  const presets = Object.values(__test__.PRESETS)
  assert.ok(presets.length >= 6)
  for (const preset of presets) {
    const url = new URL(preset.endpoint)
    assert.ok(['http:', 'https:'].includes(url.protocol))
    assert.equal(url.username, '')
    assert.equal(url.password, '')
  }
})
