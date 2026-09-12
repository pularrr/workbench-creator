"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import {
  branchMeta,
  getVisibleRelations,
  getVisibleRelationsFromDataset,
} from "../model/knowledgeViewModel";
import type { KnowledgeDataset } from "../../../core/knowledge/schema";
import {
  NODE_H,
  NODE_W,
  WORLD,
  ancestorsOf,
  arrange,
  bounded,
  childrenMap,
  clamp,
  descendantsOf,
  edgePath,
  nodeMap,
  type TraceMode,
  type Viewport,
  type LayoutIndex,
} from "../layout/legacySvgLayout";

type KnowledgeGraphCanvasProps = {
  focusId: string;
  selectedId: string;
  onSelect: (id: string) => void;
  onReveal: (id: string) => void;
  dataset?: KnowledgeDataset;
  layoutIndex?: LayoutIndex;
};

export function KnowledgeGraphCanvas({
  focusId,
  selectedId,
  onSelect,
  onReveal,
  dataset,
  layoutIndex,
}: KnowledgeGraphCanvasProps) {
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [traceMode, setTraceMode] = useState<TraceMode>("context");
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [edgeFlow, setEdgeFlow] = useState(true);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stored = window.localStorage.getItem("fmcw-edge-flow");
    setEdgeFlow(!reduced && stored !== "off");
  }, []);

  useEffect(() => {
    setViewport({ x: 0, y: 0, scale: 1 });
    setTraceMode("context");
  }, [focusId]);

  const activeNodeMap = layoutIndex?.nodeMap ?? nodeMap;
  const activeChildrenMap = layoutIndex?.childrenMap ?? childrenMap;
  const focus = activeNodeMap.get(focusId) ?? activeNodeMap.values().next().value!;
  const selected = activeNodeMap.get(selectedId) ?? focus;
  const positioned = useMemo(() => arrange(focus, layoutIndex), [focus, layoutIndex]);
  const positionedMap = useMemo(
    () => new Map(positioned.map((node) => [node.id, node])),
    [positioned],
  );
  const semanticRelations = useMemo(
    () => dataset ? getVisibleRelationsFromDataset(dataset, focus.id) : getVisibleRelations(focus.id),
    [dataset, focus.id],
  );
  const semanticContextIds = useMemo(
    () => new Set(semanticRelations.flatMap((relation) => [relation.from, relation.to])),
    [semanticRelations],
  );
  const focusPosition = positionedMap.get(focus.id);
  const ancestorIds = new Set(ancestorsOf(selected.id, layoutIndex).map((node) => node.id));
  const descendantIds = descendantsOf(selected.id, layoutIndex);

  const emphasized = (id: string) =>
    traceMode === "all" ||
    id === selected.id ||
    (traceMode === "upstream" && ancestorIds.has(id)) ||
    (traceMode === "downstream" && descendantIds.has(id)) ||
    (traceMode === "context" &&
      (ancestorIds.has(id) || descendantIds.has(id) || semanticContextIds.has(id)));

  const zoom = (factor: number) =>
    setViewport((value) => {
      const nextScale = clamp(value.scale * factor, 0.78, 1.42);
      if (!focusPosition) return bounded({ ...value, scale: nextScale });
      const focusCenterX = focusPosition.x + NODE_W / 2;
      const focusCenterY = focusPosition.y + NODE_H / 2;
      return bounded(
        {
          scale: nextScale,
          x: value.x + focusCenterX * (value.scale - nextScale),
          y: value.y + focusCenterY * (value.scale - nextScale),
        },
        focusPosition,
      );
    });

  const endDrag = (event?: PointerEvent<SVGSVGElement>) => {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const visibleEdges = positioned.flatMap((node) => {
    if (!node.parent) return [];
    const parent = positionedMap.get(node.parent);
    return parent ? [{ from: parent, to: node }] : [];
  });

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <div className="trace-controls" role="group" aria-label="关系追踪模式">
          {(["context", "upstream", "downstream", "all"] as TraceMode[]).map((mode) => (
            <button
              key={mode}
              className={traceMode === mode ? "active" : ""}
              onClick={() => setTraceMode(mode)}
            >
              {{ context: "关联上下文", upstream: "上游知识", downstream: "下游知识", all: "当前全部" }[mode]}
            </button>
          ))}
        </div>
        <div className="zoom-controls">
          <label className="flow-toggle" title="开启或关闭连线流动">
            <span>流动</span>
            <input
              type="checkbox"
              checked={edgeFlow}
              onChange={(event) => {
                const next =
                  event.target.checked &&
                  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                setEdgeFlow(next);
                window.localStorage.setItem("fmcw-edge-flow", next ? "on" : "off");
              }}
            />
            <i />
          </label>
          <button onClick={() => zoom(1.08)} aria-label="放大">
            ＋
          </button>
          <span>{Math.round(viewport.scale * 100)}%</span>
          <button onClick={() => zoom(0.92)} aria-label="缩小">
            −
          </button>
          <button
            onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}
            aria-label="适应当前节点"
          >
            ⌂
          </button>
        </div>
      </div>

      <svg
        className="knowledge-canvas"
        viewBox={`0 0 ${WORLD.width} ${WORLD.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="渐进披露式 FMCW 雷达知识图谱"
        onWheel={(event) => {
          event.preventDefault();
          zoom(event.deltaY < 0 ? 1.06 : 0.94);
        }}
        onPointerDown={(event) => {
          if ((event.target as Element).closest(".node-card")) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            vx: viewport.x,
            vy: viewport.y,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const pointerX = event.clientX;
          const pointerY = event.clientY;
          const width = event.currentTarget.getBoundingClientRect().width;
          if (width < 1) return;
          const ratio = WORLD.width / width;
          setViewport((value) =>
            bounded(
              {
                ...value,
                x: drag.vx + (pointerX - drag.x) * ratio,
                y: drag.vy + (pointerY - drag.y) * ratio,
              },
              focusPosition,
            ),
          );
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <defs>
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" fill="none" className="grid-line" />
          </pattern>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0 0L10 5L0 10Z" className="arrow-head" />
          </marker>
        </defs>
        <rect width={WORLD.width} height={WORLD.height} fill="url(#grid)" />
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          <g className="radar-rings" transform={`translate(${WORLD.width / 2} ${WORLD.height / 2})`}>
            <circle r="115" />
            <circle r="220" />
            <circle r="330" />
            <path d="M0 0L300 -165" />
          </g>
          <g className={`edges ${edgeFlow ? "flowing" : "still"}`}>
            {visibleEdges.map(({ from, to }) => {
              const active = emphasized(from.id) && emphasized(to.id);
              return (
                <path
                  key={`${from.id}-${to.id}`}
                  d={edgePath(from, to)}
                  className={active ? "edge active" : "edge muted"}
                  style={{ "--edge-color": branchMeta[to.branch].color } as CSSProperties}
                  markerEnd={active ? "url(#arrow)" : undefined}
                />
              );
            })}
            {semanticRelations.map((link) => {
              const from = positionedMap.get(link.from);
              const to = positionedMap.get(link.to);
              return from && to ? (
                <path
                  key={link.id}
                  d={edgePath(from, to)}
                  className={`edge cross active semantic ${link.type.toLowerCase()}`}
                  aria-label={`${link.type}：${link.label}`}
                >
                  <title>{`${link.type}：${link.label}`}</title>
                </path>
              ) : null;
            })}
          </g>
          <g className="nodes">
            {positioned.map((node) => {
              const count = activeChildrenMap.get(node.id)?.length ?? 0;
              const isFocus = node.id === focus.id;
              const isSelected = node.id === selected.id;
              const color = branchMeta[node.branch].color;
              return (
                <g
                  key={node.id}
                  className={`node-card ${isSelected ? "selected" : ""} ${emphasized(node.id) ? "active" : "muted"}`}
                  transform={`translate(${node.x} ${node.y})`}
                  onClick={() => onSelect(node.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onSelect(node.id);
                  }}
                  aria-label={`选择知识点：${node.title}`}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx="11"
                    style={{ "--node-color": color } as CSSProperties}
                  />
                  <rect width="4" height={NODE_H} rx="2" fill={color} />
                  <text x="15" y="22" className="node-title">
                    {node.title.length > 20 ? `${node.title.slice(0, 20)}…` : node.title}
                  </text>
                  <text x="15" y="43" className="node-fact">
                    {node.subtitle.length > 15 ? `${node.subtitle.slice(0, 15)}…` : node.subtitle}
                  </text>
                  <text x="15" y="56" className="node-branch">
                    {branchMeta[node.branch].label}
                  </text>
                  {count > 0 ? (
                    <g
                      className={`disclosure-control small ${isFocus ? "open" : ""}`}
                      transform="translate(232 20)"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isFocus) {
                          if (node.parent) onReveal(node.parent);
                        } else {
                          onReveal(node.id);
                        }
                      }}
                      role="button"
                      aria-label={
                        isFocus
                          ? node.parent
                            ? "收起"
                            : "根节点已展开"
                          : `展开 ${count} 个节点`
                      }
                    >
                      <text x="-12" y="4" textAnchor="end" className="child-count">
                        {count}
                      </text>
                      <rect x="-8" y="-8" width="16" height="16" rx="4" />
                      <text x="0" y="4" textAnchor="middle">
                        {isFocus ? (node.parent ? "−" : "·") : "+"}
                      </text>
                    </g>
                  ) : (
                    <circle cx="234" cy="32" r="3" fill={color} opacity=".65" />
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
    </div>
  );
}
