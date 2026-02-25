import { assertEquals } from "@std/assert";
import { OpenRouterProvider } from "./openrouter.ts";

/** Helper: build a minimal OpenRouter-shaped JSON response body. */
function makeResponseBody(
  overrides: {
    content?: string | null;
    finish_reason?: string;
    tool_calls?: Array<{
      id: string;
      function: { name: string; arguments: string };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    error?: { message: string };
  } = {},
): string {
  const body: Record<string, unknown> = {
    choices: [
      {
        message: {
          content: "content" in overrides ? overrides.content : "Hello!",
          ...(overrides.tool_calls ? { tool_calls: overrides.tool_calls } : {}),
        },
        finish_reason: overrides.finish_reason ?? "stop",
      },
    ],
  };
  if (overrides.usage) body.usage = overrides.usage;
  if (overrides.error) body.error = overrides.error;
  return JSON.stringify(body);
}

/** Stub globalThis.fetch, returning captured request details + controlled response. */
function stubFetch(
  responseBody: string,
  status = 200,
): { calls: Array<{ url: string; init: RequestInit }>; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];

  globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(
      new Response(responseBody, {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Stub globalThis.fetch to throw an error. */
function stubFetchThrow(
  error: Error,
): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = (): Promise<Response> => {
    return Promise.reject(error);
  };
  return { restore: () => { globalThis.fetch = original; } };
}

/**
 * Stub globalThis.fetch with a factory function called on each invocation.
 * Useful for testing retry behavior where successive calls return different results.
 * Access `tracker.calls` after the test to read the final call count.
 */
function stubFetchSequence(
  factory: (callIndex: number) => Promise<Response>,
): { tracker: { calls: number }; restore: () => void } {
  const original = globalThis.fetch;
  const tracker = { calls: 0 };

  globalThis.fetch = (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    return factory(tracker.calls++);
  };

  return { tracker, restore: () => { globalThis.fetch = original; } };
}

// ---------------------------------------------------------------------------
// 1. Constructor & getDefaultModel
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - getDefaultModel returns configured model", () => {
  const provider = new OpenRouterProvider("sk-key", "anthropic/claude-sonnet-4-5");
  assertEquals(provider.getDefaultModel(), "anthropic/claude-sonnet-4-5");
});

// ---------------------------------------------------------------------------
// 2. Successful chat — text response (no tools)
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat returns text response with correct fields", async () => {
  const stub = stubFetch(makeResponseBody({
    content: "Hi there!",
    finish_reason: "stop",
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }));

  try {
    const provider = new OpenRouterProvider("sk-test", "test-model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hello" }],
      maxTokens: 100,
      temperature: 0.5,
    });

    assertEquals(result.content, "Hi there!");
    assertEquals(result.toolCalls, []);
    assertEquals(result.finishReason, "stop");
    assertEquals(result.usage.promptTokens, 10);
    assertEquals(result.usage.completionTokens, 5);
    assertEquals(result.usage.totalTokens, 15);
  } finally {
    stub.restore();
  }
});

Deno.test("OpenRouterProvider - chat sends correct URL and headers", async () => {
  const stub = stubFetch(makeResponseBody());

  try {
    const provider = new OpenRouterProvider("sk-my-key", "test-model");
    await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(stub.calls.length, 1);
    assertEquals(stub.calls[0].url, "https://openrouter.ai/api/v1/chat/completions");

    const headers = stub.calls[0].init.headers as Record<string, string>;
    assertEquals(headers["Authorization"], "Bearer sk-my-key");
    assertEquals(headers["Content-Type"], "application/json");
    assertEquals(headers["Accept"], "text/event-stream");
    assertEquals(headers["HTTP-Referer"], "https://github.com/containerclaw/containerclaw");
    assertEquals(headers["X-Title"], "containerclaw");
  } finally {
    stub.restore();
  }
});

