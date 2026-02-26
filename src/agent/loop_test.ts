import { assertEquals, assertStringIncludes } from "@std/assert";
import type { MessageBus } from "../bus/queue.ts";
import type { InboundMessage, OutboundMessage } from "../bus/events.ts";
import type { LLMProvider, LLMResponse } from "../providers/base.ts";
import type { Config } from "../config/schema.ts";
import { AgentLoop } from "./loop.ts";

// ---------------------------------------------------------------------------
// Helper: makeConfig
// ---------------------------------------------------------------------------
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    slack: {
      bot_token: "",
      app_token: "",
      group_policy: "mention",
      group_allow_from: [],
      dm: { enabled: true, policy: "open", allow_from: [] },
    },
    openrouter: { api_key: "", default_model: "anthropic/claude-sonnet-4-5" },
    agents: {
      models: { heartbeat: "openrouter/free" },
      temperature: 0.7,
      max_tokens: 1000,
      memory_window: 10,
      consolidation_threshold: 50,
      max_iterations: 5,
      progress_updates: true,
    },
    email: {
      api_key: "",
      inbox_id: "",
      username: "",
      domain: "",
      poll_interval_seconds: 15,
      policy: "open",
      allow_from: [],
    },
    telegram: { bot_token: "", allow_from: [] },
    tools: { exec_timeout_ms: 60_000 },
    heartbeat: { enabled: false, interval_seconds: 1800 },
    cron: { enabled: false, tick_interval_ms: 30_000, job_timeout_ms: 300_000 },
    workspace: "/tmp/test-workspace",
    data_dir: "/tmp/test-data",
    ...overrides,
  } as Config;
}

// ---------------------------------------------------------------------------
// Helper: makeFakeProvider
// ---------------------------------------------------------------------------
type FakeResponse = Partial<LLMResponse>;

