import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Config } from "../../config/schema.ts";
import { getStatus, renderStatus } from "./status.ts";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    slack: {
      bot_token: "",
      app_token: "",
      group_policy: "mention",
      group_allow_from: [],
      dm: { enabled: true, policy: "open", allow_from: [] },
    },
    openrouter: { api_key: "sk-test", default_model: "test-model" },
    agents: {
      models: {},
      temperature: 0.7,
      max_tokens: 1000,
      memory_window: 10,
      consolidation_threshold: 50,
      max_iterations: 5,
    },
    email: {
      api_key: "",
      inbox_id: "",
      username: "",
      domain: "",
      poll_interval_seconds: 15,
      policy: "open",
      allow_from: [],
    },
    telegram: { bot_token: "", allow_from: [] },
    tools: { exec_timeout_ms: 60_000 },
    heartbeat: { enabled: false, interval_seconds: 1800 },
    workspace: "/workspace",
    data_dir: "/data",
    ...overrides,
  };
}

Deno.test("getStatus - returns correct workspace and data_dir", () => {
  const config = makeConfig({
    workspace: "/my/workspace",
    data_dir: "/my/data",
  });
  const status = getStatus(config);
  assertEquals(status.workspace, "/my/workspace");
  assertEquals(status.dataDir, "/my/data");
});

Deno.test("getStatus - shows correct default model info", () => {
  const config = makeConfig({
    openrouter: { api_key: "sk-test", default_model: "anthropic/claude-sonnet-4-5" },
  });
  const status = getStatus(config);
  assertEquals(status.model.chat, "anthropic/claude-sonnet-4-5");
  assertEquals(status.model.memory, "anthropic/claude-sonnet-4-5");
});

Deno.test("getStatus - shows per-role models when configured", () => {
  const config = makeConfig({
    openrouter: { api_key: "sk-test", default_model: "fallback-model" },
    agents: {
      models: { chat: "chat-model", memory: "memory-model" },
      temperature: 0.7,
      max_tokens: 1000,
      memory_window: 10,
      consolidation_threshold: 50,
      max_iterations: 5,
    },
  });
  const status = getStatus(config);
  assertEquals(status.model.chat, "chat-model");
  assertEquals(status.model.memory, "memory-model");
});

Deno.test("getStatus - detects no channels configured", () => {
  const config = makeConfig();
  const status = getStatus(config);
  assertEquals(status.channels.slack, false);
  assertEquals(status.channels.email, false);
  assertEquals(status.channels.telegram, false);
});

Deno.test("getStatus - detects slack configured", () => {
  const config = makeConfig({
    slack: {
      bot_token: "xoxb-test",
      app_token: "xapp-test",
      group_policy: "mention",
      group_allow_from: [],
      dm: { enabled: true, policy: "open", allow_from: [] },
    },
  });
  const status = getStatus(config);
  assertEquals(status.channels.slack, true);
});

Deno.test("getStatus - detects email configured", () => {
  const config = makeConfig({
    email: {
      api_key: "key",
      inbox_id: "",
      username: "",
      domain: "",
      poll_interval_seconds: 15,
      policy: "open",
      allow_from: [],
    },
  });
  const status = getStatus(config);
  assertEquals(status.channels.email, true);
});

Deno.test("getStatus - detects telegram configured", () => {
  const config = makeConfig({
    telegram: { bot_token: "123:ABC", allow_from: [] },
  });
  const status = getStatus(config);
  assertEquals(status.channels.telegram, true);
});

Deno.test("getStatus - shows heartbeat status", () => {
  const config = makeConfig({
    heartbeat: { enabled: true, interval_seconds: 900 },
  });
  const status = getStatus(config);
  assertEquals(status.heartbeat.enabled, true);
  assertEquals(status.heartbeat.intervalSeconds, 900);
});

Deno.test("renderStatus - includes workspace path", () => {
  const config = makeConfig({ workspace: "/test/workspace" });
  const status = getStatus(config);
  const output = renderStatus(status);
  assertStringIncludes(output, "/test/workspace");
});

Deno.test("renderStatus - includes model info", () => {
  const config = makeConfig({
    openrouter: { api_key: "sk-test", default_model: "my-model" },
  });
  const status = getStatus(config);
  const output = renderStatus(status);
  assertStringIncludes(output, "my-model");
});

Deno.test("renderStatus - shows channel status with checkmarks", () => {
  const config = makeConfig({
    slack: {
      bot_token: "xoxb-test",
      app_token: "xapp-test",
      group_policy: "mention",
      group_allow_from: [],
      dm: { enabled: true, policy: "open", allow_from: [] },
    },
  });
  const status = getStatus(config);
  const output = renderStatus(status);
  assertStringIncludes(output, "Slack");
});

Deno.test("renderStatus - shows heartbeat info", () => {
  const config = makeConfig({
    heartbeat: { enabled: true, interval_seconds: 1800 },
  });
  const status = getStatus(config);
  const output = renderStatus(status);
  assertStringIncludes(output, "Heartbeat");
});
