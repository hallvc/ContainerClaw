import { assertEquals, assertThrows } from "@std/assert";
import { ConfigSchema } from "./schema.ts";

Deno.test("ConfigSchema - parses with defaults", () => {
  const config = ConfigSchema.parse({});
  assertEquals(config.agents.temperature, 0.7);
  assertEquals(config.agents.max_tokens, 4096);
  assertEquals(config.agents.memory_window, 50);
  assertEquals(config.workspace, "/workspace");
  assertEquals(config.data_dir, "/data");
  assertEquals(config.slack.group_policy, "mention");
});

Deno.test("ConfigSchema - custom values", () => {
  const config = ConfigSchema.parse({
    openrouter: { api_key: "sk-test", default_model: "gpt-4" },
    agents: { temperature: 0.5, max_tokens: 8192 },
  });
  assertEquals(config.openrouter.api_key, "sk-test");
  assertEquals(config.openrouter.default_model, "gpt-4");
  assertEquals(config.agents.temperature, 0.5);
  assertEquals(config.agents.max_tokens, 8192);
});

Deno.test("ConfigSchema - rejects invalid temperature", () => {
  assertThrows(() => {
    ConfigSchema.parse({ agents: { temperature: 5.0 } });
  });
});
