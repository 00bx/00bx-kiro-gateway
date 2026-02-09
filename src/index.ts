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

      // Idle timeout: cancel reader if no data for 15s (Kiro may keep connection open)
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          reader.cancel().catch(() => {});
        }, 15_000);
      };

      try {
        resetIdleTimer();

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          resetIdleTimer();

          const events = parser.feed(value);
          for (const event of events) {
            if (event.type === "content") {
              textParts.push(event.data as string);
            }
          }

          if (parser.isComplete()) {
            reader.cancel().catch(() => {});
            break;
          }
        }
      } catch {
        // Reader cancelled or stream error — use whatever was collected
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
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
      const textId = "text-0";

      // Use TransformStream as a push-based approach (Bun-compatible)
      const { readable, writable } = new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>();
      const writer = writable.getWriter();

      // Consume the response body in a fire-and-forget async loop
      (async () => {
        let textStartEmitted = false;

        try {
          const reader = body.getReader();

          // Idle timeout: cancel the reader if no data arrives for 15s.
          // This works in Bun because we cancel() the reader directly,
          // which causes the pending reader.read() to resolve with { done: true }.
          let idleTimer: ReturnType<typeof setTimeout> | null = null;
          const resetIdleTimer = () => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
              reader.cancel().catch(() => {});
            }, 15_000);
          };

          resetIdleTimer(); // Start the initial idle timer

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const result = await reader.read();

            if (result.done) break;

            // Data arrived — reset the idle timer
            resetIdleTimer();

            const events = parser.feed(result.value!);
            for (const event of events) {
              if (event.type === "content") {
                if (!textStartEmitted) {
                  await writer.write({
                    type: "text-start",
                    id: textId,
                  } as LanguageModelV2StreamPart);
                  textStartEmitted = true;
                }
                await writer.write({
                  type: "text-delta",
                  id: textId,
                  delta: event.data as string,
                } as LanguageModelV2StreamPart);
              }
            }

            // Kiro finished: usage received + no pending tool call.
            // Don't wait for reader done — Kiro may keep the connection open.
            if (parser.isComplete()) {
              if (idleTimer) clearTimeout(idleTimer);
              reader.cancel().catch(() => {});
              break;
            }
          }

          // Clean up idle timer
          if (idleTimer) clearTimeout(idleTimer);
        } catch {
          // Stream read error or reader.cancel() — emit finish with whatever we have
        }

        // Emit finish: close text, emit tool calls, emit finish event
        const toolCalls = parser.getToolCalls();

        if (textStartEmitted) {
          await writer.write({ type: "text-end", id: textId } as LanguageModelV2StreamPart);
        }

        for (const tc of toolCalls) {
          await writer.write({ type: "tool-input-start", id: tc.id, toolName: tc.name } as LanguageModelV2StreamPart);
          await writer.write({ type: "tool-input-delta", id: tc.id, delta: tc.arguments } as LanguageModelV2StreamPart);
          await writer.write({ type: "tool-input-end", id: tc.id } as LanguageModelV2StreamPart);
          await writer.write({ type: "tool-call", toolCallId: tc.id, toolName: tc.name, input: tc.arguments } as LanguageModelV2StreamPart);
        }

        const finishReason = toolCalls.length > 0 ? "tool-calls" : "stop";
        await writer.write({
          type: "finish",
          finishReason,
          usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
        } as LanguageModelV2StreamPart);

        await writer.close();
      })();

      return {
        stream: readable,
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
