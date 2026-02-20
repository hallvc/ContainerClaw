import { assertEquals } from "@std/assert";
import type { Config } from "../../config/schema.ts";
import { detectChannels } from "./gateway.ts";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    slack: {
      bot_token: "",
      app_token: "",
      group_policy: "mention",
      group_allow_from: [],
      dm: { enabled: true, policy: "open", allow_from: [] },
    },
    openrouter: { api_key: "", default_model: "test-model" },
    agents: {
      models: { heartbeat: "openrouter/free" },
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
    workspace: "/tmp/test-workspace",
    data_dir: "/tmp/test-data",
    ...overrides,
  };
}

Deno.test("detectChannels - no channels configured", () => {
  const config = makeConfig();
  const channels = detectChannels(config);
  assertEquals(channels.hasSlack, false);
  assertEquals(channels.hasEmail, false);
  assertEquals(channels.hasTelegram, false);
  assertEquals(channels.hasAny, false);
});

Deno.test("detectChannels - slack configured when both tokens present", () => {
  const config = makeConfig({
    slack: {
      bot_token: "xoxb-test",
      app_token: "xapp-test",
      group_policy: "mention",
      group_allow_from: [],
      dm: { enabled: true, policy: "open", allow_from: [] },
    },
  });
  const channels = detectChannels(config);
  assertEquals(channels.hasSlack, true);
  assertEquals(channels.hasAny, true);
});

Deno.test("detectChannels - slack not configured with only bot_token", () => {
  const config = makeConfig({
    slack: {
      bot_token: "xoxb-test",
      app_token: "",
      group_policy: "mention",
      group_allow_from: [],
      dm: { enabled: true, policy: "open", allow_from: [] },
    },
  });
  const channels = detectChannels(config);
  assertEquals(channels.hasSlack, false);
});

Deno.test("detectChannels - email configured when api_key present", () => {
  const config = makeConfig({
    email: {
      api_key: "test-key",
      inbox_id: "",
      username: "",
      domain: "",
      poll_interval_seconds: 15,
      policy: "open",
      allow_from: [],
    },
  });
  const channels = detectChannels(config);
  assertEquals(channels.hasEmail, true);
  assertEquals(channels.hasAny, true);
});

Deno.test("detectChannels - telegram configured when bot_token present", () => {
  const config = makeConfig({
    telegram: { bot_token: "123:ABC", allow_from: [] },
  });
  const channels = detectChannels(config);
  assertEquals(channels.hasTelegram, true);
  assertEquals(channels.hasAny, true);
});

Deno.test("detectChannels - multiple channels configured", () => {
  const config = makeConfig({
    slack: {
      bot_token: "xoxb-test",
      app_token: "xapp-test",
      group_policy: "mention",
      group_allow_from: [],
      dm: { enabled: true, policy: "open", allow_from: [] },
    },
    telegram: { bot_token: "123:ABC", allow_from: [] },
  });
  const channels = detectChannels(config);
  assertEquals(channels.hasSlack, true);
  assertEquals(channels.hasTelegram, true);
  assertEquals(channels.hasEmail, false);
  assertEquals(channels.hasAny, true);
});
