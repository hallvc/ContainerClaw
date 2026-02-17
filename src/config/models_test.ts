import { assertEquals } from "@std/assert";
import { ConfigSchema } from "./schema.ts";
import { resolveModel } from "./models.ts";

Deno.test("resolveModel - returns role-specific model when set", () => {
  const config = ConfigSchema.parse({
    openrouter: { default_model: "provider-default" },
    agents: { models: { default: "global-default", chat: "chat-model", memory: "memory-model" } },
  });
  assertEquals(resolveModel(config, "chat"), "chat-model");
  assertEquals(resolveModel(config, "memory"), "memory-model");
});

Deno.test("resolveModel - falls back to models.default when role is unset", () => {
  const config = ConfigSchema.parse({
    openrouter: { default_model: "provider-default" },
    agents: { models: { default: "global-default" } },
  });
  assertEquals(resolveModel(config, "chat"), "global-default");
  assertEquals(resolveModel(config, "memory"), "global-default");
});

Deno.test("resolveModel - falls back to openrouter.default_model when models.default is also unset", () => {
  const config = ConfigSchema.parse({
    openrouter: { default_model: "provider-default" },
    agents: { models: {} },
  });
  assertEquals(resolveModel(config, "chat"), "provider-default");
  assertEquals(resolveModel(config, "memory"), "provider-default");
});

Deno.test("resolveModel - with no config returns schema default", () => {
  const config = ConfigSchema.parse({});
  assertEquals(resolveModel(config, "chat"), "minimax/minimax-m2.5");
  assertEquals(resolveModel(config, "memory"), "minimax/minimax-m2.5");
});

Deno.test("resolveModel - default role resolves to models.default then openrouter fallback", () => {
  const config1 = ConfigSchema.parse({
    agents: { models: { default: "explicit-default" } },
  });
  assertEquals(resolveModel(config1, "default"), "explicit-default");

  const config2 = ConfigSchema.parse({
    openrouter: { default_model: "or-default" },
    agents: { models: {} },
  });
  assertEquals(resolveModel(config2, "default"), "or-default");
});

Deno.test("resolveModel - role-specific takes priority over models.default", () => {
  const config = ConfigSchema.parse({
    agents: { models: { default: "fallback", memory: "specific-memory" } },
  });
  assertEquals(resolveModel(config, "memory"), "specific-memory");
  assertEquals(resolveModel(config, "chat"), "fallback");
});
