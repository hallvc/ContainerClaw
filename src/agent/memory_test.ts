import { assertEquals, assertStringIncludes } from "@std/assert";
import { MemoryStore } from "./memory.ts";

// ──────────────────────────────────────────────
// Legacy methods (backward compatibility)
// ──────────────────────────────────────────────

Deno.test("MemoryStore - readLongTerm returns content when MEMORY.md exists", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await Deno.writeTextFile(`${tmpDir}/MEMORY.md`, "some memory content");
    const result = await store.readLongTerm();
    assertEquals(result, "some memory content");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - readLongTerm returns empty string when file missing", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    const result = await store.readLongTerm();
    assertEquals(result, "");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - writeLongTerm creates directory and writes file", async () => {
  const tmpDir = await Deno.makeTempDir();
  const nestedDir = `${tmpDir}/nested/dir`;
  try {
    const store = new MemoryStore(nestedDir);
    await store.writeLongTerm("written content");
    const content = await Deno.readTextFile(`${nestedDir}/MEMORY.md`);
    assertEquals(content, "written content");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - writeLongTerm then readLongTerm round-trip", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.writeLongTerm("round-trip data");
    const result = await store.readLongTerm();
    assertEquals(result, "round-trip data");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - appendHistory creates file and writes timestamped entry", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendHistory("first entry");
    const content = await Deno.readTextFile(`${tmpDir}/HISTORY.md`);
    assertStringIncludes(content, "first entry");
    assertStringIncludes(content, "[");
    assertStringIncludes(content, "]");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - appendHistory appends not overwrites on multiple calls", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendHistory("entry one");
    await store.appendHistory("entry two");
    const content = await Deno.readTextFile(`${tmpDir}/HISTORY.md`);
    assertStringIncludes(content, "entry one");
    assertStringIncludes(content, "entry two");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - getMemoryContext returns formatted string when memory exists", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.writeLongTerm("important memory");
    const result = await store.getMemoryContext();
    assertStringIncludes(result, "## Long-term Memory");
    assertStringIncludes(result, "important memory");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - getMemoryContext returns empty string when no memory", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    const result = await store.getMemoryContext();
    assertEquals(result, "");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - getMemoryContext returns empty string when memory is whitespace-only", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.writeLongTerm("   \n\t  \n  ");
    const result = await store.getMemoryContext();
    assertEquals(result, "");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// Daily Notes
// ──────────────────────────────────────────────

Deno.test("MemoryStore - appendDailyNote creates daily file with header and entry", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendDailyNote(
      {
        time: "09:15",
        source: "telegram:matt",
        title: "Deploy discussion",
        bullets: ["Set up GitHub Actions", "Use Docker multi-stage builds"],
      },
      "2026-02-19",
    );

    const content = await Deno.readTextFile(`${tmpDir}/daily/2026-02-19.md`);
    assertStringIncludes(content, "# 2026-02-19");
    assertStringIncludes(content, "## [09:15] [telegram:matt] Deploy discussion");
    assertStringIncludes(content, "- Set up GitHub Actions");
    assertStringIncludes(content, "- Use Docker multi-stage builds");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - appendDailyNote appends to existing file", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendDailyNote(
      { time: "09:00", source: "cli", title: "Morning", bullets: ["First task"] },
      "2026-02-19",
    );
    await store.appendDailyNote(
      { time: "14:00", source: "cli", title: "Afternoon", bullets: ["Second task"] },
      "2026-02-19",
    );

    const content = await Deno.readTextFile(`${tmpDir}/daily/2026-02-19.md`);
    assertStringIncludes(content, "Morning");
    assertStringIncludes(content, "Afternoon");
    assertStringIncludes(content, "First task");
    assertStringIncludes(content, "Second task");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - readDailyNote returns content for existing date", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendDailyNote(
      { time: "10:00", source: "test", title: "Test", bullets: ["Hello"] },
      "2026-01-15",
    );

    const content = await store.readDailyNote("2026-01-15");
    assertStringIncludes(content, "Hello");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - readDailyNote returns empty for missing date", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    const content = await store.readDailyNote("2099-01-01");
    assertEquals(content, "");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - listDailyNotes returns dates newest first", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendDailyNote(
      { time: "10:00", source: "test", title: "A", bullets: ["a"] },
      "2026-01-10",
    );
    await store.appendDailyNote(
      { time: "10:00", source: "test", title: "B", bullets: ["b"] },
      "2026-01-12",
    );
    await store.appendDailyNote(
      { time: "10:00", source: "test", title: "C", bullets: ["c"] },
      "2026-01-11",
    );

    const dates = await store.listDailyNotes();
    assertEquals(dates, ["2026-01-12", "2026-01-11", "2026-01-10"]);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - listDailyNotes filters by since date", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendDailyNote(
      { time: "10:00", source: "test", title: "Old", bullets: ["old"] },
      "2026-01-01",
    );
    await store.appendDailyNote(
      { time: "10:00", source: "test", title: "New", bullets: ["new"] },
      "2026-01-15",
    );

    const dates = await store.listDailyNotes(new Date("2026-01-10"));
    assertEquals(dates, ["2026-01-15"]);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - readRecentDailyNotes returns notes from past N days", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    const today = new Date().toISOString().split("T")[0];
    await store.appendDailyNote(
      { time: "10:00", source: "test", title: "Today", bullets: ["today's note"] },
      today,
    );

    const notes = await store.readRecentDailyNotes(1);
    assertEquals(notes.length, 1);
    assertEquals(notes[0].date, today);
    assertStringIncludes(notes[0].content, "today's note");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// Learnings
