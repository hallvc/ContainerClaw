import { assertEquals } from "@std/assert";
import { analyzeHealth } from "./health.ts";
import { join } from "@std/path";

const TEST_DIR = await Deno.makeTempDir({ prefix: "health_test_" });
const DEFAULTS_DIR = await Deno.makeTempDir({ prefix: "health_defaults_" });

// Write default templates
const DEFAULT_USER_MD = `# User Profile

Information about the user to help personalize interactions.

## Basic Information

- **Name**: (your name)
- **Timezone**: (your timezone, e.g., UTC+8)
- **Language**: (preferred language)

## Preferences

### Communication Style

- [ ] Casual
- [ ] Professional
- [ ] Technical

### Response Length

- [ ] Brief and concise
- [ ] Detailed explanations
- [ ] Adaptive based on question

### Technical Level

- [ ] Beginner
- [ ] Intermediate
- [ ] Expert

## Work Context

- **Primary Role**: (your role, e.g., developer, researcher)
- **Main Projects**: (what you're working on)
- **Tools You Use**: (IDEs, languages, frameworks)

## Topics of Interest

-
-
-

## Special Instructions

(Any specific instructions for how the assistant should behave)

---

*Edit this file to customize containerclaw's behavior for your needs.*`;

const DEFAULT_SOUL_MD = `# Soul

I am containerclaw. A lightweight personal AI agent.

## Core Principles

Be helpful and concise.`;

const DEFAULT_HEARTBEAT_MD = `# Heartbeat Tasks

## Active Tasks

<!-- Add your periodic tasks below this line -->

## Completed

<!-- Move completed tasks here -->`;

const DEFAULT_AGENTS_MD = `# Agent Instructions

Be helpful.`;

const DEFAULT_TOOLS_MD = `# Available Tools

Standard tools.`;

async function setupDefaults(): Promise<void> {
  await Deno.writeTextFile(join(DEFAULTS_DIR, "USER.md"), DEFAULT_USER_MD);
  await Deno.writeTextFile(join(DEFAULTS_DIR, "SOUL.md"), DEFAULT_SOUL_MD);
  await Deno.writeTextFile(join(DEFAULTS_DIR, "HEARTBEAT.md"), DEFAULT_HEARTBEAT_MD);
  await Deno.writeTextFile(join(DEFAULTS_DIR, "AGENTS.md"), DEFAULT_AGENTS_MD);
  await Deno.writeTextFile(join(DEFAULTS_DIR, "TOOLS.md"), DEFAULT_TOOLS_MD);
}

async function setupWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "ws_" });
  for (const [name, content] of Object.entries(files)) {
    await Deno.writeTextFile(join(dir, name), content);
  }
  return dir;
}

// Setup defaults once
await setupDefaults();

Deno.test("analyzeHealth - default USER.md detects all placeholder fields", async () => {
  const ws = await setupWorkspace({
    "USER.md": DEFAULT_USER_MD,
    "SOUL.md": "Custom soul content",
    "HEARTBEAT.md": DEFAULT_HEARTBEAT_MD,
    "AGENTS.md": "Custom agents",
    "TOOLS.md": "Custom tools",
  });

  const health = await analyzeHealth(ws, DEFAULTS_DIR);
  const userFile = health.files.find((f) => f.file === "USER.md");

  assertEquals(userFile?.score, 0);
  assertEquals(userFile?.gaps.length, 11); // 6 text + 3 checkbox + topics + instructions

  const fieldKeys = userFile?.gaps.map((g) => g.fieldKey).sort();
  assertEquals(fieldKeys, [
    "user.comm_style",
    "user.instructions",
    "user.language",
    "user.name",
    "user.projects",
    "user.response_length",
    "user.role",
    "user.tech_level",
    "user.timezone",
    "user.tools",
    "user.topics",
  ]);
});

Deno.test("analyzeHealth - partially filled USER.md returns correct score", async () => {
  const partialUser = DEFAULT_USER_MD
    .replace("(your name)", "Matt")
    .replace("(your timezone, e.g., UTC+8)", "America/Los_Angeles");

  const ws = await setupWorkspace({
    "USER.md": partialUser,
    "SOUL.md": "Custom soul",
    "HEARTBEAT.md": DEFAULT_HEARTBEAT_MD,
    "AGENTS.md": "Custom agents",
    "TOOLS.md": "Custom tools",
  });

  const health = await analyzeHealth(ws, DEFAULTS_DIR);
  const userFile = health.files.find((f) => f.file === "USER.md");

  // 2 of 11 fields filled = 18% (rounded)
  assertEquals(userFile?.score, 18);
  assertEquals(userFile?.gaps.length, 9);

  // Name and timezone should NOT be in gaps
  const fieldKeys = userFile?.gaps.map((g) => g.fieldKey);
  assertEquals(fieldKeys?.includes("user.name"), false);
  assertEquals(fieldKeys?.includes("user.timezone"), false);
});

