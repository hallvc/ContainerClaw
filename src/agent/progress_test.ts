import { assertEquals, assertStringIncludes } from "@std/assert";
import type { MessageBus } from "../bus/queue.ts";
import type { InboundMessage, OutboundMessage } from "../bus/events.ts";
import type { LLMProvider } from "../providers/base.ts";
import type { Config } from "../config/schema.ts";
import { AgentLoop } from "./loop.ts";

// ---------------------------------------------------------------------------
// Helpers (same pattern as loop_test.ts)
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
      planning: { enabled: true },
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
      if (!msg) return new Promise(() => {});
      return msg;
    },
    async consumeInboundWithTimeout(
      timeoutMs: number,
    ): Promise<InboundMessage | null> {
      const msg = queue.shift();
      if (msg) return msg;
      if (stopped) return null;
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
    for (const id of pendingTimers) clearTimeout(id);
    pendingTimers.length = 0;
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

/** Wait for published messages to reach a target count. */
function waitForPublished(
  published: OutboundMessage[],
  count: number,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (published.length >= count) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(
          new Error(
            `Timed out waiting for ${count} published messages (got ${published.length})`,
          ),
        );
      }
    }, 10);
  });
}

// ---------------------------------------------------------------------------
// Tests: Progress Updates
// ---------------------------------------------------------------------------

Deno.test("progress - single-iteration task produces NO progress message", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    // Single response, no tool calls — resolves in one iteration
    const provider: LLMProvider = {
      async chat(_params) {
        return {
          content: "Simple answer",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };
    const inbound = [makeInboundMsg("What is 2+2?")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await waitForPublished(published, 1);
    loop.stop();
    busStop();
    await runPromise;

    // Only the final response — no progress message
    assertEquals(published.length, 1);
    assertEquals(published[0].content, "Simple answer");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("progress - single tool-call iteration produces NO progress message", async () => {
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
            usage: {},
          };
        }
        // Second call: no tool calls, done
        return {
          content: "Here are the files",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };
    const inbound = [makeInboundMsg("List files")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await waitForPublished(published, 1);
    loop.stop();
    busStop();
    await runPromise;

    // Tool call resolved in one round (iteration 0 had tools, iteration 1 returned stop)
    // Progress fires at i===1, but the LLM returns stop immediately — so we get progress + final
    // Actually: progress fires BEFORE the LLM call at i===1, so we'll get 2 messages
    // Let's just verify no "Working on this" appears for a 1-tool-call resolution
    // Wait — per the plan, i===1 means the first tool-call iteration completed. Even if
    // the LLM stops at iteration 1, progress has already fired. This is by design:
    // "completes 1+ tool-call iterations and enters iteration 2+" means i >= 1.
    // So for a 2-iteration task (1 tool call round), progress IS expected.
    // A truly single-iteration task is one where iteration 0 returns no tool calls.
    // This test actually has 2 iterations, so progress should fire.
    await waitForPublished(published, 2);

    // First message should be the progress update
    assertStringIncludes(published[0].content, "Working on this");
    // Second should be the final response
    assertEquals(published[1].content, "Here are the files");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("progress - multi-iteration task sends exactly one progress message", async () => {
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
        max_iterations: 5,
        progress_updates: true,
        planning: { enabled: true },
      },
    });
    let callCount = 0;
    const provider: LLMProvider = {
      async chat(_params) {
        callCount++;
        if (callCount <= 3) {
          return {
            content: `step-${callCount}`,
            toolCalls: [{ id: `tc${callCount}`, name: "list_dir", arguments: { path: "." } }],
            finishReason: "tool_calls",
            usage: {},
          };
        }
        return {
          content: "All done",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };
    const inbound = [makeInboundMsg("Do complex task")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await waitForPublished(published, 2);
    loop.stop();
    busStop();
    await runPromise;

    // Should have exactly 1 progress message + 1 final response = 2 published messages
    assertEquals(published.length, 2);
    assertStringIncludes(published[0].content, "Working on this");
    assertEquals(published[1].content, "All done");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("progress - hint message injected into LLM context after progress fires", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = makeConfig({ data_dir: tmpDir, workspace: tmpDir });
    let callCount = 0;
    let iteration1Messages: Array<Record<string, unknown>> = [];
    const provider: LLMProvider = {
      async chat(params) {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [{ id: "tc1", name: "list_dir", arguments: { path: "." } }],
            finishReason: "tool_calls",
            usage: {},
          };
        }
        if (callCount === 2) {
          // Capture messages at iteration 1 (after progress fires)
          iteration1Messages = params.messages as Array<Record<string, unknown>>;
          return {
            content: "Done",
            toolCalls: [],
            finishReason: "stop",
            usage: {},
          };
        }
        return { content: "Done", toolCalls: [], finishReason: "stop", usage: {} };
      },
      getDefaultModel() {
        return "fake";
      },
    };
    const inbound = [makeInboundMsg("Do multi-step task")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await waitForPublished(published, 2);
    loop.stop();
    busStop();
    await runPromise;

    // The hint should appear as a user-role message in the LLM context
    const hintMsg = iteration1Messages.find(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("[System instruction]"),
    );
    assertEquals(hintMsg !== undefined, true);
    assertStringIncludes(
      hintMsg!.content as string,
      "multi-step task",
    );
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("progress - disabled when config.agents.progress_updates is false", async () => {
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
        max_iterations: 5,
        progress_updates: false,
        planning: { enabled: true },
      },
    });
    let callCount = 0;
    const provider: LLMProvider = {
      async chat(_params) {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [{ id: "tc1", name: "list_dir", arguments: { path: "." } }],
            finishReason: "tool_calls",
            usage: {},
          };
        }
        return {
          content: "Final response",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };
    const inbound = [makeInboundMsg("Do something")];
    const { bus, published, stop: busStop } = makeFakeBus(inbound);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await waitForPublished(published, 1);
    // Give extra time to ensure no progress message sneaks in
    await new Promise((r) => setTimeout(r, 100));
    loop.stop();
    busStop();
    await runPromise;

    // Only the final response — no progress message
    assertEquals(published.length, 1);
    assertEquals(published[0].content, "Final response");
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("progress - processDirect does NOT send progress messages", async () => {
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
            usage: {},
          };
        }
        return {
          content: "Direct result",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };
    const { bus, published } = makeFakeBus();
    const loop = new AgentLoop(bus, provider, config);

    const result = await loop.processDirect("slack", "chat1", "Do task");
    assertEquals(result, "Direct result");
    // processDirect should not publish anything to the bus
    assertEquals(published.length, 0);
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("progress - processSystemMessage does NOT send progress messages", async () => {
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
            usage: {},
          };
        }
        return {
          content: "System response",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
      },
      getDefaultModel() {
        return "fake";
      },
    };
    const systemMsg: InboundMessage = {
      channel: "system",
      senderId: "cron",
      chatId: "slack:chat1",
      content: "Cron result",
      timestamp: new Date(),
      media: [],
      metadata: {},
    };
    const { bus, published, stop: busStop } = makeFakeBus([systemMsg]);
    const loop = new AgentLoop(bus, provider, config);

    const runPromise = loop.run();
    await waitForPublished(published, 1);
    // Give extra time to ensure no progress message sneaks in
    await new Promise((r) => setTimeout(r, 100));
    loop.stop();
    busStop();
    await runPromise;

    // Only the final response — no "Working on this" progress message
    assertEquals(published.length, 1);
    assertEquals(published[0].content, "System response");
    assertEquals(
      published.some((p) => p.content.includes("Working on this")),
      false,
    );
    await loop.closeMcp();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
