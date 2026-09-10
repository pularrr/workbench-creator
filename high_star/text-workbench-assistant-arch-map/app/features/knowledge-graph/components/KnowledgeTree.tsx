"use client";

import { useEffect, useMemo, useState } from "react";
import { ACTIVE_PROFILE } from "../../../profiles/active";
import {
  branchMeta,
  knowledgeNodes,
  type KnowledgeNode,
} from "../model/knowledgeViewModel";
import { ancestorsOf, childrenMap } from "../layout/legacySvgLayout";
import type { LayoutIndex } from "../layout/legacySvgLayout";

type KnowledgeTreeProps = {
  focusId: string;
  selectedId: string;
  onReveal: (id: string) => void;
  nodes?: readonly KnowledgeNode[];
  layoutIndex?: LayoutIndex;
};

export function KnowledgeTree({ focusId, selectedId, onReveal, nodes = knowledgeNodes, layoutIndex }: KnowledgeTreeProps) {
  const [treeQuery, setTreeQuery] = useState("");
  const [expandedTree, setExpandedTree] = useState<Set<string>>(() => new Set([ACTIVE_PROFILE.initialization.rootNode.id]));

  const treeMatches = useMemo(() => {
    const query = treeQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return nodes
      .filter((node) =>
        `${node.title} ${node.subtitle} ${node.summary}`.toLocaleLowerCase().includes(query),
      )
      .slice(0, 18);
  }, [treeQuery, nodes]);

  useEffect(() => {
    setTreeQuery("");
    setExpandedTree((previous) =>
      new Set([...previous, focusId, ...ancestorsOf(focusId, layoutIndex).map((node) => node.id)]),
    );
  }, [focusId]);

  const reveal = (id: string) => {
    setTreeQuery("");
    onReveal(id);
  };

  return (
    <aside className="branch-rail">
      <div className="tree-heading">
        <div>
          <div className="rail-label">知识域</div>
          <b>定位知识位置</b>
        </div>
        <button onClick={() => reveal(selectedId)} aria-label="定位当前知识点" title="定位当前知识点">
          ◎
        </button>
      </div>
      <label className="tree-search">
        <span aria-hidden="true">⌕</span>
        <input
          value={treeQuery}
          onChange={(event) => setTreeQuery(event.target.value)}
          placeholder="搜索知识点…"
          aria-label="搜索知识点"
        />
      </label>
      <div className="domain-tree" role="tree" aria-label="知识域树">
        {treeQuery.trim() ? (
          <div className="tree-results">
            {treeMatches.map((node) => (
              <button key={node.id} onClick={() => reveal(node.id)}>
                <i style={{ background: branchMeta[node.branch].color }} />
                <span>
                  <b>{node.title}</b>
                  <small>{node.subtitle}</small>
                </span>
              </button>
            ))}
            {!treeMatches.length && <p>没有匹配的知识点</p>}
          </div>
        ) : (
          nodes
            .filter((node) => !node.parent)
            .map((node) => (
              <KnowledgeTreeItem
                key={node.id}
                node={node}
                depth={0}
                focusId={focusId}
                selectedId={selectedId}
                expanded={expandedTree}
                layoutIndex={layoutIndex}
                onToggle={(id) =>
                  setExpandedTree((previous) => {
                    const next = new Set(previous);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onReveal={reveal}
              />
            ))
        )}
      </div>
    </aside>
  );
}

function KnowledgeTreeItem({
  node,
  depth,
  focusId,
  selectedId,
  expanded,
  onToggle,
  onReveal,
  layoutIndex,
}: {
  node: KnowledgeNode;
  depth: number;
  focusId: string;
  selectedId: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onReveal: (id: string) => void;
  layoutIndex?: LayoutIndex;
}) {
  const children = (layoutIndex?.childrenMap ?? childrenMap).get(node.id) ?? [];
  const isOpen = expanded.has(node.id);
  const active = node.id === focusId || node.id === selectedId;
  return (
    <div className="tree-node" role="treeitem" aria-selected={active} aria-expanded={children.length ? isOpen : undefined}>
      <div className={`tree-row ${active ? "active" : ""}`} style={{ paddingLeft: 5 + depth * 13 }}>
        <button
          className={`tree-chevron ${isOpen ? "open" : ""}`}
          onClick={() => children.length && onToggle(node.id)}
          aria-label={children.length ? `${isOpen ? "收起" : "展开"}${node.title}` : undefined}
          tabIndex={children.length ? 0 : -1}
        >
          {children.length ? "›" : "·"}
        </button>
        <button className="tree-label" onClick={() => onReveal(node.id)} title={node.title}>
          <i style={{ background: branchMeta[node.branch].color }} />
          <span>{node.title}</span>
          {children.length ? <small>{children.length}</small> : null}
        </button>
      </div>
      {children.length && isOpen ? (
        <div className="tree-children" role="group">
          {children.map((child) => (
            <KnowledgeTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              focusId={focusId}
              selectedId={selectedId}
              expanded={expanded}
              layoutIndex={layoutIndex}
              onToggle={onToggle}
              onReveal={onReveal}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