Deno.test("OpenRouterProvider - chat sends correct request body without tools", async () => {
  const stub = stubFetch(makeResponseBody());

  try {
    const provider = new OpenRouterProvider("sk-key", "default-model");
    await provider.chat({
      messages: [{ role: "user", content: "Test" }],
      maxTokens: 200,
      temperature: 0.8,
    });

    const body = JSON.parse(stub.calls[0].init.body as string);
    assertEquals(body.model, "default-model");
    assertEquals(body.messages, [{ role: "user", content: "Test" }]);
    assertEquals(body.max_tokens, 200);
    assertEquals(body.temperature, 0.8);
    assertEquals(body.stream, true);
    assertEquals(body.tools, undefined);
    assertEquals(body.tool_choice, undefined);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. Successful chat — with tool calls
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat parses tool calls from response", async () => {
  const stub = stubFetch(makeResponseBody({
    content: null,
    finish_reason: "tool_calls",
    tool_calls: [
      {
        id: "call_abc",
        function: {
          name: "read_file",
          arguments: JSON.stringify({ path: "/tmp/test.txt" }),
        },
      },
      {
        id: "call_def",
        function: {
          name: "exec",
          arguments: JSON.stringify({ command: "ls" }),
        },
      },
    ],
  }));

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Read a file" }],
    });

    assertEquals(result.toolCalls.length, 2);
    assertEquals(result.toolCalls[0].id, "call_abc");
    assertEquals(result.toolCalls[0].name, "read_file");
    assertEquals(result.toolCalls[0].arguments, { path: "/tmp/test.txt" });
    assertEquals(result.toolCalls[1].id, "call_def");
    assertEquals(result.toolCalls[1].name, "exec");
    assertEquals(result.toolCalls[1].arguments, { command: "ls" });
    assertEquals(result.finishReason, "tool_calls");
    assertEquals(result.content, null);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. Tool definitions forwarded
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat includes tools and tool_choice when tools provided", async () => {
  const stub = stubFetch(makeResponseBody());

  const tools = [
    { type: "function", function: { name: "read_file", parameters: { type: "object" } } },
  ];

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
      tools,
    });

    const body = JSON.parse(stub.calls[0].init.body as string);
    assertEquals(body.tools, tools);
    assertEquals(body.tool_choice, "auto");
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 5. No tools omits tool_choice
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat omits tools and tool_choice when no tools", async () => {
  const stub = stubFetch(makeResponseBody());

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    });

    const body = JSON.parse(stub.calls[0].init.body as string);
    assertEquals(body.tools, undefined);
    assertEquals(body.tool_choice, undefined);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 6. Model override
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat uses explicit model over default", async () => {
  const stub = stubFetch(makeResponseBody());

  try {
    const provider = new OpenRouterProvider("sk-key", "default-model");
    await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
      model: "override-model",
    });

    const body = JSON.parse(stub.calls[0].init.body as string);
    assertEquals(body.model, "override-model");
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 7. Model default
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat uses defaultModel when model not specified", async () => {
  const stub = stubFetch(makeResponseBody());

  try {
    const provider = new OpenRouterProvider("sk-key", "my-default");
    await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    const body = JSON.parse(stub.calls[0].init.body as string);
    assertEquals(body.model, "my-default");
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 8. HTTP error response
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat handles HTTP error response", async () => {
  const stub = stubFetch(
    JSON.stringify({ error: { message: "Rate limit exceeded" } }),
    429,
  );

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.finishReason, "error");
    assertEquals(result.content, "Rate limit exceeded");
    assertEquals(result.toolCalls, []);
    assertEquals(result.usage, {});
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 9. API error in body (ok: true but error field present)
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat handles API error in response body", async () => {
  const stub = stubFetch(makeResponseBody({
    error: { message: "Model not found" },
  }));

  // The implementation checks `!response.ok || data.error`
  // With status 200 (ok=true) but error in body, it should return error
  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.finishReason, "error");
    assertEquals(result.content, "Model not found");
    assertEquals(result.toolCalls, []);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 10. Network/fetch exception
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat handles fetch exception", async () => {
  const stub = stubFetchThrow(new TypeError("Failed to fetch"));

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.finishReason, "error");
    assertEquals(result.content, "Failed to fetch");
    assertEquals(result.toolCalls, []);
    assertEquals(result.usage, {});
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 11. Malformed tool arguments (JSON parse failure)
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat handles malformed tool arguments", async () => {
  const stub = stubFetch(makeResponseBody({
    content: null,
    finish_reason: "tool_calls",
    tool_calls: [
      {
        id: "call_bad",
        function: {
          name: "some_tool",
          arguments: "not valid json {{{",
        },
      },
    ],
  }));

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.toolCalls.length, 1);
    assertEquals(result.toolCalls[0].id, "call_bad");
    assertEquals(result.toolCalls[0].name, "some_tool");
    assertEquals(result.toolCalls[0].arguments, {});
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 12. Null content in response
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat handles null content", async () => {
  const stub = stubFetch(makeResponseBody({ content: null }));

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.content, null);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 13. Missing usage in response
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 14. reasoning_content extraction
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat extracts reasoning_content when present", async () => {
  // Build a response body with reasoning_content on the message
  const body = JSON.stringify({
    choices: [{
      message: {
        content: "The answer is 42",
        reasoning_content: "Let me think step by step...",
      },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
  const stub = stubFetch(body);

  try {
    const provider = new OpenRouterProvider("sk-key", "deepseek/deepseek-r1");
    const result = await provider.chat({
      messages: [{ role: "user", content: "What is the meaning of life?" }],
    });

    assertEquals(result.content, "The answer is 42");
    assertEquals(result.reasoning_content, "Let me think step by step...");
    assertEquals(result.finishReason, "stop");
  } finally {
    stub.restore();
  }
});

Deno.test("OpenRouterProvider - chat returns null reasoning_content when absent", async () => {
  const stub = stubFetch(makeResponseBody({
    content: "Hello!",
    finish_reason: "stop",
  }));

  try {
    const provider = new OpenRouterProvider("sk-key", "anthropic/claude-sonnet-4-5");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.content, "Hello!");
    assertEquals(result.reasoning_content, null);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 13. Missing usage in response
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat handles missing usage", async () => {
  const stub = stubFetch(JSON.stringify({
    choices: [{
      message: { content: "Hi" },
      finish_reason: "stop",
    }],
  }));

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.usage.promptTokens, undefined);
    assertEquals(result.usage.completionTokens, undefined);
    assertEquals(result.usage.totalTokens, undefined);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 14. Repairable tool arguments (json-repair)
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat repairs malformed tool arguments", async () => {
  const stub = stubFetch(makeResponseBody({
    content: null,
    finish_reason: "tool_calls",
    tool_calls: [
      {
        id: "call_repair",
        function: {
          name: "some_tool",
          arguments: "{'key': 'value', 'num': 42,}",
        },
      },
    ],
  }));

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.toolCalls.length, 1);
    assertEquals(result.toolCalls[0].id, "call_repair");
    assertEquals(result.toolCalls[0].name, "some_tool");
    assertEquals(result.toolCalls[0].arguments, { key: "value", num: 42 });
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// Fix 3: Empty choices guard
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat returns error when choices array is empty", async () => {
  const stub = stubFetch(JSON.stringify({ choices: [] }));

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.finishReason, "error");
    assertEquals(result.content, "Empty response from model (no choices returned)");
    assertEquals(result.toolCalls, []);
    assertEquals(result.usage, {});
  } finally {
    stub.restore();
  }
});

