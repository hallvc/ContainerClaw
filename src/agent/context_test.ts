import { assertEquals, assertStringIncludes } from "@std/assert";
import { ContextBuilder } from "./context.ts";
import type { MemoryStore } from "./memory.ts";

function makeMemory(memoryContext = ""): MemoryStore {
  return {
    readLongTerm: async () => "",
    writeLongTerm: async (_content: string) => {},
    appendHistory: async (_entry: string) => {},
    getMemoryContext: async () => memoryContext,
    getRelevantContext: async (_msg: string) => memoryContext,
    getLearningsContext: async () => "",
  } as unknown as MemoryStore;
}

// Test 1: system message is first, user message is last
Deno.test("ContextBuilder - buildMessages system message is first, user message is last", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const builder = new ContextBuilder(dir, makeMemory());
    const messages = await builder.buildMessages([], "hello", []);
    assertEquals(messages[0].role, "system");
    assertEquals(messages[messages.length - 1].role, "user");
    assertEquals(messages[messages.length - 1].content, "hello");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Test 2: history messages inserted in order between system and user
Deno.test("ContextBuilder - buildMessages history messages inserted in order between system and user", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const builder = new ContextBuilder(dir, makeMemory());
    const history = [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
    ];
    const messages = await builder.buildMessages(history, "current", []);
    assertEquals(messages.length, 4); // system + 2 history + user
    assertEquals(messages[0].role, "system");
    assertEquals(messages[1].role, "user");
    assertEquals(messages[1].content, "first");
    assertEquals(messages[2].role, "assistant");
    assertEquals(messages[2].content, "second");
    assertEquals(messages[3].role, "user");
    assertEquals(messages[3].content, "current");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Test 3: media URLs appended to user message content
Deno.test("ContextBuilder - buildMessages media URLs appended to user message content", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const builder = new ContextBuilder(dir, makeMemory());
    const messages = await builder.buildMessages([], "describe this", ["http://example.com/img.png"]);
    const userMsg = messages[messages.length - 1];
    assertEquals(userMsg.role, "user");
    assertStringIncludes(userMsg.content as string, "describe this");
    assertStringIncludes(userMsg.content as string, "[Attached: http://example.com/img.png]");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Test 4: no media leaves content unchanged
Deno.test("ContextBuilder - buildMessages no media leaves content unchanged", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const builder = new ContextBuilder(dir, makeMemory());
    const messages = await builder.buildMessages([], "plain message", []);
    const userMsg = messages[messages.length - 1];
    assertEquals(userMsg.content, "plain message");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Test 5: resets messages on each call (no accumulation)
Deno.test("ContextBuilder - buildMessages resets messages on each call", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const builder = new ContextBuilder(dir, makeMemory());
    await builder.buildMessages([], "first call", []);
    const messages = await builder.buildMessages([], "second call", []);
    // Should only have system + one user message, not accumulation from first call
    assertEquals(messages.length, 2);
    assertEquals(messages[messages.length - 1].content, "second call");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Test 6: loads bootstrap files from workspace when they exist
Deno.test("ContextBuilder - buildMessages loads bootstrap files from workspace when they exist", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/AGENTS.md`, "Agent instructions here");
    const builder = new ContextBuilder(dir, makeMemory());
    const messages = await builder.buildMessages([], "hi", []);
    const systemContent = messages[0].content as string;
    assertStringIncludes(systemContent, "## AGENTS.md");
    assertStringIncludes(systemContent, "Agent instructions here");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Test 7: skips missing/empty bootstrap files gracefully
Deno.test("ContextBuilder - buildMessages skips missing or empty bootstrap files gracefully", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Write one empty file; others simply don't exist
    await Deno.writeTextFile(`${dir}/SOUL.md`, "   ");
    const builder = new ContextBuilder(dir, makeMemory());
    const messages = await builder.buildMessages([], "hi", []);
    const systemContent = messages[0].content as string;
    // Neither AGENTS.md nor SOUL.md (empty) should appear
    assertEquals(systemContent.includes("## AGENTS.md"), false);
    assertEquals(systemContent.includes("## SOUL.md"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Test 8: includes memory context in system prompt when non-empty
Deno.test("ContextBuilder - buildMessages includes memory context in system prompt when non-empty", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const memory = makeMemory("## Long-term Memory\n\nRemember: user likes brevity");
    const builder = new ContextBuilder(dir, memory);
    const messages = await builder.buildMessages([], "hi", []);
    const systemContent = messages[0].content as string;
    assertStringIncludes(systemContent, "## Long-term Memory");
    assertStringIncludes(systemContent, "user likes brevity");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Test 9: addToolResult pushes correct message shape
Deno.test("ContextBuilder - addToolResult pushes correct message shape", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const builder = new ContextBuilder(dir, makeMemory());
    await builder.buildMessages([], "start", []);
    builder.addToolResult("call-123", "shell_exec", "output text");
    const messages = builder.getMessages();
    const toolMsg = messages[messages.length - 1];
    assertEquals(toolMsg.role, "tool");
    assertEquals(toolMsg.content, "output text");
    assertEquals(toolMsg.tool_call_id, "call-123");
    assertEquals(toolMsg.name, "shell_exec");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Test 10: addAssistantMessage with tool calls sets tool_calls array
Deno.test("ContextBuilder - addAssistantMessage with tool calls sets tool_calls array", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const builder = new ContextBuilder(dir, makeMemory());
    await builder.buildMessages([], "start", []);
    builder.addAssistantMessage("I'll run a command", [
      { id: "tc-1", name: "shell_exec", arguments: { cmd: "ls" } },
    ]);
    const messages = builder.getMessages();
    const assistantMsg = messages[messages.length - 1];
    assertEquals(assistantMsg.role, "assistant");
    assertEquals(assistantMsg.content, "I'll run a command");
    assertEquals(Array.isArray(assistantMsg.tool_calls), true);
    assertEquals(assistantMsg.tool_calls!.length, 1);
    assertEquals(assistantMsg.tool_calls![0].id, "tc-1");
    assertEquals(assistantMsg.tool_calls![0].type, "function");
    assertEquals(assistantMsg.tool_calls![0].function.name, "shell_exec");
    assertEquals(assistantMsg.tool_calls![0].function.arguments, JSON.stringify({ cmd: "ls" }));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Test 11: addAssistantMessage without tool calls omits tool_calls property
Deno.test("ContextBuilder - addAssistantMessage without tool calls omits tool_calls property", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const builder = new ContextBuilder(dir, makeMemory());
    await builder.buildMessages([], "start", []);
    builder.addAssistantMessage("Just a reply", []);
    const messages = builder.getMessages();
    const assistantMsg = messages[messages.length - 1];
    assertEquals(assistantMsg.role, "assistant");
    assertEquals(assistantMsg.content, "Just a reply");
    assertEquals(assistantMsg.tool_calls, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Test 12: getMessages returns current message array
Deno.test("ContextBuilder - getMessages returns current message array", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const builder = new ContextBuilder(dir, makeMemory());
    const messages = await builder.buildMessages([], "test", []);
    const got = builder.getMessages();
    assertEquals(got, messages);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
