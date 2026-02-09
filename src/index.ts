// 00bx Kiro Gateway - Vercel AI SDK Provider
// Free Claude models via Kiro CLI (AWS CodeWhisperer)

import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  ProviderV2,
} from "@ai-sdk/provider";

import { KiroAuthManager } from "./auth.js";
import { buildKiroPayload } from "./converter.js";
import { getKiroApiHost } from "./config.js";
import { getKiroHeaders } from "./utils.js";
import { AwsEventStreamParser } from "./streaming.js";
import type { CollectedToolCall } from "./streaming.js";

// ─── Singleton auth manager ──────────────────────────────────────────────────

let authManager: KiroAuthManager | null = null;

function getAuthManager(): KiroAuthManager {
  if (!authManager) {
    authManager = new KiroAuthManager();
  }
  return authManager;
}

// ─── Make API request to Kiro ────────────────────────────────────────────────

async function makeKiroRequest(
  auth: KiroAuthManager,
  payload: Record<string, unknown>,
  retries = 3,
): Promise<Response> {
  const url = `${getKiroApiHost(auth.getRegion())}/generateAssistantResponse`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    const token = attempt === 0
      ? await auth.getAccessToken()
      : await auth.forceRefresh();

    const headers = getKiroHeaders(auth.fingerprint, token);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (res.ok) return res;

    const status = res.status;
    const body = await res.text().catch(() => "");

    if (status === 403) {
      // Token expired, retry with fresh token
      lastError = new Error(`Kiro API 403: ${body}`);
      continue;
    }

    if (status === 429 || status >= 500) {
      // Rate limit or server error, wait and retry
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise((r) => setTimeout(r, delay));
      lastError = new Error(`Kiro API ${status}: ${body}`);
      continue;
    }

    // Client error (4xx) — don't retry
    throw new Error(`Kiro API error ${status}: ${body}`);
  }

  throw lastError ?? new Error("Kiro API request failed after retries");
}

// ─── Convert tool calls to AI SDK format ─────────────────────────────────────

function toolCallsToContent(
  calls: CollectedToolCall[],
): Array<{ type: "tool-call"; toolCallId: string; toolName: string; input: string }> {
  return calls.map((tc) => ({
    type: "tool-call" as const,
    toolCallId: tc.id,
    toolName: tc.name,
    input: tc.arguments,
  }));
}

// ─── Create Kiro Language Model ──────────────────────────────────────────────

function createKiroLanguageModel(modelId: string): LanguageModelV2 {
  const auth = getAuthManager();

  return {
    specificationVersion: "v2",
    provider: "00bx-kiro-gateway",
    modelId,
    supportedUrls: {},

    // ─── Non-streaming generation ──────────────────────────────────────
    async doGenerate(options: LanguageModelV2CallOptions) {
      const profileArn = auth.getProfileArn() || "";
      const payload = buildKiroPayload(options, modelId, profileArn);

      const response = await makeKiroRequest(auth, payload as unknown as Record<string, unknown>);

      // Kiro always returns a stream, even for non-streaming requests.
      // We collect the full stream into a single response.
      const parser = new AwsEventStreamParser();
      const body = response.body;
      if (!body) throw new Error("Empty response from Kiro API");

      const textParts: string[] = [];
      const reader = body.getReader();

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const events = parser.feed(value);
          for (const event of events) {
            if (event.type === "content") {
              textParts.push(event.data as string);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      const fullText = textParts.join("");
      const toolCalls = parser.getToolCalls();

      // Build content array
      const content: Array<
        | { type: "text"; text: string }
        | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
      > = [];

      if (fullText) {
        content.push({ type: "text", text: fullText });
      }
      if (toolCalls.length > 0) {
        content.push(...toolCallsToContent(toolCalls));
      }

      const finishReason = toolCalls.length > 0 ? "tool-calls" : "stop";

      return {
        content,
        finishReason: finishReason as "stop" | "tool-calls",
        usage: {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        },
        warnings: [],
      };
    },

    // ─── Streaming generation ──────────────────────────────────────────
    async doStream(options: LanguageModelV2CallOptions) {
      const profileArn = auth.getProfileArn() || "";
      const payload = buildKiroPayload(options, modelId, profileArn);

      const response = await makeKiroRequest(auth, payload as unknown as Record<string, unknown>);

      const body = response.body;
      if (!body) throw new Error("Empty response from Kiro API");

      const parser = new AwsEventStreamParser();
      const reader = body.getReader();
      let textStartEmitted = false;
      const textId = "text-0";
      let readerDone = false;

      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        async pull(controller) {
          if (readerDone) {
            controller.close();
            return;
          }

          try {
            const { done, value } = await reader.read();

            if (done) {
              readerDone = true;

              // Emit tool calls that were collected during streaming
              const toolCalls = parser.getToolCalls();

              // Close any open text stream
              if (textStartEmitted) {
                controller.enqueue({ type: "text-end", id: textId } as LanguageModelV2StreamPart);
              }

              // Emit tool call stream parts
              for (let i = 0; i < toolCalls.length; i++) {
                const tc = toolCalls[i];
                const toolId = `tool-${i}`;
                controller.enqueue({
                  type: "tool-input-start",
                  id: toolId,
                  toolName: tc.name,
                } as LanguageModelV2StreamPart);
                controller.enqueue({
                  type: "tool-input-delta",
                  id: toolId,
                  delta: tc.arguments,
                } as LanguageModelV2StreamPart);
                controller.enqueue({
                  type: "tool-input-end",
                  id: toolId,
                } as LanguageModelV2StreamPart);
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: tc.id,
                  toolName: tc.name,
                  input: tc.arguments,
                } as LanguageModelV2StreamPart);
              }

              const finishReason = toolCalls.length > 0 ? "tool-calls" : "stop";

              controller.enqueue({
                type: "finish",
                finishReason,
                usage: {
                  inputTokens: undefined,
                  outputTokens: undefined,
                  totalTokens: undefined,
                },
              } as LanguageModelV2StreamPart);

              controller.close();
              return;
            }

            const events = parser.feed(value);
            for (const event of events) {
              if (event.type === "content") {
                if (!textStartEmitted) {
                  controller.enqueue({
                    type: "text-start",
                    id: textId,
                  } as LanguageModelV2StreamPart);
                  textStartEmitted = true;
                }
                controller.enqueue({
                  type: "text-delta",
                  id: textId,
                  delta: event.data as string,
                } as LanguageModelV2StreamPart);
              }
              // Tool events are collected by the parser and emitted at stream end
            }
          } catch (err) {
            controller.enqueue({
              type: "error",
              error: err,
            } as LanguageModelV2StreamPart);
            controller.close();
          }
        },

        cancel() {
          reader.cancel().catch(() => {});
        },
      });

      return {
        stream,
        request: { body: payload },
      };
    },
  };
}

// ─── Provider factory ────────────────────────────────────────────────────────

export function createKiroProvider(_options?: Record<string, unknown>): ProviderV2 {
  return {
    languageModel(modelId: string): LanguageModelV2 {
      return createKiroLanguageModel(modelId);
    },
    textEmbeddingModel() {
      throw new Error("Kiro Gateway does not support embedding models");
    },
    imageModel() {
      throw new Error("Kiro Gateway does not support image models");
    },
  };
}

// Default export — what OpenCode calls when loading the npm provider
export default createKiroProvider;
