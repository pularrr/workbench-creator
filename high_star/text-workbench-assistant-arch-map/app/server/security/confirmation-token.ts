import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { GraphPatch } from "../../core/agent/contracts";
import { deterministicId } from "../../core/agent/graph-operations";

export interface ConfirmationClaims {
  patchId: string;
  patchHash: string;
  baseRevision: number;
  sessionId: string;
  expiresAt: number;
  nonce: string;
}

export type VerifiedConfirmationProof = ConfirmationClaims & { readonly verified: true };
// Next.js may evaluate this module in more than one server bundle. A module-local
// WeakSet makes a proof verified in one bundle appear unverified in another.
// Keep the non-serializable registry process-global so only verify() can enroll it.
const confirmationGlobal = globalThis as typeof globalThis & {
  __knowmapVerifiedConfirmationProofs?: WeakSet<object>;
};
const verifiedProofs = confirmationGlobal.__knowmapVerifiedConfirmationProofs ??= new WeakSet<object>();

const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

export function isVerifiedConfirmationProof(value: unknown): value is VerifiedConfirmationProof {
  if (!value || typeof value !== "object") return false;
  if (verifiedProofs.has(value as object)) return true;
  // Server bundles can cross VM realms, where WeakSet identity is not shared.
  // The proof is never accepted from HTTP input: OnlineAgentService creates it
  // immediately via verify(), then the repository rechecks every patch claim.
  const proof = value as Partial<VerifiedConfirmationProof>;
  return proof.verified === true
    && typeof proof.patchId === "string"
    && typeof proof.patchHash === "string"
    && typeof proof.baseRevision === "number"
    && typeof proof.sessionId === "string"
    && typeof proof.expiresAt === "number"
    && typeof proof.nonce === "string";
}

export class ConfirmationTokenService {
  constructor(private readonly secret: string, private readonly ttlMs = 10 * 60_000) {
    if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("CONFIRMATION_SECRET must contain at least 32 bytes.");
  }

  issue(patch: GraphPatch, sessionId: string, now = Date.now()): { token: string; expiresAt: number } {
    if (!sessionId.trim()) throw new Error("A session id is required.");
    const claims: ConfirmationClaims = {
      patchId: patch.id,
      patchHash: deterministicId("patch", patch),
      baseRevision: patch.baseRevision,
      sessionId,
      expiresAt: now + this.ttlMs,
      nonce: randomUUID(),
    };
    const payload = encode(JSON.stringify(claims));
    return { token: `${payload}.${this.sign(payload)}`, expiresAt: claims.expiresAt };
  }

  verify(token: string, patch: GraphPatch, sessionId: string, now = Date.now()): VerifiedConfirmationProof {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw new Error("Invalid confirmation token.");
    const expected = Buffer.from(this.sign(payload));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("Invalid confirmation token signature.");
    const claims = JSON.parse(decode(payload)) as ConfirmationClaims;
    if (claims.expiresAt < now) throw new Error("Confirmation token has expired.");
    if (claims.sessionId !== sessionId) throw new Error("Confirmation token belongs to another session.");
    if (claims.patchId !== patch.id || claims.baseRevision !== patch.baseRevision || claims.patchHash !== deterministicId("patch", patch)) {
      throw new Error("Confirmation token does not match this patch.");
    }
    const proof = { ...claims, verified: true as const };
    verifiedProofs.add(proof);
    return proof;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }
}
