import { assertEquals, assertStringIncludes } from "@std/assert";
import { SpawnTool } from "./spawn.ts";
import type { SpawnManager } from "./spawn.ts";

// ---------------------------------------------------------------------------
// Fake SubagentManager for testing
// ---------------------------------------------------------------------------
function makeFakeManager(): {
  manager: SpawnManager;
  calls: Array<{ task: string; label?: string; originChannel?: string; originChatId?: string }>;
} {
  const calls: Array<{ task: string; label?: string; originChannel?: string; originChatId?: string }> = [];
  const manager: SpawnManager = {
    async spawn(task: string, label?: string, originChannel?: string, originChatId?: string): Promise<string> {
      calls.push({ task, label, originChannel, originChatId });
      return `Subagent [${label ?? task}] started (id: abc12345).`;
    },
  };
  return { manager, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("SpawnTool - has correct name", () => {
  const { manager } = makeFakeManager();
  const tool = new SpawnTool(manager);
  assertEquals(tool.name, "spawn");
});

Deno.test("SpawnTool - has description mentioning subagent and background", () => {
  const { manager } = makeFakeManager();
  const tool = new SpawnTool(manager);
  assertStringIncludes(tool.description, "subagent");
  assertStringIncludes(tool.description, "background");
});

Deno.test("SpawnTool - parameters schema has task required and label optional", () => {
  const { manager } = makeFakeManager();
  const tool = new SpawnTool(manager);
  const params = tool.parameters as { required: string[]; properties: Record<string, unknown> };
  assertEquals(params.required, ["task"]);
  assertEquals("task" in params.properties, true);
  assertEquals("label" in params.properties, true);
});

Deno.test("SpawnTool - execute calls manager.spawn with task", async () => {
  const { manager, calls } = makeFakeManager();
  const tool = new SpawnTool(manager);
  await tool.execute({ task: "do something" });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].task, "do something");
});

Deno.test("SpawnTool - execute passes label through to manager", async () => {
  const { manager, calls } = makeFakeManager();
  const tool = new SpawnTool(manager);
  await tool.execute({ task: "do stuff", label: "my-label" });

  assertEquals(calls[0].label, "my-label");
});

Deno.test("SpawnTool - execute passes undefined label when not provided", async () => {
  const { manager, calls } = makeFakeManager();
  const tool = new SpawnTool(manager);
  await tool.execute({ task: "just a task" });

  assertEquals(calls[0].label, undefined);
});

Deno.test("SpawnTool - default context is cli/direct", async () => {
  const { manager, calls } = makeFakeManager();
  const tool = new SpawnTool(manager);
  await tool.execute({ task: "test" });

  assertEquals(calls[0].originChannel, "cli");
  assertEquals(calls[0].originChatId, "direct");
});

Deno.test("SpawnTool - setContext updates origin passed to manager", async () => {
  const { manager, calls } = makeFakeManager();
  const tool = new SpawnTool(manager);
  tool.setContext("slack", "C12345");
  await tool.execute({ task: "test with context" });

  assertEquals(calls[0].originChannel, "slack");
  assertEquals(calls[0].originChatId, "C12345");
});

Deno.test("SpawnTool - returns status message from manager", async () => {
  const { manager } = makeFakeManager();
  const tool = new SpawnTool(manager);
  const result = await tool.execute({ task: "something" });

  assertStringIncludes(result, "started");
});