// ──────────────────────────────────────────────

Deno.test("MemoryStore - saveLearning creates learning file", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.saveLearning({
      topic: "Deploy Workflow",
      learned: "2026-02-19",
      source: "correction from user",
      content: "Always run health check after deploying to staging. Don't skip this step.",
    });

    const content = await Deno.readTextFile(`${tmpDir}/learnings/deploy-workflow.md`);
    assertStringIncludes(content, "# Deploy Workflow");
    assertStringIncludes(content, "**Learned**: 2026-02-19");
    assertStringIncludes(content, "correction from user");
    assertStringIncludes(content, "health check");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - readLearnings returns all learning files", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.saveLearning({
      topic: "Topic A",
      learned: "2026-01-01",
      source: "test",
      content: "Learning A content here.",
    });
    await store.saveLearning({
      topic: "Topic B",
      learned: "2026-01-02",
      source: "test",
      content: "Learning B content here.",
    });

    const learnings = await store.readLearnings();
    assertEquals(learnings.length, 2);
    const topics = learnings.map((l) => l.topic).sort();
    assertEquals(topics, ["Topic A", "Topic B"]);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - readLearnings returns empty array when no learnings", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    const learnings = await store.readLearnings();
    assertEquals(learnings.length, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - getLearningsContext formats learnings for context", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.saveLearning({
      topic: "Auth Pattern",
      learned: "2026-02-19",
      source: "observation",
      content: "Use OAuth2 with PKCE for all auth flows.",
    });

    const ctx = await store.getLearningsContext();
    assertStringIncludes(ctx, "## Learnings");
    assertStringIncludes(ctx, "### Auth Pattern");
    assertStringIncludes(ctx, "OAuth2 with PKCE");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// Index
// ──────────────────────────────────────────────

