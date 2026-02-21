import { assertEquals, assertExists } from "@std/assert";
import { ToolRegistry } from "./base.ts";
import type { Tool } from "./base.ts";

function makeTool(name: string, result: string): Tool {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: { type: "object", properties: {} },
    execute: async (_args) => result,
  };
}

Deno.test("ToolRegistry - register and get", () => {
  const registry = new ToolRegistry();
  const tool = makeTool("test", "ok");
  registry.register(tool);
  assertExists(registry.get("test"));
  assertEquals(registry.get("test")?.name, "test");
});

Deno.test("ToolRegistry - execute registered tool", async () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("greet", "hello"));
  const result = await registry.execute("greet", {});
  assertEquals(result, "hello");
});

Deno.test("ToolRegistry - execute unknown tool", async () => {
  const registry = new ToolRegistry();
  const result = await registry.execute("missing", {});
  assertEquals(result.includes("not found"), true);
});

Deno.test("ToolRegistry - getDefinitions returns OpenAI format", () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("a", ""));
  registry.register(makeTool("b", ""));
  const defs = registry.getDefinitions();
  assertEquals(defs.length, 2);
  assertEquals(defs[0].type, "function");
  assertEquals(defs[0].function.name, "a");
});

// ---------------------------------------------------------------------------
// executeParallel tests
// ---------------------------------------------------------------------------

Deno.test("ToolRegistry - executeParallel returns results in order", async () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("a", "result-a"));
  registry.register(makeTool("b", "result-b"));
  registry.register(makeTool("c", "result-c"));

  const results = await registry.executeParallel([
    { name: "a", args: {} },
    { name: "b", args: {} },
    { name: "c", args: {} },
  ]);

  assertEquals(results.length, 3);
  assertEquals(results[0], { name: "a", result: "result-a" });
  assertEquals(results[1], { name: "b", result: "result-b" });
  assertEquals(results[2], { name: "c", result: "result-c" });
});

Deno.test("ToolRegistry - executeParallel handles unknown tool", async () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("real", "ok"));

  const results = await registry.executeParallel([
    { name: "real", args: {} },
    { name: "missing", args: {} },
  ]);

  assertEquals(results.length, 2);
  assertEquals(results[0].result, "ok");
  assertEquals(results[1].result.includes("not found"), true);
});

Deno.test("ToolRegistry - executeParallel handles tool that throws", async () => {
  const registry = new ToolRegistry();
  const throwingTool: Tool = {
    name: "boom",
    description: "throws",
    parameters: { type: "object", properties: {} },
    execute: async () => { throw new Error("kaboom"); },
  };
  registry.register(throwingTool);
  registry.register(makeTool("safe", "ok"));

  const results = await registry.executeParallel([
    { name: "boom", args: {} },
    { name: "safe", args: {} },
  ]);

  assertEquals(results.length, 2);
  assertEquals(results[0].result.includes("kaboom"), true);
  assertEquals(results[1].result, "ok");
});

Deno.test("ToolRegistry - executeParallel with empty array", async () => {
  const registry = new ToolRegistry();
  const results = await registry.executeParallel([]);
  assertEquals(results.length, 0);
});

Deno.test("ToolRegistry - executeParallel with single tool", async () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("only", "single-result"));

  const results = await registry.executeParallel([
    { name: "only", args: {} },
  ]);

  assertEquals(results.length, 1);
  assertEquals(results[0], { name: "only", result: "single-result" });
});
