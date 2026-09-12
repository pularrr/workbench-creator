import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('installer writes one self-contained preset into an isolated DSH_HOME', async () => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'text-workbench-assistant-'))
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/install-assets.mjs'], {
        cwd: root,
        env: { ...process.env, DSH_HOME: dshHome },
        windowsHide: true,
      })
      let stderr = ''
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.once('error', reject)
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `installer exited ${code}`)))
    })
    const installedRoot = path.join(dshHome, '.agent-presets', 'text-workbench-assistant-v0')
    const composition = await readFile(path.join(installedRoot, 'agent.cordis.yml'), 'utf8')
    const skill = await readFile(path.join(installedRoot, 'skills', 'text-workbench', 'SKILL.md'), 'utf8')
    assert.doesNotMatch(composition, /__TEXT_WORKBENCH_SKILLS_DIR__/)
    assert.match(composition, /text-workbench-assistant-persona/)
    assert.match(skill, /wb_resume_project/)
  } finally { await rm(dshHome, { recursive: true, force: true }) }
})
