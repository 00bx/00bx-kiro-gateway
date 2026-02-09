// 00bx Kiro Gateway - Configuration

export const KIRO_REFRESH_URL_TEMPLATE =
  "https://prod.{region}.auth.desktop.kiro.dev/refreshToken";
export const KIRO_API_HOST_TEMPLATE =
  "https://codewhisperer.{region}.amazonaws.com";

export const TOKEN_REFRESH_THRESHOLD = 600; // 10 minutes
export const TOOL_DESCRIPTION_MAX_LENGTH = 10000;

export const MODEL_MAPPING: Record<string, string> = {
  "claude-opus-4-5": "claude-opus-4.5",
  "claude-opus-4-5-20251101": "claude-opus-4.5",
  "claude-haiku-4-5": "claude-haiku-4.5",
  "claude-haiku-4.5": "claude-haiku-4.5",
  "claude-sonnet-4-5": "CLAUDE_SONNET_4_5_20250929_V1_0",
  "claude-sonnet-4-5-20250929": "CLAUDE_SONNET_4_5_20250929_V1_0",
  "claude-sonnet-4": "CLAUDE_SONNET_4_20250514_V1_0",
  "claude-sonnet-4-20250514": "CLAUDE_SONNET_4_20250514_V1_0",
  "claude-3-7-sonnet-20250219": "CLAUDE_3_7_SONNET_20250219_V1_0",
  auto: "claude-sonnet-4.5",
};

export function getKiroRefreshUrl(region: string): string {
  return KIRO_REFRESH_URL_TEMPLATE.replace("{region}", region);
}

export function getKiroApiHost(region: string): string {
  return KIRO_API_HOST_TEMPLATE.replace("{region}", region);
}

export function getInternalModelId(externalModel: string): string {
  return MODEL_MAPPING[externalModel] ?? externalModel;
}
