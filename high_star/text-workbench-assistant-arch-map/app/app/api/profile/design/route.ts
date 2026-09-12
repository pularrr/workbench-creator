/**
 * Profile 设计 API
 *
 * P3-3：通用 LLM 根据用户的任务描述，自动设计一个完整的 TaskProfile。
 *
 * POST /api/profile/design
 * Body: { topic: string, taskDescription: string, writeToFile?: boolean }
 * Response: { profile: TaskProfile, iterations: number, validationIssues: string[], warnings: string[], filePath?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { ProfileDesigner } from "../../../../server/profile/profile-designer";
import { createConfiguredLlmProvider } from "../../../../server/llm/provider-factory";
import { runtimeLlmConfigStore } from "../../../../server/runtime/app-runtime";
import { validateProfile } from "../../../../server/profile/validate-profile";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 分钟超时

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, taskDescription, writeToFile = false } = body;

    if (!topic || !taskDescription) {
      return NextResponse.json(
        { error: "缺少 topic 或 taskDescription 参数" },
        { status: 400 }
      );
    }

    // 使用统一的 LlmProvider（自动处理推理模型兼容、tool_choice 剥离等）
    const provider = createConfiguredLlmProvider({ environment: runtimeLlmConfigStore().environment() });
    const designer = new ProfileDesigner(provider, topic, taskDescription);
    const result = await designer.design();
    validateProfile(result.profile);

    let filePath: string | undefined;
    if (writeToFile) {
      try {
        filePath = designer.writeProfileToFile(result.profile);
      } catch (error) {
        result.warnings.push(`写入文件失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return NextResponse.json({
      ...result,
      filePath,
    });
  } catch (error) {
    console.error("Profile 设计失败:", error);
    return NextResponse.json(
      {
        error: "Profile 设计失败",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
