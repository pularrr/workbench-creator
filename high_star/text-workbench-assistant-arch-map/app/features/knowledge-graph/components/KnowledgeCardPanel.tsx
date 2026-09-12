"use client";

import { useEffect, useMemo, useState } from "react";
import type { PendingChangeView } from "../../../core/agent/online-contracts";
import type { CodeEntryLink } from "../../../core/codegraph/schema";
import { getCardSectionDefinition } from "../../../core/knowledge/card-section-catalog";
import type { CardBlock, KnowledgeCollectionKind, KnowledgeDataset, KnowledgeHistoryKind } from "../../../core/knowledge/schema";
import { expandedKnowledgeDataset } from "../../../data/knowledge/initial-dataset";
import { branchMeta, getKnowledgeCardFromDataset, toLegacyKnowledgeNodes } from "../model/knowledgeViewModel";
import { useKnowledgeHistory } from "../model/knowledgeHistory";
import { ancestorsOf, createLayoutIndex, type LayoutIndex } from "../layout/legacySvgLayout";
import { FormulaCard } from "./FormulaCard";

type KnowledgeCardPanelProps = {
  selectedId: string;
  onReveal: (id: string) => void;
  dataset?: KnowledgeDataset;
  layoutIndex?: LayoutIndex;
  sessionId?: string;
  onCommitted?: () => Promise<void> | void;
};

const historyLabels: Record<KnowledgeHistoryKind, string> = {
  initialized: "节点初始化", question_summary: "提问摘要", candidate_generated: "检索候选",
  knowledge_imported: "知识接入", revision_applied: "版本更新", rollback: "版本回滚",
};

