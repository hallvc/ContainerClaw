import { assertEquals } from "@std/assert";
import { SessionManager } from "./manager.ts";

Deno.test("SessionManager - create, update, save, reload", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const mgr = new SessionManager(tmpDir);
    const session = mgr.getOrCreate("test:chat1");
    assertEquals(session.messages.length, 0);

    session.addMessage("user", "hello");
    session.addMessage("assistant", "hi there");
    assertEquals(session.messages.length, 2);

    mgr.save(session);

    // Reload from disk
    mgr.invalidate("test:chat1");
    const reloaded = mgr.getOrCreate("test:chat1");
    assertEquals(reloaded.messages.length, 2);
    assertEquals(reloaded.messages[0].content, "hello");
    assertEquals(reloaded.messages[1].content, "hi there");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SessionManager - getHistory returns limited messages", () => {
  const mgr = new SessionManager("/tmp/test-sessions-" + Date.now());
  const session = mgr.getOrCreate("test:hist");
  for (let i = 0; i < 10; i++) {
    session.addMessage("user", `msg ${i}`);
  }
  const history = session.getHistory(3);
  assertEquals(history.length, 3);
  assertEquals(history[0].content, "msg 7");
});

Deno.test("SessionManager - clear resets messages", () => {
  const mgr = new SessionManager("/tmp/test-sessions-" + Date.now());
  const session = mgr.getOrCreate("test:clear");
  session.addMessage("user", "hello");
  assertEquals(session.messages.length, 1);
  session.clear();
  assertEquals(session.messages.length, 0);
});

// Cycle 1: metadata field
Deno.test("SessionManager - session has metadata defaulting to empty object", () => {
  const mgr = new SessionManager("/tmp/test-sessions-" + Date.now());
  const session = mgr.getOrCreate("test:meta");
  assertEquals(session.metadata, {});
});

