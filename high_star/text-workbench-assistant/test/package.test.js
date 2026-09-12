import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('preset package contains one unified assistant', async () => {
  const presetRoot = root
  await access(path.join(presetRoot, 'preset.yml'))
  await access(path.join(presetRoot, 'skills', 'text-workbench', 'SKILL.md'))
  const composition = await readFile(path.join(presetRoot, 'agent.cordis.yml'), 'utf8')
  assert.match(composition, /mode: assistant-policy/)
  assert.match(composition, /__TEXT_WORKBENCH_SKILLS_DIR__/)
  assert.doesNotMatch(composition, /designer-policy|writer-policy|reviewer-policy/)
  const skill = await readFile(path.join(presetRoot, 'skills', 'text-workbench', 'SKILL.md'), 'utf8')
  assert.match(skill, /wb_get_resume_state/)
  assert.match(skill, /wb_get_project_limit/)
})