Deno.test("OpenRouterProvider - chat returns error when choices field is missing", async () => {
  // Cast as unknown to bypass TS type checking for this test
  const stub = stubFetch(JSON.stringify({}));

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.finishReason, "error");
    assertEquals(result.content, "Empty response from model (no choices returned)");
    assertEquals(result.toolCalls, []);
    assertEquals(result.usage, {});
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// Fix 5: Tool argument parse logging
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - parseToolArguments warns when both parse attempts fail", async () => {
  const warnMessages: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnMessages.push(args.map(String).join(" "));
  };

  const stub = stubFetch(makeResponseBody({
    content: null,
    finish_reason: "tool_calls",
    tool_calls: [
      {
        id: "call_unparseable",
        function: {
          name: "some_tool",
          // Use a bare word that JSON.parse fails on and jsonrepair wraps as a
          // string (not an object), causing the second JSON.parse to succeed
          // but Object.keys() would pass — so use something that makes both fail:
          // jsonrepair of "not valid json {{{{" returns "{}" which parses as {}
          // but we need it to throw. Use raw binary-like content that
          // jsonrepair cannot produce valid JSON from.
          arguments: "not valid json {{{",
        },
      },
    ],
  }));

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    const warnCalled = warnMessages.some((msg) =>
      msg.startsWith("Failed to parse tool arguments:")
    );
    assertEquals(warnCalled, true);
  } finally {
    stub.restore();
    console.warn = originalWarn;
  }
});

