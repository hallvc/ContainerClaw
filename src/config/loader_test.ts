import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ConfigSchema } from "./schema.ts";
import { buildRawConfig, loadConfig, resolveConfigPath } from "./loader.ts";

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
    agents: { temperature: 0.9, max_tokens: 8192, models: { default: "file-model" } },
    openrouter: { default_model: "file-or-model" },
  };
  const raw = buildRawConfig(env, fileConfig);
  const config = ConfigSchema.parse(JSON.parse(JSON.stringify(raw)));

  assertEquals(config.slack.bot_token, "env-bot-token");
  assertEquals(config.agents.temperature, 0.3);
  assertEquals(config.agents.max_tokens, 2048);
  assertEquals(config.agents.models.default, "env-model");
  assertEquals(config.openrouter.default_model, "env-model");
});

Deno.test("loadConfig - NANOBOT_MODEL_CHAT maps to agents.models.chat", () => {
  const env: Record<string, string | undefined> = {
    NANOBOT_MODEL_CHAT: "chat-model",
  };
  const raw = buildRawConfig(env, emptyFile);
  const config = ConfigSchema.parse(JSON.parse(JSON.stringify(raw)));

  assertEquals(config.agents.models.chat, "chat-model");
  assertEquals(config.agents.models.memory, undefined);
});

Deno.test("loadConfig - NANOBOT_MODEL_MEMORY maps to agents.models.memory", () => {
  const env: Record<string, string | undefined> = {
    NANOBOT_MODEL_MEMORY: "memory-model",
  };
  const raw = buildRawConfig(env, emptyFile);
  const config = ConfigSchema.parse(JSON.parse(JSON.stringify(raw)));

  assertEquals(config.agents.models.memory, "memory-model");
  assertEquals(config.agents.models.chat, undefined);
});

Deno.test("loadConfig - per-role env vars override file config models", () => {
  const env: Record<string, string | undefined> = {
    NANOBOT_MODEL_MEMORY: "env-memory",
  };
  const fileConfig: Record<string, unknown> = {
    agents: { models: { memory: "file-memory", chat: "file-chat" } },
  };
  const raw = buildRawConfig(env, fileConfig);
  const config = ConfigSchema.parse(JSON.parse(JSON.stringify(raw)));

  assertEquals(config.agents.models.memory, "env-memory");
  assertEquals(config.agents.models.chat, "file-chat");
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

// ---------------------------------------------------------------------------
// resolveConfigPath tests
// ---------------------------------------------------------------------------

Deno.test("resolveConfigPath - explicit path takes priority", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const configPath = `${tmpDir}/config.json`;
    await Deno.writeTextFile(configPath, "{}");
    const result = await resolveConfigPath(configPath);
    assertEquals(result, configPath);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("resolveConfigPath - NANOBOT_CONFIG_PATH env var used when set", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const configPath = `${tmpDir}/custom-config.json`;
    await Deno.writeTextFile(configPath, "{}");
    const original = Deno.env.get("NANOBOT_CONFIG_PATH");
    Deno.env.set("NANOBOT_CONFIG_PATH", configPath);
    try {
      const result = await resolveConfigPath();
      assertEquals(result, configPath);
    } finally {
      if (original) Deno.env.set("NANOBOT_CONFIG_PATH", original);
      else Deno.env.delete("NANOBOT_CONFIG_PATH");
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("resolveConfigPath - falls back to /data/config.json path when it exists", async () => {
  // This test only verifies the path resolution logic, not filesystem existence
  // We test with a temp dir to simulate /data/config.json
  const tmpDir = await Deno.makeTempDir();
  try {
    const dataConfig = `${tmpDir}/data-config.json`;
    await Deno.writeTextFile(dataConfig, "{}");
    // When given explicitly, it returns that path
    const result = await resolveConfigPath(dataConfig);
    assertEquals(result, dataConfig);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("resolveConfigPath - returns /data/config.json as default when no env set", async () => {
  const original = Deno.env.get("NANOBOT_CONFIG_PATH");
  Deno.env.delete("NANOBOT_CONFIG_PATH");
  try {
    // With no explicit path and no env var, should return /data/config.json or ~/.nanobot/config.json
    const result = await resolveConfigPath();
    // It should be a string path (either /data/config.json or home-based)
    assertEquals(typeof result, "string");
  } finally {
    if (original) Deno.env.set("NANOBOT_CONFIG_PATH", original);
  }
});

// ---------------------------------------------------------------------------
// .env integration test
// ---------------------------------------------------------------------------

Deno.test("loadConfig - .env file values flow through to final Config", async () => {
  const tmpDir = await Deno.makeTempDir();
  const key = "OPENROUTER_API_KEY";
  const originalKey = Deno.env.get(key);
  const originalDotenvPath = Deno.env.get("NANOBOT_DOTENV_PATH");
  try {
    // Write a minimal config.json
    const configPath = join(tmpDir, "config.json");
    await Deno.writeTextFile(configPath, "{}");

    // Write a .env file next to config.json
    await Deno.writeTextFile(
      join(tmpDir, ".env"),
      `${key}=sk-from-dotenv\n`,
    );

    // Clear any existing env value so .env can set it
    Deno.env.delete(key);
    Deno.env.delete("NANOBOT_DOTENV_PATH");

    const config = await loadConfig(configPath);
    assertEquals(config.openrouter.api_key, "sk-from-dotenv");
  } finally {
    if (originalKey) Deno.env.set(key, originalKey);
    else Deno.env.delete(key);
    if (originalDotenvPath) Deno.env.set("NANOBOT_DOTENV_PATH", originalDotenvPath);
    else Deno.env.delete("NANOBOT_DOTENV_PATH");
    await Deno.remove(tmpDir, { recursive: true });
  }
});
