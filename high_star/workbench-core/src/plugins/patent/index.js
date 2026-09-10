/**
 * Patent Plugin Bundle — registers the Framework/Logic/Evidence plugins
 * for patent application writing.
 *
 * Usage: import { registerPatentPlugins } from 'workbench-core/plugin-patent'
 */

import { registerPlugin } from '../../core/plugin-loader.js'
import { patentFramework } from './framework.js'
import { patentLogic } from './logic.js'
import { patentEvidence } from './evidence.js'
import { patentMaterial } from './material.js'

export function registerPatentPlugins() {
  registerPlugin(patentFramework, 'framework')
  registerPlugin(patentLogic, 'logic')
  registerPlugin(patentEvidence, 'evidence')
  registerPlugin(patentMaterial, 'material')
  return { framework: patentFramework, logic: patentLogic, evidence: patentEvidence, material: patentMaterial }
}

export { patentFramework, patentLogic, patentEvidence, patentMaterial }
