#!/usr/bin/env node
/**
 * One-click diagnostic for the thesis workbench client UI (P1 · v0.6).
 *
 * Checks:
 *   1. 3199 workbench HTTP server is reachable and lists projects
 *   2. dsh-thesis-agent is installed in the DSH web profile
 *   3. client.js passes syntax check
 *   4. package.json declares dsh.client.inject with the conversation UI plugin
 *   5. client.js injects a workbench entry point (button / panel)
 *
 * Usage: node scripts/verify-client-ui.mjs
 * Exit code: 0 if all checks pass, 1 if any critical check fails.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const results = []
function check(name, fn) {
  try {
    const detail = fn()
    results.push({ name, ok: true, detail })
  } catch (error) {
    results.push({ name, ok: false, detail: error.message })
  }
}

// 1. 3199 workbench HTTP
check('3199 工作台 HTTP 连通性', () => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    // fetch is global in Node 18+
    const response = fetch('http://127.0.0.1:3199/api/projects', { signal: controller.signal })
    // fetch returns a promise; this check is async — handle below
    return 'pending'
  } finally {
    clearTimeout(timer)
  }
})

// We need to handle the async fetch properly. Redo check 1 as async.
async function checkHttp() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const response = await fetch('http://127.0.0.1:3199/api/projects', { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (!Array.isArray(data)) throw new Error('response is not an array')
    return `HTTP 200，列出 ${data.length} 个项目`
  } catch (error) {
    throw new Error(`3199 不可达: ${error.message}。请确认 DSH 已启动且插件已加载（dsh web）。`)
  }
}

// 2. DSH web profile plugin installed
check('DSH web profile 插件安装', () => {
  try {
    // On Windows, dsh is dsh.cmd; use shell:true for cross-platform resolution.
    const output = execFileSync('dsh', ['plugin', '--profile', 'web', 'list'], { encoding: 'utf8', timeout: 15000, shell: process.platform === 'win32' })
    if (output.includes('dsh-thesis-agent')) return 'dsh-thesis-agent 已安装'
    throw new Error('未找到 dsh-thesis-agent。请执行: dsh plugin --profile web add .')
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('dsh 命令未找到，请确认 DSH 已安装并在 PATH 中')
    throw error
  }
})

// 3. client.js syntax
check('client.js 语法检查', () => {
  const clientPath = path.join(projectRoot, 'client.js')
  execFileSync(process.execPath, ['--check', clientPath], { encoding: 'utf8' })
  return '语法正确'
})

// 4. package.json client inject
check('package.json client.inject 声明', () => {
  const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  const inject = pkg?.dsh?.client?.inject
  if (!Array.isArray(inject)) throw new Error('package.json 缺少 dsh.client.inject 数组')
  if (!inject.includes('@deepseek-ai/dsh-client-ui-conversation')) {
    throw new Error('dsh.client.inject 未包含 @deepseek-ai/dsh-client-ui-conversation')
  }
  return `已声明 ${inject.length} 个 client 插件`
})

// 5. client.js injects workbench entry
check('client.js 工作台入口注入', () => {
  const clientPath = path.join(projectRoot, 'client.js')
  const source = readFileSync(clientPath, 'utf8')
  const hasButton = /论文工作台|workbench/i.test(source)
  const hasSlot = /slots\.inject|conversation\.session/i.test(source)
  if (!hasButton) throw new Error('client.js 未找到"论文工作台"按钮定义')
  if (!hasSlot) throw new Error('client.js 未找到 slots.inject 调用')
  return '按钮 + slots.inject 均存在'
})

// 6. 3199 page title
check('3199 工作台页面标题', () => {
  // This is also async; handled in main
  return 'pending'
})

async function checkPageTitle() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const response = await fetch('http://127.0.0.1:3199/', { signal: controller.signal })
    clearTimeout(timer)
    const html = await response.text()
    if (/论文写作工作台|thesis.*workbench/i.test(html)) return '页面包含"论文写作工作台"标题'
    throw new Error('页面未找到工作台标题，可能服务异常')
  } catch (error) {
    throw new Error(`无法获取工作台页面: ${error.message}`)
  }
}

async function main() {
  console.log('=== dsh-thesis-agent 客户端 UI 诊断 ===\n')

  // Replace the pending sync checks with async ones
  const httpResult = await checkHttp()
  results[0] = { name: '3199 工作台 HTTP 连通性', ok: true, detail: httpResult }

  const pageResult = await checkPageTitle()
  results[5] = { name: '3199 工作台页面标题', ok: true, detail: pageResult }

  let failures = 0
  for (const r of results) {
    const icon = r.ok ? '✓' : '✗'
    console.log(`${icon} ${r.name}`)
    console.log(`  ${r.detail}`)
    if (!r.ok) failures += 1
  }

  console.log('\n=== 诊断总结 ===')
  if (failures === 0) {
    console.log('全部检查通过。工作台 UI 应可正常使用:')
    console.log('  - 浏览器打开 http://127.0.0.1:3199')
    console.log('  - 或在 DSH 会话头部点击"论文工作台"按钮')
  } else {
    console.log(`${failures} 项检查未通过，请按上述提示修复。`)
    console.log('常见修复步骤:')
    console.log('  1. cd <project> && dsh plugin --profile web remove dsh-thesis-agent')
    console.log('  2. dsh plugin --profile web add .')
    console.log('  3. npm run setup')
    console.log('  4. dsh web  (启动后等待 3199 服务就绪)')
  }
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('诊断脚本异常:', error)
  process.exit(2)
})
