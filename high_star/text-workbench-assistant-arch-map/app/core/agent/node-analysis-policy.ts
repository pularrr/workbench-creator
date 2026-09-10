/** Shared semantic policy for host-side graph construction and in-app research. */
export type NodeAnalysisStage = "baseline" | "skeleton" | "gap";

export const NODE_ANALYSIS_LOOP_RULES = `【逐节点深度分析：统一三阶段】
A1. 基线分析（baseline）：第一次面对当前节点时，不从预设栏目缺口或搜索结果倒推答案。先把节点当作完整知识对象，自主分析其对象、机制、组成、依赖、输入输出、真实实现、使用过程、工程约束、失效、验证与意义。将有实质内容的结论归入理论知识、应用知识或其他知识；栏目是归档结果，不是限制思考的问卷。
A2. 结构分析（skeleton）：仅在当前节点需要扩展下级知识时，规划 domain/category 导航骨架和 entity 归属；结构步骤不能覆盖或删除基线卡片。
A3. 缺口深挖（gap）：观察基线成果、已有卡片和待审查批次，形成仍未解决的具体问题。每轮选择一组缺口，围绕当前节点给出尽可能完整的回答，至少说明“是什么/为什么或如何实现/输入输出与关键步骤/意义或取舍/失败与验证”中适用的部分。不能因为找到若干关键词、来源或候选节点就宣布该缺口已解决。
A4. 去重与更新：新增内容须与正式卡片及本轮批次比较；语义相同则不重复添加，信息更完整时提出对原栏目补充或替换。不得以换标题、改写句子制造新增量。
A5. 完成判定：只有适用问题已经得到有机制、有实现细节且可检查的回答，连续复查也无实质新增，才建议收敛。预算耗尽、调用失败或只得到部分来源均不是完成。`;

export function nodeAnalysisStage(round: number, skeletonRounds: number, hierarchyEnabled: boolean): NodeAnalysisStage {
  if (round === 0) return "baseline";
  if (hierarchyEnabled && round <= skeletonRounds) return "skeleton";
  return "gap";
}

export function nodeAnalysisStagePrompt(stage: NodeAnalysisStage, focusGaps: readonly string[] = []): string {
  if (stage === "baseline") return "【当前阶段：基线分析】优先深入分析当前 topic 本身，不要以现有缺失栏目作为问题清单。先形成完整心智模型并把实质结论写入当前节点的 cardBlocks；确有必要时可提出相关候选节点，但候选数量不能替代当前节点的分析深度。最后列出下一阶段仍需核实或深挖的问题。";
  if (stage === "skeleton") return "【当前阶段：结构分析】只创建必要的中间导航节点并给出重挂载提示；不要创建具体叶子。保留此前基线分析形成的卡片。";
  const gaps = focusGaps.length ? focusGaps.join("；") : "根据基线分析和现有知识识别的未解决问题";
  return `【当前阶段：缺口深挖】本轮聚焦：${gaps}。围绕当前节点逐项给出饱满答案，并把答案归档到适用卡片；返回的 gaps 只能保留本轮之后仍未解决的具体问题。`;
}
