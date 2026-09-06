/**
 * JsonStorageBackend (P2 · v0.7).
 *
 * Atomic JSON-file persistence — the original behavior of DomainStore,
 * extracted into a StorageBackend implementation.
 *
 * Uses write-to-temp + rename for atomicity. Safe for concurrent readers
 * but not for concurrent writers (single-process assumption).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { StorageBackend } from './storage-backend.js'

export class JsonStorageBackend extends StorageBackend {
  constructor(dataDir, options = {}) {
    super(options)
    this.backendType = 'json'
    this.dataDir = dataDir
    this.statePath = path.join(dataDir, 'state.json')
    this.tempPath = path.join(dataDir, `state.json.tmp-${process.pid}`)
  }

  async load() {
    try {
      const raw = await readFile(this.statePath, 'utf8')
      return JSON.parse(raw)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  async save(state) {
    await mkdir(this.dataDir, { recursive: true })
    const snapshot = JSON.stringify(state, null, 2)
    await writeFile(this.tempPath, snapshot, 'utf8')
    await rename(this.tempPath, this.statePath)
  }

  async close() {
    // no-op for JSON
  }
}
