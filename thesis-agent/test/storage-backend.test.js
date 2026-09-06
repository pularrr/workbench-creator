import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { JsonStorageBackend } from '../src/storage-json.js'
import { createStorageBackend, isSqliteAvailable, SqliteStorageBackend } from '../src/storage-sqlite.js'

test('JsonStorageBackend save and load round-trip', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'json-store-'))
  const backend = new JsonStorageBackend(dir)
  const state = { schemaVersion: 1, projects: { p1: { name: 'test' } }, sessionBindings: {} }
  await backend.save(state)
  const loaded = await backend.load()
  assert.deepEqual(loaded, state)
})

test('JsonStorageBackend load returns null for empty dir', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'json-empty-'))
  const backend = new JsonStorageBackend(dir)
  const loaded = await backend.load()
  assert.equal(loaded, null)
})

test('JsonStorageBackend overwrites on repeated save', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'json-overwrite-'))
  const backend = new JsonStorageBackend(dir)
  await backend.save({ version: 1 })
  await backend.save({ version: 2 })
  const loaded = await backend.load()
  assert.deepEqual(loaded, { version: 2 })
})

test('createStorageBackend defaults to json', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'factory-json-'))
  const backend = await createStorageBackend(dir)
  assert.equal(backend.backendType, 'json')
  await backend.close()
})

test('createStorageBackend with storageType=json', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'factory-json2-'))
  const backend = await createStorageBackend(dir, { storageType: 'json' })
  assert.equal(backend.backendType, 'json')
  await backend.close()
})

test('createStorageBackend with storageType=sqlite falls back to json if not available', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'factory-sqlite-fb-'))
  const backend = await createStorageBackend(dir, { storageType: 'sqlite' })
  // If better-sqlite3 is installed, this will be sqlite; otherwise json.
  assert.ok(['json', 'sqlite'].includes(backend.backendType))
  await backend.close()
})

test('isSqliteAvailable returns boolean', () => {
  assert.equal(typeof isSqliteAvailable(), 'boolean')
})

test('SqliteStorageBackend (if available) save and load', { skip: !isSqliteAvailable() }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sqlite-store-'))
  const backend = new SqliteStorageBackend(dir)
  const state = { schemaVersion: 1, projects: { p1: { name: 'sqlite-test' } }, sessionBindings: {} }
  await backend.save(state)
  const loaded = await backend.load()
  assert.deepEqual(loaded, state)
  await backend.close()
})

test('SqliteStorageBackend (if available) migrateFromJson', { skip: !isSqliteAvailable() }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sqlite-migrate-'))
  const jsonPath = path.join(dir, 'state.json')
  const jsonState = { schemaVersion: 1, projects: { p1: { name: 'from-json' } }, sessionBindings: {} }
  await writeFile(jsonPath, JSON.stringify(jsonState), 'utf8')
  const backend = new SqliteStorageBackend(dir)
  const result = await backend.migrateFromJson(jsonPath)
  assert.equal(result.migrated, true)
  assert.equal(result.projectCount, 1)
  const loaded = await backend.load()
  assert.deepEqual(loaded, jsonState)
  await backend.close()
})

test('StorageBackend results are lossless JSON', async () => {
  const { isLosslessJson } = await import('../src/lossless.js')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'store-lossless-'))
  const backend = new JsonStorageBackend(dir)
  const state = { schemaVersion: 1, projects: {}, sessionBindings: {} }
  await backend.save(state)
  const loaded = await backend.load()
  assert.ok(isLosslessJson(loaded), 'loaded state must be lossless JSON')
})
