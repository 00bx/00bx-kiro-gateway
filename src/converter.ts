// 00bx Kiro Gateway - Message Converter (OpenAI/AI SDK <-> Kiro format)

import type {
  LanguageModelV2CallOptions,
  LanguageModelV2Prompt,
  LanguageModelV2Content,
} from "@ai-sdk/provider";
import { getInternalModelId, TOOL_DESCRIPTION_MAX_LENGTH } from "./config.js";
import { generateConversationId } from "./utils.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface KiroToolSpec {
  toolSpecification: {
    name: string;
    description: string;
    inputSchema: { json: Record<string, unknown> };
  };
}

interface KiroToolResult {
  content: Array<{ text: string }>;
  status: string;
  toolUseId: string;
}

interface KiroUserInput {
  content: string;
  modelId: string;
  origin: string;
  userInputMessageContext?: {
    tools?: KiroToolSpec[];
    toolResults?: KiroToolResult[];
  };
}

interface KiroHistoryEntry {
  userInputMessage?: KiroUserInput;
  assistantResponseMessage?: {
    content: string;
    toolUses?: Array<{
      name: string;
      input: Record<string, unknown>;
      toolUseId: string;
    }>;
  };
}

export interface KiroPayload {
  conversationState: {
    chatTriggerType: string;
    conversationId: string;
    currentMessage: {
      userInputMessage: KiroUserInput;
    };
    history?: KiroHistoryEntry[];
  };
  profileArn?: string;
}

// ─── Schema sanitizer ────────────────────────────────────────────────────────

function sanitizeJsonSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema) return {};

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    // Skip empty required arrays
    if (key === "required" && Array.isArray(value) && value.length === 0) continue;
    // Skip additionalProperties — Kiro rejects it
    if (key === "additionalProperties") continue;

    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const props: Record<string, unknown> = {};
      for (const [pName, pValue] of Object.entries(value as Record<string, unknown>)) {
        props[pName] = pValue && typeof pValue === "object" && !Array.isArray(pValue)
          ? sanitizeJsonSchema(pValue as Record<string, unknown>)
          : pValue;
      }
      result[key] = props;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = sanitizeJsonSchema(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? sanitizeJsonSchema(item as Record<string, unknown>)
          : item,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ─── Extract text from AI SDK content parts ──────────────────────────────────

function extractTextFromParts(parts: LanguageModelV2Content): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// ─── Build tool specs for Kiro ───────────────────────────────────────────────

function buildToolSpecs(
  tools: LanguageModelV2CallOptions["tools"],
): { specs: KiroToolSpec[]; toolDocumentation: string } | null {
  if (!tools || tools.length === 0) return null;

  const specs: KiroToolSpec[] = [];
  const docParts: string[] = [];

  for (const tool of tools) {
    let description = tool.description || `Tool: ${tool.name}`;
    const sanitizedParams = sanitizeJsonSchema(
      tool.parameters as Record<string, unknown> | undefined,
    );

    // Move long descriptions to system prompt
    if (
      TOOL_DESCRIPTION_MAX_LENGTH > 0 &&
      description.length > TOOL_DESCRIPTION_MAX_LENGTH
    ) {
      docParts.push(`## Tool: ${tool.name}\n\n${description}`);
      description = `[Full documentation in system prompt under '## Tool: ${tool.name}']`;
    }

    specs.push({
      toolSpecification: {
        name: tool.name,
        description,
        inputSchema: { json: sanitizedParams },
      },
    });
  }

  const toolDocumentation = docParts.length > 0
    ? `\n\n---\n# Tool Documentation\nThe following tools have detailed documentation that couldn't fit in the tool definition.\n\n${docParts.join("\n\n---\n\n")}`
    : "";

  return { specs, toolDocumentation };
}

// ─── Convert AI SDK prompt to Kiro history entries ───────────────────────────

interface FlatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ name: string; input: Record<string, unknown>; toolUseId: string }>;
  toolResults?: KiroToolResult[];
}

