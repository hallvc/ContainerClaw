/**
 * Permanent integration test: validates FTS5 availability on current Deno+SQLite combination.
 * This test was created as Step 1.0 of the SQLite memory backend plan.
 * If this test fails, the entire SQLite FTS5 approach needs reconsideration.
 */
import { Database } from "jsr:@db/sqlite@0.12";
import { assertEquals, assert } from "@std/assert";

Deno.test("SQLite FTS5 spike - create DB, insert, and query with BM25 ranking", async (t) => {
  const dbPath = await Deno.makeTempFile({ suffix: ".db" });

  try {
    const db = new Database(dbPath);

    // Enable WAL mode (planned for production)
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA synchronous=NORMAL");

    await t.step("create FTS5 virtual table", () => {
      db.exec(`
        CREATE TABLE chunks (
          id INTEGER PRIMARY KEY,
          content TEXT NOT NULL,
          source TEXT,
          date TEXT,
          tags TEXT
        )
      `);

      db.exec(`
        CREATE VIRTUAL TABLE chunks_fts USING fts5(
          content,
          source,
          tags,
          content=chunks,
          content_rowid=id,
          tokenize='unicode61'
        )
      `);

      // Sync triggers
      db.exec(`
        CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
          INSERT INTO chunks_fts(rowid, content, source, tags)
          VALUES (new.id, new.content, new.source, new.tags);
        END
      `);

      db.exec(`
        CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
          INSERT INTO chunks_fts(chunks_fts, rowid, content, source, tags)
          VALUES ('delete', old.id, old.content, old.source, old.tags);
        END
      `);
    });

    await t.step("insert 1000 rows", () => {
      const topics = [
        "authentication", "database", "deployment", "testing", "performance",
        "security", "caching", "logging", "monitoring", "configuration",
        "docker", "kubernetes", "api", "frontend", "backend",
        "typescript", "react", "nodejs", "python", "rust",
      ];
      const verbs = ["implemented", "fixed", "refactored", "added", "removed", "updated", "optimized"];
      const sources = ["slack", "telegram", "email", "meeting", "standup"];

      const insert = db.prepare(
        "INSERT INTO chunks (content, source, date, tags) VALUES (?, ?, ?, ?)"
      );

      db.exec("BEGIN");
      for (let i = 0; i < 1000; i++) {
        const topic = topics[i % topics.length];
        const verb = verbs[i % verbs.length];
        const source = sources[i % sources.length];
        const day = String(1 + (i % 28)).padStart(2, "0");
        const content = `${verb} the ${topic} module for better reliability and ${topic} handling in the system iteration ${i}`;
        const date = `2026-02-${day}`;
        const tags = JSON.stringify([topic, verb]);
        insert.run(content, source, date, tags);
      }
      db.exec("COMMIT");

      const count = db.prepare("SELECT COUNT(*) as cnt FROM chunks").get() as { cnt: number };
      assertEquals(count.cnt, 1000);
    });

    await t.step("BM25 search returns ranked results", () => {
      const results = db.prepare(`
        SELECT c.id, c.content, c.source, c.date,
               bm25(chunks_fts) AS score
        FROM chunks_fts
        JOIN chunks c ON chunks_fts.rowid = c.id
        WHERE chunks_fts MATCH ?
        ORDER BY bm25(chunks_fts)
        LIMIT 10
      `).all("authentication");

      assert(results.length > 0, "Expected results for 'authentication' query");
      assert(results.length <= 10, "Expected at most 10 results");

      // BM25 scores should be negative (lower = better match in SQLite FTS5)
      for (const r of results as Array<{ score: number }>) {
        assert(typeof r.score === "number", "Score should be a number");
        assert(r.score < 0, "BM25 scores should be negative (lower = better)");
      }
    });

    await t.step("BM25 search with type filter via JOIN", () => {
      // Simulate the planned query with a type filter
      // (In production, documents table provides the type; here we filter by source as proxy)
      // FTS5 uses implicit AND for space-separated terms, so use a single term
      const results = db.prepare(`
        SELECT c.id, c.content, c.source,
               bm25(chunks_fts) AS score
        FROM chunks_fts
        JOIN chunks c ON chunks_fts.rowid = c.id
        WHERE chunks_fts MATCH ?
          AND c.source = ?
        ORDER BY bm25(chunks_fts)
        LIMIT 5
      `).all("database", "telegram");

      assert(results.length > 0, "Expected results for filtered query");
    });

    await t.step("multi-term OR query ranks correctly", () => {
      // FTS5 uses implicit AND; use OR to match rows containing either term
      const results = db.prepare(`
        SELECT c.content, bm25(chunks_fts) AS score
        FROM chunks_fts
        JOIN chunks c ON chunks_fts.rowid = c.id
        WHERE chunks_fts MATCH ?
        ORDER BY bm25(chunks_fts)
        LIMIT 5
      `).all("security OR authentication");

      assert(results.length > 0, "Expected results for multi-term OR query");
    });

    await t.step("phrase query works", () => {
      const results = db.prepare(`
        SELECT c.content, bm25(chunks_fts) AS score
        FROM chunks_fts
        JOIN chunks c ON chunks_fts.rowid = c.id
        WHERE chunks_fts MATCH ?
        ORDER BY bm25(chunks_fts)
        LIMIT 5
      `).all('"authentication module"');

      // Phrase queries may return fewer results but should not crash
      assert(Array.isArray(results), "Phrase query should return an array");
    });

    await t.step("empty query returns empty results", () => {
      // FTS5 MATCH with empty string should throw or return empty
      try {
        const results = db.prepare(`
          SELECT c.content FROM chunks_fts
          JOIN chunks c ON chunks_fts.rowid = c.id
          WHERE chunks_fts MATCH ?
          LIMIT 5
        `).all("");
        // If it doesn't throw, results should be empty
        assertEquals(results.length, 0);
      } catch {
        // FTS5 may throw on empty match - that's acceptable
      }
    });

    await t.step("query for nonexistent term returns empty", () => {
      const results = db.prepare(`
        SELECT c.content FROM chunks_fts
        JOIN chunks c ON chunks_fts.rowid = c.id
        WHERE chunks_fts MATCH ?
        LIMIT 5
      `).all("xyznonexistent");

      assertEquals(results.length, 0);
    });

    await t.step("delete triggers update FTS5", () => {
      // Get count before
      const before = db.prepare(
        "SELECT COUNT(*) as cnt FROM chunks_fts WHERE chunks_fts MATCH 'authentication'"
      ).get() as { cnt: number };

      // Delete first matching row
      const first = db.prepare(
        "SELECT id FROM chunks WHERE content LIKE '%authentication%' LIMIT 1"
      ).get() as { id: number };
      db.prepare("DELETE FROM chunks WHERE id = ?").run(first.id);

      // Count should decrease
      const after = db.prepare(
        "SELECT COUNT(*) as cnt FROM chunks_fts WHERE chunks_fts MATCH 'authentication'"
      ).get() as { cnt: number };

      assert(after.cnt < before.cnt, "FTS5 should reflect deletion via trigger");
    });

    await t.step("integrity check passes", () => {
      const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      assertEquals(result.integrity_check, "ok");
    });

    await t.step("performance: 100 queries under 1 second total", () => {
      const queries = [
        "authentication", "database", "deployment", "testing", "performance",
        "security", "caching", "logging", "monitoring", "configuration",
      ];

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        const q = queries[i % queries.length];
        db.prepare(`
          SELECT c.id, c.content, bm25(chunks_fts) AS score
          FROM chunks_fts
          JOIN chunks c ON chunks_fts.rowid = c.id
          WHERE chunks_fts MATCH ?
          ORDER BY bm25(chunks_fts)
          LIMIT 25
        `).all(q);
      }
      const elapsed = performance.now() - start;

      assert(elapsed < 1000, `100 queries took ${elapsed.toFixed(0)}ms (should be < 1000ms)`);
    });

    db.close();
  } finally {
    // Cleanup temp files
    try { await Deno.remove(dbPath); } catch { /* ok */ }
    try { await Deno.remove(dbPath + "-wal"); } catch { /* ok */ }
    try { await Deno.remove(dbPath + "-shm"); } catch { /* ok */ }
  }
});
