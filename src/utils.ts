// 00bx Kiro Gateway - Utilities

import { createHash, randomUUID } from "node:crypto";
import { hostname, userInfo } from "node:os";

export function getMachineFingerprint(): string {
  try {
    const h = hostname();
    const u = userInfo().username;
    return createHash("sha256")
      .update(`${h}-${u}-kiro-gateway`)
      .digest("hex");
  } catch {
    return createHash("sha256").update("default-kiro-gateway").digest("hex");
  }
}

export function getKiroHeaders(fingerprint: string, token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": `aws-sdk-js/1.0.27 ua/2.1 os/win32#10.0.19044 lang/js md/nodejs#22.21.1 api/codewhispererstreaming#1.0.27 m/E KiroGateway-${fingerprint.slice(0, 32)}`,
    "x-amz-user-agent": `aws-sdk-js/1.0.27 KiroGateway-${fingerprint.slice(0, 32)}`,
    "x-amzn-codewhisperer-optout": "true",
    "x-amzn-kiro-agent-mode": "vibe",
    "amz-sdk-invocation-id": randomUUID(),
    "amz-sdk-request": "attempt=1; max=3",
  };
}

export function generateConversationId(): string {
  return randomUUID();
}

export function generateToolCallId(): string {
  return `call_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}
