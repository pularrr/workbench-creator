"use client";

import { useEffect, useState, type FormEvent } from "react";

import { TypographySettings } from "./TypographySettings";

type Status = { configured: boolean; provider: string; baseUrl: string; model: string; budgets?:{maxOutputTokens:number} };

export function LlmConfigDialog({ open, onClose, onStatus }: { open: boolean; onClose: () => void; onStatus?: (status: Status) => void }) {
  const [status, setStatus] = useState<Status>({ configured: false, provider: "openai-responses", baseUrl: "https://api.openai.com/v1", model: "" });
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(status.baseUrl);
  const [model, setModel] = useState("");
  const [maxOutputTokens,setMaxOutputTokens]=useState(16384);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/llm/config", { cache: "no-store" }).then((response) => response.json()).then((next: Status) => {
      setStatus(next); setBaseUrl(next.baseUrl); setModel(next.model); setMaxOutputTokens(next.budgets?.maxOutputTokens ?? 16384); onStatus?.(next);
    });
  }, [open, onStatus]);

  if (!open) return null;

  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/llm/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey, baseUrl, model, maxOutputTokens }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "配置保存失败。");
      setStatus(result); setApiKey(""); setMessage("配置已保存。"); onStatus?.(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "配置保存失败。"); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/llm/test", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "连接失败。");
      setMessage(`连接成功：${result.model}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败。"); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="llm-dialog" role="dialog" aria-modal="true" aria-labelledby="llm-dialog-title"><header><div><span className={`llm-status-dot ${status.configured ? "configured" : ""}`} /><h2 id="llm-dialog-title">设置</h2></div><button onClick={onClose} aria-label="关闭">×</button></header><form onSubmit={save}><label>API 地址<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></label><label>模型<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型名称" /></label><label>API Key<input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" autoComplete="off" placeholder={status.configured ? "留空保持现有密钥" : "仅发送到本机服务端"} /></label><label>单次最大输出 Token<input type="number" min="512" max="131072" step="512" value={maxOutputTokens} onChange={(event)=>setMaxOutputTokens(Number(event.target.value))} /></label><div className="dialog-actions"><button type="button" onClick={() => void test()} disabled={busy || !status.configured}>测试连接</button><button className="primary" type="submit" disabled={busy || !baseUrl.trim() || !model.trim()}>{busy ? "处理中…" : "保存配置"}</button></div>{message ? <p className="dialog-message">{message}</p> : null}</form><TypographySettings /><p><a href="/api/knowledge/reference" download>下载增强基准图谱</a></p></section></div>;
}
