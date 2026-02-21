import { assertEquals } from "@std/assert";
import type { ContextAware } from "./base.ts";
import { isContextAware } from "./base.ts";
import { MessageTool } from "./message.ts";
import { SpawnTool } from "./spawn.ts";

// Type-level tests: these tools should implement ContextAware
Deno.test("MessageTool implements ContextAware", () => {
  const tool = new MessageTool(async () => {});
  // Should be assignable to ContextAware
  const ca: ContextAware = tool;
  ca.setContext("test", "123");
  assertEquals(typeof ca.setContext, "function");
});

Deno.test("SpawnTool implements ContextAware", () => {
  const fakeManager = { spawn: () => "ok" };
  const tool = new SpawnTool(fakeManager);
  const ca: ContextAware = tool;
  ca.setContext("test", "456");
  assertEquals(typeof ca.setContext, "function");
});

Deno.test("isContextAware type guard works", () => {
  // A tool WITH setContext
  const fakeManager = { spawn: () => "ok" };
  const spawnTool = new SpawnTool(fakeManager);
  assertEquals(isContextAware(spawnTool), true);

  // A plain tool WITHOUT setContext
  const plainTool = {
    name: "test",
    description: "test",
    parameters: {},
    execute: async () => "ok",
  };
  assertEquals(isContextAware(plainTool), false);
});
