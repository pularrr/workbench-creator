"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AgentInteractionResult, PendingChangeView } from "../../../core/agent/online-contracts";
import type { KnowledgeNode } from "../../knowledge-graph/model/knowledgeViewModel";
import { appendKnowledgeHistory } from "../../knowledge-graph/model/knowledgeHistory";
import { MarkdownMessage } from "./MarkdownMessage";

type PanelMode = "collapsed" | "compact" | "overlay";
type MessageRole = "user" | "assistant";
type IngestKind = "conversation" | "summary" | "paper" | "document";
type Message = {
  id: string;
  role: MessageRole;
  label: string;
  text: string;
  streaming?: boolean;
  result?: AgentInteractionResult;
};

export function AgentPanel({ selected, sessionId, onCommitted }: { selected: KnowledgeNode; sessionId: string; onReveal: (id: string) => void; onCommitted?: () => Promise<void> | void }) {
  const [mode, setMode] = useState<PanelMode>("compact");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ingestKind, setIngestKind] = useState<IngestKind>("document");
  const threadRef = useRef<HTMLDivElement>(null);
  const shouldFollowThreadRef = useRef(true);
  const jobTextCache = useRef(new Map<string, { revision: number; text: string }>());

  useEffect(() => {
    const thread = threadRef.current;
    if (thread && shouldFollowThreadRef.current) thread.scrollTop = thread.scrollHeight;
  }, [messages]);

  const updateThreadFollowState = () => {
    const thread = threadRef.current;
    if (!thread) return;
    shouldFollowThreadRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 24;
  };

  useEffect(() => {
    if (!sessionId || sessionId === "local-session") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch("/api/agent/jobs?sessionId=" + encodeURIComponent(sessionId), { cache: "no-store" });
        if (!response.ok) throw new Error("任务状态加载失败");
        const { jobs } = await response.json() as { jobs: Array<{ id: string; nodeId: string; kind: string; query: string; state: string; revision: number; progress?: string; hasResult: boolean; error?: string }> };
        const hydrated = await Promise.all(jobs.map(async (job) => {
          const cached = jobTextCache.current.get(job.id);
          let result: Omit<AgentInteractionResult, "text"> | undefined;
          if (job.hasResult) {
            const detailResponse = await fetch(`/api/agent/jobs/${encodeURIComponent(job.id)}?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
            if (!detailResponse.ok) throw new Error("任务详情加载失败");
            result = (await detailResponse.json() as { job: { result?: Omit<AgentInteractionResult, "text"> } }).job.result;
          }
          if (cached?.revision === job.revision) return { ...job, result, text: cached.text };
          let cursor: number | null = 0; let text = "";
          while (cursor !== null) {
            const resultResponse = await fetch(`/api/agent/jobs/${encodeURIComponent(job.id)}/result?sessionId=${encodeURIComponent(sessionId)}&cursor=${cursor}`, { cache: "no-store" });
            if (!resultResponse.ok) throw new Error("任务结果加载失败");
            const chunk = await resultResponse.json() as { text: string; nextCursor: number | null };
            text += chunk.text; cursor = chunk.nextCursor;
          }
          jobTextCache.current.set(job.id, { revision: job.revision, text });
          return { ...job, result, text };
        }));
        if (!cancelled) setMessages((current) => [
          ...current.filter((item) => !item.id.startsWith("job-")),
          ...hydrated.reverse().flatMap((job): Message[] => [
            { id: "job-user-" + job.id, role: "user", label: "你", text: job.query },
            { id: "job-reply-" + job.id, role: "assistant", label: job.kind === "chat" ? "AI 回答" : job.kind === "deep-search" ? "深度搜索" : "知识整理",
              text: job.text || job.error || job.progress || "", streaming: job.state === "running" || job.state === "queued", result: job.result ? { ...job.result, text: job.text } as AgentInteractionResult : undefined },
          ]),
        ]);
      } catch { /* The server task continues; reconnect on the next poll. */ }
      if (!cancelled) timer = setTimeout(poll, document.hidden ? 4000 : 1000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sessionId]);

  const startJob = async (kind: "chat" | "deep-search" | "ingest" | "summary", text: string, sourceText?: string) => {
    setBusy(true); setError("");
    shouldFollowThreadRef.current = true;
    setMode((current) => current === "collapsed" ? "compact" : current);
    try {
      const response = await fetch("/api/agent/jobs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, nodeId: selected.id, kind, query: text, sourceText, sourceKind: ingestKind }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "启动任务失败");
      setQuery("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "启动任务失败"); }
    finally { setBusy(false); }
  };

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim() && !busy) await startJob("chat", query.trim());
  };
  const run = async (kind: "deep-search" | "ingest") => {
    if (busy) return;
    await startJob(kind, kind === "ingest" ? "整理资料并补充知识" : query.trim() || "围绕“" + selected.title + "”扩展知识网络", kind === "ingest" ? query.trim() : undefined);
  };

  const uploadFile = async (file: File) => {
    if (busy) return;
    setError("");
    setBusy(true);
    shouldFollowThreadRef.current = true;
    setMode((current) => (current === "collapsed" ? "compact" : current));
    const pendingId = `file-${Date.now()}`;
    setMessages((current) => [...current, { id: pendingId, role: "assistant", label: `资料整理（${file.name}）`, text: "", streaming: true }]);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("sessionId", sessionId);
      form.append("nodeId", selected.id);
      form.append("kind", ingestKind);
      const response = await fetch("/api/knowledge/ingest-file", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "文件整理失败。");
      const notes = result.parsedNotes?.length ? `\n\n> 解析说明：${result.parsedNotes.join("；")}` : "";
      setMessages((current) => current.map((item) => (item.id === pendingId ? { ...item, label: result.mode === "online" ? "资料整理" : "离线覆盖检查", text: `${result.text}${notes}`, streaming: false, result } : item)));
      appendKnowledgeHistory({ nodeId: selected.id, kind: result.candidate ? "candidate_generated" : "question_summary", summary: result.candidate?.summary ?? result.text });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "文件整理失败。";
      setError(message);
      setMessages((current) => current.map((item) => (item.id === pendingId ? { ...item, streaming: false, label: "整理失败", text: message } : item)));
    } finally {
      setBusy(false);
    }
  };

  const loadReference = async () => {
    setBusy(true);setError("");
    shouldFollowThreadRef.current = true;
    try {
      const response=await fetch("/api/knowledge/reference",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId})});
      const result=await response.json() as AgentInteractionResult & {error?:string};
      if(!response.ok) throw new Error(result.error || "基准加载失败");
      setMessages((current)=>[...current,{id:"reference-"+Date.now(),role:"assistant",label:"基准扩充",text:result.text,result}]);
      setMode("overlay");
    } catch(error) {setError(String(error));} finally {setBusy(false);}
  };

  const summarize = async () => {
    const completed = messages.filter((item) => !item.streaming && item.text.trim());
    if (!completed.length) { setError("当前还没有可整理的对话。"); return; }
    await startJob("summary", "总结当前对话并补充知识", completed.map((item) => item.label + "：" + item.text).join("\\n").slice(-80000));
  };

  const confirm = async (candidate: PendingChangeView) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/agent/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, patchId: candidate.patchId, confirmationToken: candidate.confirmationToken }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "确认失败。");
      setMessages((current) => current.map((message) => message.result?.candidate?.patchId === candidate.patchId ? { ...message, label: "已写入图谱", result: { ...message.result, candidate: undefined }, text: `${message.text}\n\n**已确认写入修订 ${result.revision}。**` } : message));
      await onCommitted?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "确认失败。");
    } finally {
      setBusy(false);
    }
  };

  const reject = async (messageId: string, candidate: PendingChangeView) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/agent/reject", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, patchId: candidate.patchId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "拒绝失败。");
      setMessages((current) => current.filter((item) => item.id !== messageId));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "拒绝失败。"); }
    finally { setBusy(false); }
  };

  return (
    <section className={`graph-agent ${mode}`} aria-label="知识图谱 Agent" aria-busy={busy}>
      <header className="graph-agent-head">
        <div><span>AI AGENT</span><strong>{selected.title}</strong></div>
        <div className="graph-agent-actions">
          <button className="deep-search-button" onClick={() => void run("deep-search")} disabled={busy}>深度搜索</button>
          <button className="summary-button" onClick={() => void summarize()} disabled={busy}>总结并补充知识</button>
          <label className="summary-button file-upload-label" aria-disabled={busy}>
            上传资料
            <input type="file" accept=".pdf,image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); e.target.value = ""; }} disabled={busy} />
          </label>
          <button className="summary-button" onClick={() => void run("ingest")} disabled={busy || !query.trim()}>整理资料</button>
          <button className="agent-expand" onClick={() => setMode((current) => (current === "overlay" ? "compact" : "overlay"))} aria-label={mode === "overlay" ? "退出大窗" : "展开为大窗"}>{mode === "overlay" ? "↙" : "↗"}</button>
          <button className="agent-collapse" onClick={() => setMode((current) => (current === "collapsed" ? "compact" : "collapsed"))} aria-label={mode === "collapsed" ? "展开 Agent" : "收起 Agent"}>{mode === "collapsed" ? "⌃" : "⌄"}</button>
        </div>
      </header>
      {mode !== "collapsed" ? <div className="graph-agent-body">
        <form className="agent-query" onSubmit={ask}><label htmlFor="agent-query">围绕当前节点提问</label><div><textarea id="agent-query" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={`询问“${selected.title}”，Enter 发送，Shift+Enter 换行；或粘贴资料后点“整理资料”`} /><button type="submit" disabled={busy || !query.trim()} aria-label="发送问题">↑</button></div><div className="ingest-kind-bar"><span>资料类型：</span><select value={ingestKind} onChange={(e) => setIngestKind(e.target.value as IngestKind)} disabled={busy} aria-label="选择资料类型"><option value="document">文档</option><option value="conversation">对话记录</option><option value="summary">知识摘要</option><option value="paper">文献/技术方案</option></select></div>{busy ? <small className="agent-busy-hint">回答生成中，可稍候…</small> : null}</form>
        <div className="agent-thread" ref={threadRef} onScroll={updateThreadFollowState} aria-live="polite">
          {messages.length ? messages.map((message) => (
            <article key={message.id} className={`agent-message ${message.role}${message.result?.candidate ? " knowledge_candidate" : ""}${message.streaming ? " streaming" : ""}`}>
              <span>{message.label}{message.result?.model ? <em>{message.result.model}</em> : null}</span>
              {message.role === "user" ? <p className="user-text">{message.text}</p> : (message.streaming && !message.text) ? <p className="agent-thinking"><i /><i /><i />正在思考…</p> : <MarkdownMessage text={message.text || (message.streaming ? "…" : "（空回答）")} />}
              {message.streaming && message.id.startsWith("job-reply-") ? <button className="stop-task" onClick={() => { void fetch("/api/agent/jobs", {method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId,id:message.id.slice("job-reply-".length)})}).then((response) => { if (!response.ok) setError("停止任务失败，请重试。"); }); }}>停止任务</button> : null}
              {message.streaming && message.text ? <span className="stream-cursor" aria-hidden="true">▍</span> : null}
              {message.result?.observations.length ? <details className="observation-log"><summary>{message.result.observations.length} 次知识观察</summary><ol>{message.result.observations.map((item) => <li key={`${message.id}-${item.round}`}>{item.summary}</li>)}</ol></details> : null}
              {message.result?.candidate ? <div className="candidate-details"><b>{message.result.candidate.summary}</b><p>{message.result.candidate.rationale}</p><small>新增 {message.result.candidate.projectionDiff.nodes.added.length} 个节点，更新 {message.result.candidate.projectionDiff.cards.updated.length + message.result.candidate.projectionDiff.cards.added.length} 张卡片</small><div className="candidate-actions"><button onClick={() => void confirm(message.result!.candidate!)} disabled={busy}>确认写入</button><button onClick={() => void reject(message.id, message.result!.candidate!)} disabled={busy}>拒绝</button></div></div> : null}
              {message.result?.warning ? <small className="message-warning">{message.result.warning}</small> : null}
            </article>
          )) : <p className="agent-thread-empty">可以直接提问，也可以启动深度搜索扩充当前节点。</p>}
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      </div> : null}
    </section>
  );
}
