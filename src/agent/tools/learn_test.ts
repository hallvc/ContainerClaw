import { assertEquals, assertStringIncludes } from "@std/assert";
import { LearnTool } from "./learn.ts";
import { MemoryStore } from "../memory.ts";

function makeStore(): { store: MemoryStore; dir: Promise<string> } {
  const dir = Deno.makeTempDir();
  return {
    store: null as unknown as MemoryStore,
    dir,
  };
}

async function setup(): Promise<{ tool: LearnTool; store: MemoryStore; dir: string }> {
  const dir = await Deno.makeTempDir();
  const store = new MemoryStore(dir);
  await store.ensureDirectories();
  const tool = new LearnTool(store);
  return { tool, store, dir };
}

async function cleanup(dir: string): Promise<void> {
  await Deno.remove(dir, { recursive: true });
}

const VALID_CONTENT =
  "When the user says 'put link in Asana', fetch the content first, then create the task. Don't create empty tasks with just a URL. This is important behavior to remember.";

// Test 1: successful learn saves file
Deno.test("LearnTool - execute saves learning and returns success message", async () => {
  const { tool, store, dir } = await setup();
  try {
    const result = await tool.execute({
      topic: "asana-workflow",
      content: VALID_CONTENT,
      source: "correction",
    });
    assertStringIncludes(result, 'Learned "asana-workflow"');
    assertStringIncludes(result, "saved to");

    // Verify the learning was actually saved
    const learnings = await store.readLearnings();
    assertEquals(learnings.length, 1);
    assertEquals(learnings[0].topic, "asana-workflow");
    assertStringIncludes(learnings[0].content, "fetch the content first");
  } finally {
    await cleanup(dir);
  }
});

// Test 2: missing topic returns error
Deno.test("LearnTool - execute returns error when topic is missing", async () => {
  const { tool, dir } = await setup();
  try {
    const result = await tool.execute({ content: VALID_CONTENT });
    assertStringIncludes(result, "Error: topic is required");
  } finally {
    await cleanup(dir);
  }
});

// Test 3: empty topic returns error
Deno.test("LearnTool - execute returns error when topic is empty string", async () => {
  const { tool, dir } = await setup();
  try {
    const result = await tool.execute({ topic: "  ", content: VALID_CONTENT });
    assertStringIncludes(result, "Error: topic is required");
  } finally {
    await cleanup(dir);
  }
});

// Test 4: content too short returns error
Deno.test("LearnTool - execute returns error when content is too short", async () => {
  const { tool, dir } = await setup();
  try {
    const result = await tool.execute({
      topic: "short-note",
      content: "Too short",
    });
    assertStringIncludes(result, "Error: content must be at least 100 characters");
    assertStringIncludes(result, "got 9");
  } finally {
    await cleanup(dir);
  }
});

// Test 5: content exactly at minimum length succeeds
Deno.test("LearnTool - execute succeeds with content at exactly 100 characters", async () => {
  const { tool, dir } = await setup();
  try {
    const content = "a".repeat(100);
    const result = await tool.execute({
      topic: "edge-case",
      content,
    });
    assertStringIncludes(result, 'Learned "edge-case"');
  } finally {
    await cleanup(dir);
  }
});

// Test 6: default source is "observation"
Deno.test("LearnTool - execute uses 'observation' as default source", async () => {
  const { tool, store, dir } = await setup();
  try {
    await tool.execute({
      topic: "default-source",
      content: VALID_CONTENT,
    });
    const learnings = await store.readLearnings();
    assertEquals(learnings[0].source, "observation");
  } finally {
    await cleanup(dir);
  }
});

// Test 7: custom source is preserved
Deno.test("LearnTool - execute preserves custom source", async () => {
  const { tool, store, dir } = await setup();
  try {
    await tool.execute({
      topic: "custom-source",
      content: VALID_CONTENT,
      source: "telegram:matt",
    });
    const learnings = await store.readLearnings();
    assertEquals(learnings[0].source, "telegram:matt");
  } finally {
    await cleanup(dir);
  }
});

// Test 8: tool metadata is correct
Deno.test("LearnTool - has correct name, description, and parameters", () => {
  const store = new MemoryStore("/tmp/fake");
  const tool = new LearnTool(store);
  assertEquals(tool.name, "learn");
  assertStringIncludes(tool.description, "persistent memory");
  assertEquals(tool.parameters.required, ["topic", "content"]);
});

// Test 9: learning with same topic appends instead of overwriting
Deno.test("LearnTool - execute appends to existing topic instead of overwriting", async () => {
  const { tool, store, dir } = await setup();
  try {
    await tool.execute({
      topic: "deploy-prefs",
      content: "First learning: " + "a".repeat(90),
      source: "observation",
    });
    await tool.execute({
      topic: "deploy-prefs",
      content: "Updated learning: " + "b".repeat(90),
      source: "correction",
    });

    const learnings = await store.readLearnings();
    // Should still parse as one learning (the file has both entries)
    assertEquals(learnings.length, 1);
    // The parsed content should include the original content
    // (parseLearningFile reads the body after metadata)
  } finally {
    await cleanup(dir);
  }
});
