import { knowledgeNodes, type KnowledgeNode } from "../model/knowledgeViewModel";

export type Viewport = { x: number; y: number; scale: number };
export type TraceMode = "context" | "upstream" | "downstream" | "all";
export type PositionedNode = KnowledgeNode & {
  x: number;
  y: number;
  role: "previous" | "focus" | "next";
};

export const WORLD = { width: 1400, height: 680 };
export const NODE_W = 252;
export const NODE_H = 64;
export const MAX_NODES_PER_LANE = 8;

export const nodeMap = new Map(knowledgeNodes.map((node) => [node.id, node]));
export const childrenMap = new Map<string, KnowledgeNode[]>();

knowledgeNodes.forEach((node) => {
  if (!node.parent) return;
  childrenMap.set(node.parent, [...(childrenMap.get(node.parent) ?? []), node]);
});

export type LayoutIndex = {
  nodeMap: Map<string, KnowledgeNode>;
  childrenMap: Map<string, KnowledgeNode[]>;
};

export function createLayoutIndex(nodes: readonly KnowledgeNode[]): LayoutIndex {
  const nextNodeMap = new Map(nodes.map((node) => [node.id, node]));
  const nextChildrenMap = new Map<string, KnowledgeNode[]>();
  for (const node of nodes) {
    if (node.parent) nextChildrenMap.set(node.parent, [...(nextChildrenMap.get(node.parent) ?? []), node]);
  }
  return { nodeMap: nextNodeMap, childrenMap: nextChildrenMap };
}

const defaultIndex: LayoutIndex = { nodeMap, childrenMap };

export function ancestorsOf(id: string, index: LayoutIndex = defaultIndex) {
  const result: KnowledgeNode[] = [];
  let current = index.nodeMap.get(id);
  while (current?.parent) {
    const parent = index.nodeMap.get(current.parent);
    if (!parent) break;
    result.push(parent);
    current = parent;
  }
  return result;
}

export function descendantsOf(id: string, index: LayoutIndex = defaultIndex) {
  const result = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    (index.childrenMap.get(current) ?? []).forEach((node) => {
      if (!result.has(node.id)) {
        result.add(node.id);
        queue.push(node.id);
      }
    });
  }
  return result;
}

export function arrange(focus: KnowledgeNode, index: LayoutIndex = defaultIndex): PositionedNode[] {
  const lineage = [...ancestorsOf(focus.id, index).reverse(), focus];
  const focusChildren = index.childrenMap.get(focus.id) ?? [];
  /**
   * A column represents exactly one primary-tree depth.  The focus lineage
   * supplies the column's parent context; the column itself shows that
   * context node together with its true siblings.  Only direct children of
   * the focus may be appended as the next column.  Semantic links never
   * participate in this placement calculation.
   */
  const columns: KnowledgeNode[][] = lineage.map((node) =>
    node.parent ? (index.childrenMap.get(node.parent) ?? [node]) : [node],
  );
  if (focusChildren.length) columns.push(focusChildren);

  // Keep the most relevant four depths when a deep node is opened.  Columns
  // are still level-pure; no ancestor sibling can leak into a child column.
  const visibleColumns = columns.slice(-4);
  const directChildLaneCount = Math.ceil(focusChildren.length / MAX_NODES_PER_LANE);
  const layoutColumns = directChildLaneCount > 1
    ? visibleColumns.slice(-2)
    : visibleColumns;
  const displayColumns = layoutColumns.flatMap((column, logicalIndex) => {
    const sorted = [...column].sort((left, right) => left.id === focus.id ? -1 : right.id === focus.id ? 1 : left.title.localeCompare(right.title, "zh-CN"));
    const lanes = Array.from({ length: Math.ceil(sorted.length / MAX_NODES_PER_LANE) }, (_, laneIndex) =>
      sorted.slice(laneIndex * MAX_NODES_PER_LANE, (laneIndex + 1) * MAX_NODES_PER_LANE),
    );
    // Ancestor context keeps only the lane containing the lineage node. The
    // focus's direct children use every lane, so the next depth always starts
    // after all same-depth lanes.
    if (logicalIndex < layoutColumns.length - 1 && lanes.length > 1) {
      return [lanes.find((lane) => lane.some((node) => lineage.some((item) => item.id === node.id))) ?? lanes[0]];
    }
    return lanes;
  });
  const gutter = 22;
  const availableWidth = WORLD.width - NODE_W;
  const columnGap = displayColumns.length > 1
    ? Math.min(NODE_W + gutter, availableWidth / (displayColumns.length - 1))
    : 0;
  const contentWidth = NODE_W + columnGap * Math.max(0, displayColumns.length - 1);
  const firstX = Math.max(24, (WORLD.width - contentWidth) / 2);
  const result: PositionedNode[] = [];

  displayColumns.forEach((sorted, columnIndex) => {
    const gap = Math.min(82, 560 / Math.max(1, sorted.length - 1));
    const startY = WORLD.height / 2 - NODE_H / 2 - ((sorted.length - 1) * gap) / 2;
    const x = firstX + columnIndex * columnGap;
    sorted.forEach((node, rowIndex) => {
      result.push({
        ...node,
        x,
        y: startY + rowIndex * gap,
        role: node.id === focus.id ? "focus" : focusChildren.some((child) => child.id === node.id) ? "next" : "previous",
      });
    });
  });
  return result;
}

export function edgePath(from: PositionedNode, to: PositionedNode) {
  const sx = from.x + NODE_W;
  const sy = from.y + NODE_H / 2;
  const tx = to.x;
  const ty = to.y + NODE_H / 2;
  const bend = Math.max(65, (tx - sx) * 0.5);
  return `M${sx} ${sy} C${sx + bend} ${sy},${tx - bend} ${ty},${tx} ${ty}`;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function bounded(view: Viewport, anchor?: PositionedNode): Viewport {
  const scale = Number.isFinite(view.scale) ? clamp(view.scale, 0.78, 1.42) : 1;
  const point = anchor ?? {
    x: WORLD.width / 2 - NODE_W / 2,
    y: WORLD.height / 2 - NODE_H / 2,
  };
  const anchorX = (point.x + NODE_W / 2) * scale;
  const anchorY = (point.y + NODE_H / 2) * scale;
  const marginX = NODE_W * 0.62;
  const marginY = NODE_H;
  return {
    scale,
    x: Number.isFinite(view.x)
      ? clamp(view.x, marginX - anchorX, WORLD.width - marginX - anchorX)
      : 0,
    y: Number.isFinite(view.y)
      ? clamp(view.y, marginY - anchorY, WORLD.height - marginY - anchorY)
      : 0,
  };
}
