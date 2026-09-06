import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply } from '../src/index.js'

async function createHarness() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-preset-'))
  const definitions = new Map()
  const ctx = {
    tools: {
      register(definition) {
        definitions.set(definition.name, definition)
        return () => definitions.delete(definition.name)
      },
    },
  }
  await apply(ctx, { dataDir })
  const exec = { agent: { session: { id: 'session-preset-test' } } }
  const call = async (name, args = {}) => {
    const result = await definitions.get(name).execute(args, exec)
    return result.data
  }
  return { dataDir, definitions, exec, call }
}

test('setEmbeddingPreset resolves preset, persists config and keeps secret in memory', async () => {
  const { call } = await createHarness()
  await call('thesis_create_project', { name: '预设测试论文' })

  // Ollama preset with test + rebuild skipped (no real service in CI).
  const status = await call('thesis_set_embedding_preset', {
    provider: 'ollama', test: false, rebuild: false,
  })
  assert.equal(status.provider, 'openai-compatible')
  assert.ok(status.endpoint.includes('11434'))
  assert.equal(status.model, 'bge-m3')
  assert.equal(status.revision, 1)
  assert.equal(status.credentialReady, true)
  // index must not be stale when there are no chunks yet
  assert.equal(status.index.status, 'ready')
})

test('setEmbeddingPreset supports model/endpoint override and Chinese alias', async () => {
  const { call } = await createHarness()
  await call('thesis_create_project', { name: '预设覆盖测试' })
  const status = await call('thesis_set_embedding_preset', {
    provider: '通义', model: 'text-embedding-v4', endpoint: 'https://example.com/v1', test: false, rebuild: false,
  })
  assert.equal(status.model, 'text-embedding-v4')
  assert.equal(status.endpoint, 'https://example.com/v1')
  assert.equal(status.revision, 1)
})

test('setEmbeddingPreset rejects unknown provider with clear error', async () => {
  const { call } = await createHarness()
  await call('thesis_create_project', { name: '未知预设测试' })
  await assert.rejects(
    () => call('thesis_set_embedding_preset', { provider: 'does-not-exist', test: false }),
    /Unknown embedding preset/,
  )
})

test('setEmbeddingPreset enforces expectedRevision conflict when provided', async () => {
  const { call } = await createHarness()
  await call('thesis_create_project', { name: '版本冲突测试' })
  await assert.rejects(
    () => call('thesis_set_embedding_preset', { provider: 'ollama', expectedRevision: 5, test: false, rebuild: false }),
    /revision conflict/,
  )
})

test('listEmbeddingPresets returns 6 lossless presets via tool', async () => {
  const { call } = await createHarness()
  const presets = await call('thesis_list_embedding_presets')
  assert.equal(presets.length, 6)
  const { isLosslessJson } = await import('../src/lossless.js')
  assert.ok(isLosslessJson(presets))
})