// ---------------------------------------------------------------------------
// Fix 2: Request timeout
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat retries on TimeoutError then returns error", async () => {
  let fetchCallCount = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (): Promise<Response> => {
    fetchCallCount++;
    return Promise.reject(new DOMException("The signal has been aborted", "TimeoutError"));
  };

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    // TimeoutError should be retried like other transient errors (3 attempts)
    assertEquals(fetchCallCount, 3);
    assertEquals(result.finishReason, "error");
  } finally {
    globalThis.fetch = original;
  }
});

// ---------------------------------------------------------------------------
// Fix 1: Retry with exponential backoff
// ---------------------------------------------------------------------------

Deno.test("OpenRouterProvider - chat retries on fetch exception and succeeds on second attempt", async () => {
  let callIndex = 0;
  const successBody = makeResponseBody({ content: "Recovered!", finish_reason: "stop" });
  const stub = stubFetchSequence((idx) => {
    callIndex = idx;
    if (idx === 0) {
      return Promise.reject(new TypeError("Network error"));
    }
    return Promise.resolve(
      new Response(successBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(stub.tracker.calls, 2);
    assertEquals(result.content, "Recovered!");
    assertEquals(result.finishReason, "stop");
  } finally {
    stub.restore();
    void callIndex; // suppress unused warning
  }
});

Deno.test("OpenRouterProvider - chat retries on 429 and succeeds on second attempt", async () => {
  const successBody = makeResponseBody({ content: "OK after rate limit", finish_reason: "stop" });
  const rateLimitBody = JSON.stringify({ error: { message: "Rate limit exceeded" } });
  const stub = stubFetchSequence((idx) => {
    if (idx === 0) {
      return Promise.resolve(
        new Response(rateLimitBody, {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(successBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(stub.tracker.calls, 2);
    assertEquals(result.content, "OK after rate limit");
    assertEquals(result.finishReason, "stop");
  } finally {
    stub.restore();
  }
});

Deno.test("OpenRouterProvider - chat retries on 500 and succeeds on second attempt", async () => {
  const successBody = makeResponseBody({ content: "OK after server error", finish_reason: "stop" });
  const stub = stubFetchSequence((idx) => {
    if (idx === 0) {
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(successBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(stub.tracker.calls, 2);
    assertEquals(result.content, "OK after server error");
    assertEquals(result.finishReason, "stop");
  } finally {
    stub.restore();
  }
});

Deno.test("OpenRouterProvider - chat does NOT retry on 400 response", async () => {
  const errorBody = JSON.stringify({ error: { message: "Bad request" } });
  const stub = stubFetchSequence((_idx) => {
    return Promise.resolve(
      new Response(errorBody, {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    // Only 1 fetch call - no retry on 4xx (except 429)
    assertEquals(stub.tracker.calls, 1);
    assertEquals(result.finishReason, "error");
  } finally {
    stub.restore();
  }
});

Deno.test("OpenRouterProvider - chat gives up after max retries and returns error", async () => {
  const stub = stubFetchSequence((_idx) => {
    return Promise.reject(new TypeError("Persistent network failure"));
  });

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    // 3 max attempts
    assertEquals(stub.tracker.calls, 3);
    assertEquals(result.finishReason, "error");
    assertEquals(result.toolCalls, []);
    assertEquals(result.usage, {});
  } finally {
    stub.restore();
  }
});

// ===========================================================================
// SSE Streaming Tests
// ===========================================================================

/** Build SSE text from an array of events (objects become `data: JSON`, strings pass through). */
function makeSSEBody(
  events: Array<Record<string, unknown> | string>,
): string {
  return events
    .map((event) => {
      if (typeof event === "string") return event + "\n";
      return `data: ${JSON.stringify(event)}\n\n`;
    })
    .join("");
}

/** Stub globalThis.fetch to return an SSE streaming response with a ReadableStream body. */
function stubFetchSSE(
  events: Array<Record<string, unknown> | string>,
): { calls: Array<{ url: string; init: RequestInit }>; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const sseText = makeSSEBody(events);

  globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseText));
        controller.close();
      },
    });

    return Promise.resolve(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
  };

  return { calls, restore: () => { globalThis.fetch = original; } };
}

// ---------------------------------------------------------------------------
// SSE 1. Basic text streaming
// ---------------------------------------------------------------------------

Deno.test("SSE streaming - assembles text content from multiple deltas", async () => {
  const stub = stubFetchSSE([
    { choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { content: "!" }, finish_reason: null }] },
    {
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    },
    "data: [DONE]\n",
  ]);

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.content, "Hello world!");
    assertEquals(result.toolCalls, []);
    assertEquals(result.finishReason, "stop");
    assertEquals(result.usage.promptTokens, 10);
    assertEquals(result.usage.completionTokens, 3);
    assertEquals(result.usage.totalTokens, 13);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// SSE 2. Tool call streaming (index-based accumulation)
// ---------------------------------------------------------------------------

Deno.test("SSE streaming - assembles tool calls from chunked deltas", async () => {
  const stub = stubFetchSSE([
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_abc",
            function: { name: "read_file", arguments: "" },
          }],
        },
        finish_reason: null,
      }],
    },
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '{"path"' } }],
        },
        finish_reason: null,
      }],
    },
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: ':"/tmp/test.txt"}' } }],
        },
        finish_reason: null,
      }],
    },
    {
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    },
    "data: [DONE]\n",
  ]);

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Read a file" }],
    });

    assertEquals(result.content, null);
    assertEquals(result.toolCalls.length, 1);
    assertEquals(result.toolCalls[0].id, "call_abc");
    assertEquals(result.toolCalls[0].name, "read_file");
    assertEquals(result.toolCalls[0].arguments, { path: "/tmp/test.txt" });
    assertEquals(result.finishReason, "tool_calls");
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// SSE 3. Multiple tool calls in parallel
// ---------------------------------------------------------------------------

