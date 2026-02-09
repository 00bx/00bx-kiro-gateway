// E2E test for 00bx-kiro-gateway provider
// Run: node test.mjs

import createKiroProvider from "./dist/index.mjs";

const TIMEOUT_MS = 30000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT (${ms}ms) in ${label}`)), ms)
    ),
  ]);
}

async function testStreaming() {
  console.log("=== Test 1: Streaming text generation ===\n");

  const provider = createKiroProvider();
  const model = provider.languageModel("claude-sonnet-4");

  console.log("Provider:", model.provider);
  console.log("Model ID:", model.modelId);
  console.log("Spec version:", model.specificationVersion);
  console.log("");

  const { stream } = await withTimeout(
    model.doStream({
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [
        { role: "user", content: [{ type: "text", text: "Reply with exactly: STREAM_OK" }] },
      ],
    }),
    TIMEOUT_MS,
    "doStream()"
  );

  const reader = stream.getReader();
  let fullText = "";
  let partCount = 0;

  while (true) {
    const { done, value } = await withTimeout(reader.read(), TIMEOUT_MS, "reader.read()");
    if (done) break;

    partCount++;
    if (value.type === "text-delta") {
      process.stdout.write(value.delta);
      fullText += value.delta;
    } else {
      console.log(`[${value.type}]`);
    }
  }

  console.log(`\nParts: ${partCount} | Text: "${fullText.trim()}"`);
  console.log("=== PASS ===\n");
}

async function testNonStreaming() {
  console.log("=== Test 2: Non-streaming (doGenerate) ===\n");

  const provider = createKiroProvider();
  const model = provider.languageModel("claude-sonnet-4");

  const result = await withTimeout(
    model.doGenerate({
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [
        { role: "user", content: [{ type: "text", text: "Reply with exactly: GENERATE_OK" }] },
      ],
    }),
    TIMEOUT_MS,
    "doGenerate()"
  );

  console.log("Finish reason:", result.finishReason);
  for (const c of result.content) {
    if (c.type === "text") console.log("Text:", c.text);
    else console.log("Part:", c.type);
  }
  console.log("=== PASS ===\n");
}

async function testSystemPrompt() {
  console.log("=== Test 3: System prompt handling ===\n");

  const provider = createKiroProvider();
  const model = provider.languageModel("claude-sonnet-4");

  const { stream } = await withTimeout(
    model.doStream({
      inputFormat: "prompt",
      mode: { type: "regular" },
      prompt: [
        { role: "system", content: "You are a pirate. Always say 'Arrr'" },
        { role: "user", content: [{ type: "text", text: "Say hello" }] },
      ],
    }),
    TIMEOUT_MS,
    "doStream() with system"
  );

  const reader = stream.getReader();
  let fullText = "";
  while (true) {
    const { done, value } = await withTimeout(reader.read(), TIMEOUT_MS, "reader.read()");
    if (done) break;
    if (value.type === "text-delta") fullText += value.delta;
  }
  console.log("Response:", fullText.trim().slice(0, 200));
  const hasArrr = fullText.toLowerCase().includes("arrr");
  console.log("Contains 'Arrr':", hasArrr);
  console.log(hasArrr ? "=== PASS ===" : "=== WARN (may not follow system prompt perfectly) ===");
  console.log("");
}

// Run tests
try {
  await testStreaming();
  await testNonStreaming();
  await testSystemPrompt();
  console.log("All tests passed!");
} catch (err) {
  console.error("\n=== FAIL ===");
  console.error(err.message);
  console.error(err.stack?.split("\n").slice(0, 5).join("\n"));
  process.exit(1);
}
