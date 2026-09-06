import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const sourceRoot = path.join(root, 'assets', 'presets')
const targetRoot = path.join(dshHome, '.agent-presets')
const names = ['workbench-designer-v0', 'workbench-writer-v0', 'workbench-reviewer-v0']
for (const name of names) {
  const source = path.join(sourceRoot, name); const target = path.join(targetRoot, name)
  await mkdir(targetRoot, { recursive: true }); await cp(source, target, { recursive: true, force: true })
  const composition = path.join(target, 'agent.cordis.yml')
  const text = await readFile(composition, 'utf8')
  await writeFile(composition, text.replaceAll('__WORKBENCH_SKILLS_DIR__', path.join(target, 'skills').replaceAll('\\', '/')), 'utf8')
  console.log(`Installed ${name}: ${target}`)
}
