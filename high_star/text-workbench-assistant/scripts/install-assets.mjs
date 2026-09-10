import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const presetName = 'text-workbench-assistant-v0'
const source = packageRoot
const targetRoot = path.join(dshHome, '.agent-presets')
const target = path.join(targetRoot, presetName)

await access(path.join(source, 'agent.cordis.yml'))
await access(path.join(source, 'preset.yml'))
await access(path.join(source, 'skills', 'text-workbench', 'SKILL.md'))
await mkdir(targetRoot, { recursive: true })
await mkdir(target, { recursive: true })
await cp(path.join(source, 'agent.cordis.yml'), path.join(target, 'agent.cordis.yml'), { force: true })
await cp(path.join(source, 'preset.yml'), path.join(target, 'preset.yml'), { force: true })
await cp(path.join(source, 'skills'), path.join(target, 'skills'), { recursive: true, force: true })

const compositionPath = path.join(target, 'agent.cordis.yml')
const skillsPath = path.join(target, 'skills').replaceAll('\\', '/')
const composition = (await readFile(compositionPath, 'utf8'))
  .replaceAll('__TEXT_WORKBENCH_SKILLS_DIR__', skillsPath)
await writeFile(compositionPath, composition, 'utf8')

console.log(`Installed ${presetName}: ${target}`)
console.log('Dependency: install and activate dsh-workbench-core before using this preset.')
