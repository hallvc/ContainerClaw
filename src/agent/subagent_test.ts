import { assertEquals, assertStringIncludes } from "@std/assert";
import type { LLMProvider, LLMResponse } from "../providers/base.ts";
import { MessageBus } from "../bus/queue.ts";
import { SubagentManager } from "./subagent.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FakeResponse = Partial<LLMResponse>;

function makeFakeProvider(responses: FakeResponse[] = []): LLMProvider {
  let callIndex = 0;
  const defaults: LLMResponse = {
    content: "Task completed successfully.",
    toolCalls: [],
    finishReason: "stop",
    usage: {},
  };

  return {
    async chat(_params) {
      const r = responses[callIndex] ?? defaults;
      callIndex++;
      return { ...defaults, ...r };
    },
    getDefaultModel() {
      return "fake-model";
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("SubagentManager - getRunningCount returns 0 initially", () => {
  const provider = makeFakeProvider();
  const bus = new MessageBus();
  const manager = new SubagentManager(provider, "/tmp/test", bus, {});
  assertEquals(manager.getRunningCount(), 0);
});

Deno.test("SubagentManager - spawn returns status message with label", async () => {
  const provider = makeFakeProvider();
  const bus = new MessageBus();
  const manager = new SubagentManager(provider, "/tmp/test", bus, {});

  const result = await manager.spawn("analyze the codebase", "analyze");
  assertStringIncludes(result, "analyze");
  assertStringIncludes(result, "started");
});

Deno.test("SubagentManager - spawn with custom label uses provided label", async () => {
  const provider = makeFakeProvider();
  const bus = new MessageBus();
  const manager = new SubagentManager(provider, "/tmp/test", bus, {});

  const result = await manager.spawn("do something complex", "my-custom-label");
  assertStringIncludes(result, "my-custom-label");
});

Deno.test("SubagentManager - spawn without label truncates task to 30 chars", async () => {
  const provider = makeFakeProvider();
  const bus = new MessageBus();
  const manager = new SubagentManager(provider, "/tmp/test", bus, {});

  const longTask = "this is a very long task description that exceeds thirty characters";
  const result = await manager.spawn(longTask);
  assertStringIncludes(result, "this is a very long task descr");
  assertStringIncludes(result, "...");
});

Deno.test("SubagentManager - getRunningCount increments after spawn", async () => {
  // Provider that blocks until we resolve it, keeping the task alive
  let unblock: () => void;
  const blocker = new Promise<void>((resolve) => { unblock = resolve; });
  const provider: LLMProvider = {
    async chat(_params) {
      await blocker;
      return { content: "done", toolCalls: [], finishReason: "stop", usage: {} };
    },
    getDefaultModel() { return "fake-model"; },
  };
  const bus = new MessageBus();
  const tmpDir = await Deno.makeTempDir();
  try {
    const manager = new SubagentManager(provider, tmpDir, bus, {});
    await manager.spawn("long running task");
    // Give the background task a tick to start
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(manager.getRunningCount(), 1);
    // Let the task finish so cleanup runs
    unblock!();
    await bus.consumeInboundWithTimeout(2000);
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SubagentManager - background task announces result via bus on completion", async () => {
  const provider = makeFakeProvider([
    { content: "Analysis complete: found 3 issues", toolCalls: [], finishReason: "stop", usage: {} },
  ]);
  const bus = new MessageBus();
  const tmpDir = await Deno.makeTempDir();
  try {
    const manager = new SubagentManager(provider, tmpDir, bus, {});
    await manager.spawn("analyze code", "analyze", "slack", "chat42");

    // Wait for the system message to appear on the bus
    const msg = await bus.consumeInboundWithTimeout(2000);
    assertEquals(msg !== null, true);
    assertEquals(msg!.channel, "system");
    assertEquals(msg!.senderId, "subagent");
    assertEquals(msg!.chatId, "slack:chat42");
    assertStringIncludes(msg!.content, "analyze code");
    assertStringIncludes(msg!.content, "Analysis complete: found 3 issues");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SubagentManager - background task announces error on failure", async () => {
  const provider: LLMProvider = {
    async chat(_params) {
      throw new Error("LLM crashed");
    },
    getDefaultModel() {
      return "fake-model";
    },
  };
  const bus = new MessageBus();
  const tmpDir = await Deno.makeTempDir();
  try {
    const manager = new SubagentManager(provider, tmpDir, bus, {});
    await manager.spawn("bad task", "failing", "telegram", "user99");

    const msg = await bus.consumeInboundWithTimeout(2000);
    assertEquals(msg !== null, true);
    assertEquals(msg!.channel, "system");
    assertEquals(msg!.chatId, "telegram:user99");
    assertStringIncludes(msg!.content, "failed");
    assertStringIncludes(msg!.content, "LLM crashed");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SubagentManager - default origin is cli:direct", async () => {
  const provider = makeFakeProvider([
    { content: "done", toolCalls: [], finishReason: "stop", usage: {} },
  ]);
  const bus = new MessageBus();
  const tmpDir = await Deno.makeTempDir();
  try {
    const manager = new SubagentManager(provider, tmpDir, bus, {});
    await manager.spawn("quick task");

    const msg = await bus.consumeInboundWithTimeout(2000);
    assertEquals(msg !== null, true);
    assertEquals(msg!.chatId, "cli:direct");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SubagentManager - running count decrements after task completes", async () => {
  const provider = makeFakeProvider([
    { content: "done", toolCalls: [], finishReason: "stop", usage: {} },
  ]);
  const bus = new MessageBus();
  const tmpDir = await Deno.makeTempDir();
  try {
    const manager = new SubagentManager(provider, tmpDir, bus, {});
    await manager.spawn("quick task");

    // Wait for completion
    await bus.consumeInboundWithTimeout(2000);
    // Give cleanup a tick
    await new Promise((resolve) => setTimeout(resolve, 50));
    assertEquals(manager.getRunningCount(), 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SubagentManager - respects 15-iteration max loop", async () => {
  // Provider always returns tool calls — subagent should stop at 15
  let callCount = 0;
  const provider: LLMProvider = {
    async chat(_params) {
      callCount++;
      return {
        content: "still working...",
        toolCalls: [{ id: `tc${callCount}`, name: "list_dir", arguments: { path: "." } }],
        finishReason: "tool_calls",
        usage: {},
      };
    },
    getDefaultModel() {
      return "fake-model";
    },
  };
  const bus = new MessageBus();
  const tmpDir = await Deno.makeTempDir();
  try {
    const manager = new SubagentManager(provider, tmpDir, bus, {});
    await manager.spawn("infinite task", "looper", "cli", "direct");

    const msg = await bus.consumeInboundWithTimeout(5000);
    assertEquals(msg !== null, true);
    // Should have stopped at 15 iterations
    assertEquals(callCount, 15);
    assertStringIncludes(msg!.content, "completed");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
