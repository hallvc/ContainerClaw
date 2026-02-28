import { assertEquals, assertStringIncludes } from "@std/assert";
import { WorkspaceHealthTool } from "./workspace_health.ts";
import { HealthStateManager } from "../../workspace/health_state.ts";
import { join } from "@std/path";

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

async function setupTool(): Promise<{
  tool: WorkspaceHealthTool;
  wsDir: string;
  stateDir: string;
  healthState: HealthStateManager;
}> {
  const wsDir = await Deno.makeTempDir({ prefix: "wh_ws_" });
  const defaultsDir = await Deno.makeTempDir({ prefix: "wh_def_" });
  const stateDir = await Deno.makeTempDir({ prefix: "wh_state_" });

  await Deno.writeTextFile(join(wsDir, "USER.md"), DEFAULT_USER_MD);
  await Deno.writeTextFile(join(defaultsDir, "USER.md"), DEFAULT_USER_MD);

  const healthState = new HealthStateManager(stateDir, 2, 24);
  await healthState.load();

  const tool = new WorkspaceHealthTool(wsDir, defaultsDir, healthState);
  return { tool, wsDir, stateDir, healthState };
}

Deno.test("WorkspaceHealthTool - record_answer for text field updates USER.md", async () => {
  const { tool, wsDir } = await setupTool();

  const result = await tool.execute({
    action: "record_answer",
    field_key: "user.name",
    value: "Matt",
  });

  assertStringIncludes(result, "Updated");

  const content = await Deno.readTextFile(join(wsDir, "USER.md"));
  assertStringIncludes(content, "**Name**: Matt");
  assertEquals(content.includes("(your name)"), false);
});

Deno.test("WorkspaceHealthTool - record_answer for timezone updates USER.md", async () => {
  const { tool, wsDir } = await setupTool();

  const result = await tool.execute({
    action: "record_answer",
    field_key: "user.timezone",
    value: "America/Los_Angeles",
  });

  assertStringIncludes(result, "Updated");

  const content = await Deno.readTextFile(join(wsDir, "USER.md"));
  assertStringIncludes(content, "**Timezone**: America/Los_Angeles");
});

Deno.test("WorkspaceHealthTool - record_answer for checkbox field checks correct option", async () => {
  const { tool, wsDir } = await setupTool();

  const result = await tool.execute({
    action: "record_answer",
    field_key: "user.comm_style",
    value: "Casual",
  });

  assertStringIncludes(result, "Updated");

  const content = await Deno.readTextFile(join(wsDir, "USER.md"));
  assertStringIncludes(content, "- [x] Casual");
  assertStringIncludes(content, "- [ ] Professional");
  assertStringIncludes(content, "- [ ] Technical");
});

Deno.test("WorkspaceHealthTool - record_answer for checkbox unchecks others", async () => {
  const { tool, wsDir } = await setupTool();

  // First check one option
  await tool.execute({
    action: "record_answer",
    field_key: "user.tech_level",
    value: "Expert",
  });

  const content = await Deno.readTextFile(join(wsDir, "USER.md"));
  assertStringIncludes(content, "- [x] Expert");
  assertStringIncludes(content, "- [ ] Beginner");
  assertStringIncludes(content, "- [ ] Intermediate");
});

Deno.test("WorkspaceHealthTool - record_skip records skip timestamp", async () => {
  const { tool, healthState } = await setupTool();

  const result = await tool.execute({
    action: "record_skip",
    field_key: "user.timezone",
  });

  assertStringIncludes(result, "Skipped");
  assertEquals(healthState.canAskField("user.timezone"), false);
});

Deno.test("WorkspaceHealthTool - check_status returns health report", async () => {
  const { tool } = await setupTool();

  const result = await tool.execute({ action: "check_status" });

  assertStringIncludes(result, "Workspace health:");
  assertStringIncludes(result, "USER.md");
  assertStringIncludes(result, "Name");
});

Deno.test("WorkspaceHealthTool - record_answer marks field as completed", async () => {
  const { tool, healthState } = await setupTool();

  assertEquals(healthState.canAskField("user.name"), true);

  await tool.execute({
    action: "record_answer",
    field_key: "user.name",
    value: "Matt",
  });

  assertEquals(healthState.canAskField("user.name"), false);
});

Deno.test("WorkspaceHealthTool - record_answer for list field replaces empty bullets", async () => {
  const { tool, wsDir } = await setupTool();

  const result = await tool.execute({
    action: "record_answer",
    field_key: "user.topics",
    value: "AI, DevOps, TypeScript",
  });

  assertStringIncludes(result, "Updated");

  const content = await Deno.readTextFile(join(wsDir, "USER.md"));
  assertStringIncludes(content, "- AI");
  assertStringIncludes(content, "- DevOps");
  assertStringIncludes(content, "- TypeScript");
});

Deno.test("WorkspaceHealthTool - record_answer requires field_key", async () => {
  const { tool } = await setupTool();

  const result = await tool.execute({
    action: "record_answer",
    value: "Matt",
  });

  assertStringIncludes(result, "Error");
  assertStringIncludes(result, "field_key");
});

Deno.test("WorkspaceHealthTool - record_answer requires value", async () => {
  const { tool } = await setupTool();

  const result = await tool.execute({
    action: "record_answer",
    field_key: "user.name",
  });

  assertStringIncludes(result, "Error");
  assertStringIncludes(result, "value");
});
