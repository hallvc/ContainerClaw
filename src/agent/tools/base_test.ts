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
