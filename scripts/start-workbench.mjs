/**
 * Starts the browser workbench against the same durable store as the DSH
 * plugin. This is a recovery entry point when a host has not yet invoked
 * wb_open_workbench (which normally starts the server lazily).
 */
import os from 'node:os'
import path from 'node:path'
import { WorkbenchRuntime } from '../src/core/runtime.js'
import { createWorkbenchServer } from '../src/core/workbench-server.js'
import { registerThesisPlugins } from '../src/plugins/thesis/index.js'
import { registerPatentPlugins } from '../src/plugins/patent/index.js'

registerThesisPlugins()
registerPatentPlugins()
const storagePath = process.env.WORKBENCH_STORAGE_PATH || path.join(os.homedir(), '.dsh', 'storages', 'workbench-core', 'workbench.db')
const port = Number(process.env.WORKBENCH_PORT || 3200)
try {
  const existing = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(750) })
  const health = existing.ok ? await existing.json() : null
  if (health?.service === 'workbench-core') {
    console.log(`[workbench-core] Reusing healthy Core service at http://127.0.0.1:${port}`)
    process.exit(0)
  }
} catch { /* No healthy service is listening; start one below. */ }
const runtime = new WorkbenchRuntime({ storagePath })
const server = createWorkbenchServer(runtime, { port, fallback: false })
await server.ready
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => { runtime.close(); process.exit(0) }))
}