Deno.test("SSE streaming - assembles multiple tool calls by index", async () => {
  const stub = stubFetchSSE([
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: "call_1", function: { name: "read_file", arguments: "" } },
            { index: 1, id: "call_2", function: { name: "exec", arguments: "" } },
          ],
        },
        finish_reason: null,
      }],
    },
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, function: { arguments: '{"path":"/a"}' } },
            { index: 1, function: { arguments: '{"cmd":"ls"}' } },
          ],
        },
        finish_reason: null,
      }],
    },
    {
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
    },
    "data: [DONE]\n",
  ]);

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Do two things" }],
    });

    assertEquals(result.toolCalls.length, 2);
    assertEquals(result.toolCalls[0].id, "call_1");
    assertEquals(result.toolCalls[0].name, "read_file");
    assertEquals(result.toolCalls[0].arguments, { path: "/a" });
    assertEquals(result.toolCalls[1].id, "call_2");
    assertEquals(result.toolCalls[1].name, "exec");
    assertEquals(result.toolCalls[1].arguments, { cmd: "ls" });
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// SSE 4. Keepalive comments are ignored
// ---------------------------------------------------------------------------

Deno.test("SSE streaming - ignores keepalive comments", async () => {
  const stub = stubFetchSSE([
    ": OPENROUTER PROCESSING\n",
    { choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] },
    ": OPENROUTER PROCESSING\n",
    ": OPENROUTER PROCESSING\n",
    {
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
    "data: [DONE]\n",
  ]);

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.content, "Hi");
    assertEquals(result.finishReason, "stop");
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// SSE 5. Mixed content + tool calls
// ---------------------------------------------------------------------------

Deno.test("SSE streaming - handles mixed content and tool calls", async () => {
  const stub = stubFetchSSE([
    { choices: [{ index: 0, delta: { content: "Let me help." }, finish_reason: null }] },
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: 0, id: "call_x", function: { name: "search", arguments: '{"q":"test"}' } }],
        },
        finish_reason: null,
      }],
    },
    {
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
    },
    "data: [DONE]\n",
  ]);

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Search for something" }],
    });

    assertEquals(result.content, "Let me help.");
    assertEquals(result.toolCalls.length, 1);
    assertEquals(result.toolCalls[0].name, "search");
    assertEquals(result.toolCalls[0].arguments, { q: "test" });
    assertEquals(result.finishReason, "tool_calls");
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// SSE 6. Non-streaming JSON error fallback (Content-Type routing)
// ---------------------------------------------------------------------------

