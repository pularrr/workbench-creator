"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { loadTypography } from "../features/agent/components/TypographySettings";
import { LlmConfigDialog } from "../features/agent/components/LlmConfigDialog";
import { AgentPanel } from "../features/agent/components/AgentPanel";
import { KnowledgeCardPanel } from "../features/knowledge-graph/components/KnowledgeCardPanel";
import { KnowledgeGraphCanvas } from "../features/knowledge-graph/components/KnowledgeGraphCanvas";
import { KnowledgeTree } from "../features/knowledge-graph/components/KnowledgeTree";
import { createLayoutIndex } from "../features/knowledge-graph/layout/legacySvgLayout";
import { toLegacyKnowledgeNodes } from "../features/knowledge-graph/model/knowledgeViewModel";
import type { KnowledgeDataset } from "../core/knowledge/schema";
import { expandedKnowledgeDataset } from "../data/knowledge/initial-dataset";
import { ACTIVE_PROFILE } from "../profiles/active";
import { APP_CONFIG } from "./config";

// UI contract: 知识域树 · 复制 LaTeX · 展开字母与符号解释 · 开启或关闭连线流动 · 当前节点优先

type LlmStatus = { configured: boolean; provider: string; baseUrl: string; model: string };

export default function Home() {
  const [dataset, setDataset] = useState<KnowledgeDataset>(expandedKnowledgeDataset);
  const rootNodeId = ACTIVE_PROFILE.initialization.rootNode.id;
  const [focusId, setFocusId] = useState(rootNodeId);
  const [selectedId, setSelectedId] = useState(rootNodeId);
  const [dark, setDark] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [llmStatus, setLlmStatus] = useState<LlmStatus>({ configured: false, provider: "openai-responses", baseUrl: "", model: "" });
  const [leftWidth, setLeftWidth] = useState(250);
  const [rightWidth, setRightWidth] = useState(360);
  const [sessionId, setSessionId] = useState("local-session");

  const nodes = useMemo(() => toLegacyKnowledgeNodes(dataset), [dataset]);
  const layoutIndex = useMemo(() => createLayoutIndex(nodes), [nodes]);
  const selected = layoutIndex.nodeMap.get(selectedId) ?? layoutIndex.nodeMap.values().next().value!;

  const refreshDataset = useCallback(async () => {
    const response = await fetch("/api/knowledge", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json() as { dataset: KnowledgeDataset };
    setDataset(result.dataset);
    const requested = new URLSearchParams(window.location.search).get("node");
    const next = requested && result.dataset.nodes.some((node) => node.id === requested) ? requested : rootNodeId;
    setFocusId(next); setSelectedId(next);
  }, [rootNodeId]);

  useEffect(() => {
    loadTypography();
    setDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
    setLeftWidth(Number(window.localStorage.getItem(`${APP_CONFIG.storagePrefix}-left-width`)) || 250);
    setRightWidth(Number(window.localStorage.getItem(`${APP_CONFIG.storagePrefix}-right-width`)) || 360);
    const storedSession = window.localStorage.getItem(`${APP_CONFIG.storagePrefix}-session-id`) || crypto.randomUUID();
    window.localStorage.setItem(`${APP_CONFIG.storagePrefix}-session-id`, storedSession);
    setSessionId(storedSession);
    void refreshDataset();
    void fetch("/api/llm/config", { cache: "no-store" }).then((response) => response.json()).then(setLlmStatus).catch(() => undefined);
  }, [refreshDataset]);

  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);

  useEffect(() => {
    if (!layoutIndex.nodeMap.has(focusId)) setFocusId(rootNodeId);
    if (!layoutIndex.nodeMap.has(selectedId)) setSelectedId(rootNodeId);
  }, [focusId, selectedId, layoutIndex, rootNodeId]);

  const reveal = (id: string) => {
    if (!layoutIndex.nodeMap.has(id)) return;
    setFocusId(id); setSelectedId(id);
    const url = new URL(window.location.href); url.searchParams.set("node", id); url.hash = ""; window.history.replaceState({}, "", url);
  };

  const startResize = (side: "left" | "right", event: PointerEvent<HTMLDivElement>) => {
    if (window.innerWidth <= 720) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;
    let lastWidth = startWidth;
    const move = (moveEvent: globalThis.PointerEvent) => {
      const delta = side === "left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const next = Math.min(side === "left" ? 420 : 720, Math.max(side === "left" ? 220 : 340, startWidth + delta));
      lastWidth = next;
      if (side === "left") setLeftWidth(next); else setRightWidth(next);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop);
      window.localStorage.setItem(`${APP_CONFIG.storagePrefix}-${side}-width`, String(lastWidth));
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop, { once: true });
  };

  const resizeByKeyboard = (side: "left" | "right", direction: number) => {
    if (side === "left") setLeftWidth((value) => Math.min(420, Math.max(220, value + direction * 12)));
    else setRightWidth((value) => Math.min(720, Math.max(340, value + direction * 12)));
  };

  const savepoint = async () => { await fetch("/api/knowledge/savepoint", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: `修订 ${dataset.revision}`, savedBy: "local-user" }) }); };
  const workspaceStyle = { "--left-width": `${leftWidth}px`, "--right-width": inspectorOpen ? `${rightWidth}px` : "42px" } as CSSProperties;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block"><div className="brand-mark" aria-hidden="true"><span /><span /><span /></div><div><div className="eyebrow">{APP_CONFIG.eyebrow}</div><h1>{APP_CONFIG.appName} <em>AI</em></h1></div></div>
        <div className="top-actions">
          <div className="graph-stat"><b>{nodes.length}</b><span>知识节点</span></div><div className="graph-stat"><b>{dataset.domains.length}</b><span>知识域</span></div>
          <button className={`ai-config-button ${llmStatus.configured ? "configured" : ""}`} onClick={() => setConfigOpen(true)}><i />{llmStatus.configured ? "设置 · " + llmStatus.model : "设置 · AI 配置"}</button>
          <button className="savepoint-button" onClick={() => void savepoint()}>保存版本</button>
          <button className="theme-button" onClick={() => setDark((value) => !value)} aria-label={dark ? "切换为明亮主题" : "切换为暗色主题"}><span className="theme-orbit">{dark ? "☾" : "☼"}</span><span>{dark ? "暗色" : "明亮"}</span></button>
        </div>
      </header>

      <section className="workspace" style={workspaceStyle} aria-label="知识图谱工作区">
        <KnowledgeTree focusId={focusId} selectedId={selectedId} onReveal={reveal} nodes={nodes} layoutIndex={layoutIndex} />
        <div className="resize-handle left" role="separator" tabIndex={0} aria-label="调整左侧宽度" onPointerDown={(event) => startResize("left", event)} onKeyDown={(event) => { if (event.key === "ArrowLeft") resizeByKeyboard("left", -1); if (event.key === "ArrowRight") resizeByKeyboard("left", 1); }} />
        <div className="graph-workbench"><KnowledgeGraphCanvas focusId={focusId} selectedId={selectedId} onSelect={setSelectedId} onReveal={reveal} dataset={dataset} layoutIndex={layoutIndex} /><AgentPanel selected={selected} sessionId={sessionId} onReveal={reveal} onCommitted={refreshDataset} /></div>
        <div className="resize-handle right" role="separator" tabIndex={0} aria-label="调整知识卡片宽度" onPointerDown={(event) => startResize("right", event)} onKeyDown={(event) => { if (event.key === "ArrowLeft") resizeByKeyboard("right", 1); if (event.key === "ArrowRight") resizeByKeyboard("right", -1); }} />
        <aside className={inspectorOpen ? "inspector open" : "inspector"}><button className="inspector-toggle" onClick={() => setInspectorOpen((value) => !value)} aria-label={inspectorOpen ? "收起详情" : "展开详情"}>{inspectorOpen ? "›" : "‹"}</button><div className="inspector-content"><KnowledgeCardPanel key={selected.id} selectedId={selectedId} onReveal={reveal} dataset={dataset} layoutIndex={layoutIndex} sessionId={sessionId} onCommitted={refreshDataset} /></div></aside>
      </section>

      <footer className="statusbar"><span><i className="online" />知识图谱 · 修订 {dataset.revision}</span><span>{llmStatus.configured ? `外部 LLM：${llmStatus.model}` : "离线模式"}</span></footer>
      <LlmConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} onStatus={setLlmStatus} />
    </main>
  );
}
