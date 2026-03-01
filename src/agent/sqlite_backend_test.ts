import { assertEquals, assert, assertGreater } from "@std/assert";
import { join } from "@std/path";
import { SqliteSearchBackend } from "./sqlite_backend.ts";
import type { IndexFact, IndexEntity, IndexLearning } from "./memory.ts";

/** Create a temp directory and return its path and a cleanup function */
async function makeTempEnv(): Promise<{ dir: string; dbPath: string; cleanup: () => Promise<void> }> {
  const dir = await Deno.makeTempDir({ prefix: "sqlite_backend_test_" });
  const dbPath = join(dir, "test.db");
  return {
    dir,
    dbPath,
    cleanup: async () => {
      try { await Deno.remove(dir, { recursive: true }); } catch { /* ok */ }
    },
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function makeFacts(overrides?: Partial<IndexFact>[]): IndexFact[] {
  const defaults: IndexFact[] = [
    { id: "f1", content: "Fixed authentication bug in login flow", source: "slack", date: today(), file: "daily/today.md", tags: ["authentication", "bug", "login"] },
    { id: "f2", content: "Deployed new caching layer to production", source: "telegram", date: today(), file: "daily/today.md", tags: ["caching", "deployment", "production"] },
    { id: "f3", content: "Reviewed pull request for database migration", source: "github", date: daysAgo(5), file: "daily/5daysago.md", tags: ["database", "migration", "review"] },
    { id: "f4", content: "Discussed authentication improvements in standup", source: "meeting", date: daysAgo(20), file: "daily/20daysago.md", tags: ["authentication", "standup"] },
    { id: "f5", content: "Old deployment of the monitoring dashboard", source: "email", date: daysAgo(45), file: "daily/45daysago.md", tags: ["deployment", "monitoring"] },
  ];
  if (overrides) {
    for (let i = 0; i < overrides.length && i < defaults.length; i++) {
      Object.assign(defaults[i], overrides[i]);
    }
  }
  return defaults;
}

function makeLearnings(): IndexLearning[] {
  return [
    { topic: "SQLite FTS5", file: "learnings/sqlite.md", date: "SQLite FTS5", content: "FTS5 provides BM25 ranking for full-text search in SQLite databases", source: "documentation", tags: ["sqlite", "fts5", "search"] },
    { topic: "Deno Permissions", file: "learnings/deno.md", date: "Deno Permissions", content: "Deno requires explicit permissions for file system and network access", source: "deno docs", tags: ["deno", "permissions", "security"] },
  ];
}

function makeEntities(): IndexEntity[] {
  return [
    { name: "Alice", type: "person", mentions: 5, lastSeen: today() },
    { name: "ContainerClaw", type: "project", mentions: 12, lastSeen: today() },
  ];
}

// --- Tests ---

Deno.test("constructor creates DB and schema", async () => {
  const { dbPath, dir, cleanup } = await makeTempEnv();
  try {
    const backend = new SqliteSearchBackend(dbPath, dir);
    // Verify DB file exists
    const stat = await Deno.stat(dbPath);
    assert(stat.isFile, "DB file should exist");
    backend.close();
  } finally {
    await cleanup();
  }
});

Deno.test("index() with facts, learnings, entities — data is searchable", async () => {
  const { dbPath, dir, cleanup } = await makeTempEnv();
  try {
    const backend = new SqliteSearchBackend(dbPath, dir);
    await backend.index(makeFacts(), makeEntities(), makeLearnings());

    const results = await backend.search("authentication");
    assertGreater(results.length, 0, "Should find results for 'authentication'");
    // Verify result shape
    const r = results[0];
    assert(r.id, "Result should have an id");
    assert(r.content, "Result should have content");
    assert(r.score > 0, "Result should have a positive score");
    assert(r.type === "daily" || r.type === "learning", "Result should have a valid type");
    backend.close();
  } finally {
    await cleanup();
  }
});

Deno.test("search() returns ranked results", async () => {
  const { dbPath, dir, cleanup } = await makeTempEnv();
  try {
    const backend = new SqliteSearchBackend(dbPath, dir);
    await backend.index(makeFacts(), makeEntities(), makeLearnings());

    const results = await backend.search("authentication", { limit: 5 });
    assertGreater(results.length, 0, "Should have results");
    // Verify scores are in descending order
    for (let i = 1; i < results.length; i++) {
      assert(results[i - 1].score >= results[i].score, "Results should be sorted by score descending");
    }
    backend.close();
  } finally {
    await cleanup();
  }
});

Deno.test("search() with type filter", async () => {
  const { dbPath, dir, cleanup } = await makeTempEnv();
  try {
    const backend = new SqliteSearchBackend(dbPath, dir);
    await backend.index(makeFacts(), makeEntities(), makeLearnings());

    // Search only learnings
    const learningResults = await backend.search("search", { type: "learning" });
    for (const r of learningResults) {
      assertEquals(r.type, "learning", "Filtered results should all be learnings");
    }

    // Search only daily
    const dailyResults = await backend.search("authentication", { type: "daily" });
    for (const r of dailyResults) {
      assertEquals(r.type, "daily", "Filtered results should all be daily");
    }
    backend.close();
  } finally {
    await cleanup();
  }
});

Deno.test("searchWithRecency() applies recency decay to daily facts", async () => {
  const { dbPath, dir, cleanup } = await makeTempEnv();
  try {
    const backend = new SqliteSearchBackend(dbPath, dir);
    // Create facts with identical content but different dates
    const facts: IndexFact[] = [
      { id: "recent", content: "authentication system update performed", source: "slack", date: today(), file: "daily/today.md", tags: ["authentication"] },
      { id: "old", content: "authentication system update performed", source: "slack", date: daysAgo(25), file: "daily/25daysago.md", tags: ["authentication"] },
    ];
    await backend.index(facts, [], []);

    const results = await backend.searchWithRecency("authentication", { limit: 10 });
    assertGreater(results.length, 0, "Should find results");

    // The recent fact should score higher than the old one after recency boost
    if (results.length >= 2) {
      const recentResult = results.find((r) => r.date === today());
      const oldResult = results.find((r) => r.date === daysAgo(25));
      if (recentResult && oldResult) {
        assertGreater(recentResult.score, oldResult.score, "Recent fact should score higher with recency decay");
      }
    }
    backend.close();
  } finally {
    await cleanup();
  }
});

Deno.test("searchWithRecency() gives learnings 1.5x boost WITHOUT recency decay", async () => {
  const { dbPath, dir, cleanup } = await makeTempEnv();
  try {
    const backend = new SqliteSearchBackend(dbPath, dir);
    // Create a learning and an identical old daily fact
    const facts: IndexFact[] = [
      { id: "old-daily", content: "sqlite database optimization techniques", source: "slack", date: daysAgo(29), file: "daily/old.md", tags: ["sqlite", "database"] },
    ];
    const learnings: IndexLearning[] = [
      { topic: "SQLite Optimization", file: "learnings/sqlite.md", date: "SQLite Optimization", content: "sqlite database optimization techniques", source: "docs", tags: ["sqlite", "database"] },
    ];
    await backend.index(facts, [], learnings);

    const results = await backend.searchWithRecency("sqlite database", { limit: 10 });
    assertGreater(results.length, 0, "Should find results");

    const learningResult = results.find((r) => r.type === "learning");
    const dailyResult = results.find((r) => r.type === "daily");

    if (learningResult && dailyResult) {
      // Learning gets 1.5x flat boost; old daily gets severe recency decay (~0.33)
      // So learning should rank higher
      assertGreater(learningResult.score, dailyResult.score, "Learning should score higher than old daily fact");
    }
    backend.close();
  } finally {
    await cleanup();
  }
});

Deno.test("isStale() returns true when no index exists", async () => {
  const { dbPath, dir, cleanup } = await makeTempEnv();
  try {
    const backend = new SqliteSearchBackend(dbPath, dir);
    const stale = await backend.isStale(["/some/file.md"]);
    assertEquals(stale, true, "Should be stale when never indexed");
    backend.close();
  } finally {
    await cleanup();
  }
});

Deno.test("isStale() returns false after indexing", async () => {
  const { dbPath, dir, cleanup } = await makeTempEnv();
  try {
    const backend = new SqliteSearchBackend(dbPath, dir);
    await backend.index(makeFacts(), makeEntities(), makeLearnings());

    // Create a file that is older than the index
    const testFile = join(dir, "old_file.md");
    await Deno.writeTextFile(testFile, "test content");
    // Touch it to a time in the past
    const pastTime = new Date(Date.now() - 60000);
    await Deno.utime(testFile, pastTime, pastTime);

    // Small delay to ensure index timestamp is after file mtime
    await new Promise((r) => setTimeout(r, 50));
    await backend.index(makeFacts(), makeEntities(), makeLearnings());

    const stale = await backend.isStale([testFile]);
    assertEquals(stale, false, "Should not be stale after fresh index");
    backend.close();
  } finally {
    await cleanup();
  }
});

Deno.test("empty query returns empty results", async () => {
  const { dbPath, dir, cleanup } = await makeTempEnv();
  try {
    const backend = new SqliteSearchBackend(dbPath, dir);
    await backend.index(makeFacts(), makeEntities(), makeLearnings());

    const empty1 = await backend.search("");
    assertEquals(empty1.length, 0, "Empty string should return no results");

    const empty2 = await backend.search("   ");
    assertEquals(empty2.length, 0, "Whitespace-only should return no results");
    backend.close();
  } finally {
    await cleanup();
  }
});

Deno.test("corrupt DB recovery — write garbage, constructor should recreate", async () => {
  const { dbPath, dir, cleanup } = await makeTempEnv();
  try {
    // Write garbage to DB file
    await Deno.writeTextFile(dbPath, "this is not a valid sqlite database at all!!!###");

    // Constructor should detect corruption and recreate
    const backend = new SqliteSearchBackend(dbPath, dir);

    // Should be functional after recovery
    await backend.index(makeFacts(), makeEntities(), makeLearnings());
    const results = await backend.search("authentication");
    assertGreater(results.length, 0, "Should work after corruption recovery");
    backend.close();
  } finally {
    await cleanup();
  }
});

Deno.test("close() works without error", async () => {
  const { dbPath, dir, cleanup } = await makeTempEnv();
  try {
    const backend = new SqliteSearchBackend(dbPath, dir);
    backend.close();
    // Double close should also not throw
    backend.close();
  } finally {
    await cleanup();
  }
});

Deno.test("indexFromFiles() reads and indexes markdown files from a temp directory", async () => {
  const { dbPath, dir, cleanup } = await makeTempEnv();
  try {
    // Set up a fake data directory structure
    const dataDir = join(dir, "data");
    await Deno.mkdir(join(dataDir, "daily"), { recursive: true });
    await Deno.mkdir(join(dataDir, "learnings"), { recursive: true });

    // Write a daily note
    await Deno.writeTextFile(join(dataDir, "daily", "2026-02-15.md"), `# 2026-02-15

## [10:00] [slack] Morning standup
- Fixed the authentication bug
- Deployed to staging
`);

    // Write a learning
    await Deno.writeTextFile(join(dataDir, "learnings", "docker.md"), `# Docker Tips

**Source**: official docs
**Learned**: 2026-02-10

Use multi-stage builds to reduce image size.

---

# Kubernetes Basics

**Source**: k8s docs

Pods are the smallest deployable units.
`);

    // Write MEMORY.md
    await Deno.writeTextFile(join(dataDir, "MEMORY.md"), `# Project Memory

## Key Preferences
User prefers TypeScript over JavaScript.

## Architecture
The system uses a modular plugin architecture.
`);

    const backend = new SqliteSearchBackend(dbPath, dataDir);
    await backend.indexFromFiles();

    // Verify daily notes are searchable
    const dailyResults = await backend.search("authentication");
    assertGreater(dailyResults.length, 0, "Should find daily note content");

    // Verify learnings are searchable
    const learningResults = await backend.search("docker");
    assertGreater(learningResults.length, 0, "Should find learning content");

    // Verify memory is searchable
    const memoryResults = await backend.search("TypeScript");
    assertGreater(memoryResults.length, 0, "Should find memory content");

    backend.close();
  } finally {
    await cleanup();
  }
});
