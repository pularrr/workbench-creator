import { createHash } from "node:crypto";
import type { KnowledgeNetwork } from "./network-dataset";

/**
 * MVP 验收令牌
 *
 * 把“用户已验收某个具体 MVP 网络”这件事在服务器端做成不可抵赖的记录，
 * 使完整网络生成必须基于【被验收过】的 MVP，而非客户端随意置位的 `confirmedMvp` 布尔值。
 *
 * 流程：
 *  1. generate(mode="mvp") 返回网络 + mvpAcceptanceToken（= 对 profileId + 网络做 sha256）。
 *  2. 用户在 UI/编排层验收该 MVP，并带着 initialNetwork 与 mvpAcceptanceToken 调用 generate(mode="full")。
 *  3. 服务端用 verifyMvpToken 重新计算哈希并比对；不匹配直接 400，完整生成被强制阻断。
 *
 * 这样“仅需 0 error 即可进完整生成”的漏洞被堵死：完整生成必须来自一个被显式验收、且内容未篡改的 MVP。
 */
export function issueMvpToken(profileId: string, network: KnowledgeNetwork): string {
  const payload = JSON.stringify({ profileId, network });
  return createHash("sha256").update(payload).digest("hex");
}

export function verifyMvpToken(token: string, profileId: string, network: KnowledgeNetwork): boolean {
  if (!token || typeof token !== "string") return false;
  return token === issueMvpToken(profileId, network);
}
