/**
 * SqliteStorageBackend (P2 · v0.7).
 *
 * SQLite persistence using better-sqlite3 (native, optional dependency).
 * Stores the full state as a JSON blob in a key-value table, with WAL
 * mode for concurrent read performance.
 *
 * If better-sqlite3 is not installed, createStorageBackend() falls back
 * to JsonStorageBackend automatically.
 *
 * Schema:
 *   CREATE TABLE IF NOT EXISTS kv (
 *     key TEXT PRIMARY KEY,
 *     value TEXT NOT NULL,
 *     updated_at TEXT NOT NULL
 *   );
 *   CREATE INDEX IF NOT EXISTS idx_kv_updated ON kv(updated_at);
 */

import path from 'node:path'
import { StorageBackend } from './storage-backend.js'
import { JsonStorageBackend } from './storage-json.js'

let Database = null
let sqliteAvailable = false

try {
  // better-sqlite3 is an optional peer dependency; load lazily.
  const mod = await import('better-sqlite3')
  Database = mod.default || mod
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

export function isSqliteAvailable() {
  return sqliteAvailable
}

export class SqliteStorageBackend extends StorageBackend {
  constructor(dataDir, options = {}) {
    super(options)
    if (!sqliteAvailable) {
      throw new Error('better-sqlite3 is not installed. Run: npm install better-sqlite3')
    }
    this.backendType = 'sqlite'
    this.dataDir = dataDir
    this.dbPath = options.dbPath || path.join(dataDir, 'thesis-agent.db')
    this.db = new Database(this.dbPath)
    // WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')
    this._initSchema()
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_kv_updated ON kv(updated_at);
    `)
  }

  async load() {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get('state')
    if (!row) return null
    return JSON.parse(row.value)
  }

  async save(state) {
    const value = JSON.stringify(state)
    this.db.prepare(`
      INSERT INTO kv (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run('state', value)
  }

  /**
   * Get a single top-level key from the stored state without parsing the
   * whole blob. Uses SQLite json_extract for efficient partial reads.
   */
  getKey(key) {
    const row = this.db.prepare("SELECT json_extract(value, ?) AS v FROM kv WHERE key = 'state'").get(`$.${key}`)
    if (!row || row.v === null) return undefined
    return JSON.parse(row.v)
  }

  /**
   * Migrate from a JSON state file to SQLite.
   * Returns { migrated: boolean, from: string, projectCount: number }.
   */
  async migrateFromJson(jsonPath) {
    const { readFile } = await import('node:fs/promises')
    try {
      const raw = await readFile(jsonPath, 'utf8')
      const state = JSON.parse(raw)
      await this.save(state)
      const projectCount = Array.isArray(state?.projects) ? state.projects.length : 0
      return { migrated: true, from: jsonPath, projectCount }
    } catch (error) {
      if (error.code === 'ENOENT') return { migrated: false, from: jsonPath, reason: 'file not found' }
      throw error
    }
  }

  async close() {
    if (this.db && this.db.open) {
      this.db.close()
    }
  }
}

/**
 * Factory: create the appropriate storage backend.
 * - If storageType='sqlite' and better-sqlite3 is available → SqliteStorageBackend
 * - If storageType='sqlite' but better-sqlite3 is NOT available → falls back to JSON with a warning
 * - Otherwise → JsonStorageBackend
 */
export async function createStorageBackend(dataDir, options = {}) {
  const storageType = options.storageType || process.env.THESIS_STORAGE || 'json'
  if (storageType === 'sqlite') {
    if (sqliteAvailable) {
      return new SqliteStorageBackend(dataDir, options)
    }
    // Fall back to JSON with a console warning
    console.warn('[thesis-agent] better-sqlite3 not installed; falling back to JSON storage. Install with: npm install better-sqlite3')
  }
  return new JsonStorageBackend(dataDir, options)
}
