/**
 * SQLite FTS5-backed search backend for the memory system.
 * Implements SearchBackend using jsr:@db/sqlite with BM25 ranking
 * and recency-boosted post-processing.
 *
 * Markdown files remain the source of truth; this is a derived index.
 */

import { Database } from "jsr:@db/sqlite@0.12";
import { join } from "@std/path";
import type { IndexFact, IndexEntity, IndexLearning } from "./memory.ts";
import type { SearchBackend, SearchResult, SearchOptions, ContentType } from "./search_backend.ts";
import { chunkDailyNote, chunkLearning, chunkMemory, chunkEntity } from "./chunker.ts";

/** Individual schema statements — kept separate because triggers contain semicolons inside BEGIN...END */
const SCHEMA_STMTS: string[] = [
  "PRAGMA journal_mode=WAL",
  "PRAGMA synchronous=NORMAL",
  "PRAGMA busy_timeout=5000",
  "PRAGMA foreign_keys=ON",

  `CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    file TEXT NOT NULL UNIQUE,
    modified TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('daily', 'learning', 'memory', 'entity'))
  )`,

  `CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source TEXT,
    date TEXT CHECK(date IS NULL OR date GLOB '????-??-??'),
    tags TEXT,
    position INTEGER DEFAULT 0,
    UNIQUE(doc_id, position)
  )`,

  "CREATE INDEX IF NOT EXISTS idx_chunks_date ON chunks(date)",

  `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    source,
    tags,
    content=chunks,
    content_rowid=id,
    tokenize='unicode61'
  )`,

  `CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, content, source, tags)
    VALUES (new.id, new.content, new.source, new.tags);
  END`,

  `CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content, source, tags)
    VALUES ('delete', old.id, old.content, old.source, old.tags);
  END`,

  `CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content, source, tags)
    VALUES ('delete', old.id, old.content, old.source, old.tags);
    INSERT INTO chunks_fts(rowid, content, source, tags)
    VALUES (new.id, new.content, new.source, new.tags);
  END`,

  `CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    mentions INTEGER DEFAULT 1,
    last_seen TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Return the date string if it matches YYYY-MM-DD, otherwise null (for SQL CHECK constraint) */
function sanitizeDate(date: string | null | undefined): string | null {
  if (!date || !DATE_PATTERN.test(date)) return null;
  return date;
}

/** FTS5 operator keywords that indicate an intentional advanced query */
const FTS5_OPERATORS = /\b(AND|OR|NOT|NEAR)\b|"/;

/**
 * Sanitize a user query for safe use in FTS5 MATCH.
 * If the query contains FTS5 operators, pass it through.
 * Otherwise, tokenize on whitespace and join with OR for broad matching.
 */
function sanitizeFtsQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";

  // If the user is using FTS5 syntax, let it through
  if (FTS5_OPERATORS.test(trimmed)) return trimmed;

  // Tokenize: keep only word chars, join with OR
  const tokens = trimmed.match(/[\w]+/g);
  if (!tokens || tokens.length === 0) return "";
  if (tokens.length === 1) return tokens[0];
  return tokens.join(" OR ");
}

export class SqliteSearchBackend implements SearchBackend {
  private db: Database;

  constructor(dbPath: string, private dataDir: string) {
    this.db = this.openOrRecreate(dbPath);
  }

  /**
   * Open the database, run integrity check, and create the schema.
   * If integrity check fails, delete and recreate.
   */
  private openOrRecreate(dbPath: string): Database {
    let db: Database;
    try {
      db = new Database(dbPath);
      const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
      if (result?.integrity_check !== "ok") {
        throw new Error("integrity check failed");
      }
    } catch {
      // Close if open, delete, and recreate
      try { db!.close(); } catch { /* ignore */ }
      try { Deno.removeSync(dbPath); } catch { /* ignore */ }
      try { Deno.removeSync(dbPath + "-wal"); } catch { /* ignore */ }
      try { Deno.removeSync(dbPath + "-shm"); } catch { /* ignore */ }
      db = new Database(dbPath);
    }

    // Apply schema
    for (const stmt of SCHEMA_STMTS) {
      db.exec(stmt);
    }

    // Set user_version if not already set
    const ver = db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (ver.user_version === 0) {
      db.exec("PRAGMA user_version = 1");
    }

    return db;
  }

  /** Build/rebuild the index from parsed facts, entities, and learnings */
  async index(facts: IndexFact[], entities: IndexEntity[], learnings: IndexLearning[]): Promise<void> {
    const db = this.db;
    db.exec("BEGIN");
    try {
      // Clear existing data (full rebuild)
      db.exec("DELETE FROM chunks");
      db.exec("DELETE FROM documents");
      db.exec("DELETE FROM entities");

      const insertDoc = db.prepare(
        "INSERT INTO documents (file, modified, type) VALUES (?, ?, ?)"
      );
      const insertChunk = db.prepare(
        "INSERT INTO chunks (doc_id, content, source, date, tags, position) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const insertEntity = db.prepare(
        "INSERT OR REPLACE INTO entities (name, type, mentions, last_seen) VALUES (?, ?, ?, ?)"
      );

      // Track files we've already inserted documents for
      const fileToDocId = new Map<string, number>();
      let position = 0;

      // Index facts
      for (const fact of facts) {
        let docId = fileToDocId.get(fact.file);
        if (docId === undefined) {
          insertDoc.run(fact.file, new Date().toISOString(), "daily");
          docId = db.lastInsertRowId;
          fileToDocId.set(fact.file, docId);
          position = 0;
        }
        const tagsJson = JSON.stringify(fact.tags);
        insertChunk.run(docId, fact.content, fact.source, sanitizeDate(fact.date), tagsJson, position++);
      }

      // Index learnings
      for (const learning of learnings) {
        let docId = fileToDocId.get(learning.file);
        if (docId === undefined) {
          insertDoc.run(learning.file, new Date().toISOString(), "learning");
          docId = db.lastInsertRowId;
          fileToDocId.set(learning.file, docId);
          position = 0;
        }
        const tagsJson = JSON.stringify(learning.tags);
        // Learnings use topic as date field (no date in file) — sanitize for CHECK constraint
        insertChunk.run(docId, learning.content, learning.source, sanitizeDate(learning.date), tagsJson, position++);
      }

      // Index entities
      for (const entity of entities) {
        insertEntity.run(entity.name, entity.type, entity.mentions, entity.lastSeen);
      }

      // Update rebuild timestamp
      db.exec(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('last_rebuilt', '${new Date().toISOString()}')`
      );

      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  /**
   * Index directly from markdown files in the data directory.
   * Preferred path since it doesn't depend on the old rebuildIndex parsing.
   */
  async indexFromFiles(): Promise<void> {
    const db = this.db;
    db.exec("BEGIN");
    try {
      // Clear existing data
      db.exec("DELETE FROM chunks");
      db.exec("DELETE FROM documents");
      db.exec("DELETE FROM entities");

      const insertDoc = db.prepare(
        "INSERT INTO documents (file, modified, type) VALUES (?, ?, ?)"
      );
      const insertChunk = db.prepare(
        "INSERT INTO chunks (doc_id, content, source, date, tags, position) VALUES (?, ?, ?, ?, ?, ?)"
      );

      // Daily notes: data/memory/daily/*.md
      const dailyDir = join(this.dataDir, "daily");
      try {
        for await (const entry of Deno.readDir(dailyDir)) {
          if (!entry.isFile || !entry.name.endsWith(".md")) continue;
          const filePath = join(dailyDir, entry.name);
          const content = await Deno.readTextFile(filePath);
          const date = entry.name.replace(/\.md$/, "");

          insertDoc.run(filePath, new Date().toISOString(), "daily");
          const docId = db.lastInsertRowId;

          const chunks = chunkDailyNote(content, date);
          for (const chunk of chunks) {
            insertChunk.run(
              docId, chunk.content, chunk.source,
              sanitizeDate(chunk.date), JSON.stringify(chunk.tags), chunk.position,
            );
          }
        }
      } catch {
        // daily dir may not exist
      }

      // Learnings: data/memory/learnings/*.md
      const learningsDir = join(this.dataDir, "learnings");
      try {
        for await (const entry of Deno.readDir(learningsDir)) {
          if (!entry.isFile || !entry.name.endsWith(".md")) continue;
          const filePath = join(learningsDir, entry.name);
          const content = await Deno.readTextFile(filePath);

          insertDoc.run(filePath, new Date().toISOString(), "learning");
          const docId = db.lastInsertRowId;

          const chunks = chunkLearning(content, entry.name);
          for (const chunk of chunks) {
            insertChunk.run(
              docId, chunk.content, chunk.source,
              sanitizeDate(chunk.date), JSON.stringify(chunk.tags), chunk.position,
            );
          }
        }
      } catch {
        // learnings dir may not exist
      }

      // MEMORY.md
      const memoryPath = join(this.dataDir, "MEMORY.md");
      try {
        const content = await Deno.readTextFile(memoryPath);
        insertDoc.run(memoryPath, new Date().toISOString(), "memory");
        const docId = db.lastInsertRowId;

        const chunks = chunkMemory(content);
        for (const chunk of chunks) {
          insertChunk.run(
            docId, chunk.content, chunk.source,
            chunk.date, JSON.stringify(chunk.tags), chunk.position,
          );
        }
      } catch {
        // MEMORY.md may not exist
      }

      // Entities: data/memory/entities/ENTITIES.md
      const entitiesPath = join(this.dataDir, "entities", "ENTITIES.md");
      try {
        const content = await Deno.readTextFile(entitiesPath);
        insertDoc.run(entitiesPath, new Date().toISOString(), "entity");
        const docId = db.lastInsertRowId;

        const chunks = chunkEntity(content);
        for (const chunk of chunks) {
          insertChunk.run(
            docId, chunk.content, chunk.source,
            chunk.date, JSON.stringify(chunk.tags), chunk.position,
          );
        }
      } catch {
        // entities dir may not exist
      }

      // Update rebuild timestamp
      db.exec(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('last_rebuilt', '${new Date().toISOString()}')`
      );

      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Search with raw BM25 scoring */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const limit = options?.limit ?? 10;
    const overFetch = options?.overFetchFactor ?? 5;
    const fetchLimit = limit * overFetch;
    const typeFilter = options?.type;

    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];

    try {
      let sql: string;
      const params: (string | number)[] = [sanitized];

      if (typeFilter) {
        sql = `
          SELECT c.id, c.content, c.source, c.date, c.tags,
                 d.file, d.type,
                 bm25(chunks_fts) AS score
          FROM chunks_fts
          JOIN chunks c ON chunks_fts.rowid = c.id
          JOIN documents d ON c.doc_id = d.id
          WHERE chunks_fts MATCH ?
            AND d.type = ?
          ORDER BY bm25(chunks_fts)
          LIMIT ?
        `;
        params.push(typeFilter, fetchLimit);
      } else {
        sql = `
          SELECT c.id, c.content, c.source, c.date, c.tags,
                 d.file, d.type,
                 bm25(chunks_fts) AS score
          FROM chunks_fts
          JOIN chunks c ON chunks_fts.rowid = c.id
          JOIN documents d ON c.doc_id = d.id
          WHERE chunks_fts MATCH ?
          ORDER BY bm25(chunks_fts)
          LIMIT ?
        `;
        params.push(fetchLimit);
      }

      const rows = this.db.prepare(sql).all(...params) as Array<{
        id: number;
        content: string;
        source: string | null;
        date: string | null;
        tags: string | null;
        file: string;
        type: string;
        score: number;
      }>;

      const results: SearchResult[] = rows.map((row) => ({
        id: String(row.id),
        content: row.content,
        source: row.source ?? "unknown",
        date: row.date ?? "",
        file: row.file,
        tags: parseTags(row.tags),
        score: Math.abs(row.score), // BM25 returns negative; normalize to positive
        type: row.type as ContentType,
      }));

      // Sort by score descending (higher = better after abs)
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, limit);
    } catch {
      // FTS5 MATCH can throw on invalid syntax
      return [];
    }
  }

  /** Search with recency boost applied */
  async searchWithRecency(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const limit = options?.limit ?? 10;
    // Over-fetch more for recency re-ranking
    const overFetchOptions: SearchOptions = {
      ...options,
      limit: limit * (options?.overFetchFactor ?? 5),
      overFetchFactor: 1, // Don't double-overfetch inside search()
    };

    const results = await this.search(query, overFetchOptions);

    // Apply recency scoring
    for (const result of results) {
      if (result.type === "learning") {
        // Learnings: flat 1.5x boost, NO recency decay
        result.score = result.score * 1.5;
      } else {
        // Daily facts: apply 30-day recency decay
        const multiplier = recencyMultiplier(result.date);
        result.score = result.score * multiplier;
      }
    }

    // Sort by final score descending
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /** Check if the index is stale relative to source files */
  async isStale(files: string[]): Promise<boolean> {
    const row = this.db.prepare(
      "SELECT value FROM meta WHERE key = 'last_rebuilt'"
    ).get() as { value: string } | undefined;

    if (!row) return true; // Never built

    const lastRebuilt = new Date(row.value).getTime();
    if (isNaN(lastRebuilt)) return true;

    for (const file of files) {
      try {
        const stat = await Deno.stat(file);
        if (stat.mtime && stat.mtime.getTime() > lastRebuilt) {
          return true;
        }
      } catch {
        // File doesn't exist or can't be read — skip
      }
    }

    return false;
  }

  /** Close the database connection */
  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed or never opened
    }
  }
}

/** Parse a JSON tags string back to string array */
function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Recency multiplier: 1.0 for today, decays to 0.3 over 30 days */
function recencyMultiplier(dateStr: string): number {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 0.3;
  const now = new Date();
  const daysDiff = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff <= 0) return 1.0;
  if (daysDiff >= 30) return 0.3;
  return Math.max(0.3, 1.0 - (daysDiff / 30) * 0.7);
}
