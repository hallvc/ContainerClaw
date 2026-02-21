import { assertEquals, assertThrows } from "@std/assert";
import {
  AgentsConfigSchema,
  ConfigSchema,
  CronConfigSchema,
  EmailConfigSchema,
  OpenRouterConfigSchema,
  RESTRICT_TO_WORKSPACE,
  SlackConfigSchema,
  ToolsConfigSchema,
} from "./schema.ts";

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

Deno.test("RESTRICT_TO_WORKSPACE - is hardcoded true", () => {
  assertEquals(RESTRICT_TO_WORKSPACE, true);
});

Deno.test("SlackConfigSchema - defaults match Python reference", () => {
  const slack = SlackConfigSchema.parse({});
  assertEquals(slack.bot_token, "");
  assertEquals(slack.app_token, "");
  assertEquals(slack.group_policy, "mention");
  assertEquals(slack.group_allow_from, []);
  assertEquals(slack.dm.enabled, true);
  assertEquals(slack.dm.policy, "open");
  assertEquals(slack.dm.allow_from, []);
});

Deno.test("AgentsConfigSchema - defaults match Python reference", () => {
  const agents = AgentsConfigSchema.parse({});
  assertEquals(agents.temperature, 0.7);
  assertEquals(agents.max_tokens, 4096);
  assertEquals(agents.memory_window, 50);
  assertEquals(agents.max_iterations, 20);
  assertEquals(agents.models.default, undefined);
  assertEquals(agents.models.chat, undefined);
  assertEquals(agents.models.memory, undefined);
});

Deno.test("OpenRouterConfigSchema - defaults", () => {
  const or_ = OpenRouterConfigSchema.parse({});
  assertEquals(or_.api_key, "");
  assertEquals(or_.default_model, "minimax/minimax-m2.5");
});

Deno.test("ConfigSchema - Docker-friendly defaults", () => {
  const config = ConfigSchema.parse({});
  assertEquals(config.workspace, "/workspace");
  assertEquals(config.data_dir, "/data");
});

Deno.test("ToolsConfigSchema - defaults", () => {
  const tools = ToolsConfigSchema.parse({});
  assertEquals(tools.exec_timeout_ms, 60_000);
});

Deno.test("ConfigSchema - tools defaults", () => {
  const config = ConfigSchema.parse({});
  assertEquals(config.tools.exec_timeout_ms, 60_000);
});

Deno.test("ConfigSchema - custom tools exec_timeout_ms", () => {
  const config = ConfigSchema.parse({ tools: { exec_timeout_ms: 120_000 } });
  assertEquals(config.tools.exec_timeout_ms, 120_000);
});

Deno.test("CronConfigSchema - defaults", () => {
  const cron = CronConfigSchema.parse({});
  assertEquals(cron.enabled, true);
  assertEquals(cron.tick_interval_ms, 30_000);
  assertEquals(cron.job_timeout_ms, 300_000);
});

Deno.test("ConfigSchema - cron defaults", () => {
  const config = ConfigSchema.parse({});
  assertEquals(config.cron.enabled, true);
  assertEquals(config.cron.tick_interval_ms, 30_000);
  assertEquals(config.cron.job_timeout_ms, 300_000);
});

Deno.test("EmailConfigSchema - default policy is allowlist", () => {
  const email = EmailConfigSchema.parse({});
  assertEquals(email.policy, "allowlist");
  assertEquals(email.allow_from, []);
});
