/**
 * Core module exports for the pluggable workbench framework.
 */

export { WorkbenchRuntime } from './runtime.js'
export { createStateMachine, isTerminal } from './state-machine.js'
export { WorkbenchStorage } from './storage.js'
export { createWorkbenchServer } from './workbench-server.js'
export { parseMaterialFile } from './material-parser.js'
export { parseDocumentFile } from '../services/document-service.js'
export { createPluginSpecDraft, validatePluginSpec, createPluginBundleFromSpec } from './plugin-spec.js'
export { chunkText, localEmbedding, searchChunks } from '../services/retrieval-service.js'
export { createSnapshot, compareSnapshot } from '../services/version-service.js'
export { renderMarkdown, renderPlainText, markdownExporter, textExporter } from '../services/export-service.js'
export {
  registerPlugin,
  registerPluginBundle,
  listPlugins,
  listPluginBundles,
  getPlugin,
  getPluginBundleManifest,
  validatePluginManifest,
  resolvePluginBundle,
  createPluginBundle,
  listSupportedTaskTypes,
  generatePluginScaffold,
  registerExporter,
  listExporters,
  resolveExporter,
} from './plugin-loader.js'