Deno.test("SessionManager - metadata persists through save/reload", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const mgr = new SessionManager(tmpDir);
    const session = mgr.getOrCreate("test:meta2");
    session.metadata.userName = "Alice";
    session.metadata.preference = "dark";
    mgr.save(session);

    mgr.invalidate("test:meta2");
    const reloaded = mgr.getOrCreate("test:meta2");
    assertEquals(reloaded.metadata.userName, "Alice");
    assertEquals(reloaded.metadata.preference, "dark");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// Cycle 3: JSONL storage format
Deno.test("SessionManager - saves in JSONL format with metadata header", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const mgr = new SessionManager(tmpDir);
    const session = mgr.getOrCreate("test:jsonl");
    session.addMessage("user", "hello");
    session.addMessage("assistant", "world");
    session.metadata.tag = "test";
    mgr.save(session);

    // Read raw file - should be .jsonl
    const filePath = `${tmpDir}/sessions/test_jsonl.jsonl`;
    const raw = await Deno.readTextFile(filePath);
    const lines = raw.trim().split("\n");

    // First line is metadata header
    assertEquals(lines.length, 3); // 1 metadata + 2 messages
    const meta = JSON.parse(lines[0]);
    assertEquals(meta._type, "metadata");
    assertEquals(typeof meta.created_at, "string");
    assertEquals(typeof meta.updated_at, "string");
    assertEquals(meta.metadata.tag, "test");
    assertEquals(meta.last_consolidated, 0);

    // Subsequent lines are messages
    const msg1 = JSON.parse(lines[1]);
    assertEquals(msg1.role, "user");
    assertEquals(msg1.content, "hello");
    assertEquals(typeof msg1.timestamp, "string");

    const msg2 = JSON.parse(lines[2]);
    assertEquals(msg2.role, "assistant");
    assertEquals(msg2.content, "world");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SessionManager - JSONL round-trip preserves all fields", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const mgr = new SessionManager(tmpDir);
    const session = mgr.getOrCreate("test:roundtrip");
    session.addMessage("user", "question");
    session.addMessage("assistant", "answer", ["web_search"]);
    session.metadata.context = "testing";
    session.lastConsolidated = 1;
    mgr.save(session);

    mgr.invalidate("test:roundtrip");
    const reloaded = mgr.getOrCreate("test:roundtrip");
    assertEquals(reloaded.key, "test:roundtrip");
    assertEquals(reloaded.messages.length, 2);
    assertEquals(reloaded.messages[0].role, "user");
    assertEquals(reloaded.messages[0].content, "question");
    assertEquals(reloaded.messages[1].toolsUsed, ["web_search"]);
    assertEquals(reloaded.lastConsolidated, 1);
    assertEquals(reloaded.metadata.context, "testing");
    assertEquals(typeof reloaded.createdAt, "string");
    assertEquals(typeof reloaded.updatedAt, "string");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// Cycle 4: Legacy .json migration fallback
Deno.test("SessionManager - migrates legacy .json files to .jsonl", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    // Write a legacy .json file manually
    const sessionsDir = `${tmpDir}/sessions`;
    await Deno.mkdir(sessionsDir, { recursive: true });
    const legacyData = {
      key: "test:legacy",
      messages: [
        { role: "user", content: "old msg", timestamp: "2025-01-01T00:00:00.000Z" },
      ],
      lastConsolidated: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      metadata: { source: "legacy" },
    };
    await Deno.writeTextFile(
      `${sessionsDir}/test_legacy.json`,
      JSON.stringify(legacyData, null, 2),
    );

    // Load via SessionManager - should find the .json fallback
    const mgr = new SessionManager(tmpDir);
    const session = mgr.getOrCreate("test:legacy");
    assertEquals(session.messages.length, 1);
    assertEquals(session.messages[0].content, "old msg");
    assertEquals(session.metadata.source, "legacy");

    // Save should write .jsonl and remove .json
    mgr.save(session);

    // .jsonl should exist
    const jsonlExists = await Deno.stat(`${sessionsDir}/test_legacy.jsonl`)
      .then(() => true)
      .catch(() => false);
    assertEquals(jsonlExists, true);

    // .json should be removed
    const jsonExists = await Deno.stat(`${sessionsDir}/test_legacy.json`)
      .then(() => true)
      .catch(() => false);
    assertEquals(jsonExists, false);

    // Reload from .jsonl should work
    mgr.invalidate("test:legacy");
    const reloaded = mgr.getOrCreate("test:legacy");
    assertEquals(reloaded.messages.length, 1);
    assertEquals(reloaded.messages[0].content, "old msg");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// Cycle 5: listSessions()
Deno.test("SessionManager - listSessions returns all sessions sorted by updatedAt", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const mgr = new SessionManager(tmpDir);

    // Create sessions with staggered timestamps
    const s1 = mgr.getOrCreate("slack:chan1");
    s1.addMessage("user", "first");
    mgr.save(s1);

    // Small delay to ensure different updatedAt
    await new Promise((r) => setTimeout(r, 10));

    const s2 = mgr.getOrCreate("slack:chan2");
    s2.addMessage("user", "second");
    mgr.save(s2);

    await new Promise((r) => setTimeout(r, 10));

    const s3 = mgr.getOrCreate("telegram:user1");
    s3.addMessage("user", "third");
    mgr.save(s3);

    const sessions = mgr.listSessions();
    assertEquals(sessions.length, 3);

    // Most recent first
    assertEquals(sessions[0].key, "telegram:user1");
    assertEquals(sessions[1].key, "slack:chan2");
    assertEquals(sessions[2].key, "slack:chan1");

    // Each has required fields
    for (const s of sessions) {
      assertEquals(typeof s.createdAt, "string");
      assertEquals(typeof s.updatedAt, "string");
      assertEquals(typeof s.path, "string");
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// Cycle 6: addMessage() extras parameter
Deno.test("SessionManager - addMessage accepts extras parameter", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const mgr = new SessionManager(tmpDir);
    const session = mgr.getOrCreate("test:extras");

    // Existing behavior still works
    session.addMessage("user", "hello");
    session.addMessage("assistant", "response", ["web_search"]);

    // New extras parameter
    session.addMessage("assistant", "detailed", undefined, { model: "gpt-4", tokens: 150 });

    assertEquals(session.messages.length, 3);
    assertEquals(session.messages[2].content, "detailed");
    // deno-lint-ignore no-explicit-any
    assertEquals((session.messages[2] as any).model, "gpt-4");
    // deno-lint-ignore no-explicit-any
    assertEquals((session.messages[2] as any).tokens, 150);

    // Extras persist through save/reload
    mgr.save(session);
    mgr.invalidate("test:extras");
    const reloaded = mgr.getOrCreate("test:extras");
    // deno-lint-ignore no-explicit-any
    assertEquals((reloaded.messages[2] as any).model, "gpt-4");
    // deno-lint-ignore no-explicit-any
    assertEquals((reloaded.messages[2] as any).tokens, 150);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// Cycle 7: save() updates cache
Deno.test("SessionManager - save updates in-memory cache", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const mgr = new SessionManager(tmpDir);
    const session = mgr.getOrCreate("test:cache");
    session.addMessage("user", "hello");
    mgr.save(session);

    // Get again WITHOUT invalidating - should return cached version with message
    const cached = mgr.getOrCreate("test:cache");
    assertEquals(cached.messages.length, 1);
    assertEquals(cached.messages[0].content, "hello");

    // Verify it's the same object reference (cache hit)
    session.addMessage("user", "world");
    mgr.save(session);
    const cached2 = mgr.getOrCreate("test:cache");
    assertEquals(cached2.messages.length, 2);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// Cycle 2: clear resets lastConsolidated
Deno.test("SessionManager - clear resets lastConsolidated to 0", () => {
  const mgr = new SessionManager("/tmp/test-sessions-" + Date.now());
  const session = mgr.getOrCreate("test:consol");
  for (let i = 0; i < 10; i++) {
    session.addMessage("user", `msg ${i}`);
  }
  session.lastConsolidated = 5;
  session.clear();
  assertEquals(session.lastConsolidated, 0);
  assertEquals(session.messages.length, 0);
});
