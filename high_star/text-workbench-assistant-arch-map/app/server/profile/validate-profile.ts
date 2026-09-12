import { z } from "zod";
import type { TaskProfile } from "../../plugin/contracts/task-profile";
import { BASE_NODE_TYPES, BASE_EDGE_TYPES } from "../../plugin/contracts/task-profile";
import { CARD_SECTION_CATALOG } from "../../core/knowledge/card-section-catalog";

const text = z.string().trim().min(1);
const pair = z.tuple([z.number().nonnegative(), z.number().positive()]).refine(([a,b]) => a <= b);
const profileSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: text, description: text,
  version: text, schemaVersion: z.literal("task-profile/1"),
  domains: z.array(z.object({ id: text, name: text, description: text, visualBranch: text, order: z.number() })).min(1),
  visualBranches: z.array(text).min(1),
  nodeTypes: z.array(z.object({ type: text, label: text, singular: text, forbidden: z.array(z.string()), note: z.string(), isGranularSensitive: z.boolean() })).min(1),
  edgeTypes: z.array(z.object({ type: text, label: text, direction: z.enum(["directed", "symmetric"]), description: text })).min(1),
  cardSections: z.array(z.object({ type: text, label: text, definition: text, coverage: z.enum(["core","conditional","optional"]), appliesTo: z.union([z.literal("all"),z.array(text)]), order: z.number() })).min(1),
  validation: z.object({ domainCount: z.number().int().positive(), visualBranchCount: z.number().int().positive(), rootNodeRequired: z.boolean(), maxPrimaryChildren: z.number().int().min(1).optional(), extraRules: z.array(text).optional() }),
  hierarchy: z.object({ enabled: z.boolean(), intermediateNodeTypes: z.array(text), planningThreshold: z.number().int().min(1).optional(), maxDepth: z.number().int().min(1).optional(), minMembersPerIntermediate: z.number().int().min(1).optional() }).optional(),
  prompts: z.object({ react: text, review: text, finalResponse: text, ingest: z.record(z.string()), topicAppendix: z.string().optional() }),
  initialization: z.object({ rootNode: z.object({ id: text, name: text, shortFact: text }),
    mvp: z.object({ nodeCount: pair, reactRounds: pair, sectionsFilled: z.array(text), domainCount: pair, durationMinutes: pair }),
    full: z.object({ nodeCount: pair, visitTopicCount: pair.optional(), maxModelCalls: z.number().int().positive().optional(), reactRounds: pair, rootBudgetMinutes: pair, durationMinutes: pair }) }),
  createdAt: text, updatedAt: text, author: z.string().optional(), tags: z.array(z.string()).optional(),
});

/** Counts are descriptive; the current renderer still has a fixed type/color vocabulary. */
export function validateProfile(value: unknown): TaskProfile {
  const p = profileSchema.parse(value);
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) throw new Error(`重复 ${label}`);
  };
  unique(p.domains.map(d => d.id), "domain ID");
  unique(p.visualBranches, "visualBranch");
  for (const list of [p.nodeTypes, p.edgeTypes, p.cardSections]) unique(list.map(t => t.type), "type");
  if (p.domains.some(d => d.id === p.initialization.rootNode.id)) throw new Error("根 ID 不可与域 ID 重复");
  if (p.validation.domainCount !== p.domains.length || p.validation.visualBranchCount !== new Set(p.domains.map(d => d.visualBranch)).size) throw new Error("validation 数量必须与实际域和分支一致");
  if (p.domains.some(d => !p.visualBranches.includes(d.visualBranch))) throw new Error("域引用未知视觉分支");
  const supported = (values: string[], allowed: string[], label: string) => {
    const invalid = values.filter(v => !allowed.includes(v));
    if (invalid.length) throw new Error(`${label} 尚未接入当前引擎: ${invalid.join(", ")}`);
  };
  supported(p.visualBranches, ["foundation","signal","data","system","ai"], "视觉分支");
  supported(p.nodeTypes.map(t => t.type), BASE_NODE_TYPES.map(t => t.type), "节点类型");
  supported(p.edgeTypes.map(t => t.type), BASE_EDGE_TYPES.map(t => t.type), "边类型");
  supported(p.cardSections.map(t => t.type), CARD_SECTION_CATALOG.map(t => t.type), "栏目");
  if (!p.nodeTypes.some(t => t.type === "domain") || !p.cardSections.some(t => t.type === "definition")) throw new Error("需要 domain 类型和 definition 栏目");
  if (p.hierarchy?.enabled && p.hierarchy.intermediateNodeTypes.some(type => !p.nodeTypes.some(nodeType => nodeType.type === type))) throw new Error("hierarchy 引用了未声明的中间节点类型");
  return p;
}
