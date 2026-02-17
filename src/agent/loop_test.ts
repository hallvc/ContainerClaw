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
      models: {},
      temperature: 0.7,
      max_tokens: 1000,
      memory_window: 10,
      max_iterations: 5,
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
    web_search: {},
    workspace: "/tmp/test-workspace",
    data_dir: "/tmp/test-data",
    ...overrides,
  };
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
    async consumeInboundWithTimeout(timeoutMs: number): Promise<InboundMessage | null> {
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
    get inboundSize() { return queue.length; },
    get outboundSize() { return published.length; },
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
      { content: "Direct response", toolCalls: [], finishReason: "stop", usage: {} },
    ]);
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "Hello");
    assertEquals(result, "Direct response");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - processDirect returns error message when provider returns error finishReason", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    const provider = makeFakeProvider([
      { content: "Something went wrong", toolCalls: [], finishReason: "error", usage: {} },
    ]);
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "Hello");
    assertEquals(result, "Something went wrong");
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
    assertEquals(result, "Sorry, I encountered an error processing your request.");
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
      { content: "Files listed!", toolCalls: [], finishReason: "stop", usage: {} },
    ]);
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "List files");
    assertEquals(result, "Files listed!");
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
      agents: { models: {}, temperature: 0.7, max_tokens: 1000, memory_window: 10, max_iterations: 2 },
    });
    // Always returns tool calls so we never finish naturally
    const toolCallResponse: FakeResponse = {
      content: "thinking...",
      toolCalls: [{ id: "tc1", name: "list_dir", arguments: { path: "." } }],
      finishReason: "tool_calls",
      usage: {},
    };
    const provider = makeFakeProvider([toolCallResponse, toolCallResponse, toolCallResponse]);
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "Loop forever");
    assertStringIncludes(result, "thinking...");
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
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - WebSearchTool registered when brave_api_key present", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({
      data_dir: tmpDir,
      workspace: tmpDir,
      web_search: { brave_api_key: "test-key-123" },
    });
    // Inspect what tool definitions the provider receives — if web_search is registered it appears there
    let toolNames: string[] = [];
    const inspectingProvider: LLMProvider = {
      async chat(params) {
        if (toolNames.length === 0) {
          toolNames = ((params.tools ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name);
        }
        return { content: "Done", toolCalls: [], finishReason: "stop", usage: {} };
      },
      getDefaultModel() { return "fake"; },
    };
    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, inspectingProvider, config);

    await loop.processDirect("slack", "chat1", "Search for something");
    // web_search should appear in the tool definitions
    assertEquals(toolNames.includes("web_search"), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("AgentLoop - WebSearchTool not registered when brave_api_key absent", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({
      data_dir: tmpDir,
      workspace: tmpDir,
      web_search: {},
    });
    const toolCallResults: string[] = [];
    // Intercept tool execution by calling a web_search tool — should return "Tool not found"
    const provider = makeFakeProvider([
      { content: null, toolCalls: [{ id: "tc1", name: "web_search", arguments: { query: "test" } }], finishReason: "tool_calls", usage: {} },
      { content: "Done", toolCalls: [], finishReason: "stop", usage: {} },
    ]);

    // We'll capture the tool result by looking at the messages passed to provider.chat
    let secondCallMessages: Array<{ role: string; content: string | null }> = [];
    let callCount = 0;
    const capturingProvider: LLMProvider = {
      async chat(params) {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [{ id: "tc1", name: "web_search", arguments: { query: "test" } }],
            finishReason: "tool_calls",
            usage: {},
          };
        }
        // Capture what was passed as messages to see tool result
        secondCallMessages = params.messages as Array<{ role: string; content: string | null }>;
        return { content: "Done", toolCalls: [], finishReason: "stop", usage: {} };
      },
      getDefaultModel() { return "fake"; },
    };

    const { bus } = makeFakeBus();
    const loop = new AgentLoop(bus, capturingProvider, config);
    await loop.processDirect("slack", "chat1", "Search for something");

    // Find the tool result message
    const toolResultMsg = secondCallMessages.find((m) => m.role === "tool");
    const toolContent = typeof toolResultMsg?.content === "string" ? toolResultMsg.content : "";
    assertStringIncludes(toolContent, "web_search");
    assertStringIncludes(toolContent, "not found");
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
      agents: { models: {}, temperature: 0.7, max_tokens: 1000, memory_window: 2, max_iterations: 5 },
    });

    let consolidationCalled = false;
    const provider: LLMProvider = {
      async chat(params) {
        // Detect consolidation call by checking for memory consolidation prompt
        const lastMsg = params.messages[params.messages.length - 1];
        if (
          typeof lastMsg?.content === "string" &&
          lastMsg.content.includes("memory consolidation")
        ) {
          consolidationCalled = true;
          return { content: "Updated memory", toolCalls: [], finishReason: "stop", usage: {} };
        }
        return { content: "Response", toolCalls: [], finishReason: "stop", usage: {} };
      },
      getDefaultModel() { return "fake"; },
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
      agents: { models: {}, temperature: 0.7, max_tokens: 1000, memory_window: 2, max_iterations: 5 },
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
        return { content: "Response", toolCalls: [], finishReason: "stop", usage: {} };
      },
      getDefaultModel() { return "fake"; },
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
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
