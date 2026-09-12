/**
 * Thesis Plugin Bundle — registers the Framework/Logic/Evidence plugins
 * for academic thesis writing.
 *
 * Usage: import { registerThesisPlugins } from 'workbench-core/plugin-thesis'
 */

import { registerPlugin } from '../../core/plugin-loader.js'
import { thesisFramework } from './framework.js'
import { thesisLogic } from './logic.js'
import { thesisEvidence } from './evidence.js'
import { thesisMaterial } from './material.js'

export function registerThesisPlugins() {
  registerPlugin(thesisFramework, 'framework')
  registerPlugin(thesisLogic, 'logic')
  registerPlugin(thesisEvidence, 'evidence')
  registerPlugin(thesisMaterial, 'material')
  return { framework: thesisFramework, logic: thesisLogic, evidence: thesisEvidence, material: thesisMaterial }
}

export { thesisFramework, thesisLogic, thesisEvidence, thesisMaterial }