Deno.test("analyzeHealth - fully filled USER.md returns score 100", async () => {
  const fullUser = DEFAULT_USER_MD
    .replace("(your name)", "Matt")
    .replace("(your timezone, e.g., UTC+8)", "PST")
    .replace("(preferred language)", "English")
    .replace("- [ ] Casual", "- [x] Casual")
    .replace("- [ ] Brief and concise", "- [x] Brief and concise")
    .replace("- [ ] Expert", "- [x] Expert")
    .replace("(your role, e.g., developer, researcher)", "Developer")
    .replace("(what you're working on)", "ContainerClaw")
    .replace("(IDEs, languages, frameworks)", "VS Code, TypeScript")
    .replace("-\n-\n-\n", "- AI\n- DevOps\n- TypeScript\n")
    .replace("(Any specific instructions for how the assistant should behave)", "Be concise");

  const ws = await setupWorkspace({
    "USER.md": fullUser,
    "SOUL.md": "Custom soul",
    "HEARTBEAT.md": DEFAULT_HEARTBEAT_MD,
    "AGENTS.md": "Custom agents",
    "TOOLS.md": "Custom tools",
  });

  const health = await analyzeHealth(ws, DEFAULTS_DIR);
  const userFile = health.files.find((f) => f.file === "USER.md");

  assertEquals(userFile?.score, 100);
  assertEquals(userFile?.gaps.length, 0);
});

Deno.test("analyzeHealth - default SOUL.md detected as gap", async () => {
  const ws = await setupWorkspace({
    "USER.md": DEFAULT_USER_MD,
    "SOUL.md": DEFAULT_SOUL_MD,
    "HEARTBEAT.md": DEFAULT_HEARTBEAT_MD,
    "AGENTS.md": "Custom agents",
    "TOOLS.md": "Custom tools",
  });

  const health = await analyzeHealth(ws, DEFAULTS_DIR);
  const soulFile = health.files.find((f) => f.file === "SOUL.md");

  assertEquals(soulFile?.score, 0);
  assertEquals(soulFile?.gaps.length, 1);
  assertEquals(soulFile?.gaps[0].fieldKey, "soul.personality");
});

Deno.test("analyzeHealth - customized SOUL.md has no gap", async () => {
  const ws = await setupWorkspace({
    "USER.md": DEFAULT_USER_MD,
    "SOUL.md": "My custom personality file with unique content.",
    "HEARTBEAT.md": DEFAULT_HEARTBEAT_MD,
    "AGENTS.md": "Custom agents",
    "TOOLS.md": "Custom tools",
  });

  const health = await analyzeHealth(ws, DEFAULTS_DIR);
  const soulFile = health.files.find((f) => f.file === "SOUL.md");

  assertEquals(soulFile?.score, 100);
  assertEquals(soulFile?.gaps.length, 0);
});

Deno.test("analyzeHealth - empty HEARTBEAT.md flagged, with tasks not flagged", async () => {
  // Empty heartbeat
  const ws1 = await setupWorkspace({
    "USER.md": DEFAULT_USER_MD,
    "SOUL.md": "Custom",
    "HEARTBEAT.md": DEFAULT_HEARTBEAT_MD,
    "AGENTS.md": "Custom",
    "TOOLS.md": "Custom",
  });

  const health1 = await analyzeHealth(ws1, DEFAULTS_DIR);
  const hb1 = health1.files.find((f) => f.file === "HEARTBEAT.md");
  assertEquals(hb1?.score, 0);
  assertEquals(hb1?.gaps.length, 1);

  // Heartbeat with actual tasks
  const ws2 = await setupWorkspace({
    "USER.md": DEFAULT_USER_MD,
    "SOUL.md": "Custom",
    "HEARTBEAT.md": "# Heartbeat\n\n## Active Tasks\n\nCheck the weather daily",
    "AGENTS.md": "Custom",
    "TOOLS.md": "Custom",
  });

  const health2 = await analyzeHealth(ws2, DEFAULTS_DIR);
  const hb2 = health2.files.find((f) => f.file === "HEARTBEAT.md");
  assertEquals(hb2?.score, 100);
  assertEquals(hb2?.gaps.length, 0);
});

Deno.test("analyzeHealth - isComplete true when all files filled", async () => {
  const fullUser = DEFAULT_USER_MD
    .replace("(your name)", "Matt")
    .replace("(your timezone, e.g., UTC+8)", "PST")
    .replace("(preferred language)", "English")
    .replace("- [ ] Casual", "- [x] Casual")
    .replace("- [ ] Brief and concise", "- [x] Brief and concise")
    .replace("- [ ] Expert", "- [x] Expert")
    .replace("(your role, e.g., developer, researcher)", "Developer")
    .replace("(what you're working on)", "ContainerClaw")
    .replace("(IDEs, languages, frameworks)", "VS Code, TypeScript")
    .replace("-\n-\n-\n", "- AI\n- DevOps\n- TypeScript\n")
    .replace("(Any specific instructions for how the assistant should behave)", "Be concise");

  const ws = await setupWorkspace({
    "USER.md": fullUser,
    "SOUL.md": "Custom soul",
    "HEARTBEAT.md": "# Tasks\n\nDo something",
    "AGENTS.md": "Custom agents",
    "TOOLS.md": "Custom tools",
  });

  const health = await analyzeHealth(ws, DEFAULTS_DIR);
  assertEquals(health.isComplete, true);
  assertEquals(health.overallScore, 100);
});