function flattenPrompt(
  prompt: LanguageModelV2Prompt,
  hasToolsInRequest: boolean,
): { systemPrompt: string; messages: FlatMessage[] } {
  let systemPrompt = "";
  const messages: FlatMessage[] = [];

  for (const msg of prompt) {
    if (msg.role === "system") {
      // System can be string or parts
      if (typeof msg.content === "string") {
        systemPrompt += (systemPrompt ? "\n" : "") + msg.content;
      } else if (Array.isArray(msg.content)) {
        systemPrompt += (systemPrompt ? "\n" : "") + extractTextFromParts(msg.content as LanguageModelV2Content);
      }
    } else if (msg.role === "user") {
      const textParts = (msg.content as LanguageModelV2Content)
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text);
      messages.push({ role: "user", content: textParts.join("") || "" });
    } else if (msg.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: FlatMessage["toolCalls"] = [];

      for (const part of msg.content as LanguageModelV2Content) {
        if (part.type === "text") {
          textParts.push((part as { type: "text"; text: string }).text);
        } else if (part.type === "tool-call") {
          const tc = part as { type: "tool-call"; toolCallId: string; toolName: string; input: unknown };
          const inputObj = (typeof tc.input === "object" && tc.input !== null ? tc.input : {}) as Record<string, unknown>;
          if (hasToolsInRequest) {
            toolCalls.push({
              name: tc.toolName,
              input: inputObj,
              toolUseId: tc.toolCallId,
            });
          } else {
            // Flatten tool calls to plain text (compaction fix)
            textParts.push(
              `[Called tool: ${tc.toolName}(${JSON.stringify(inputObj)})]`,
            );
          }
        }
      }

      const flat: FlatMessage = {
        role: "assistant",
        content: textParts.join("") || "",
      };
      if (toolCalls.length > 0) flat.toolCalls = toolCalls;
      messages.push(flat);
    } else if (msg.role === "tool") {
      // Tool results
      const toolResults: KiroToolResult[] = [];
      const textParts: string[] = [];

      for (const part of msg.content as LanguageModelV2Content) {
        if (part.type === "tool-result") {
          const tr = part as { type: "tool-result"; toolCallId: string; toolName: string; output: unknown };
          // V2: output is { type: "text", value: string } | { type: "json", value: unknown } | { type: "error-text", value: string } | Array
          let resultText = "";
          let isError = false;
          const output = tr.output;
          if (Array.isArray(output)) {
            resultText = output.map((o: { type: string; value: unknown }) => {
              if (o.type === "error-text") isError = true;
              return typeof o.value === "string" ? o.value : JSON.stringify(o.value);
            }).join("\n");
          } else if (output && typeof output === "object" && "value" in (output as Record<string, unknown>)) {
            const o = output as { type: string; value: unknown };
            if (o.type === "error-text") isError = true;
            resultText = typeof o.value === "string" ? o.value : JSON.stringify(o.value);
          } else if (typeof output === "string") {
            resultText = output;
          } else if (output !== undefined) {
            resultText = JSON.stringify(output);
          }

          if (hasToolsInRequest) {
            toolResults.push({
              content: [{ text: resultText || "(empty result)" }],
              status: isError ? "error" : "success",
              toolUseId: tr.toolCallId,
            });
          } else {
            textParts.push(
              `[Tool result for ${tr.toolCallId}]: ${resultText}`,
            );
          }
        }
      }

      if (textParts.length > 0) {
        // Flattened mode: add as user message
        messages.push({ role: "user", content: textParts.join("\n") });
      } else if (toolResults.length > 0) {
        // Normal mode: add as user message with toolResults
        messages.push({
          role: "user",
          content: "",
          toolResults,
        });
      }
    }
  }

  return { systemPrompt, messages };
}

// ─── Merge adjacent same-role messages ───────────────────────────────────────

function mergeAdjacentMessages(messages: FlatMessage[]): FlatMessage[] {
  if (messages.length === 0) return [];

  const merged: FlatMessage[] = [{ ...messages[0] }];

  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i];
    const last = merged[merged.length - 1];

    if (msg.role === last.role) {
      // Merge content
      if (last.content && msg.content) {
        last.content = `${last.content}\n${msg.content}`;
      } else if (msg.content) {
        last.content = msg.content;
      }

      // Merge tool calls
      if (msg.toolCalls) {
        last.toolCalls = [...(last.toolCalls || []), ...msg.toolCalls];
      }

      // Merge tool results
      if (msg.toolResults) {
        last.toolResults = [...(last.toolResults || []), ...msg.toolResults];
      }
    } else {
      merged.push({ ...msg });
    }
  }

  return merged;
}

