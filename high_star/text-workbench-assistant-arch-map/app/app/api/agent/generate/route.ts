/**
 * 知识生成 API
 *
 * P3-4：根据主题 + Profile，自动生成初始知识网络。
 *
 * POST /api/agent/generate
 * Body: { topic: string, profile?: TaskProfile, profileId?: string, mode: "mvp" | "full", writeToFile?: boolean }
 * Response: { network: KnowledgeNetwork, mode, iterations, totalNodes, totalCardBlocks, totalRelations, distributedCalls, warnings, converged, filePath? }
 */

import { NextRequest, NextResponse } from "next/server";
import { KnowledgeGenerator } from "../../../../server/agent/knowledge-generator";
import { ACTIVE_PROFILE } from "../../../../profiles/active";
import { validateProfile } from "../../../../server/profile/validate-profile";
import { runtimeLlmConfigStore } from "../../../../server/runtime/app-runtime";
import { createConfiguredLlmProvider } from "../../../../server/llm/provider-factory";
import type { TaskProfile } from "../../../../plugin/contracts/task-profile";
import { verifyMvpToken } from "../../../../server/agent/mvp-confirmation";
import type { ApprovedResearchBudget } from "../../../../core/agent/research-budget-policy";

export const runtime = "nodejs";
export const maxDuration = 800; // MVP 与完整开发共用；完整开发为长任务，生产环境应走后台任务

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, profile: customProfile, profileId, mode = "mvp", writeToFile = false, initialNetwork, confirmedMvp, mvpConfirmationToken, approvedBudget, queueState, extraDurationMinutes, resumeRunId } = body;

    if (!topic) {
      return NextResponse.json(
        { error: "缺少 topic 参数" },
        { status: 400 }
      );
    }

    // 选择 Profile：优先使用传入的 customProfile，其次根据 profileId 加载，最后使用 FMCW 默认
    let profile: TaskProfile;
    if (customProfile) {
      profile = customProfile;
    } else if (profileId === ACTIVE_PROFILE.id || !profileId) {
      profile = ACTIVE_PROFILE;
    } else {
      return NextResponse.json(
        { error: `未知 profileId: ${profileId}；请传入完整 profile 或使用 ${ACTIVE_PROFILE.id}` },
        { status: 400 }
      );
    }
    profile = validateProfile(profile);

    // 确认门：完整开发必须先由用户验收 MVP（拿到不可抵赖的确认令牌），令牌需与 initialNetwork 匹配
    if (mode === "full") {
      if (!initialNetwork) {
        return NextResponse.json({ error: "完整开发需要已验收的 MVP 网络(initialNetwork)" }, { status: 400 });
      }
      if (!mvpConfirmationToken || !verifyMvpToken(mvpConfirmationToken, profile.id, initialNetwork)) {
        return NextResponse.json({ error: "需先由用户验收 MVP（拿到确认令牌）才能进行完整生成；令牌无效或与 initialNetwork 不匹配" }, { status: 400 });
      }
    }

    // 使用统一的 LlmProvider（自动处理推理模型兼容、tool_choice 剥离等）
    const provider = createConfiguredLlmProvider({ environment: runtimeLlmConfigStore().environment() });
    const generator = new KnowledgeGenerator(provider, topic, profile, mode);
    const result = await generator.generate({ initialNetwork, confirmedMvp: mode === "full" ? true : Boolean(confirmedMvp), mvpAcceptanceToken: mode === "full" ? mvpConfirmationToken : undefined, approvedBudget: mode === "full" ? approvedBudget as ApprovedResearchBudget : undefined, queueState, extraDurationMinutes: Number(extraDurationMinutes) || 0, resumeRunId, signal: request.signal });

    let filePath: string | undefined;
    if (writeToFile) {
      try {
        filePath = generator.writeNetworkToFile(result.network);
      } catch (error) {
        result.warnings.push(`写入文件失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return NextResponse.json({
      ...result,
      filePath,
    });
  } catch (error) {
    console.error("知识生成失败:", error);
    return NextResponse.json(
      {
        error: "知识生成失败",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
