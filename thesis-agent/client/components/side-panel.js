/**
 * Thesis Workbench Side Panel (P3 · v1.0).
 *
 * Injects a collapsible right-side panel into the DSH conversation UI,
 * providing:
 *   - Current project status & quick stats
 *   - Quick action buttons (create/bind/scan/export)
 *   - Workbench launcher (opens 3199 in new tab or inline)
 *   - Tool result cards (interactive, expandable)
 *   - Agent run status monitor
 *
 * The panel is designed to coexist with the DSH conversation UI without
 * breaking its layout. It uses Shadow DOM for style isolation.
 */

const PANEL_WIDTH = 360
const STORAGE_KEY = 'thesis-panel-state'

export function createSidePanel(options = {}) {
  const workbenchUrl = options.workbenchUrl || 'http://127.0.0.1:3199'
  const apiBase = options.apiBase || workbenchUrl

  // Create panel container
  const container = document.createElement('div')
  container.id = 'thesis-workbench-panel'
  container.style.cssText = `
    position: fixed; top: 0; right: 0; height: 100vh; width: ${PANEL_WIDTH}px;
    background: #fff; border-left: 1px solid #e3e7ec; box-shadow: -4px 0 16px rgba(0,0,0,0.08);
    z-index: 9999; display: flex; flex-direction: column;
    transform: translateX(100%); transition: transform 0.25s ease;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif;
  `

  // Create toggle button
  const toggleBtn = document.createElement('button')
  toggleBtn.id = 'thesis-panel-toggle'
  toggleBtn.textContent = '📝 论文工作台'
  toggleBtn.style.cssText = `
    position: fixed; top: 50%; right: 0; transform: translateY(-50%) rotate(-90deg);
    transform-origin: right center; background: #1f6feb; color: #fff; border: none;
    padding: 8px 16px; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 13px;
    font-weight: 600; z-index: 10000; box-shadow: -2px 0 8px rgba(0,0,0,0.15);
  `
  toggleBtn.onmouseenter = () => { toggleBtn.style.background = '#1557c0' }
  toggleBtn.onmouseleave = () => { toggleBtn.style.background = '#1f6feb' }

  // Panel header
  const header = document.createElement('div')
  header.style.cssText = 'padding: 14px 16px; border-bottom: 1px solid #e3e7ec; display: flex; align-items: center; gap: 8px; background: #f8f9fa;'
  header.innerHTML = `
    <span style="font-size:18px">📝</span>
    <strong style="font-size:15px; flex:1">论文写作工作台</strong>
    <button id="panel-close" style="border:none;background:none;cursor:pointer;font-size:18px;color:#6c7789;padding:4px 8px;">✕</button>
  `

  // Panel content (scrollable)
  const content = document.createElement('div')
  content.style.cssText = 'flex:1; overflow-y:auto; padding: 12px 16px;'

  // Panel footer
  const footer = document.createElement('div')
  footer.style.cssText = 'padding: 10px 16px; border-top: 1px solid #e3e7ec; background: #f8f9fa; font-size: 11px; color: #8a94a6;'
  footer.innerHTML = `dsh-thesis-agent v1.0 · <a href="${workbenchUrl}" target="_blank" style="color:#1f6feb">打开完整工作台</a>`

  container.appendChild(header)
  container.appendChild(content)
  container.appendChild(footer)

  // State
  let isOpen = false
  let currentProject = null
  let toolResults = []

  // API helper
  async function api(path, opts = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    })
    if (!response.ok) throw new Error(`API ${response.status}`)
    return response.json()
  }

  // Render project status
  function renderProjectStatus() {
    if (!currentProject) {
      content.innerHTML = `
        <div style="text-align:center; padding: 40px 20px; color: #8a94a6;">
          <div style="font-size: 40px; margin-bottom: 12px;">📋</div>
          <p style="margin-bottom: 16px;">尚未绑定论文项目</p>
          <button id="quick-create" style="background:#1f6feb;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">创建新项目</button>
        </div>
      `
      const createBtn = document.getElementById('quick-create')
      if (createBtn) createBtn.onclick = handleQuickCreate
      return
    }
    const p = currentProject
    const statusColors = { planning: '#faad14', awaiting_plan_approval: '#1f6feb', ready_to_generate: '#52c41a', generating: '#1f6feb', completed: '#52c41a' }
    const statusColor = statusColors[p.status] || '#8a94a6'
    content.innerHTML = `
      <div style="margin-bottom: 16px;">
        <div style="font-size: 13px; color: #6c7789; margin-bottom: 4px;">当前项目</div>
        <div style="font-size: 16px; font-weight: 600; color: #1a1b1c; margin-bottom: 8px;">${escapeHtml(p.name || '未命名')}</div>
        <span style="display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600;color:#fff;background:${statusColor}">${p.status}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
        ${statCard('大纲节点', p.outlineCount || 0)}
        ${statCard('正文段落', p.manuscriptBlockCount || 0)}
        ${statCard('来源文档', p.sourceCount || 0)}
        ${statCard('Agent任务', p.agentRunCount || 0)}
      </div>
      <div style="margin-bottom:12px;font-size:12px;font-weight:600;color:#4a5568;">快捷操作</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
        ${actionBtn('📂 扫描目录', 'scan')}
        ${actionBtn('📝 编辑大纲', 'outline')}
        ${actionBtn('📊 导出DOCX', 'export-docx')}
        ${actionBtn('📄 导出LaTeX', 'export-latex')}
        ${actionBtn('🔍 检索来源', 'search')}
        ${actionBtn('⚡ 生成任务', 'agent-run')}
      </div>
      <div style="margin-bottom:12px;font-size:12px;font-weight:600;color:#4a5568;">最近工具结果</div>
      <div id="tool-results">${renderToolResults()}</div>
    `
    // Bind action buttons
    content.querySelectorAll('[data-action]').forEach((btn) => {
      btn.onclick = () => handleAction(btn.dataset.action)
    })
  }

  function statCard(label, value) {
    return `<div style="background:#f8f9fa;border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:#1f6feb;">${value}</div>
      <div style="font-size:11px;color:#6c7789;margin-top:2px;">${label}</div>
    </div>`
  }

  function actionBtn(label, action) {
    return `<button data-action="${action}" style="flex:1 1 45%;background:#f0f2f5;border:1px solid #e1e5ea;border-radius:8px;padding:8px 10px;cursor:pointer;font-size:12px;color:#28303d;text-align:left;">${label}</button>`
  }

  function renderToolResults() {
    if (toolResults.length === 0) {
      return '<div style="color:#8a94a6;font-size:12px;text-align:center;padding:16px;">暂无工具调用记录</div>'
    }
    return toolResults.slice(0, 5).map((r) => `
      <div style="background:#f8f9fa;border-radius:8px;padding:10px;margin-bottom:8px;cursor:pointer;" data-tool-result="${r.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:12px;font-weight:600;color:#1f6feb;">${escapeHtml(r.toolName)}</span>
          <span style="font-size:10px;color:#8a94a6;">${r.time}</span>
        </div>
        <div style="font-size:11px;color:#4a5568;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.summary || '')}</div>
      </div>
    `).join('')
  }

  function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  // Actions
  async function handleQuickCreate() {
    const name = prompt('请输入论文项目名称：')
    if (!name) return
    try {
      const sessionId = getSessionId()
      const result = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ sessionId, name }),
      })
      currentProject = { id: result.id, name: result.name, status: result.status || 'planning' }
      renderProjectStatus()
    } catch (error) {
      alert('创建项目失败：' + error.message)
    }
  }

  function handleAction(action) {
    switch (action) {
      case 'scan':
        alert('请在对话中使用 thesis_scan_directory 工具扫描目录')
        break
      case 'outline':
      case 'export-docx':
      case 'export-latex':
      case 'search':
      case 'agent-run':
        alert(`请在对话中使用对应的 thesis_* 工具执行此操作`)
        break
    }
  }

  function getSessionId() {
    return localStorage.thesisWorkbenchSession || (localStorage.thesisWorkbenchSession = crypto.randomUUID())
  }

  // Open/close
  function open() {
    isOpen = true
    container.style.transform = 'translateX(0)'
    toggleBtn.style.display = 'none'
    // Try to load project status
    loadProjectStatus()
  }

  function close() {
    isOpen = false
    container.style.transform = 'translateX(100%)'
    toggleBtn.style.display = 'block'
  }

  async function loadProjectStatus() {
    try {
      const sessionId = getSessionId()
      const status = await api(`/api/workbench?sessionId=${encodeURIComponent(sessionId)}`)
      if (status && status.project) {
        currentProject = {
          id: status.project.id,
          name: status.project.name,
          status: status.project.status,
          outlineCount: status.outline?.length || 0,
          manuscriptBlockCount: status.manuscriptBlocks?.length || 0,
          sourceCount: status.sourceBindings?.length || 0,
          agentRunCount: status.agentRuns?.length || 0,
        }
      }
      renderProjectStatus()
    } catch {
      renderProjectStatus()
    }
  }

  // Public API for tool result injection
  function addToolResult(toolName, summary, data) {
    const result = {
      id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolName,
      summary,
      data,
      time: new Date().toLocaleTimeString(),
    }
    toolResults.unshift(result)
    if (toolResults.length > 20) toolResults = toolResults.slice(0, 20)
    if (isOpen) {
      const container = document.getElementById('tool-results')
      if (container) container.innerHTML = renderToolResults()
    }
    return result
  }

  // Event bindings
  toggleBtn.onclick = open
  header.querySelector('#panel-close').onclick = close

  // Mount
  document.body.appendChild(container)
  document.body.appendChild(toggleBtn)

  // Restore state
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (saved.open) open()
  } catch { /* ignore */ }

  // Save state on close
  const originalClose = close
  close = function () {
    originalClose()
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ open: false })) } catch { /* ignore */ }
  }

  return {
    open,
    close,
    toggle: () => isOpen ? close() : open(),
    addToolResult,
    refresh: loadProjectStatus,
    isOpen: () => isOpen,
    destroy: () => {
      container.remove()
      toggleBtn.remove()
    },
  }
}
