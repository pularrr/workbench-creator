import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'

function readLock(lockPath) {
  try { return JSON.parse(readFileSync(lockPath, 'utf8')) } catch { return null }
}

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

/**
 * Acquires an exclusive, recoverable lock for one Core service per storage.
 * A stale lock is removed only after its recorded process is confirmed absent.
 */
export function acquireServiceLock(lockPath, metadata = {}) {
  const acquire = () => {
    const fd = openSync(lockPath, 'wx')
    const record = { pid: process.pid, startedAt: new Date().toISOString(), ...metadata }
    writeFileSync(fd, JSON.stringify(record), 'utf8')
    closeSync(fd)
    let released = false
    return {
      path: lockPath,
      record,
      release() {
        if (released) return
        released = true
        const current = readLock(lockPath)
        if (current?.pid === process.pid) {
          try { unlinkSync(lockPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
        }
      },
    }
  }

  try { return acquire() } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const existing = readLock(lockPath)
    if (existing && isRunning(existing.pid)) {
      const message = `Workbench Core is already running for this storage (pid ${existing.pid}). Reuse its /health endpoint instead of starting another runtime.`
      const conflict = new Error(message)
      conflict.code = 'WORKBENCH_CORE_ALREADY_RUNNING'
      conflict.lock = existing
      throw conflict
    }
    // An interrupted process can leave a lock behind. It is safe to recover
    // only after confirming that the original PID no longer exists.
    if (existsSync(lockPath)) unlinkSync(lockPath)
    return acquire()
  }
}
