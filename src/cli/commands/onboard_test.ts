import { assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { ConfigSchema } from "../../config/schema.ts";
import {
  buildDefaultConfig,
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

Deno.test("buildDefaultConfig - custom API key is included", () => {
  const raw = buildDefaultConfig({ apiKey: "sk-test-key" });
  const config = ConfigSchema.parse(raw);
  assertEquals(config.openrouter.api_key, "sk-test-key");
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
    apiKey: "sk-test",
    model: "test-model",
    workspace: "/ws",
    dataDir: "/data",
  });
  // Should not throw
  const config = ConfigSchema.parse(raw);
  assertEquals(typeof config.openrouter.api_key, "string");
});

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

Deno.test("writeOnboardFiles - writes config.json that passes schema", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const workspace = join(tmpDir, "workspace");
    const dataDir = join(tmpDir, "data");
    const configData = buildDefaultConfig({ apiKey: "sk-test" });
    const configPath = join(dataDir, "config.json");
    await writeOnboardFiles(configPath, workspace, dataDir, configData);

    const text = await Deno.readTextFile(configPath);
    const parsed = JSON.parse(text);
    const config = ConfigSchema.parse(parsed);
    assertEquals(config.openrouter.api_key, "sk-test");
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