function makeFakeProvider(responses: FakeResponse[] = []): LLMProvider {
  let callIndex = 0;
  const defaults: LLMResponse = {
    content: "Hello from LLM",
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
// Helper: makeFakeBus
// ---------------------------------------------------------------------------
function makeFakeBus(inboundMessages: InboundMessage[] = []): {
  bus: MessageBus;
  published: OutboundMessage[];
  stop: () => void;
} {
  const published: OutboundMessage[] = [];
  const queue = [...inboundMessages];
  const pendingTimers: number[] = [];
  const pendingResolvers: Array<(v: null) => void> = [];
  let stopped = false;

  const bus = {
    async publishInbound(_msg: InboundMessage): Promise<void> {},
    async consumeInbound(): Promise<InboundMessage> {
      const msg = queue.shift();
      if (!msg) return new Promise(() => {}); // never resolves
      return msg;
    },
    async consumeInboundWithTimeout(
      timeoutMs: number,
    ): Promise<InboundMessage | null> {
      const msg = queue.shift();
      if (msg) return msg;
      if (stopped) return null;
      // Return null after a short wait to unblock the loop
      return new Promise((resolve) => {
        const delay = Math.min(timeoutMs, 50);
        pendingResolvers.push(resolve);
        const id = setTimeout(() => {
          const timerIdx = pendingTimers.indexOf(id);
          if (timerIdx !== -1) pendingTimers.splice(timerIdx, 1);
          const resolverIdx = pendingResolvers.indexOf(resolve);
          if (resolverIdx !== -1) pendingResolvers.splice(resolverIdx, 1);
          resolve(null);
        }, delay) as unknown as number;
        pendingTimers.push(id);
      });
    },
    async publishOutbound(msg: OutboundMessage): Promise<void> {
      published.push(msg);
    },
    async consumeOutbound(): Promise<OutboundMessage> {
      return new Promise(() => {});
    },
    subscribeOutbound(_channel: string, _cb: unknown): void {},
    async dispatchOutbound(): Promise<void> {},
    stop(): void {},
    get inboundSize() {
      return queue.length;
    },
    get outboundSize() {
      return published.length;
    },
  } as unknown as MessageBus;

  const stop = () => {
    stopped = true;
    // Clear all pending timers
    for (const id of pendingTimers) clearTimeout(id);
    pendingTimers.length = 0;
    // Resolve all waiting promises with null so the agent loop can exit
    for (const resolve of pendingResolvers) resolve(null);
    pendingResolvers.length = 0;
  };

  return { bus, published, stop };
}

function makeInboundMsg(content: string): InboundMessage {
  return {
    channel: "slack",
    senderId: "user1",
    chatId: "chat1",
    content,
    timestamp: new Date(),
    media: [],
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("AgentLoop - processDirect returns LLM response content", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    const provider = makeFakeProvider([
      {
        content: "Direct response",
        toolCalls: [],
        finishReason: "stop",
        usage: {},
      },
    ]);
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "Hello");
    assertEquals(result, "Direct response");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - processDirect returns error message when provider returns error finishReason", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    const provider = makeFakeProvider([
      {
        content: "Something went wrong",
        toolCalls: [],
        finishReason: "error",
        usage: {},
      },
    ]);
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "Hello");
    assertEquals(result, "Something went wrong");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - processDirect returns fallback when provider returns error with null content", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    const provider = makeFakeProvider([
      { content: null, toolCalls: [], finishReason: "error", usage: {} },
    ]);
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "Hello");
    assertEquals(
      result,
      "Sorry, I encountered an error processing your request.",
    );
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - processDirect executes tool calls when provider returns them", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    // First call returns a tool call, second returns the final response
    const provider = makeFakeProvider([
      {
        content: null,
        toolCalls: [{ id: "tc1", name: "list_dir", arguments: { path: "." } }],
        finishReason: "tool_calls",
        usage: {},
      },
      {
        content: "Files listed!",
        toolCalls: [],
        finishReason: "stop",
        usage: {},
      },
    ]);
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "List files");
    assertEquals(result, "Files listed!");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - processDirect stops at maxIterations with fallback message", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    // max_iterations: 2 so we hit it quickly
    const config = makeConfig({
      data_dir: tmpDir,
      workspace: tmpDir,
      agents: {
        models: { heartbeat: "openrouter/free" },
        temperature: 0.7,
        max_tokens: 1000,
        memory_window: 10,
        consolidation_threshold: 50,
        max_iterations: 2,
        progress_updates: true,
      },
    });
    // Always returns tool calls so we never finish naturally
    const toolCallResponse: FakeResponse = {
      content: "thinking...",
      toolCalls: [{ id: "tc1", name: "list_dir", arguments: { path: "." } }],
      finishReason: "tool_calls",
      usage: {},
    };
    const provider = makeFakeProvider([
      toolCallResponse,
      toolCallResponse,
      toolCallResponse,
    ]);
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "Loop forever");
    assertStringIncludes(result, "thinking...");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - stop halts the run loop", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    const provider = makeFakeProvider();
    const { bus, stop: busStop } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    // Start the loop and immediately stop it
    const runPromise = loop.run();
    // Give the loop one tick to start
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Stop both the loop and the fake bus timers
    loop.stop();
    busStop();

    await runPromise;
    await loop.closeMcp();
    assertEquals(true, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - slash command /new clears session and publishes response", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    const provider = makeFakeProvider();
    const inbound = [makeInboundMsg("/new")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    // Run the loop; it will process the /new message then block waiting for more
    const runPromise = loop.run();
    // Wait for the message to be processed and published
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (published.length > 0) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    assertEquals(published.length, 1);
    assertEquals(published[0].content, "Session cleared. Starting fresh!");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - slash command /help publishes help text", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    const provider = makeFakeProvider();
    const inbound = [makeInboundMsg("/help")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (published.length > 0) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    assertEquals(published.length, 1);
    assertStringIncludes(published[0].content, "Available commands");
    assertStringIncludes(published[0].content, "/new");
    assertStringIncludes(published[0].content, "/help");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - slash command case insensitive /NEW works", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    const provider = makeFakeProvider();
    const inbound = [makeInboundMsg("/NEW")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (published.length > 0) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    assertEquals(published.length, 1);
    assertEquals(published[0].content, "Session cleared. Starting fresh!");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - reasoning_content is passed through to provider on next iteration", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    let secondCallMessages: Array<Record<string, unknown>> = [];
    let callCount = 0;
    const provider: LLMProvider = {
      async chat(params) {
        callCount++;
        if (callCount === 1) {
          // First call: return a tool call with reasoning_content
          return {
            content: "Let me check",
            toolCalls: [{
              id: "tc1",
              name: "list_dir",
              arguments: { path: "." },
            }],
            finishReason: "tool_calls",
            reasoning_content: "I should list the directory first",
            usage: {},
          };
        }
        // Second call: capture messages to verify reasoning_content was included
        secondCallMessages = params.messages as Array<Record<string, unknown>>;
        return {
          content: "Done",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    await loop.processDirect("slack", "chat1", "List files");

    // Find the assistant message in the second call's messages
    const assistantMsg = secondCallMessages.find((m) => m.role === "assistant");
    assertEquals(
      assistantMsg?.reasoning_content,
      "I should list the directory first",
    );
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - reasoning_content omitted from message when not present", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    let secondCallMessages: Array<Record<string, unknown>> = [];
    let callCount = 0;
    const provider: LLMProvider = {
      async chat(params) {
        callCount++;
        if (callCount === 1) {
          return {
            content: "Let me check",
            toolCalls: [{
              id: "tc1",
              name: "list_dir",
              arguments: { path: "." },
            }],
            finishReason: "tool_calls",
            usage: {},
          };
        }
        secondCallMessages = params.messages as Array<Record<string, unknown>>;
        return {
          content: "Done",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    await loop.processDirect("slack", "chat1", "List files");

    const assistantMsg = secondCallMessages.find((m) => m.role === "assistant");
    assertEquals("reasoning_content" in (assistantMsg ?? {}), false);
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - memory consolidation triggers when message count exceeds memory_window", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    // memory_window: 2 so consolidation triggers after 2 messages (1 user + 1 assistant)
    const config = makeConfig({
      data_dir: tmpDir,
      workspace: tmpDir,
      agents: {
        models: { heartbeat: "openrouter/free" },
        temperature: 0.7,
        max_tokens: 1000,
        memory_window: 2,
        consolidation_threshold: 2,
        max_iterations: 5,
        progress_updates: true,
      },
    });

    let consolidationCalled = false;
    const provider: LLMProvider = {
      async chat(params) {
        // Detect consolidation call by checking for memory extraction prompt
        const lastMsg = params.messages[params.messages.length - 1];
        if (
          typeof lastMsg?.content === "string" &&
          (lastMsg.content.includes("memory consolidation") ||
            lastMsg.content.includes("memory extraction") ||
            lastMsg.content.includes("Extract noteworthy"))
        ) {
          consolidationCalled = true;
          return {
            content: "- User prefers dark mode",
            toolCalls: [],
            finishReason: "stop",
            usage: {},
          };
        }
        return {
          content: "Response",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };

    const inbound = [makeInboundMsg("Hello there")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    // Wait for the response to be published
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (published.length > 0) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    assertEquals(consolidationCalled, true);
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - spawn tool is registered", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    let toolNames: string[] = [];
    const inspectingProvider: LLMProvider = {
      async chat(params) {
        if (toolNames.length === 0) {
          toolNames =
            ((params.tools ?? []) as Array<{ function: { name: string } }>).map(
              (t) => t.function.name,
            );
        }
        return {
          content: "Done",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, inspectingProvider, config);

    await loop.processDirect("slack", "chat1", "Hello");
    assertEquals(toolNames.includes("spawn"), true);
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - system message routes response to original channel", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    const provider = makeFakeProvider([
      {
        content: "Background task result summary",
        toolCalls: [],
        finishReason: "stop",
        usage: {},
      },
    ]);
    // System message with chatId encoding original destination
    const systemMsg: InboundMessage = {
      channel: "system",
      senderId: "subagent",
      chatId: "slack:chat42",
      content: "[Subagent 'analyze' completed]\n\nResult: found 3 issues",
      timestamp: new Date(),
      media: [],
      metadata: {},
    };
    const { bus, published, stop: busStop } = makeFakeBus([systemMsg]);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (published.length > 0) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    assertEquals(published.length, 1);
    assertEquals(published[0].channel, "slack");
    assertEquals(published[0].chatId, "chat42");
    assertStringIncludes(
      published[0].content,
      "Background task result summary",
    );
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - system message with no colon in chatId falls back", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    const provider = makeFakeProvider([
      {
        content: "Fallback response",
        toolCalls: [],
        finishReason: "stop",
        usage: {},
      },
    ]);
    const systemMsg: InboundMessage = {
      channel: "system",
      senderId: "subagent",
      chatId: "nochannel",
      content: "Some system notification",
      timestamp: new Date(),
      media: [],
      metadata: {},
    };
    const { bus, published, stop: busStop } = makeFakeBus([systemMsg]);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (published.length > 0) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    assertEquals(published.length, 1);
    // Falls back to cli channel
    assertEquals(published[0].channel, "cli");
    assertEquals(published[0].chatId, "nochannel");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - /new extracts unextracted messages before clearing session", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });

    let extractionCalled = false;
    const provider: LLMProvider = {
      async chat(params) {
        const lastMsg = params.messages[params.messages.length - 1];
        if (
          typeof lastMsg?.content === "string" &&
          lastMsg.content.includes("Extract noteworthy")
        ) {
          extractionCalled = true;
          return {
            content: "- User discussed deployment strategy",
            toolCalls: [],
            finishReason: "stop",
            usage: {},
          };
        }
        return {
          content: "Response",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };

    // Send 2 regular messages first (each creates user+assistant = 4 session messages >= 3), then /new
    const inbound = [
      makeInboundMsg("First message"),
      makeInboundMsg("Second message"),
      makeInboundMsg("/new"),
    ];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (
          published.some((p) =>
            p.content === "Session cleared. Starting fresh!"
          )
        ) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    // Extraction should have been called before clearing
    assertEquals(extractionCalled, true);
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - /new skips extraction when fewer than 3 unextracted messages", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });

    let extractionCalled = false;
    const provider: LLMProvider = {
      async chat(params) {
        const lastMsg = params.messages[params.messages.length - 1];
        if (
          typeof lastMsg?.content === "string" &&
          lastMsg.content.includes("Extract noteworthy")
        ) {
          extractionCalled = true;
          return {
            content: "- Extracted fact",
            toolCalls: [],
            finishReason: "stop",
            usage: {},
          };
        }
        return {
          content: "Response",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };

    // Send only /new with no prior messages — too few for extraction
    const inbound = [makeInboundMsg("/new")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (
          published.some((p) =>
            p.content === "Session cleared. Starting fresh!"
          )
        ) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    // Extraction should NOT have been called (0 session messages < 3)
    assertEquals(extractionCalled, false);
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - memory consolidation handles provider errors gracefully", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({
      data_dir: tmpDir,
      workspace: tmpDir,
      agents: {
        models: { heartbeat: "openrouter/free" },
        temperature: 0.7,
        max_tokens: 1000,
        memory_window: 2,
        consolidation_threshold: 2,
        max_iterations: 5,
        progress_updates: true,
      },
    });

    let callCount = 0;
    const provider: LLMProvider = {
      async chat(params) {
        callCount++;
        const lastMsg = params.messages[params.messages.length - 1];
        if (
          typeof lastMsg?.content === "string" &&
          lastMsg.content.includes("memory consolidation")
        ) {
          throw new Error("Provider crashed during consolidation");
        }
        return {
          content: "Response",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };

    const inbound = [makeInboundMsg("Hello there")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    // Wait for the response to be published — consolidation error should not block this
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (published.length > 0) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    // Despite the consolidation error, the main response was still published
    assertEquals(published.length, 1);
    assertEquals(published[0].content, "Response");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Phase 2: Error boundary in processMessage
// ---------------------------------------------------------------------------

Deno.test("AgentLoop - processMessage publishes error response when provider throws", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    const provider: LLMProvider = {
      async chat(_params) {
        throw new Error("Provider exploded");
      },
      getDefaultModel() { return "fake"; },
    };
    const inbound = [makeInboundMsg("Hello")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (published.length > 0) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    assertEquals(published.length, 1);
    assertStringIncludes(published[0].content, "unexpected error");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - processMessage error boundary does not affect subsequent messages", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    let callCount = 0;
    const provider: LLMProvider = {
      async chat(_params) {
        callCount++;
        if (callCount === 1) {
          throw new Error("First call fails");
        }
        return { content: "Second call succeeds", toolCalls: [], finishReason: "stop", usage: {} };
      },
      getDefaultModel() { return "fake"; },
    };
    const inbound = [makeInboundMsg("First"), makeInboundMsg("Second")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (published.length >= 2) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    assertEquals(published.length, 2);
    assertStringIncludes(published[0].content, "unexpected error");
    assertEquals(published[1].content, "Second call succeeds");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Phase 2: Token budget tracking
// ---------------------------------------------------------------------------

Deno.test("AgentLoop - runAgentLoop accumulates token usage across iterations", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    let callCount = 0;
    const provider: LLMProvider = {
      async chat(_params) {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [{ id: "tc1", name: "list_dir", arguments: { path: "." } }],
            finishReason: "tool_calls",
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          };
        }
        return {
          content: "Done",
          toolCalls: [],
          finishReason: "stop",
          usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
        };
      },
      getDefaultModel() { return "fake"; },
    };
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "List files");
    assertEquals(result, "Done");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - runAgentLoop stops when token budget exceeded", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({
      data_dir: tmpDir,
      workspace: tmpDir,
      agents: {
        models: { heartbeat: "openrouter/free" },
        temperature: 0.7,
        max_tokens: 1000,
        memory_window: 10,
        consolidation_threshold: 50,
        max_iterations: 10,
        token_budget: 1000,
        progress_updates: true,
      },
    });
    let callCount = 0;
    const provider: LLMProvider = {
      async chat(_params) {
        callCount++;
        return {
          content: `iteration-${callCount}`,
          toolCalls: [{ id: `tc${callCount}`, name: "list_dir", arguments: { path: "." } }],
          finishReason: "tool_calls",
          usage: { promptTokens: 400, completionTokens: 200, totalTokens: 600 },
        };
      },
      getDefaultModel() { return "fake"; },
    };
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "Do work");
    // First iteration: 600 tokens (under 1000) -> executes tools, loops
    // Second iteration: budget check 600 >= 1000? No -> calls LLM, now 1200 tokens
    // Third iteration: budget check 1200 >= 1000? Yes -> breaks out
    assertEquals(callCount, 2);
    assertStringIncludes(result, "iteration-2");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - runAgentLoop works without token budget (backward compat)", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    // No token_budget in config
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    const provider = makeFakeProvider([
      { content: "Works fine", toolCalls: [], finishReason: "stop", usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 } },
    ]);
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "Hello");
    assertEquals(result, "Works fine");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Phase 2: Parallel tool execution in agent loop
// ---------------------------------------------------------------------------

Deno.test("AgentLoop - vision model role selected when message contains image media", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({
      data_dir: tmpDir,
      workspace: tmpDir,
      agents: {
        models: { heartbeat: "openrouter/free", vision: "vision-specific-model" },
        temperature: 0.7,
        max_tokens: 1000,
        memory_window: 10,
        consolidation_threshold: 50,
        max_iterations: 5,
        progress_updates: true,
      },
    });

    let capturedModel: string | undefined;
    const provider: LLMProvider = {
      async chat(params) {
        capturedModel = params.model;
        return { content: "I see the image", toolCalls: [], finishReason: "stop", usage: {} };
      },
      getDefaultModel() { return "default-model"; },
    };

    const imageMsg: InboundMessage = {
      channel: "slack",
      senderId: "user1",
      chatId: "chat1",
      content: "What is this?",
      timestamp: new Date(),
      media: ["https://example.com/photo.jpg"],
      metadata: {},
    };

    const { bus, published, stop: busStop } = makeFakeBus([imageMsg]);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (published.length > 0) { clearInterval(interval); resolve(); }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    assertEquals(capturedModel, "vision-specific-model");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - chat model role selected when message has no image media", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({
      data_dir: tmpDir,
      workspace: tmpDir,
      agents: {
        models: { heartbeat: "openrouter/free", vision: "vision-specific-model", default: "chat-model" },
        temperature: 0.7,
        max_tokens: 1000,
        memory_window: 10,
        consolidation_threshold: 50,
        max_iterations: 5,
        progress_updates: true,
      },
    });

    let capturedModel: string | undefined;
    const provider: LLMProvider = {
      async chat(params) {
        capturedModel = params.model;
        return { content: "Reply", toolCalls: [], finishReason: "stop", usage: {} };
      },
      getDefaultModel() { return "default-model"; },
    };

    const { bus, published, stop: busStop } = makeFakeBus([makeInboundMsg("Hello")]);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (published.length > 0) { clearInterval(interval); resolve(); }
      }, 10);
    });
    loop.stop();
    busStop();
    await runPromise;

    assertEquals(capturedModel, "chat-model");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - parallel tool execution returns correct results for multiple tools", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    let secondCallMessages: Array<Record<string, unknown>> = [];
    let callCount = 0;
    const provider: LLMProvider = {
      async chat(params) {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [
              { id: "tc1", name: "list_dir", arguments: { path: "." } },
              { id: "tc2", name: "list_dir", arguments: { path: ".." } },
            ],
            finishReason: "tool_calls",
            usage: {},
          };
        }
        secondCallMessages = params.messages as Array<Record<string, unknown>>;
        return { content: "Both done", toolCalls: [], finishReason: "stop", usage: {} };
      },
      getDefaultModel() { return "fake"; },
    };
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "List two dirs");
    assertEquals(result, "Both done");

    // Verify both tool results were included in the second call
    const toolResults = secondCallMessages.filter((m) => m.role === "tool");
    assertEquals(toolResults.length, 2);
    assertEquals(toolResults[0].tool_call_id, "tc1");
    assertEquals(toolResults[1].tool_call_id, "tc2");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
