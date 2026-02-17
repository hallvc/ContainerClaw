import { assertEquals } from "@std/assert";
import { ConfigSchema } from "./schema.ts";
import { buildRawConfig } from "./loader.ts";

const emptyEnv: Record<string, string | undefined> = {};
const emptyFile: Record<string, unknown> = {};

Deno.test("loadConfig - defaults apply when no env vars or file config", () => {
  const raw = buildRawConfig(emptyEnv, emptyFile);
  const config = ConfigSchema.parse(JSON.parse(JSON.stringify(raw)));

  assertEquals(config.agents.temperature, 0.7);
  assertEquals(config.agents.max_tokens, 4096);
  assertEquals(config.agents.memory_window, 50);
  assertEquals(config.agents.max_iterations, 20);
});

Deno.test("loadConfig - env vars override file config", () => {
  const env: Record<string, string | undefined> = {
    SLACK_BOT_TOKEN: "env-bot-token",
    NANOBOT_TEMPERATURE: "0.3",
    NANOBOT_MAX_TOKENS: "2048",
    NANOBOT_MODEL: "env-model",
  };
  const fileConfig: Record<string, unknown> = {
    slack: { bot_token: "file-bot-token" },
    agents: { temperature: 0.9, max_tokens: 8192, model: "file-model" },
    openrouter: { default_model: "file-or-model" },
  };
  const raw = buildRawConfig(env, fileConfig);
  const config = ConfigSchema.parse(JSON.parse(JSON.stringify(raw)));

  assertEquals(config.slack.bot_token, "env-bot-token");
  assertEquals(config.agents.temperature, 0.3);
  assertEquals(config.agents.max_tokens, 2048);
  assertEquals(config.agents.model, "env-model");
});

Deno.test("loadConfig - file config used as fallback", () => {
  const env: Record<string, string | undefined> = {};
  const fileConfig: Record<string, unknown> = {
    slack: { bot_token: "file-token", group_policy: "open" },
    agents: { temperature: 1.2, max_tokens: 1024 },
    workspace: "/custom/workspace",
  };
  const raw = buildRawConfig(env, fileConfig);
  const config = ConfigSchema.parse(JSON.parse(JSON.stringify(raw)));

  assertEquals(config.slack.bot_token, "file-token");
  assertEquals(config.slack.group_policy, "open");
  assertEquals(config.agents.temperature, 1.2);
  assertEquals(config.agents.max_tokens, 1024);
  assertEquals(config.workspace, "/custom/workspace");
});

Deno.test("loadConfig - NANOBOT_MAX_ITERATIONS maps to agents.max_iterations", () => {
  const env: Record<string, string | undefined> = {
    NANOBOT_MAX_ITERATIONS: "10",
  };
  const raw = buildRawConfig(env, emptyFile);
  const config = ConfigSchema.parse(JSON.parse(JSON.stringify(raw)));

  assertEquals(config.agents.max_iterations, 10);
});

Deno.test("loadConfig - invalid numeric env vars fall back to defaults", () => {
  const env: Record<string, string | undefined> = {
    NANOBOT_TEMPERATURE: "abc",
    NANOBOT_MAX_TOKENS: "xyz",
    NANOBOT_MEMORY_WINDOW: "not-a-number",
    NANOBOT_MAX_ITERATIONS: "",
  };
  const raw = buildRawConfig(env, emptyFile);
  const config = ConfigSchema.parse(JSON.parse(JSON.stringify(raw)));

  assertEquals(config.agents.temperature, 0.7);
  assertEquals(config.agents.max_tokens, 4096);
  assertEquals(config.agents.memory_window, 50);
  assertEquals(config.agents.max_iterations, 20);
});
