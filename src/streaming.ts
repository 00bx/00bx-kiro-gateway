// 00bx Kiro Gateway - AWS Event Stream Parser & Streaming

import { generateToolCallId } from "./utils.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedEvent {
  type: "content" | "tool_start" | "tool_input" | "tool_stop" | "usage" | "context_usage" | "followup";
  data: unknown;
}

export interface CollectedToolCall {
  id: string;
  name: string;
  arguments: string;
}

// ─── AWS Binary Event Stream Protocol Parser ─────────────────────────────────
// Each message: [total_len:4][headers_len:4][prelude_crc:4][headers][payload][msg_crc:4]

function extractJsonPayloads(rawBuffer: Uint8Array): { payloads: string[]; remaining: Uint8Array } {
  const payloads: string[] = [];
  let offset = 0;

  while (offset + 12 <= rawBuffer.length) {
    // Read total message length (big-endian uint32)
    const totalLen =
      (rawBuffer[offset] << 24) |
      (rawBuffer[offset + 1] << 16) |
      (rawBuffer[offset + 2] << 8) |
      rawBuffer[offset + 3];

    // Sanity check: total length must be at least 16 (prelude + trailing CRC)
    if (totalLen < 16 || totalLen > 1_000_000) {
      // Invalid frame — skip one byte and try again
      offset++;
      continue;
    }

    // Check if we have the full message
    if (offset + totalLen > rawBuffer.length) {
      break; // Incomplete message, wait for more data
    }

    // Read headers length
    const headersLen =
      (rawBuffer[offset + 4] << 24) |
      (rawBuffer[offset + 5] << 16) |
      (rawBuffer[offset + 6] << 8) |
      rawBuffer[offset + 7];

    // Payload starts after: prelude (12 bytes) + headers
    const payloadStart = offset + 12 + headersLen;
    // Payload ends before: trailing CRC (4 bytes)
    const payloadEnd = offset + totalLen - 4;

    if (payloadStart < payloadEnd) {
      const payloadBytes = rawBuffer.slice(payloadStart, payloadEnd);
      const payloadStr = new TextDecoder("utf-8", { fatal: false }).decode(payloadBytes);
      if (payloadStr.trim()) {
        payloads.push(payloadStr);
      }
    }

    offset += totalLen;
  }

  // Return remaining unprocessed bytes
  const remaining = offset < rawBuffer.length
    ? rawBuffer.slice(offset)
    : new Uint8Array(0);

  return { payloads, remaining };
}

// ─── Event type detection from parsed JSON ───────────────────────────────────

function detectEventType(data: Record<string, unknown>): ParsedEvent["type"] | null {
  if ("content" in data) return "content";
  if ("name" in data) return "tool_start";
  if ("input" in data && !("name" in data)) return "tool_input";
  if ("stop" in data && !("name" in data)) return "tool_stop";
  if ("followupPrompt" in data) return "followup";
  if ("usage" in data) return "usage";
  if ("contextUsagePercentage" in data) return "context_usage";
  return null;
}

// ─── AWS Event Stream Parser ─────────────────────────────────────────────────

export class AwsEventStreamParser {
  private rawBuffer = new Uint8Array(0);
  private lastContent: string | null = null;
  private currentToolCall: {
    id: string;
    name: string;
    arguments: string;
  } | null = null;
  toolCalls: CollectedToolCall[] = [];

  feed(chunk: Uint8Array | string): ParsedEvent[] {
    // Convert string to bytes if needed
    const newBytes = typeof chunk === "string"
      ? new TextEncoder().encode(chunk)
      : chunk;

    // Append to raw buffer
    const merged = new Uint8Array(this.rawBuffer.length + newBytes.length);
    merged.set(this.rawBuffer);
    merged.set(newBytes, this.rawBuffer.length);
    this.rawBuffer = merged;

    // Extract JSON payloads from binary frames
    const { payloads, remaining } = extractJsonPayloads(this.rawBuffer);
    this.rawBuffer = remaining;

    // Process each payload
    const events: ParsedEvent[] = [];
    for (const payload of payloads) {
      try {
        const data = JSON.parse(payload) as Record<string, unknown>;
        const eventType = detectEventType(data);
        if (eventType) {
          const event = this.processEvent(data, eventType);
          if (event) events.push(event);
        }
      } catch {
        // Skip malformed JSON
      }
    }

    return events;
  }

  private processEvent(
    data: Record<string, unknown>,
    type: ParsedEvent["type"],
  ): ParsedEvent | null {
    switch (type) {
      case "content": {
        const content = (data.content as string) || "";
        if (data.followupPrompt) return null;
        if (content === this.lastContent) return null; // Dedup
        this.lastContent = content;
        return { type: "content", data: content };
      }
      case "tool_start": {
        // Finalize previous tool if any
        if (this.currentToolCall) this.finalizeToolCall();

        const inputData = data.input;
        const inputStr =
          typeof inputData === "object" && inputData !== null
            ? JSON.stringify(inputData)
            : inputData
              ? String(inputData)
              : "";

        this.currentToolCall = {
          id: (data.toolUseId as string) || generateToolCallId(),
          name: (data.name as string) || "",
          arguments: inputStr as string,
        };

        if (data.stop) this.finalizeToolCall();
        return null;
      }
      case "tool_input": {
        if (this.currentToolCall) {
          const inputData = data.input;
          const inputStr =
            typeof inputData === "object" && inputData !== null
              ? JSON.stringify(inputData)
              : inputData
                ? String(inputData)
                : "";
          this.currentToolCall.arguments += inputStr;
        }
        return null;
      }
      case "tool_stop": {
        if (this.currentToolCall && data.stop) this.finalizeToolCall();
        return null;
      }
      case "usage":
        return { type: "usage", data: data.usage ?? 0 };
      case "context_usage":
        return { type: "context_usage", data: data.contextUsagePercentage ?? 0 };
      default:
        return null;
    }
  }

  private finalizeToolCall(): void {
    if (!this.currentToolCall) return;

    let args = this.currentToolCall.arguments;
    if (args.trim()) {
      try {
        const parsed = JSON.parse(args);
        args = JSON.stringify(parsed);
      } catch {
        args = "{}";
      }
    } else {
      args = "{}";
    }

    this.toolCalls.push({
      id: this.currentToolCall.id,
      name: this.currentToolCall.name,
      arguments: args,
    });
    this.currentToolCall = null;
  }

  getToolCalls(): CollectedToolCall[] {
    if (this.currentToolCall) this.finalizeToolCall();
    return deduplicateToolCalls(this.toolCalls);
  }

  reset(): void {
    this.rawBuffer = new Uint8Array(0);
    this.lastContent = null;
    this.currentToolCall = null;
    this.toolCalls = [];
  }
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function deduplicateToolCalls(calls: CollectedToolCall[]): CollectedToolCall[] {
  const byId = new Map<string, CollectedToolCall>();

  for (const tc of calls) {
    if (!tc.id) continue;
    const existing = byId.get(tc.id);
    if (!existing) {
      byId.set(tc.id, tc);
    } else if (tc.arguments !== "{}" && (existing.arguments === "{}" || tc.arguments.length > existing.arguments.length)) {
      byId.set(tc.id, tc);
    }
  }

  const seen = new Set<string>();
  const unique: CollectedToolCall[] = [];
  for (const tc of byId.values()) {
    const key = `${tc.name}-${tc.arguments}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(tc);
    }
  }

  return unique;
}
