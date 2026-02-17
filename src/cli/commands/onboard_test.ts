import { assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { ConfigSchema } from "../../config/schema.ts";
import {
  buildDefaultConfig,
  buildDotenvContent,
  TEMPLATE_AGENTS_MD,
  TEMPLATE_SOUL_MD,
  TEMPLATE_USER_MD,
  writeOnboardFiles,
} from "./onboard.ts";

Deno.test("buildDefaultConfig - returns valid config with defaults", () => {
  const raw = buildDefaultConfig({});
  const config = ConfigSchema.parse(raw);
  assertEquals(config.openrouter.default_model, "minimax/minimax-m2.5");
});

Deno.test("buildDefaultConfig - does not include api_key", () => {
  const raw = buildDefaultConfig({ apiKey: "sk-test-key" });
  const config = ConfigSchema.parse(raw);
  // api_key should default to empty string (not set by buildDefaultConfig)
  assertEquals(config.openrouter.api_key, "");
});

Deno.test("buildDefaultConfig - custom model is included", () => {
  const raw = buildDefaultConfig({ model: "anthropic/claude-sonnet-4-5" });
  const config = ConfigSchema.parse(raw);
  assertEquals(config.openrouter.default_model, "anthropic/claude-sonnet-4-5");
});

Deno.test("buildDefaultConfig - custom workspace and data_dir", () => {
  const raw = buildDefaultConfig({
    workspace: "/custom/workspace",
    dataDir: "/custom/data",
  });
  const config = ConfigSchema.parse(raw);
  assertEquals(config.workspace, "/custom/workspace");
  assertEquals(config.data_dir, "/custom/data");
});

Deno.test("buildDefaultConfig - passes ConfigSchema validation", () => {
  const raw = buildDefaultConfig({
    model: "test-model",
    workspace: "/ws",
    dataDir: "/data",
  });
  // Should not throw
  const config = ConfigSchema.parse(raw);
  assertEquals(config.openrouter.default_model, "test-model");
});

// ---------------------------------------------------------------------------
// buildDotenvContent tests
// ---------------------------------------------------------------------------

Deno.test("buildDotenvContent - produces valid .env format with API key", () => {
  const content = buildDotenvContent("sk-or-test-123");
  assertEquals(content.includes("OPENROUTER_API_KEY=sk-or-test-123"), true);
  assertEquals(content.includes("# ContainerClaw"), true);
});

Deno.test("buildDotenvContent - handles empty API key", () => {
  const content = buildDotenvContent("");
  assertEquals(content.includes("OPENROUTER_API_KEY="), true);
});

// ---------------------------------------------------------------------------
// writeOnboardFiles tests
// ---------------------------------------------------------------------------

Deno.test("writeOnboardFiles - creates workspace directory", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    const configData = buildDefaultConfig({});
    await writeOnboardFiles(join(dataDir, "config.json"), workspace, dataDir, configData);
    assertEquals(await exists(workspace), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeOnboardFiles - creates data directory", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    const configData = buildDefaultConfig({});
    await writeOnboardFiles(join(dataDir, "config.json"), workspace, dataDir, configData);
    assertEquals(await exists(dataDir), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeOnboardFiles - writes config.json without api_key", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    const configData = buildDefaultConfig({ model: "test-model" });
    const configPath = join(dataDir, "config.json");
    await writeOnboardFiles(configPath, workspace, dataDir, configData, "sk-test");

    const text = await Deno.readTextFile(configPath);
    const parsed = JSON.parse(text);
    // config.json should NOT contain the API key
    assertEquals(parsed.openrouter?.api_key, undefined);
    // But should still be valid
    const config = ConfigSchema.parse(parsed);
    assertEquals(config.openrouter.default_model, "test-model");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeOnboardFiles - creates .env with API key", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    const configData = buildDefaultConfig({});
    await writeOnboardFiles(join(dataDir, "config.json"), workspace, dataDir, configData, "sk-test-key");

    const dotenvPath = join(dataDir, ".env");
    assertEquals(await exists(dotenvPath), true);
    const content = await Deno.readTextFile(dotenvPath);
    assertEquals(content.includes("OPENROUTER_API_KEY=sk-test-key"), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeOnboardFiles - does not create .env when no apiKey", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    const configData = buildDefaultConfig({});
    await writeOnboardFiles(join(dataDir, "config.json"), workspace, dataDir, configData);

    const dotenvPath = join(dataDir, ".env");
    assertEquals(await exists(dotenvPath), false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeOnboardFiles - does not overwrite existing .env", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    await Deno.mkdir(dataDir, { recursive: true });

    const dotenvPath = join(dataDir, ".env");
    await Deno.writeTextFile(dotenvPath, "OPENROUTER_API_KEY=original\n");

    const configData = buildDefaultConfig({});
    await writeOnboardFiles(join(dataDir, "config.json"), workspace, dataDir, configData, "new-key");

    const content = await Deno.readTextFile(dotenvPath);
    assertEquals(content, "OPENROUTER_API_KEY=original\n");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeOnboardFiles - creates AGENTS.md in workspace", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    const configData = buildDefaultConfig({});
    await writeOnboardFiles(join(dataDir, "config.json"), workspace, dataDir, configData);

    const content = await Deno.readTextFile(join(workspace, "AGENTS.md"));
    assertEquals(content, TEMPLATE_AGENTS_MD);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeOnboardFiles - creates SOUL.md in workspace", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    const configData = buildDefaultConfig({});
    await writeOnboardFiles(join(dataDir, "config.json"), workspace, dataDir, configData);

    const content = await Deno.readTextFile(join(workspace, "SOUL.md"));
    assertEquals(content, TEMPLATE_SOUL_MD);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeOnboardFiles - creates USER.md in workspace", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    const configData = buildDefaultConfig({});
    await writeOnboardFiles(join(dataDir, "config.json"), workspace, dataDir, configData);

    const content = await Deno.readTextFile(join(workspace, "USER.md"));
    assertEquals(content, TEMPLATE_USER_MD);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeOnboardFiles - creates skills directory", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    const configData = buildDefaultConfig({});
    await writeOnboardFiles(join(dataDir, "config.json"), workspace, dataDir, configData);

    assertEquals(await exists(join(workspace, "skills")), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeOnboardFiles - does not overwrite existing config.json", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    await Deno.mkdir(dataDir, { recursive: true });

    const configPath = join(dataDir, "config.json");
    await Deno.writeTextFile(configPath, '{"existing": true}');

    const configData = buildDefaultConfig({ apiKey: "new-key" });
    await writeOnboardFiles(configPath, workspace, dataDir, configData);

    // Should still have original content
    const text = await Deno.readTextFile(configPath);
    assertEquals(JSON.parse(text).existing, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeOnboardFiles - does not overwrite existing workspace files", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    await Deno.mkdir(workspace, { recursive: true });

    await Deno.writeTextFile(join(workspace, "AGENTS.md"), "custom content");

    const configData = buildDefaultConfig({});
    await writeOnboardFiles(join(dataDir, "config.json"), workspace, dataDir, configData);

    const content = await Deno.readTextFile(join(workspace, "AGENTS.md"));
    assertEquals(content, "custom content");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
