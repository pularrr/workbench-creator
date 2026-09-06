/**
 * StorageBackend interface (P2 · v0.7).
 *
 * Abstracts persistence so DomainStore can swap between JSON-file and
 * SQLite backends without changing business logic.
 *
 * Contract:
 *   - load(): returns the full state object (or defaultState if none)
 *   - save(state): persists the full state object atomically
 *   - close(): release resources (optional, no-op for JSON)
 *   - backendType: 'json' | 'sqlite'
 *
 * All state objects must be lossless-JSON safe (no undefined, NaN, etc.).
 */

export class StorageBackend {
  constructor(options = {}) {
    this.options = options
    this.backendType = 'abstract'
  }

  async load() {
    throw new Error('StorageBackend.load() must be implemented by subclass')
  }

  async save(_state) {
    throw new Error('StorageBackend.save() must be implemented by subclass')
  }

  async close() {
    // default no-op
  }
}