// ─── Main payload builder ────────────────────────────────────────────────────

export function buildKiroPayload(
  options: LanguageModelV2CallOptions,
  modelId: string,
  profileArn: string,
): KiroPayload {
  const internalModelId = getInternalModelId(modelId);
  const conversationId = generateConversationId();
  const hasToolsInRequest = !!(options.tools && options.tools.length > 0);

  // Flatten prompt
  const { systemPrompt: rawSystemPrompt, messages: rawMessages } = flattenPrompt(
    options.prompt,
    hasToolsInRequest,
  );

  // Build tool specs
  const toolData = buildToolSpecs(options.tools);
  let systemPrompt = rawSystemPrompt;
  if (toolData?.toolDocumentation) {
    systemPrompt = systemPrompt
      ? systemPrompt + toolData.toolDocumentation
      : toolData.toolDocumentation.trim();
  }

  // Merge adjacent same-role messages
  const messages = mergeAdjacentMessages(rawMessages);

  if (messages.length === 0) {
    throw new Error("No messages to send");
  }

  // Split into history (all but last) and current (last)
  const historyMessages = messages.slice(0, -1);
  let currentMessage = messages[messages.length - 1];

  // Prepend system prompt to first user message
  if (systemPrompt) {
    if (historyMessages.length > 0 && historyMessages[0].role === "user") {
      historyMessages[0] = {
        ...historyMessages[0],
        content: `${systemPrompt}\n\n${historyMessages[0].content}`,
      };
    } else if (historyMessages.length === 0) {
      currentMessage = {
        ...currentMessage,
        content: `${systemPrompt}\n\n${currentMessage.content}`,
      };
    }
  }

  // Build Kiro history array
  const history: KiroHistoryEntry[] = [];
  for (const msg of historyMessages) {
    if (msg.role === "user") {
      const userInput: KiroUserInput = {
        content: msg.content,
        modelId: internalModelId,
        origin: "AI_EDITOR",
      };
      if (msg.toolResults && msg.toolResults.length > 0) {
        userInput.userInputMessageContext = { toolResults: msg.toolResults };
      }
      history.push({ userInputMessage: userInput });
    } else if (msg.role === "assistant") {
      const entry: KiroHistoryEntry["assistantResponseMessage"] = {
        content: msg.content,
      };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        entry!.toolUses = msg.toolCalls;
      }
      history.push({ assistantResponseMessage: entry });
    }
  }

  // Handle current message
  let currentContent = currentMessage.content || "";
  let currentToolResults: KiroToolResult[] | undefined;

  if (currentMessage.role === "assistant") {
    // If last message is assistant, add to history and use "Continue"
    history.push({
      assistantResponseMessage: { content: currentContent },
    });
    currentContent = "Continue";
  } else {
    currentToolResults = currentMessage.toolResults;
  }

  if (!currentContent) currentContent = "Continue";

  // Build userInputMessage
  const userInputMessage: KiroUserInput = {
    content: currentContent,
    modelId: internalModelId,
    origin: "AI_EDITOR",
  };

  // Add tool context
  const context: KiroUserInput["userInputMessageContext"] = {};
  if (toolData?.specs && toolData.specs.length > 0) {
    context.tools = toolData.specs;
  }
  if (currentToolResults && currentToolResults.length > 0) {
    context.toolResults = currentToolResults;
  }
  if (context.tools || context.toolResults) {
    userInputMessage.userInputMessageContext = context;
  }

  // Build final payload
  const payload: KiroPayload = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId,
      currentMessage: { userInputMessage },
    },
  };

  if (history.length > 0) {
    payload.conversationState.history = history;
  }

  if (profileArn) {
    payload.profileArn = profileArn;
  }

  return payload;
}