Deno.test("MemoryStore - rebuildIndex indexes daily notes", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendDailyNote(
      {
        time: "09:00",
        source: "telegram:matt",
        title: "OAuth2 setup",
        bullets: ["Configured OAuth2 with PKCE flow", "Added refresh token rotation"],
      },
      "2026-02-19",
    );

    const index = await store.rebuildIndex();
    assertEquals(index.version, "1.0.0");
    assertEquals(index.facts.length >= 1, true);
    // Check that the fact has relevant tags
    const fact = index.facts[0];
    assertEquals(fact.date, "2026-02-19");
    assertEquals(fact.source, "telegram:matt");
    assertEquals(fact.file, "daily/2026-02-19.md");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - rebuildIndex indexes learnings", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.saveLearning({
      topic: "Docker Pattern",
      learned: "2026-02-19",
      source: "observation",
      content: "Always use multi-stage builds for production Docker images.",
    });

    const index = await store.rebuildIndex();
    assertEquals(index.learnings.length, 1);
    assertEquals(index.learnings[0].topic, "Docker Pattern");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - isIndexStale returns true when no index exists", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    const stale = await store.isIndexStale();
    assertEquals(stale, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - isIndexStale returns false after rebuild with no changes", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.ensureDirectories();
    await store.rebuildIndex();
    // Small delay to ensure mtime difference
    await new Promise((r) => setTimeout(r, 50));
    const stale = await store.isIndexStale();
    assertEquals(stale, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// Retrieval
// ──────────────────────────────────────────────

Deno.test("MemoryStore - recall returns matching entries", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendDailyNote(
      {
        time: "09:00",
        source: "telegram:matt",
        title: "OAuth2 config",
        bullets: ["Set up OAuth2 with PKCE flow for the API", "Added token refresh"],
      },
      new Date().toISOString().split("T")[0],
    );
    await store.appendDailyNote(
      {
        time: "14:00",
        source: "telegram:matt",
        title: "Weather check",
        bullets: ["User asked about weather in San Francisco"],
      },
      new Date().toISOString().split("T")[0],
    );

    await store.rebuildIndex();

    const results = await store.recall("OAuth2 authentication");
    assertEquals(results.length >= 1, true);
    assertStringIncludes(results[0].content, "OAuth2");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - recall returns empty array for no matches", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.ensureDirectories();
    await store.rebuildIndex();
    const results = await store.recall("xyznonexistent");
    assertEquals(results.length, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - recall boosts learnings", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendDailyNote(
      {
        time: "09:00",
        source: "test",
        title: "Docker discussion",
        bullets: ["Talked about Docker builds and deployment"],
      },
      new Date().toISOString().split("T")[0],
    );
    await store.saveLearning({
      topic: "Docker Builds",
      learned: new Date().toISOString().split("T")[0],
      source: "correction",
      content: "Always use multi-stage Docker builds for production. Never use single-stage Dockerfiles in production environments.",
    });

    await store.rebuildIndex();

    const results = await store.recall("Docker builds");
    assertEquals(results.length >= 1, true);
    // Learning should be boosted and appear first
    assertEquals(results[0].type, "learning");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// Smart Context Loading
// ──────────────────────────────────────────────

Deno.test("MemoryStore - getRelevantContext includes memory and learnings", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.writeLongTerm("User prefers TypeScript and dark mode.");
    await store.saveLearning({
      topic: "Code Style",
      learned: "2026-02-19",
      source: "preference",
      content: "Always use strict TypeScript with no-any rule enabled.",
    });

    const ctx = await store.getRelevantContext("Help me set up TypeScript");
    assertStringIncludes(ctx, "Synthesized Memory");
    assertStringIncludes(ctx, "TypeScript");
    assertStringIncludes(ctx, "Learnings");
    assertStringIncludes(ctx, "Code Style");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - getRelevantContext returns empty when no memory exists", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.ensureDirectories();
    await store.rebuildIndex();
    const ctx = await store.getRelevantContext("hello");
    // Should return empty or minimal since nothing exists
    assertEquals(ctx === "" || !ctx.includes("Relevant Past Context"), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// Archive
// ──────────────────────────────────────────────

Deno.test("MemoryStore - archiveOldNotes moves old notes to monthly archive", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    // Create an "old" note from 60 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);
    const oldDateStr = oldDate.toISOString().split("T")[0];
    const oldMonth = oldDateStr.slice(0, 7);

    await store.appendDailyNote(
      { time: "10:00", source: "test", title: "Old note", bullets: ["archived content"] },
      oldDateStr,
    );

    // Create a recent note
    const today = new Date().toISOString().split("T")[0];
    await store.appendDailyNote(
      { time: "10:00", source: "test", title: "Recent note", bullets: ["keep this"] },
      today,
    );

    const archived = await store.archiveOldNotes(30);
    assertEquals(archived, 1);

    // Old note should be gone from daily/
    const oldContent = await store.readDailyNote(oldDateStr);
    assertEquals(oldContent, "");

    // Recent note should still exist
    const recentContent = await store.readDailyNote(today);
    assertStringIncludes(recentContent, "keep this");

    // Archive file should exist
    const archiveContent = await Deno.readTextFile(`${tmpDir}/archive/${oldMonth}.md`);
    assertStringIncludes(archiveContent, "archived content");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// Entities
// ──────────────────────────────────────────────

Deno.test("MemoryStore - trackEntity creates entities file and appends", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.trackEntity("Alice", "Project lead for ContainerClaw");
    await store.trackEntity("Bob", "Backend developer");

    const content = await Deno.readTextFile(`${tmpDir}/entities/ENTITIES.md`);
    assertStringIncludes(content, "# Entities");
    assertStringIncludes(content, "**Alice**");
    assertStringIncludes(content, "**Bob**");
    assertStringIncludes(content, "Project lead");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// Directory Setup
// ──────────────────────────────────────────────

Deno.test("MemoryStore - ensureDirectories creates all required directories", async () => {
  const tmpDir = await Deno.makeTempDir();
  const memDir = `${tmpDir}/memory`;
  try {
    const store = new MemoryStore(memDir);
    await store.ensureDirectories();

    // Verify directories exist
    const dailyStat = await Deno.stat(`${memDir}/daily`);
    assertEquals(dailyStat.isDirectory, true);
    const learningsStat = await Deno.stat(`${memDir}/learnings`);
    assertEquals(learningsStat.isDirectory, true);
    const tasksStat = await Deno.stat(`${memDir}/tasks`);
    assertEquals(tasksStat.isDirectory, true);
    const entitiesStat = await Deno.stat(`${memDir}/entities`);
    assertEquals(entitiesStat.isDirectory, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// Weekly Synthesis Input
// ──────────────────────────────────────────────

Deno.test("MemoryStore - getWeeklySynthesisInput returns memory and weekly notes", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.writeLongTerm("Existing memory content");

    const today = new Date().toISOString().split("T")[0];
    await store.appendDailyNote(
      { time: "10:00", source: "test", title: "Today's work", bullets: ["Did something important"] },
      today,
    );

    const { existingMemory, weeklyNotes } = await store.getWeeklySynthesisInput();
    assertStringIncludes(existingMemory, "Existing memory content");
    assertStringIncludes(weeklyNotes, "Did something important");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// appendDailyRaw
// ──────────────────────────────────────────────

Deno.test("MemoryStore - appendDailyRaw creates entry with title from first line", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendDailyRaw("User asked about weather\nAssistant: It's sunny", "cli:123", "2026-01-15");
    const content = await store.readDailyNote("2026-01-15");
    assertStringIncludes(content, "User asked about weather");
    assertStringIncludes(content, "- Assistant: It's sunny");
    // Title line should NOT appear as a bullet (P0 fix #3)
    const bullets = content.split("\n").filter((l) => l.startsWith("- "));
    assertEquals(bullets.length, 1); // Only "Assistant: It's sunny"
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - appendDailyRaw handles single-line text", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendDailyRaw("Single line message", "test:1", "2026-01-15");
    const content = await store.readDailyNote("2026-01-15");
    assertStringIncludes(content, "Single line message");
    // No bullets since the only line is the title
    const bullets = content.split("\n").filter((l) => l.startsWith("- "));
    assertEquals(bullets.length, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// readToday
// ──────────────────────────────────────────────

Deno.test("MemoryStore - readToday returns today's note", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    const today = new Date().toISOString().split("T")[0];
    await store.appendDailyNote(
      { time: "09:00", source: "test", title: "Morning work", bullets: ["Started coding"] },
      today,
    );
    const content = await store.readToday();
    assertStringIncludes(content, "Morning work");
    assertStringIncludes(content, "Started coding");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - readToday returns empty when no note exists", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    const content = await store.readToday();
    assertEquals(content, "");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// saveTask
// ──────────────────────────────────────────────

Deno.test("MemoryStore - saveTask creates task file", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.ensureDirectories();
    await store.saveTask("deploy-v2", "# Deploy v2\n\nRolled out to staging");
    const content = await Deno.readTextFile(`${tmpDir}/tasks/deploy-v2.md`);
    assertStringIncludes(content, "Deploy v2");
    assertStringIncludes(content, "Rolled out to staging");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// saveLearning append behavior (P2 fix #12)
// ──────────────────────────────────────────────

Deno.test("MemoryStore - saveLearning appends update to existing topic", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.saveLearning({
      topic: "Auth Pattern",
      learned: "2026-01-10",
      source: "observation",
      content: "Use JWT tokens for API auth",
    });
    await store.saveLearning({
      topic: "Auth Pattern",
      learned: "2026-01-15",
      source: "correction",
      content: "Actually use short-lived JWTs with refresh tokens",
    });

    // Read raw file to verify append
    const raw = await Deno.readTextFile(`${tmpDir}/learnings/auth-pattern.md`);
    assertStringIncludes(raw, "Use JWT tokens for API auth");
    assertStringIncludes(raw, "Actually use short-lived JWTs with refresh tokens");
    assertStringIncludes(raw, "---"); // Separator between original and update
    assertStringIncludes(raw, "**Updated**: 2026-01-15");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// atomicWrite (tested through writeLongTerm)
// ──────────────────────────────────────────────

Deno.test("MemoryStore - writeLongTerm uses atomic write (no .tmp file left behind)", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.writeLongTerm("Test content for atomic write");
    const content = await store.readLongTerm();
    assertEquals(content, "Test content for atomic write");

    // Verify no .tmp file is left behind
    let tmpExists = false;
    try {
      await Deno.stat(`${tmpDir}/MEMORY.md.tmp`);
      tmpExists = true;
    } catch {
      // Expected: .tmp should not exist after successful write
    }
    assertEquals(tmpExists, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// recall with index auto-rebuild
// ──────────────────────────────────────────────

Deno.test("MemoryStore - recall auto-rebuilds index after appendDailyNote", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    // Write a daily note — this invalidates the index cache
    await store.appendDailyNote(
      { time: "10:00", source: "test", title: "OAuth discussion", bullets: ["Implemented OAuth2 flow", "Used PKCE for SPA"] },
      "2026-02-19",
    );
    // recall should auto-rebuild and find the content
    const results = await store.recall("OAuth");
    assertEquals(results.length > 0, true);
    assertStringIncludes(results[0].content, "OAuth2");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// recencyBoost with invalid dates (tested through recall scoring)
// ──────────────────────────────────────────────

Deno.test("MemoryStore - recall handles entries with invalid dates gracefully", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    // Manually create a daily note with an unusual date folder name
    await Deno.mkdir(`${tmpDir}/daily`, { recursive: true });
    await Deno.writeTextFile(`${tmpDir}/daily/not-a-date.md`, `# not-a-date\n\n## [10:00] [test] Deploy discussion\n- Set up deploy pipeline\n`);
    // Should not throw — NaN guard in recencyBoost handles this
    const results = await store.recall("deploy");
    // Should find the result but with a low recency score
    assertEquals(results.length > 0, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// scoreMatch substring behavior (tested through recall)
// ──────────────────────────────────────────────

Deno.test("MemoryStore - recall does not match unrelated entries", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.appendDailyNote(
      { time: "10:00", source: "test", title: "Weather chat", bullets: ["It's sunny today", "No rain expected"] },
      "2026-02-19",
    );
    // Searching for completely unrelated terms should return nothing
    const results = await store.recall("kubernetes docker containers");
    assertEquals(results.length, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// rebuildIndex indexes learning content in index
// ──────────────────────────────────────────────

Deno.test("MemoryStore - rebuildIndex includes learning content and tags in index", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.saveLearning({
      topic: "API Design",
      learned: "2026-02-19",
      source: "observation",
      content: "Always version REST APIs with /v1/ prefix in the URL path",
    });
    const index = await store.rebuildIndex();
    assertEquals(index.learnings.length, 1);
    assertEquals(index.learnings[0].topic, "API Design");
    assertStringIncludes(index.learnings[0].content, "version REST APIs");
    assertEquals(index.learnings[0].source, "observation");
    assertEquals(Array.isArray(index.learnings[0].tags), true);
    assertEquals(index.learnings[0].tags.length > 0, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// recall finds learnings from index (no extra disk I/O)
// ──────────────────────────────────────────────

Deno.test("MemoryStore - recall finds learnings via index without extra disk reads", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await store.saveLearning({
      topic: "Git Workflow",
      learned: "2026-02-19",
      source: "correction",
      content: "Always rebase feature branches before merging to main. Avoid merge commits.",
    });
    // Force index rebuild
    await store.rebuildIndex();

    const results = await store.recall("rebase merge");
    assertEquals(results.length > 0, true);
    assertEquals(results[0].type, "learning");
    assertStringIncludes(results[0].content, "Git Workflow");
    assertStringIncludes(results[0].content, "rebase");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// getRelevantContext budget enforcement
// ──────────────────────────────────────────────

Deno.test("MemoryStore - getRelevantContext respects character budget", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    // Write a large MEMORY.md
    await store.writeLongTerm("X".repeat(5000));
    // Write several learnings
    for (let i = 0; i < 10; i++) {
      await store.saveLearning({
        topic: `Topic ${i}`,
        learned: "2026-02-19",
        source: "test",
        content: `Learning content number ${i} ` + "Y".repeat(200),
      });
    }

    const context = await store.getRelevantContext("test query", 2000);
    // Total should be within a reasonable range of the budget
    // (each section can be up to its allocation, but empty sections don't count)
    assertEquals(context.length < 3000, true); // Some overhead for section headers
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// slugify behavior (tested through saveLearning file path)
// ──────────────────────────────────────────────

Deno.test("MemoryStore - saveLearning slugifies topic for filename", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    const path = await store.saveLearning({
      topic: "OAuth 2.0 & PKCE Flow!!!",
      learned: "2026-02-19",
      source: "test",
      content: "Use PKCE for single-page apps. Never store client secrets in the browser.",
    });
    assertStringIncludes(path, "oauth-2-0-pkce-flow");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ──────────────────────────────────────────────
// parseLearningFile edge cases (tested through readLearnings)
// ──────────────────────────────────────────────

Deno.test("MemoryStore - readLearnings handles malformed learning file gracefully", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await Deno.mkdir(`${tmpDir}/learnings`, { recursive: true });
    // Write a malformed file with no metadata
    await Deno.writeTextFile(`${tmpDir}/learnings/weird-file.md`, "Just some random text\nwithout any metadata\n");
    const learnings = await store.readLearnings();
    assertEquals(learnings.length, 1);
    assertEquals(learnings[0].topic, "Just some random text");
    assertEquals(learnings[0].source, "unknown");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("MemoryStore - readLearnings handles empty learning file", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const store = new MemoryStore(tmpDir);
    await Deno.mkdir(`${tmpDir}/learnings`, { recursive: true });
    await Deno.writeTextFile(`${tmpDir}/learnings/empty.md`, "");
    const learnings = await store.readLearnings();
    assertEquals(learnings.length, 1);
    // Should use filename as topic fallback
    assertEquals(learnings[0].topic, "empty");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