export function KnowledgeCardPanel({ selectedId, onReveal, dataset = expandedKnowledgeDataset, layoutIndex, sessionId = "local", onCommitted }: KnowledgeCardPanelProps) {
  const [activePage, setActivePage] = useState<KnowledgeCollectionKind | "history">("theory");
  const [editing, setEditing] = useState(false);
  const [draftHeadline, setDraftHeadline] = useState("");
  const [draftBlocks, setDraftBlocks] = useState<CardBlock[]>([]);
  const [pending, setPending] = useState<PendingChangeView | null>(null);
  const [saveError, setSaveError] = useState("");
  const [codeLinks, setCodeLinks] = useState<CodeEntryLink[]>([]);
  const nodes = useMemo(() => toLegacyKnowledgeNodes(dataset), [dataset]);
  const index = useMemo(() => layoutIndex ?? createLayoutIndex(nodes), [layoutIndex, nodes]);
  const selected = index.nodeMap.get(selectedId) ?? index.nodeMap.values().next().value!;
  const selectedAncestors = ancestorsOf(selected.id, index);
  const selectedChildren = index.childrenMap.get(selected.id) ?? [];
  const card = getKnowledgeCardFromDataset(dataset, selected.id);
  const rawCard = dataset.cards.find((item) => item.nodeId === selected.id);
  const localHistory = useKnowledgeHistory(selected.id);

  useEffect(() => {
    setDraftHeadline(rawCard?.headline ?? selected.summary);
    setDraftBlocks(structuredClone(rawCard?.blocks ?? []));
    setEditing(false);
    setPending(null);
    setSaveError("");
  }, [selected.id, rawCard, selected.summary]);

  useEffect(() => {
    const controller = new AbortController();
    setCodeLinks([]);
    fetch(`/api/codegraph/links?knowledgeNodeId=${encodeURIComponent(selected.id)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : { links: [] })
      .then((value: { links?: CodeEntryLink[] }) => { if (!controller.signal.aborted) setCodeLinks(value.links ?? []); })
      .catch(() => { /* Source interpretation is optional; never break knowledge cards. */ });
    return () => controller.abort();
  }, [selected.id]);

  const pageSections = card?.sections
    .filter((section) => getCardSectionDefinition(section.type).collection === activePage)
    .sort((left, right) => getCardSectionDefinition(left.type).order - getCardSectionDefinition(right.type).order) ?? [];
  const history = (() => {
    const runtime = (dataset.history ?? []).filter((entry) => entry.nodeId === selected.id);
    const unique = new Map([...runtime, ...localHistory].map((entry) => [entry.id, entry]));
    const entries = [...unique.values()].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
    if (!entries.some((entry) => entry.kind === "initialized")) entries.push({ id: `initialized-${selected.id}`, nodeId: selected.id, kind: "initialized", summary: "知识节点与首版知识卡片完成初始化。", occurredAt: "1970-01-01T00:00:00.000Z", revision: 1 });
    return entries.slice(0, 15);
  })();

  const prepareSave = async () => {
    setSaveError("");
    const response = await fetch("/api/knowledge/card-edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, nodeId: selected.id, headline: draftHeadline, blocks: draftBlocks }) });
    const result = await response.json();
    if (!response.ok) { setSaveError(result.error ?? "无法准备编辑。请保留草稿后重试。"); return; }
    setPending(result as PendingChangeView);
  };

  const confirmSave = async () => {
    if (!pending) return;
    setSaveError("");
    const response = await fetch("/api/agent/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, patchId: pending.patchId, confirmationToken: pending.confirmationToken }) });
    const result = await response.json();
    if (!response.ok) { setSaveError(result.error ?? "保存冲突；草稿仍被保留。"); return; }
    setPending(null);
    setEditing(false);
    await onCommitted?.();
  };

  return (
    <div className="inspector-pane">
      <div className="detail-kicker"><i style={{ background: branchMeta[selected.branch].color }} />{branchMeta[selected.branch].label}{selectedChildren.length > 0 && <span>{selectedChildren.length} 条下游关系</span>}</div>
      <div className="card-title-row"><h2>{selected.title}</h2><button className="card-edit-button" onClick={() => { setEditing((value) => !value); setPending(null); }}>{editing ? "退出编辑" : "编辑"}</button></div>
      <p className="detail-subtitle">{selected.subtitle}</p>

      {editing ? (
        <div className="card-editor">
          <label>卡片摘要<textarea value={draftHeadline} maxLength={80} onChange={(event) => setDraftHeadline(event.target.value)} /></label>
          {draftBlocks.map((block, indexValue) => (
            <fieldset key={`${block.type}-${indexValue}`}><legend>{getCardSectionDefinition(block.type).label}</legend>
              <input value={block.title} onChange={(event) => setDraftBlocks((items) => items.map((item, indexItem) => indexItem === indexValue ? { ...item, title: event.target.value } : item))} />
              <textarea value={block.text ?? block.items?.join("\n") ?? ""} onChange={(event) => setDraftBlocks((items) => items.map((item, indexItem) => indexItem === indexValue ? { ...item, text: event.target.value, items: undefined } : item))} />
            </fieldset>
          ))}
          <div className="card-editor-actions"><button onClick={prepareSave}>生成变更预览</button>{pending ? <button className="confirm" onClick={confirmSave}>确认保存</button> : null}</div>
          {pending ? <p className="edit-preview">将更新 {pending.projectionDiff.cards.updated.length + pending.projectionDiff.cards.added.length} 张卡片；确认前不会写入。</p> : null}
          {saveError ? <p className="form-error">{saveError}</p> : null}
        </div>
      ) : <p className="detail-summary"><strong>{selected.title}</strong>：{selected.summary}</p>}

      {!editing ? <>
        <div className="knowledge-card-tabs" role="tablist" aria-label="知识卡片分类">{([ ["theory", "理论知识"], ["application", "应用知识"], ["other", "其他知识"], ["history", "历史修改"] ] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={activePage === id} className={activePage === id ? "active" : ""} onClick={() => setActivePage(id)}>{label}</button>)}</div>
        <div className="knowledge-card-page" role="tabpanel">
          {activePage === "theory" && selected.formula ? <FormulaCard nodeId={selected.id} fallback={selected.formula} /> : null}
          {activePage !== "history" ? pageSections.map((section, indexValue) => <details className={`detail-text ${section.type === "failure_mode" || section.type === "misconception" ? "warning" : ""}`} key={`${section.type}-${section.title}-${indexValue}`} open={indexValue === 0}><summary className="section-label">{section.title}</summary>{section.text ? <p>{section.text}</p> : null}{section.items?.length ? <ul>{section.items.map((item, itemIndex) => <li key={item}>{itemIndex === 0 ? <strong>{item}</strong> : item}</li>)}</ul> : null}{section.code ? <pre className="card-code"><code>{section.code}</code><small>{section.language ?? "text"}</small></pre> : null}</details>) : null}
          {activePage !== "history" && pageSections.length === 0 && !(activePage === "theory" && selected.formula) ? <p className="card-page-empty">当前分类暂无内容。</p> : null}
          {activePage === "history" ? <div className="history-page"><ol>{history.map((entry) => <li key={entry.id}><span>{historyLabels[entry.kind]}</span><b>{entry.summary}</b><time>{entry.occurredAt.startsWith("1970") ? `修订 ${entry.revision ?? 1}` : new Date(entry.occurredAt).toLocaleString("zh-CN", { hour12: false })}</time></li>)}</ol></div> : null}
        </div>
      </> : null}

      {codeLinks.length > 0 ? <div className="code-link-card"><div className="section-label">关联实现</div><p>以下为独立源码解读分支提供的定位信息，不会改变当前知识节点的构建结果。</p><ul>{codeLinks.map((link) => <li key={link.id}><b>{link.relation}</b><code>{link.citation.path}{link.citation.symbol ? ` · ${link.citation.symbol}` : ""}</code><small>第 {link.citation.startLine}–{link.citation.endLine} 行 · {link.source}{link.stale ? " · 待复核" : ""}</small>{link.rationale ? <span>{link.rationale}</span> : null}</li>)}</ul></div> : null}

      <div className="path-card"><div className="section-label">知识链路</div><div className="breadcrumbs">{[...selectedAncestors].reverse().map((node) => <button key={node.id} onClick={() => onReveal(node.id)}>{node.title}<span>→</span></button>)}<b>{selected.title}</b></div></div>
      {selectedChildren.length > 0 ? <div className="detail-group"><div className="section-label">关联知识</div><div className="child-list">{selectedChildren.map((node) => <button key={node.id} onClick={() => onReveal(node.id)}><i style={{ background: branchMeta[node.branch].color }} /><span><b>{node.title}</b><small>{node.subtitle}</small></span><em>＋</em></button>)}</div></div> : null}
    </div>
  );
}