Deno.test("SSE streaming - falls back to JSON parsing for error responses", async () => {
  // Error responses come as application/json, not text/event-stream
  const stub = stubFetch(
    JSON.stringify({ error: { message: "Invalid API key" } }),
    401,
  );

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.finishReason, "error");
    assertEquals(result.content, "Invalid API key");
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// SSE 7. Malformed SSE chunk skipped gracefully
// ---------------------------------------------------------------------------

Deno.test("SSE streaming - skips malformed SSE chunks and continues", async () => {
  const warnMessages: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnMessages.push(args.map(String).join(" "));
  };

  const stub = stubFetchSSE([
    { choices: [{ index: 0, delta: { content: "A" }, finish_reason: null }] },
    "data: {not valid json!!!\n\n",
    { choices: [{ index: 0, delta: { content: "B" }, finish_reason: null }] },
    {
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    },
    "data: [DONE]\n",
  ]);

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.content, "AB");
    assertEquals(result.finishReason, "stop");

    const malformedWarn = warnMessages.some((msg) => msg.startsWith("Malformed SSE chunk:"));
    assertEquals(malformedWarn, true);
  } finally {
    stub.restore();
    console.warn = originalWarn;
  }
});

// ---------------------------------------------------------------------------
// SSE 8. Request body includes stream: true
// ---------------------------------------------------------------------------

Deno.test("SSE streaming - request body includes stream: true", async () => {
  const stub = stubFetchSSE([
    { choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }] },
    "data: [DONE]\n",
  ]);

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    const body = JSON.parse(stub.calls[0].init.body as string);
    assertEquals(body.stream, true);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// SSE 9. Reasoning content extraction via streaming
// ---------------------------------------------------------------------------

Deno.test("SSE streaming - assembles reasoning_content from deltas", async () => {
  const stub = stubFetchSSE([
    { choices: [{ index: 0, delta: { reasoning_content: "Let me think" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { reasoning_content: " step by step..." }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { content: "The answer is 42" }, finish_reason: null }] },
    {
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    },
    "data: [DONE]\n",
  ]);

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Think about this" }],
    });

    assertEquals(result.content, "The answer is 42");
    assertEquals(result.reasoning_content, "Let me think step by step...");
    assertEquals(result.finishReason, "stop");
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// SSE 10. Usage from separate final chunk (no choices)
// ---------------------------------------------------------------------------

Deno.test("SSE streaming - captures usage from final usage-only chunk", async () => {
  const stub = stubFetchSSE([
    { choices: [{ index: 0, delta: { content: "Done" }, finish_reason: "stop" }] },
    { usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 } },
    "data: [DONE]\n",
  ]);

  try {
    const provider = new OpenRouterProvider("sk-key", "model");
    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    assertEquals(result.content, "Done");
    assertEquals(result.usage.promptTokens, 50);
    assertEquals(result.usage.completionTokens, 25);
    assertEquals(result.usage.totalTokens, 75);
  } finally {
    stub.restore();
  }
});
