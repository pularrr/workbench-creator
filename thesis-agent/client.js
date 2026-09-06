window.__ModuleLoader__.load({
  id: 'dsh-thesis-agent',
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports
    const jsx = require('react/jsx-runtime')
    const inject = ['slots']

    const WORKBENCH_URL = 'http://127.0.0.1:3199'
    const PANEL_WIDTH = 380

    // -----------------------------------------------------------------------
    // Side panel (vanilla JS, injected into DSH conversation UI)
    // -----------------------------------------------------------------------
    let panelInstance = null

    function ensurePanel() {
      if (panelInstance) return panelInstance
      panelInstance = createSidePanel({ workbenchUrl: WORKBENCH_URL })
      return panelInstance
    }

    function createSidePanel(options) {
      const workbenchUrl = options.workbenchUrl
      const apiBase = workbenchUrl

      // Container
      const container = document.createElement('div')
      container.id = 'thesis-side-panel'
      container.style.cssText = `
        position:fixed;top:0;right:0;height:100vh;width:${PANEL_WIDTH}px;
        background:#fff;border-left:1px solid #e3e7ec;box-shadow:-4px 0 20px rgba(0,0,0,0.1);
        z-index:99999;display:flex;flex-direction:column;
        transform:translateX(100%);transition:transform 0.25s cubic-bezier(0.4,0,0.2,1);
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;
      `

      // Toggle tab (visible when closed)
      const toggleTab = document.createElement('div')
      toggleTab.id = 'thesis-panel-tab'
      toggleTab.textContent = '📝 论文工作台'
      toggleTab.style.cssText = `
        position:fixed;top:50%;right:0;transform:translateY(-50%);
        background:linear-gradient(135deg,#1f6feb,#3b82f6);color:#fff;
        padding:14px 8px;border-radius:10px 0 0 10px;cursor:pointer;
        font-size:13px;font-weight:600;writing-mode:vertical-rl;
        z-index:100000;box-shadow:-2px 0 10px rgba(31,111,235,0.3);
        letter-spacing:2px;user-select:none;
      `
      toggleTab.onmouseenter = () => { toggleTab.style.opacity = '0.9' }
      toggleTab.onmouseleave = () => { toggleTab.style.opacity = '1' }

      // Header
      const header = document.createElement('div')
      header.style.cssText = 'padding:14px 16px;border-bottom:1px solid #e3e7ec;display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#f8faff,#fff);'
      header.innerHTML = `
        <span style="font-size:20px">📝</span>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:700;color:#1a1b1c">论文写作工作台</div>
          <div style="font-size:11px;color:#8a94a6;margin-top:1px">dsh-thesis-agent v1.0</div>
        </div>
        <button id="panel-open-full" title="在新标签页打开完整工作台" style="border:none;background:#f0f2f5;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px;color:#4a5568;">↗ 完整</button>
        <button id="panel-close" style="border:none;background:none;cursor:pointer;font-size:18px;color:#8a94a6;padding:4px 6px;">✕</button>
      `

      // Content
      const content = document.createElement('div')
      content.style.cssText = 'flex:1;overflow-y:auto;padding:14px 16px;'

      // Footer
      const footer = document.createElement('div')
      footer.style.cssText = 'padding:10px 16px;border-top:1px solid #e3e7ec;background:#f8f9fa;font-size:11px;color:#8a94a6;display:flex;justify-content:space-between;align-items:center;'
      footer.innerHTML = `<span>数据来源: ${workbenchUrl}</span><span id="panel-status">就绪</span>`

      container.appendChild(header)
      container.appendChild(content)
      container.appendChild(footer)

      let isOpen = false
      let currentProject = null

      function escapeHtml(text) {
        return String(text || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
      }

      function getSessionId() {
        return localStorage.thesisWorkbenchSession || (localStorage.thesisWorkbenchSession = crypto.randomUUID())
      }

      async function api(path, opts) {
        const response = await fetch(`${apiBase}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      }

      function setStatus(text) {
        const el = document.getElementById('panel-status')
        if (el) el.textContent = text
      }

      function renderEmpty() {
        content.innerHTML = `
          <div style="text-align:center;padding:48px 20px;">
            <div style="font-size:48px;margin-bottom:16px;opacity:0.6;">📋</div>
            <div style="font-size:15px;font-weight:600;color:#4a5568;margin-bottom:8px;">尚未绑定论文项目</div>
            <div style="font-size:12px;color:#8a94a6;margin-bottom:20px;">在对话中创建或绑定项目后，这里将显示项目状态</div>
            <button id="panel-create" style="background:linear-gradient(135deg,#1f6feb,#3b82f6);color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">+ 创建新项目</button>
          </div>
        `
        const btn = document.getElementById('panel-create')
        if (btn) btn.onclick = async () => {
          const name = prompt('请输入论文项目名称：')
          if (!name) return
          try {
            setStatus('创建中...')
            const result = await api('/api/projects', { method: 'POST', body: JSON.stringify({ sessionId: getSessionId(), name }) })
            setStatus('项目已创建')
            await refresh()
          } catch (e) {
            setStatus('创建失败')
            alert('创建失败：' + e.message)
          }
        }
      }

      function renderProject() {
        const p = currentProject
        if (!p) { renderEmpty(); return }
        const statusMap = {
          planning: { color: '#faad14', label: '规划中' },
          awaiting_plan_approval: { color: '#1f6feb', label: '等待计划确认' },
          ready_to_generate: { color: '#52c41a', label: '准备生成' },
          generating: { color: '#1f6feb', label: '生成中' },
          reviewing: { color: '#722ed1', label: '审查中' },
          completed: { color: '#52c41a', label: '已完成' },
        }
        const st = statusMap[p.status] || { color: '#8a94a6', label: p.status }
        content.innerHTML = `
          <div style="margin-bottom:16px;">
            <div style="font-size:11px;color:#8a94a6;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px;">当前项目</div>
            <div style="font-size:17px;font-weight:700;color:#1a1b1c;margin-bottom:8px;line-height:1.3;">${escapeHtml(p.name)}</div>
            <span style="display:inline-block;padding:4px 12px;border-radius:99px;font-size:11px;font-weight:600;color:#fff;background:${st.color};">${st.label}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px;">
            ${statCard('📑 大纲', p.outlineCount || 0)}
            ${statCard('📝 段落', p.manuscriptBlockCount || 0)}
            ${statCard('📚 来源', p.sourceCount || 0)}
            ${statCard('⚡ 任务', p.agentRunCount || 0)}
          </div>
          <div style="margin-bottom:10px;font-size:12px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:0.5px;">快捷操作</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:18px;">
            ${quickBtn('📂 扫描目录', 'scan')}
            ${quickBtn('📋 查看大纲', 'outline')}
            ${quickBtn('🔍 检索来源', 'search')}
            ${quickBtn('⚡ 新建任务', 'agent')}
            ${quickBtn('📊 导出 DOCX', 'docx')}
            ${quickBtn('📄 导出 LaTeX', 'latex')}
          </div>
          <div style="margin-bottom:10px;font-size:12px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:0.5px;">项目信息</div>
          <div style="background:#f8f9fa;border-radius:8px;padding:12px;font-size:12px;color:#4a5568;line-height:1.8;">
            <div><span style="color:#8a94a6;">项目ID:</span> <code style="font-size:11px;">${escapeHtml(p.id?.slice(0, 12) || '')}...</code></div>
            <div><span style="color:#8a94a6;">计划版本:</span> ${p.planningRevision || 0}</div>
            <div><span style="color:#8a94a6;">正文版本:</span> ${p.manuscriptRevision || 0}</div>
            <div><span style="color:#8a94a6;">更新时间:</span> ${p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '-'}</div>
          </div>
        `
        content.querySelectorAll('[data-quick]').forEach((btn) => {
          btn.onclick = () => {
            const action = btn.dataset.quick
            const hints = {
              scan: '请在对话中输入：扫描目录，或使用 thesis_scan_directory 工具',
              outline: '请在对话中查看或编辑大纲，使用 thesis_get_workbench 获取当前状态',
              search: '请在对话中使用 thesis_search_sources 工具检索来源',
              agent: '请在对话中使用 thesis_create_agent_run 工具新建受控生成任务',
              docx: '请在对话中使用 thesis_export_current_docx 工具导出',
              latex: '请在对话中使用 thesis_export_current_latex 工具导出',
            }
            alert(hints[action] || '请在对话中使用对应工具')
          }
        })
      }

      function statCard(label, value) {
        return `<div style="background:linear-gradient(135deg,#f8faff,#fff);border:1px solid #e8edf5;border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:22px;font-weight:700;color:#1f6feb;">${value}</div>
          <div style="font-size:11px;color:#6c7789;margin-top:2px;">${label}</div>
        </div>`
      }

      function quickBtn(label, action) {
        return `<button data-quick="${action}" style="background:#f8f9fa;border:1px solid #e1e5ea;border-radius:8px;padding:10px 8px;cursor:pointer;font-size:12px;color:#28303d;text-align:left;transition:all 0.15s;">${label}</button>`
      }

      async function refresh() {
        try {
          setStatus('加载中...')
          const wb = await api(`/api/workbench?sessionId=${encodeURIComponent(getSessionId())}`)
          if (wb && wb.project) {
            currentProject = {
              id: wb.project.id,
              name: wb.project.name,
              status: wb.project.status,
              planningRevision: wb.project.planningRevision,
              manuscriptRevision: wb.project.manuscriptRevision,
              updatedAt: wb.project.updatedAt,
              outlineCount: wb.outline?.length || 0,
              manuscriptBlockCount: wb.manuscriptBlocks?.length || 0,
              sourceCount: wb.sourceBindings?.length || 0,
              agentRunCount: wb.agentRuns?.length || 0,
            }
          } else {
            currentProject = null
          }
          renderProject()
          setStatus('已更新')
        } catch (e) {
          currentProject = null
          renderEmpty()
          setStatus('连接失败')
        }
      }

      function open() {
        isOpen = true
        container.style.transform = 'translateX(0)'
        toggleTab.style.display = 'none'
        refresh()
      }

      function close() {
        isOpen = false
        container.style.transform = 'translateX(100%)'
        toggleTab.style.display = 'block'
      }

      // Events
      toggleTab.onclick = open
      header.querySelector('#panel-close').onclick = close
      header.querySelector('#panel-open-full').onclick = () => window.open(workbenchUrl, 'dsh-thesis-workbench')

      // ---------------------------------------------------------------------
      // Auto-follow: bind this panel session to the most recently active
      // project (the one created/loaded via natural-language dialogue) and
      // open the panel automatically the first time a project appears — so
      // "帮我加载项目文件" auto-opens the matching workbench, no manual step.
      // ---------------------------------------------------------------------
      let autoOpenedProject = null
      try { autoOpenedProject = localStorage.getItem('thesisAutoOpenedProject') } catch (e) { /* ignore */ }

      async function followAndMaybeOpen() {
        if (isOpen) return // user already interacting: never steal focus
        let bound = null
        try {
          bound = await api('/api/follow', { method: 'POST', body: JSON.stringify({ sessionId: getSessionId() }) })
        } catch (e) { return }
        if (!bound || !bound.bound || !bound.id) return
        if (autoOpenedProject === bound.id) return // already auto-opened for this project
        autoOpenedProject = bound.id
        try { localStorage.setItem('thesisAutoOpenedProject', bound.id) } catch (e) { /* ignore */ }
        open()
        setStatus(`已检测到项目「${bound.name || ''}」，自动打开工作台`)
      }

      followAndMaybeOpen()
      setInterval(followAndMaybeOpen, 3000)

      // Mount
      document.body.appendChild(container)
      document.body.appendChild(toggleTab)

      return {
        open, close,
        toggle: () => isOpen ? close() : open(),
        refresh,
        isOpen: () => isOpen,
        addToolResult: (name, summary) => {
          // Hook for future host tool-result callbacks; current auto-open is
          // driven by the follow poller above. Opening on these tools matches
          // the "load project / scan directory" natural-language intent.
          if (name && /create_project|bind_project|import_source|scan_directory|follow_recent/.test(name)) {
            open()
            setStatus('工具执行完成：' + (summary || name))
          }
        },
        destroy: () => { container.remove(); toggleTab.remove(); panelInstance = null },
      }
    }

    // -----------------------------------------------------------------------
    // DSH slot injection
    // -----------------------------------------------------------------------
    function WorkbenchButton() {
      return jsx.jsx('button', {
        type: 'button',
        title: '打开论文写作工作台面板',
        onClick: () => {
          const panel = ensurePanel()
          panel.toggle()
        },
        style: {
          border: '1px solid var(--dsw-alias-border-l2, #d7dce2)',
          borderRadius: 8,
          background: 'linear-gradient(135deg, #1f6feb, #3b82f6)',
          color: '#fff',
          padding: '5px 14px',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 13,
        },
        children: '📝 论文工作台',
      })
    }

    function apply(ctx) {
      // Mount the (hidden) side panel up front so the auto-follow poller can
      // detect a project created/loaded from natural language and open it
      // automatically. Toggling stays available via the header button.
      ensurePanel()
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'thesis-workbench',
        order: 40,
        label: '论文工作台',
      }, WorkbenchButton))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
