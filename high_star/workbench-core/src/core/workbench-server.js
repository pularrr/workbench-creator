/**
 * Generic workbench HTTP server for the pluggable framework.
 * Serves the dual-pane 4:3 draggable editor UI and REST API.
 * Task-type-agnostic: all content comes from the runtime + plugins.
 */

import http from 'node:http'
import { createPluginSpecDraft, validatePluginSpec } from './plugin-spec.js'
import { generatePluginBundle } from '../generator.js'
import { assertToolAllowedForStage } from '../work-stage.js'

export function createWorkbenchServer(runtime, options = {}) {
  const port = options.port || 3200
  const host = options.host || '127.0.0.1'
  const guard = async (sessionId, toolName) => {
    if (options.enforceStages !== false) await assertToolAllowedForStage(runtime, sessionId, toolName)
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${host}:${port}`)
    try {
      // ─── Page ───────────────────────────────────────────────────────
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self' 'unsafe-inline'; connect-src 'self'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' })
        response.end(pageHtml())
        return
      }

      // ─── Projects API ───────────────────────────────────────────────
      if (request.method === 'GET' && url.pathname === '/api/projects') {
        return json(response, 200, await runtime.listProjects())
      }
      if (request.method === 'POST' && url.pathname === '/api/projects') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_create_project')
        return json(response, 200, await runtime.createProject(input.sessionId, input))
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/projects/')) {
        const projectId = url.pathname.split('/').pop()
        await guard(url.searchParams.get('sessionId'), 'wb_delete_project')
        return json(response, 200, await runtime.deleteProject(projectId))
      }
      if (request.method === 'POST' && url.pathname === '/api/bind') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_bind_project')
        return json(response, 200, await runtime.bindProject(input.sessionId, input.projectId, { assistantKey: input.assistantKey }))
      }
      if (request.method === 'POST' && url.pathname === '/api/unbind') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_unbind_project')
        return json(response, 200, await runtime.unbindProject(input.sessionId, { assistantKey: input.assistantKey }))
      }
      if (request.method === 'GET' && url.pathname === '/api/session') {
        const sessionId = url.searchParams.get('sessionId')
        return json(response, 200, await runtime.getResumeState(sessionId, url.searchParams.get('assistantKey')))
      }
      if (request.method === 'GET' && url.pathname === '/api/project-limit') {
        return json(response, 200, await runtime.getProjectLimit())
      }
      if (request.method === 'GET' && url.pathname === '/api/archives') {
        return json(response, 200, await runtime.listArchivedProjects())
      }
      if (request.method === 'POST' && url.pathname === '/api/follow') {
        const input = await body(request)
        return json(response, 200, await runtime.followProject(input.sessionId))
      }

      // ─── Workbench State ────────────────────────────────────────────
      if (request.method === 'GET' && url.pathname === '/api/workbench') {
        return json(response, 200, await runtime.getWorkbench(url.searchParams.get('sessionId')))
      }

      // ─── Outline / Manuscript ────────────────────────────────────────
      if (request.method === 'POST' && url.pathname === '/api/plan') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_set_outline')
        return json(response, 200, await runtime.setOutline(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/manuscript') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_set_manuscript')
        return json(response, 200, await runtime.setManuscriptBlocks(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/domain-fields') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_set_domain_fields')
        return json(response, 200, await runtime.setDomainFields(input.sessionId, input.fields || {}))
      }
      if (request.method === 'POST' && url.pathname === '/api/materials') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_add_material')
        return json(response, 200, await runtime.addMaterial(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/materials/import-file') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_import_material_file')
        return json(response, 200, await runtime.importMaterialFile(input.sessionId, input.filePath))
      }
      if (request.method === 'POST' && url.pathname === '/api/materials/search') {
        const input = await body(request)
        return json(response, 200, await runtime.searchMaterials(input.sessionId, input.query, input.limit))
      }
      if (request.method === 'POST' && url.pathname === '/api/evidence/bind') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_bind_evidence')
        return json(response, 200, await runtime.bindEvidence(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/snapshots') {
        const input = await body(request)
        return json(response, 200, await runtime.createSnapshot(input.sessionId, input.name))
      }
      if (request.method === 'POST' && url.pathname === '/api/snapshots/restore') {
        const input = await body(request)
        await guard(input.sessionId, 'wb_restore_snapshot')
        return json(response, 200, await runtime.restoreSnapshot(input.sessionId, input.snapshotId))
      }
      if (request.method === 'POST' && url.pathname === '/api/export') {
        const input = await body(request)
        return json(response, 200, await runtime.exportDocument(input.sessionId, input.format))
      }

      // ─── Spec Studio (JSON only until the user explicitly generates) ──
      if (request.method === 'POST' && url.pathname === '/api/plugin-spec/draft') {
        return json(response, 200, createPluginSpecDraft(await body(request)))
      }
      if (request.method === 'POST' && url.pathname === '/api/plugin-spec/validate') {
        const input = await body(request)
        return json(response, 200, validatePluginSpec(input.spec))
      }
      if (request.method === 'POST' && url.pathname === '/api/plugin-spec/generate') {
        const input = await body(request)
        return json(response, 200, await generatePluginBundle({ spec: input.spec, outputRoot: input.outputRoot, confirmedDestination: input.confirmedDestination === true }))
      }

      // ─── Runs (State Machine) ────────────────────────────────────────
      if (request.method === 'POST' && url.pathname === '/api/runs') {
        const input = await body(request)
        return json(response, 200, await runtime.createRun(input.sessionId, input))
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/runs/')) {
        const runId = url.pathname.split('/').pop()
        return json(response, 200, await runtime.getRun(url.searchParams.get('sessionId'), runId))
      }
      if (request.method === 'POST' && url.pathname === '/api/runs/advance') {
        const input = await body(request)
        return json(response, 200, await runtime.advanceRun(input.sessionId, input))
      }
      if (request.method === 'POST' && url.pathname === '/api/runs/cancel') {
        const input = await body(request)
        return json(response, 200, await runtime.cancelRun(input.sessionId, input))
      }

      // ─── Templates ───────────────────────────────────────────────────
      if (request.method === 'GET' && url.pathname === '/api/templates') {
        return json(response, 200, await runtime.listTemplates(url.searchParams.get('sessionId')))
      }
      if (request.method === 'POST' && url.pathname === '/api/templates') {
        const input = await body(request)
        return json(response, 200, await runtime.saveTemplate(input.sessionId, input))
      }

      // ─── Regeneration ────────────────────────────────────────────────
      if (request.method === 'POST' && url.pathname === '/api/request-regeneration') {
        const input = await body(request)
        return json(response, 200, await runtime.requestRegeneration(input.sessionId, input))
      }

      // ─── 404 ─────────────────────────────────────────────────────────
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'Not found', path: url.pathname }))
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: error.message }))
    }
  })

  const start = (listenPort) => server.listen(listenPort, host, () => {
    server.port = listenPort
    server.url = `http://${host}:${listenPort}`
    console.log(`[workbench-core] Workbench UI running at ${server.url}`)
  })
  server.once('error', (error) => {
    if (error.code !== 'EADDRINUSE' || options.fallback === false) throw error
    const fallbackPort = options.fallbackPort || (port + 1)
    console.warn(`[workbench-core] Port ${port} is busy; using ${fallbackPort}`)
    start(fallbackPort)
  })
  start(port)

  return server
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(data))
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

function pageHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pluggable Workbench</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI','PingFang SC',sans-serif;background:#f4f3ee;color:#1a1b1c;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.top{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fff;border-bottom:1px solid #e4e3dd;flex-wrap:wrap}
.top strong{font-size:14px;margin-right:8px}
.top select{padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:12px}
.top button{padding:4px 12px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;white-space:nowrap}
.top button:hover{background:#f3f4f6}
.status{margin-left:auto;font-size:11px;color:#6b7280;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:1;min-width:0}
.layout{flex:1;display:flex;overflow:hidden}
.paper{flex:0 0 57%;display:flex;flex-direction:column;border-right:1px solid #e4e3dd;min-width:0}
.paper textarea{flex:1;border:none;outline:none;padding:16px;font-size:14px;line-height:1.7;resize:none;background:#fff;font-family:'Georgia',serif}
.resizer{width:5px;background:#e4e3dd;cursor:col-resize;flex-shrink:0;transition:background .2s}
.resizer:hover,.resizer.active{background:#3b82f6}
.side{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.tabs{display:flex;gap:0;border-bottom:1px solid #e4e3dd;background:#fff;overflow-x:auto}
.tabs button{padding:8px 14px;border:none;background:transparent;cursor:pointer;font-size:12px;color:#6b7280;white-space:nowrap;border-bottom:2px solid transparent}
.tabs button.active{color:#1f6feb;border-bottom-color:#1f6feb;font-weight:600}
.panel{flex:1;overflow-y:auto;padding:12px;display:none}
.panel.active{display:block}
.card{background:#fff;border:1px solid #e4e3dd;border-radius:8px;padding:10px;margin-bottom:10px}
.card h3{font-size:13px;margin-bottom:6px}
.card input,.card textarea{width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;margin-top:4px}
.card textarea{min-height:60px;resize:vertical}
.badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;background:#e8f0fe;color:#1f6feb;margin-right:6px}
.muted{font-size:11px;color:#6b7280;margin-top:4px}
.empty{text-align:center;color:#9ca3af;padding:40px 20px;font-size:13px}
</style>
</head>
<body>
<header class="top">
<strong>Pluggable Workbench</strong>
<select id="projects"></select>
<button id="create">新建</button>
<button id="deleteProject" style="color:#c0392b;border-color:#e74c3c">删除</button>
<button id="refresh">刷新</button>
<button id="save">保存正文</button>
<button id="savePlan">保存大纲</button>
<button id="regenerate" style="background:linear-gradient(135deg,#1f6feb,#3b82f6);color:#fff;border-color:#1f6feb">让 DSH 重写选中文本</button>
<span class="status" id="status">等待连接</span>
</header>
<main class="layout">
<section class="paper"><textarea id="editor" placeholder="选择或创建项目后，在这里编辑正文。"></textarea></section>
<div class="resizer" title="拖拽调整左右宽度"></div>
<aside class="side">
<nav class="tabs">
<button data-tab="outline" class="active">大纲</button>
<button data-tab="logic">逻辑</button>
<button data-tab="sources">引用</button>
<button data-tab="review">审查</button>
<button data-tab="runs">任务</button>
<button data-tab="templates">模板</button>
<button data-tab="versions">版本</button>
<button data-tab="spec">规格</button>
<button data-tab="settings">设置</button>
</nav>
<div id="outline" class="panel active"></div>
<div id="logic" class="panel"></div>
<div id="sources" class="panel"></div>
<div id="review" class="panel"></div>
<div id="runs" class="panel"></div>
<div id="templates" class="panel"></div>
<div id="versions" class="panel"></div>
<div id="spec" class="panel"></div>
<div id="settings" class="panel"></div>
</aside>
</main>
<script>
// The DSH tool that opens this page passes its session id in the URL. Keeping
// it makes browser actions operate on exactly the same shared project binding.
const requestedSessionId=new URLSearchParams(location.search).get('sessionId');
const sessionId=requestedSessionId||localStorage.wbSession||(localStorage.wbSession=crypto.randomUUID());
const assistantKey=new URLSearchParams(location.search).get('assistantKey')||'web:text-workbench-assistant-v0';
const homeMode=new URLSearchParams(location.search).get('home')==='1';
let wb=null;let selectedBlock=null;
const el=id=>document.getElementById(id);
function status(t){el('status').textContent=t}
async function api(path,options={}){const r=await fetch('/api'+path,{headers:{'content-type':'application/json'},...options});const v=await r.json();if(!r.ok)throw new Error(v.error||'请求失败');return v}
async function projects(){const rows=await api('/projects');el('projects').innerHTML='<option value="">选择项目</option>'+rows.map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name)+' ('+x.taskType+')</option>').join('');if(homeMode){status(rows.length?'请选择项目或点击「新建」':'暂无项目，请点击「新建」');return}const active=localStorage.wbProjectId;if(active&&rows.some(x=>x.id===active)){el('projects').value=active;await bind(active)}else if(rows.length){el('projects').value=rows[0].id;await bind(rows[0].id)}else{status('暂无项目，请点击「新建」')}}
async function bind(id){await api('/bind',{method:'POST',body:JSON.stringify({sessionId,projectId:id,assistantKey})});localStorage.wbProjectId=id;await load()}
async function load(){try{wb=await api('/workbench?sessionId='+encodeURIComponent(sessionId));render();status('已加载 · '+wb.project.taskType+' · '+wb.project.name)}catch(e){status(e.message)}}
function escapeHtml(t){return String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function sendToDsh(prompt){
  if(!window.opener||window.opener===window)throw new Error('请从 DSH 内的“打开工作台”链接打开此页面，才能把请求发送回当前对话。');
  window.opener.postMessage({source:'dsh-workbench-core',type:'submit-prompt',sessionId,prompt},'*');
}
window.addEventListener('message',event=>{
  if(event.data?.source==='dsh-workbench-core'&&event.data?.type==='prompt-accepted')status('已发送给 DSH Agent，完成后工作台会自动刷新');
});
function render(){
const labels=wb.ui||{};
document.querySelector('[data-tab="outline"]').textContent=labels.outlineLabel||'大纲';document.querySelector('[data-tab="logic"]').textContent=labels.logicLabel||'逻辑';document.querySelector('[data-tab="sources"]').textContent=labels.evidenceLabel||'引用';el('editor').placeholder=labels.editorLabel||'在这里编辑正文。';
el('outline').innerHTML=(wb.outline||[]).map(x=>'<article class="card"><input data-title="'+x.id+'" value="'+escapeHtml(x.title)+'" style="width:100%;font-weight:600"><textarea data-objective="'+x.id+'" style="width:100%;margin-top:6px">'+escapeHtml(x.objective||'')+'</textarea><div class="muted">目标 '+(x.targetWords||0)+' 字 · 图 '+(x.expectedFigures||0)+' · 表 '+(x.expectedTables||0)+'</div></article>').join('')||'<div class="empty">尚未建立大纲</div>';
const blocks=[...(wb.manuscriptBlocks||[])].sort((a,b)=>a.order-b.order);
el('editor').value=blocks.map(x=>x.markdown).join('\\n\\n');
if(!selectedBlock&&blocks[0])selectedBlock=blocks[0].id;
el('logic').innerHTML=(wb.logicBlocks||[]).filter(x=>!selectedBlock||(wb.manuscriptBlocks.find(b=>b.id===selectedBlock)?.logicBlockIds||[]).includes(x.id)).map(x=>'<article class="card"><h3>'+escapeHtml(x.purpose||'写作目标')+'</h3><div class="muted">承接: '+escapeHtml(x.transition||'')+'</div></article>').join('')||'<div class="empty">在正文中选择段落后显示对应逻辑</div>';
el('sources').innerHTML=(wb.citations||[]).map(x=>'<article class="card"><span class="badge">'+escapeHtml(x.status||'cited')+'</span><div>'+escapeHtml(x.text||x.citationKey||'')+'</div></article>').join('')||'<div class="empty">暂无引用</div>';
el('review').innerHTML='<button id="askReviewAgent">请 DSH 审查当前文本</button><div class="muted" style="margin:6px 0 10px">审查结论会由 Review Agent 写回此处，不会自动改动正文。</div>'+((wb.reviewSuggestions||[]).map(x=>'<article class="card"><h3>'+escapeHtml(x.editedSuggestion||x.suggestion||'')+'</h3><div class="muted">'+escapeHtml(x.category||'')+' · '+escapeHtml(x.severity||x.status||'')+'</div></article>').join('')||'<div class="empty">暂无审查建议</div>');
const askReviewAgent=el('askReviewAgent');if(askReviewAgent)askReviewAgent.onclick=()=>{try{const text=el('editor').value;sendToDsh('【工作台审查请求】用户已明确请求进入 review 阶段并审查当前绑定项目的正文。请调用 wb_set_work_stage（stage=review，userConfirmed=true）后，检查结构、证据、引用和术语一致性。每条可执行建议都必须调用 wb_add_review_suggestion 保存；不要直接修改正文。当前页面正文如下：\n\n'+text);status('审查请求已发送给 DSH Agent')}catch(e){status(e.message)}};
el('runs').innerHTML='<button id="createRun">新建生成任务</button>'+(wb.runs||[]).map(x=>'<article class="card"><span class="badge">'+escapeHtml(x.state)+'</span><h3>'+escapeHtml(x.taskType)+'</h3><div class="muted">revision '+x.revision+' · '+new Date(x.updatedAt).toLocaleString()+'</div></article>').join('')||'<div class="empty">暂无运行记录</div>';
el('templates').innerHTML=(wb.customTemplates||[]).map(t=>'<article class="card"><span class="badge">'+escapeHtml(t.type||'text')+'</span><h3>'+escapeHtml(t.name||'未命名模板')+'</h3><div class="muted">rev '+(t.revision||1)+'</div><textarea style="width:100%;margin-top:6px;min-height:80px;font-family:monospace;font-size:11px">'+escapeHtml(t.content||'')+'</textarea></article>').join('')||'<div class="empty">暂无自定义模板</div>';
 const exportButtons=(wb.exportFormats||[]).map(x=>'<button data-export-format="'+escapeHtml(x.format)+'" style="margin-left:6px">导出 '+escapeHtml(x.name||x.format)+'</button>').join('');el('versions').innerHTML='<button id="createSnapshot">保存当前版本</button>'+exportButtons+(wb.snapshots||[]).map(s=>'<article class="card"><h3>'+escapeHtml(s.name)+'</h3><div class="muted">'+new Date(s.createdAt).toLocaleString()+' · '+s.blockCount+' 个文本块</div><button data-restore="'+s.id+'" style="margin-top:6px">恢复此版本</button></article>').join('')||'<div class="empty">暂无已保存版本</div>';
const createSnapshot=el('createSnapshot');if(createSnapshot)createSnapshot.onclick=async()=>{const name=prompt('版本名称','保存版本');if(!name)return;try{await api('/snapshots',{method:'POST',body:JSON.stringify({sessionId,name})});await load();status('版本已保存')}catch(e){status(e.message)}};
 document.querySelectorAll('[data-export-format]').forEach(button=>button.onclick=async()=>{const format=button.dataset.exportFormat;try{const result=await api('/export',{method:'POST',body:JSON.stringify({sessionId,format})});const bytes=result.data?Uint8Array.from(atob(result.data),c=>c.charCodeAt(0)):result.content;const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([bytes],{type:result.mimeType||'application/octet-stream'}));link.download=result.filename||('export.'+format);link.click();URL.revokeObjectURL(link.href);status('已导出 '+format)}catch(e){status(e.message)}});
document.querySelectorAll('[data-restore]').forEach(button=>button.onclick=async()=>{if(!confirm('恢复后将覆盖当前正文，是否继续？'))return;try{await api('/snapshots/restore',{method:'POST',body:JSON.stringify({sessionId,snapshotId:button.dataset.restore})});await load();status('版本已恢复')}catch(e){status(e.message)}});
renderSpecStudio();
const domainInputs=Object.entries(wb.domainFieldSchema||{}).map(([key,spec])=>'<label class="muted" style="display:block;margin-top:8px">'+escapeHtml(spec.label||key)+'<input data-domain-field="'+escapeHtml(key)+'" value="'+escapeHtml(wb.domainFields?.[key]||'')+'" style="width:100%;margin-top:3px"></label>').join('');
const materialRows=(wb.materials||[]).map(m=>'<article class="card"><strong>'+escapeHtml(m.name)+'</strong><div class="muted">'+escapeHtml(m.type)+' · '+escapeHtml(m.metadata?.materialRole||'未分类')+' · '+escapeHtml(m.status||'ready')+'</div><div class="muted">'+escapeHtml(m.summary||m.metadata?.extractionHint||'')+'</div><div class="muted">'+escapeHtml(m.suggestedEvidenceUse||'')+'</div></article>').join('')||'<div class="muted">暂无已登记材料</div>';
el('settings').innerHTML='<article class="card"><h3>插件信息</h3><div class="muted">任务类型: '+escapeHtml(wb.project.taskType)+'</div><div class="muted">框架: '+escapeHtml(wb.bundle.framework?.name||'未加载')+'</div><div class="muted">逻辑: '+escapeHtml(wb.bundle.logic?.name||'未加载')+'</div><div class="muted">凭证: '+escapeHtml(wb.bundle.evidence?.name||'未加载')+'</div></article><article class="card"><h3>领域字段</h3>'+domainInputs+'<button id="saveDomain" style="margin-top:10px">保存领域字段</button></article><article class="card"><h3>材料</h3>'+materialRows+'<button id="addMaterial" style="margin-top:10px">登记材料</button> <button id="importMaterial" style="margin-top:10px">导入本地文件</button></article>';
const saveDomain=el('saveDomain');if(saveDomain)saveDomain.onclick=async()=>{const fields={};document.querySelectorAll('[data-domain-field]').forEach(input=>fields[input.dataset.domainField]=input.value);try{await api('/domain-fields',{method:'POST',body:JSON.stringify({sessionId,fields})});await load();status('领域字段已保存')}catch(e){status(e.message)}};
const addMaterial=el('addMaterial');if(addMaterial)addMaterial.onclick=async()=>{const name=prompt('材料名称');if(!name)return;const type=prompt('材料类型 (text/pdf/docx/image/table)','text');if(!type)return;try{await api('/materials',{method:'POST',body:JSON.stringify({sessionId,name,type})});await load();status('材料已登记')}catch(e){status(e.message)}};
const importMaterial=el('importMaterial');if(importMaterial)importMaterial.onclick=async()=>{const filePath=prompt('请输入已选择的本地文件完整路径');if(!filePath)return;try{await api('/materials/import-file',{method:'POST',body:JSON.stringify({sessionId,filePath})});await load();status('材料已导入')}catch(e){status(e.message)}};
const createRunBtn=el('createRun');if(createRunBtn)createRunBtn.onclick=async()=>{try{await api('/runs',{method:'POST',body:JSON.stringify({sessionId,reviewEnabled:true})});await load();status('任务已创建')}catch(e){status(e.message)}};
}
function renderSpecStudio(){const saved=localStorage.wbPluginSpec||'';el('spec').innerHTML='<article class="card"><h3>领域工作台规格（JSON）</h3><div class="muted">修改规格、校验后，生成的插件包将与本工作台隔离。</div><textarea id="specEditor" style="width:100%;min-height:330px;margin-top:8px;font-family:monospace;font-size:12px">'+escapeHtml(saved)+'</textarea><button id="newSpec" style="margin-top:8px">新建规格</button> <button id="validateSpec" style="margin-top:8px">校验</button> <button id="generateSpec" style="margin-top:8px">生成独立插件包</button><div id="specStatus" class="muted" style="margin-top:8px"></div></article>';const value=()=>{try{return JSON.parse(el('specEditor').value)}catch(e){throw new Error('JSON 格式错误：'+e.message)}};el('newSpec').onclick=async()=>{const taskType=prompt('任务类型，例如 legal-contract','generic-workbench');const name=prompt('工作台名称','新文本工作台');if(!taskType||!name)return;const spec=await api('/plugin-spec/draft',{method:'POST',body:JSON.stringify({taskType,name})});el('specEditor').value=JSON.stringify(spec,null,2);localStorage.wbPluginSpec=el('specEditor').value};el('validateSpec').onclick=async()=>{try{const spec=value();localStorage.wbPluginSpec=JSON.stringify(spec,null,2);const result=await api('/plugin-spec/validate',{method:'POST',body:JSON.stringify({spec})});el('specStatus').textContent=result.valid?'规格校验通过':'规格问题：'+result.issues.join('；')}catch(e){el('specStatus').textContent=e.message}};el('generateSpec').onclick=async()=>{try{if(!confirm('将生成到默认 DSH 工作台插件目录。确认继续吗？'))return;const spec=value();const result=await api('/plugin-spec/generate',{method:'POST',body:JSON.stringify({spec,confirmedDestination:true})});localStorage.wbPluginSpec=JSON.stringify(spec,null,2);el('specStatus').textContent='已生成并验证：'+result.outputDir}catch(e){el('specStatus').textContent=e.message}}}
el('create').onclick=async()=>{const name=prompt('项目名称');if(!name)return;const taskType=prompt('任务类型 (thesis/patent/contract/generic)','thesis')||'thesis';let confirmedEviction=false;try{const limit=await api('/project-limit');if(limit.activeCount>=limit.limit){const old=limit.evictionCandidate;if(!confirm('当前已有 '+limit.limit+' 个项目。继续将归档最早项目“'+old.name+'”。是否继续？'))return;confirmedEviction=true}const created=await api('/projects',{method:'POST',body:JSON.stringify({sessionId,name,taskType,assistantKey,confirmedEviction})});localStorage.wbProjectId=created.id;await projects();await bind(created.id)}catch(e){status(e.message)}};
el('deleteProject').onclick=async()=>{const sel=el('projects').value;if(!sel)return status('请先选择要删除的项目');if(!confirm('确定归档此项目？项目仍可从归档中恢复。'))return;try{await api('/projects/'+sel+'?sessionId='+encodeURIComponent(sessionId),{method:'DELETE'});delete localStorage.wbProjectId;wb=null;el('editor').value='';status('项目已归档');await projects()}catch(e){status(e.message)}};
el('projects').onchange=e=>e.target.value&&bind(e.target.value);
el('refresh').onclick=load;
el('save').onclick=async()=>{if(!wb)return;const texts=el('editor').value.split(/\\n\\s*\\n/).filter(Boolean);const blocks=texts.map((markdown,i)=>({...(wb.manuscriptBlocks||[])[i],markdown}));try{await api('/manuscript',{method:'POST',body:JSON.stringify({sessionId,blocks})});await load();status('正文已保存')}catch(e){status(e.message)}};
el('savePlan').onclick=async()=>{if(!wb)return;const outline=(wb.outline||[]).map(node=>({...node,title:document.querySelector('[data-title="'+node.id+'"]')?.value||node.title,objective:document.querySelector('[data-objective="'+node.id+'"]')?.value||node.objective}));try{await api('/plan',{method:'POST',body:JSON.stringify({sessionId,confirmed:true,outline})});await load();status('大纲已保存')}catch(e){status(e.message)}};
el('regenerate').onclick=()=>{if(!wb)return status('请先选择项目');const editor=el('editor');const selected=editor.value.slice(editor.selectionStart,editor.selectionEnd);if(!selected)return status('请先在正文中选中需要重写的文本');const instruction=prompt('请说明如何重写选中文本','保持原意，提升表达清晰度并与上下文衔接');if(!instruction)return;try{sendToDsh('【工作台选中文本重写】用户明确请求在 write 阶段重写当前项目「'+wb.project.name+'」的下列文本。必要时调用 wb_set_work_stage（stage=write，userConfirmed=true）；基于已绑定项目、材料和上下文重写，随后通过 wb_set_manuscript 保存更新后的正文；不得捏造材料事实。\n\n重写要求：'+instruction+'\n\n选中文本：\n'+selected);status('重写请求已发送给 DSH Agent')}catch(e){status(e.message)}};
setInterval(()=>{if(wb)load()},3000);
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button,.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');el(b.dataset.tab).classList.add('active')});
(function initResizer(){const resizer=document.querySelector('.resizer');const paper=document.querySelector('.paper');if(!resizer||!paper)return;let isResizing=false;resizer.addEventListener('mousedown',e=>{isResizing=true;resizer.classList.add('active');document.body.style.cursor='col-resize';document.body.style.userSelect='none';e.preventDefault()});document.addEventListener('mousemove',e=>{if(!isResizing)return;const layout=document.querySelector('.layout');const rect=layout.getBoundingClientRect();const percent=((e.clientX-rect.left)/rect.width)*100;paper.style.flex='0 0 '+Math.max(30,Math.min(75,percent))+'%'});document.addEventListener('mouseup',()=>{if(isResizing){isResizing=false;resizer.classList.remove('active');document.body.style.cursor='';document.body.style.userSelect=''}})})();
projects().catch(e=>status(e.message));
</script>
</body>
</html>`
}
