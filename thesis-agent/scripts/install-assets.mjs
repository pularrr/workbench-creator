import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const sourceRoot = path.join(packageRoot, 'assets', 'presets')
const targetRoot = path.join(dshHome, '.agent-presets')

function yamlPath(value) {
  return value.replaceAll('\\', '/')
}

async function installPreset(name) {
  const source = path.join(sourceRoot, name)
  const target = path.join(targetRoot, name)
  await mkdir(targetRoot, { recursive: true })
  await cp(source, target, { recursive: true, force: true })
  const compositionPath = path.join(target, 'agent.cordis.yml')
  const skillsPath = yamlPath(path.join(target, 'skills'))
  const composition = (await readFile(compositionPath, 'utf8')).replaceAll('__THESIS_SKILLS_DIR__', skillsPath)
  await writeFile(compositionPath, composition, 'utf8')
  return target
}

const installed = []
installed.push(await installPreset('thesis-writer-v0'))
installed.push(await installPreset('thesis-review-v0'))
console.log(`Installed thesis presets:\n${installed.join('\n')}`)
