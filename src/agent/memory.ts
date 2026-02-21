import { join } from "@std/path";

// Module-level singleton to avoid repeated allocation
const ENCODER = new TextEncoder();

// --- Types ---

export interface DailyEntry {
  time: string;
  source: string;
  title: string;
  bullets: string[];
}

export interface Learning {
  topic: string;
  learned: string;
  source: string;
  content: string;
}

export interface IndexFact {
  id: string;
  content: string;
  source: string;
  date: string;
  file: string;
  tags: string[];
}

export interface IndexEntity {
  name: string;
  type: "person" | "project" | "tool" | "place";
  mentions: number;
  lastSeen: string;
}

export interface IndexLearning {
  topic: string;
  file: string;
  date: string;
  content: string;
  source: string;
  tags: string[];
}

export interface MemoryIndex {
  version: string;
  lastRebuilt: string;
  facts: IndexFact[];
  entities: IndexEntity[];
  learnings: IndexLearning[];
}

export interface RecallResult {
  content: string;
  source: string;
  date: string;
  score: number;
  type: "daily" | "learning" | "memory";
}

// --- Helpers ---

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function timeStr(): string {
  return new Date().toISOString().split("T")[1].slice(0, 5);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Simple SHA-256 hash for content dedup */
async function contentHash(content: string): Promise<string> {
  const data = ENCODER.encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** Atomic write: write to tmp file then rename (POSIX rename is atomic) */
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = path + ".tmp";
  await Deno.writeTextFile(tmp, content);
  await Deno.rename(tmp, path);
}

/** Extract simple keyword tags from text */
function extractTags(text: string): string[] {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "used",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "out",
    "off",
    "over",
    "under",
    "again",
    "further",
    "then",
    "once",
    "that",
    "this",
    "these",
    "those",
    "and",
    "but",
    "or",
    "nor",
    "not",
    "so",
    "very",
    "just",
    "about",
    "up",
    "it",
    "its",
    "he",
    "she",
    "they",
    "them",
    "we",
    "you",
    "i",
    "me",
    "my",
    "your",
    "his",
    "her",
    "our",
    "their",
    "what",
    "which",
    "who",
    "whom",
    "when",
    "where",
    "why",
    "how",
    "all",
    "each",
    "every",
    "both",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "only",
    "own",
    "same",
    "than",
    "too",
    "also",
  ]);

  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const counts = new Map<string, number>();
  for (const w of words) {
    if (w.length < 3 || stopWords.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** BM25-inspired scoring for keyword match */
export function scoreMatch(query: string, content: string, tags: string[]): number {
  const queryTerms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (queryTerms.length === 0) return 0;

  const contentLower = content.toLowerCase();
  const tagSet = new Set(tags);
  let score = 0;

  // Pre-compile regexes once per query
  const termRegexes = queryTerms.map((t) => new RegExp(`\\b${escapeRegExp(t)}\\b`));

  for (let i = 0; i < queryTerms.length; i++) {
    // Exact tag match scores higher
    if (tagSet.has(queryTerms[i])) {
      score += 3;
    }
    // Content word-boundary match (prevents "log" matching "biology")
    if (termRegexes[i].test(contentLower)) {
      score += 1;
    }
  }

  // Normalize by query length
  return score / queryTerms.length;
}

/** Recency boost: 1.0 for today, decays over 30 days */
function recencyBoost(dateStr: string): number {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 0.3; // Default to min boost for invalid dates
  const now = new Date();
  const daysDiff = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff <= 0) return 1.0;
  if (daysDiff >= 30) return 0.3;
  return 1.0 - (daysDiff / 30) * 0.7;
}

const INDEX_VERSION = "1.1.0";

// --- MemoryStore ---

export class MemoryStore {
  private dataDir: string;
  private indexCache: MemoryIndex | null = null;
  private _dataDirReady = false;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private async ensureDataDir(): Promise<void> {
    if (this._dataDirReady) return;
    await Deno.mkdir(this.dataDir, { recursive: true });
    this._dataDirReady = true;
  }

  // ──────────────────────────────────────────────
  // Paths
  // ──────────────────────────────────────────────

  private memoryPath(): string {
    return join(this.dataDir, "MEMORY.md");
  }

  private historyPath(): string {
    return join(this.dataDir, "HISTORY.md");
  }

  private dailyDir(): string {
    return join(this.dataDir, "daily");
  }

  private dailyPath(date: string): string {
    return join(this.dailyDir(), `${date}.md`);
  }

  private learningsDir(): string {
    return join(this.dataDir, "learnings");
  }

  private learningPath(topic: string): string {
    return join(this.learningsDir(), `${slugify(topic)}.md`);
  }

  private tasksDir(): string {
    return join(this.dataDir, "tasks");
  }

  private entitiesPath(): string {
    return join(this.dataDir, "entities", "ENTITIES.md");
  }

  private indexPath(): string {
    return join(this.dataDir, ".index.json");
  }

  private versionsDir(): string {
    return join(this.dataDir, "versions");
  }

  // ──────────────────────────────────────────────
  // Legacy methods (backward compatible)
  // ──────────────────────────────────────────────

  async readLongTerm(): Promise<string> {
    try {
      return await Deno.readTextFile(this.memoryPath());
    } catch {
      return "";
    }
  }

  async writeLongTerm(content: string): Promise<void> {
    await this.ensureDataDir();
    await atomicWrite(this.memoryPath(), content);
  }

  async appendHistory(entry: string): Promise<void> {
    await this.ensureDataDir();
    const line = `[${new Date().toISOString()}] ${entry}\n`;
    await using file = await Deno.open(this.historyPath(), {
      write: true,
      create: true,
      append: true,
    });
    await file.write(ENCODER.encode(line));
  }

  async getMemoryContext(): Promise<string> {
    const memory = await this.readLongTerm();
    if (!memory.trim()) {
      return "";
    }
    return `## Long-term Memory\n\n${memory}`;
  }

  // ──────────────────────────────────────────────
  // Daily Notes
  // ──────────────────────────────────────────────

  /** Ensure the daily notes directory exists */
  private async ensureDailyDir(): Promise<void> {
    await Deno.mkdir(this.dailyDir(), { recursive: true });
  }

  /** Append an entry to today's (or specified date's) daily note */
  async appendDailyNote(entry: DailyEntry, date?: string): Promise<void> {
    await this.ensureDailyDir();
    const d = date ?? todayStr();
    const path = this.dailyPath(d);

    // Build the entry markdown
    const lines: string[] = [];
    lines.push(`\n## [${entry.time}] [${entry.source}] ${entry.title}`);
    for (const bullet of entry.bullets) {
      lines.push(`- ${bullet}`);
    }
    lines.push("");

    // Create file with header if it doesn't exist (atomic check-and-create)
    try {
      await Deno.writeTextFile(path, `# ${d}\n`, { createNew: true });
    } catch (err) {
      if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
    }

    await using file = await Deno.open(path, {
      write: true,
      append: true,
    });
    await file.write(ENCODER.encode(lines.join("\n")));
    this.indexCache = null; // Invalidate so recall() finds new content
  }

  /** Append raw text entry to daily note (simpler interface for consolidation) */
  async appendDailyRaw(
    text: string,
    source: string,
    date?: string,
  ): Promise<void> {
    const d = date ?? todayStr();
    const entry: DailyEntry = {
      time: timeStr(),
      source,
      title: text.split("\n")[0].slice(0, 80),
      bullets: text.split("\n").filter((l) => l.trim()).slice(1),
    };
    await this.appendDailyNote(entry, d);
  }

  /** Read a specific day's note */
  async readDailyNote(date: string): Promise<string> {
    try {
      return await Deno.readTextFile(this.dailyPath(date));
    } catch {
      return "";
    }
  }

  /** Read today's daily note */
  readToday(): Promise<string> {
    return this.readDailyNote(todayStr());
  }

  /** List all available daily note dates, newest first */
  async listDailyNotes(since?: Date): Promise<string[]> {
    try {
      const dates: string[] = [];
      for await (const entry of Deno.readDir(this.dailyDir())) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const date = entry.name.replace(".md", "");
        if (since) {
          const noteDate = new Date(date);
          if (noteDate < since) continue;
        }
        dates.push(date);
      }
      return dates.sort().reverse();
    } catch {
      return [];
    }
  }

  /** Read daily notes from the past N days */
  async readRecentDailyNotes(
    days: number,
  ): Promise<Array<{ date: string; content: string }>> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const dates = await this.listDailyNotes(since);
    const notes: Array<{ date: string; content: string }> = [];
    for (const date of dates) {
      const content = await this.readDailyNote(date);
      if (content.trim()) {
        notes.push({ date, content });
      }
    }
    return notes;
  }

  // ──────────────────────────────────────────────
  // Learnings
  // ──────────────────────────────────────────────

  /** Ensure the learnings directory exists */
  private async ensureLearningsDir(): Promise<void> {
    await Deno.mkdir(this.learningsDir(), { recursive: true });
  }

  /** Save a learning (appends update if topic exists, creates if new) */
  async saveLearning(learning: Learning): Promise<string> {
    await this.ensureLearningsDir();
    const path = this.learningPath(learning.topic);

    let exists = false;
    try {
      await Deno.stat(path);
      exists = true;
    } catch {
      // File doesn't exist
    }

    if (exists) {
      // Append update to existing learning (preserve history)
      const update =
        `\n\n---\n\n**Updated**: ${learning.learned}\n**Source**: ${learning.source}\n\n${learning.content}\n`;
      await using file = await Deno.open(path, { write: true, append: true });
      await file.write(ENCODER.encode(update));
    } else {
      // Create new learning file
      const md = [
        `# ${learning.topic}`,
        "",
        `**Learned**: ${learning.learned}`,
        `**Source**: ${learning.source}`,
        "",
        learning.content,
        "",
      ].join("\n");
      await atomicWrite(path, md);
    }

    this.indexCache = null; // Invalidate index
    return path;
  }

  /** Read all learnings */
  async readLearnings(): Promise<Learning[]> {
    const learnings: Learning[] = [];
    try {
      for await (const entry of Deno.readDir(this.learningsDir())) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const content = await Deno.readTextFile(
          join(this.learningsDir(), entry.name),
        );
        const parsed = this.parseLearningFile(content, entry.name);
        if (parsed) learnings.push(parsed);
      }
    } catch {
      // Directory doesn't exist yet
    }
    return learnings;
  }

  /** Parse a learning markdown file */
  private parseLearningFile(
    content: string,
    filename: string,
  ): Learning | null {
    const lines = content.split("\n");
    const topic = (lines[0] ?? "").replace(/^#\s*/, "").trim() ||
      filename.replace(".md", "");
    let learned = "";
    let source = "";
    const bodyLines: string[] = [];
    let pastMeta = false;

    for (const line of lines.slice(1)) {
      const learnedMatch = line.match(/^\*\*Learned\*\*:\s*(.+)/);
      const sourceMatch = line.match(/^\*\*Source\*\*:\s*(.+)/);
      if (learnedMatch) {
        learned = learnedMatch[1];
        continue;
      }
      if (sourceMatch) {
        source = sourceMatch[1];
        continue;
      }
      if (!pastMeta && line.trim() === "") continue;
      pastMeta = true;
      bodyLines.push(line);
    }

    return {
      topic,
      learned: learned || todayStr(),
      source: source || "unknown",
      content: bodyLines.join("\n").trim(),
    };
  }

  /** Get all learnings formatted for context injection */
  async getLearningsContext(): Promise<string> {
    const learnings = await this.readLearnings();
    if (learnings.length === 0) return "";

    const parts = learnings.map(
      (l) => `### ${l.topic}\n${l.content}`,
    );
    return `## Learnings\n\n${parts.join("\n\n")}`;
  }

  // ──────────────────────────────────────────────
  // Tasks (append-only)
  // ──────────────────────────────────────────────

  /** Ensure the tasks directory exists */
  private async ensureTasksDir(): Promise<void> {
    await Deno.mkdir(this.tasksDir(), { recursive: true });
  }

  /** Save a task record (append-only, never edited) */
  async saveTask(id: string, content: string): Promise<void> {
    await this.ensureTasksDir();
    const path = join(this.tasksDir(), `${slugify(id)}.md`);
    await Deno.writeTextFile(path, content);
  }

  // ──────────────────────────────────────────────
  // Entities
  // ──────────────────────────────────────────────

  /** Ensure the entities directory exists */
  private async ensureEntitiesDir(): Promise<void> {
    await Deno.mkdir(join(this.dataDir, "entities"), { recursive: true });
  }

  /** Append an entity mention */
  async trackEntity(name: string, context: string): Promise<void> {
    await this.ensureEntitiesDir();
    const path = this.entitiesPath();
    const line = `- **${name}**: ${context} (${todayStr()})\n`;

    // Atomic check-and-create
    try {
      await Deno.writeTextFile(
        path,
        "# Entities\n\nPeople, projects, and tools mentioned in conversations.\n\n",
        { createNew: true },
      );
    } catch (err) {
      if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
    }

    await using file = await Deno.open(path, {
      write: true,
      append: true,
    });
    await file.write(ENCODER.encode(line));
    this.indexCache = null;
  }

  // ──────────────────────────────────────────────
  // Index
  // ──────────────────────────────────────────────

  /** Check if the index needs rebuilding */
  async isIndexStale(): Promise<boolean> {
    try {
      const indexStat = await Deno.stat(this.indexPath());
      const indexMtime = indexStat.mtime?.getTime() ?? 0;

      // Check if any markdown file is newer than the index
      const dirs = [
        this.dailyDir(),
        this.learningsDir(),
        this.dataDir,
        join(this.dataDir, "entities"),
      ];
      for (const dir of dirs) {
        try {
          for await (const entry of Deno.readDir(dir)) {
            if (!entry.isFile || !entry.name.endsWith(".md")) continue;
            const stat = await Deno.stat(join(dir, entry.name));
            if ((stat.mtime?.getTime() ?? 0) > indexMtime) return true;
          }
        } catch {
          // Directory doesn't exist
        }
      }
      return false;
    } catch {
      // Index doesn't exist
      return true;
    }
  }

  /** Rebuild the search index from markdown files */
  async rebuildIndex(): Promise<MemoryIndex> {
    const index: MemoryIndex = {
      version: INDEX_VERSION,
      lastRebuilt: new Date().toISOString(),
      facts: [],
      entities: [],
      learnings: [],
    };

    // Index daily notes (retention cutoff: 90 days to prevent unbounded growth)
    const retentionCutoff = new Date();
    retentionCutoff.setDate(retentionCutoff.getDate() - 90);
    const dailyDates = await this.listDailyNotes(retentionCutoff);
    for (const date of dailyDates) {
      const content = await this.readDailyNote(date);
      const sections = content.split(/\n## /);
      for (const section of sections) {
        if (!section.trim() || section.startsWith("# ")) continue;
        const firstLine = section.split("\n")[0] ?? "";
        const body = section.split("\n").slice(1).join("\n").trim();
        if (!body) continue;

        const sourceMatch = firstLine.match(/\[([^\]]+)\]\s*\[([^\]]+)\]/);
        const source = sourceMatch?.[2] ?? "unknown";
        const file = `daily/${date}.md`;

        // Split body into individual bullet points for fine-grained indexing
        const lines = body.split("\n");
        const bullets: string[] = [];
        const nonBulletLines: string[] = [];

        for (const line of lines) {
          if (/^[-*]\s+/.test(line)) {
            bullets.push(line.replace(/^[-*]\s+/, "").trim());
          } else if (line.trim()) {
            nonBulletLines.push(line);
          }
        }

        // Each bullet becomes its own IndexFact
        for (const bullet of bullets) {
          if (!bullet) continue;
          index.facts.push({
            id: await contentHash(`${date}:${bullet}`),
            content: bullet,
            source,
            date,
            file,
            tags: extractTags(bullet),
          });
        }

        // Non-bullet content stays grouped as a single fact
        if (nonBulletLines.length > 0) {
          const nonBulletContent = nonBulletLines.join("\n").trim();
          index.facts.push({
            id: await contentHash(`${date}:${firstLine}:${nonBulletContent}`),
            content: nonBulletContent,
            source,
            date,
            file,
            tags: extractTags(`${firstLine} ${nonBulletContent}`),
          });
        }
      }
    }

    // Index learnings (include content for recall without disk I/O)
    const learnings = await this.readLearnings();
    for (const l of learnings) {
      index.learnings.push({
        topic: l.topic,
        file: `learnings/${slugify(l.topic)}.md`,
        date: l.learned,
        content: l.content,
        source: l.source,
        tags: extractTags(`${l.topic} ${l.content}`),
      });
    }

    // Index entities
    try {
      const entitiesContent = await Deno.readTextFile(this.entitiesPath());
      const entityLines = entitiesContent.split("\n").filter((l) =>
        l.startsWith("- **")
      );
      const entityMap = new Map<
        string,
        { mentions: number; lastSeen: string }
      >();

      for (const line of entityLines) {
        const match = line.match(
          /^- \*\*([^*]+)\*\*:.+\((\d{4}-\d{2}-\d{2})\)/,
        );
        if (!match) continue;
        const name = match[1];
        const date = match[2];
        const existing = entityMap.get(name);
        if (existing) {
          existing.mentions++;
          if (date > existing.lastSeen) existing.lastSeen = date;
        } else {
          entityMap.set(name, { mentions: 1, lastSeen: date });
        }
      }

      for (const [name, data] of entityMap) {
        index.entities.push({
          name,
          type: "person", // Default; could be refined later
          mentions: data.mentions,
          lastSeen: data.lastSeen,
        });
      }
    } catch {
      // Entities file doesn't exist
    }

    // Save index atomically
    await Deno.mkdir(this.dataDir, { recursive: true });
    await atomicWrite(this.indexPath(), JSON.stringify(index, null, 2));
    this.indexCache = index;
    return index;
  }

  /** Load the index (from cache, file, or rebuild) */
  async loadIndex(): Promise<MemoryIndex> {
    if (this.indexCache) return this.indexCache;

    try {
      const raw = await Deno.readTextFile(this.indexPath());
      const index = JSON.parse(raw) as MemoryIndex;
      if (index.version !== INDEX_VERSION) {
        return await this.rebuildIndex();
      }
      this.indexCache = index;
      return this.indexCache;
    } catch {
      return await this.rebuildIndex();
    }
  }

  // ──────────────────────────────────────────────
  // Retrieval
  // ──────────────────────────────────────────────

  /** Search memory for entries matching a query */
  async recall(query: string, maxResults = 5): Promise<RecallResult[]> {
    const index = await this.loadIndex();
    const results: RecallResult[] = [];

    // Score daily note facts
    for (const fact of index.facts) {
      const keywordScore = scoreMatch(query, fact.content, fact.tags);
      if (keywordScore <= 0) continue;
      const recency = recencyBoost(fact.date);
      results.push({
        content: fact.content,
        source: fact.source,
        date: fact.date,
        score: keywordScore * recency,
        type: "daily",
      });
    }

    // Score learnings from index (no disk I/O; corrections are important so boosted)
    for (const l of index.learnings) {
      const keywordScore = scoreMatch(query, `${l.topic} ${l.content}`, l.tags);
      if (keywordScore <= 0) continue;
      results.push({
        content: `[${l.topic}] ${l.content}`,
        source: l.source,
        date: l.date,
        score: keywordScore * 1.5, // Learnings get a boost
        type: "learning",
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /** Get relevant context for a user message (smart context loading) */
  async getRelevantContext(
    userMessage: string,
    maxChars = 4000,
  ): Promise<string> {
    const parts: string[] = [];
    let budget = maxChars;

    // Always load synthesized wisdom (MEMORY.md) — 40% budget
    const memoryBudget = Math.floor(maxChars * 0.4);
    const memory = await this.readLongTerm();
    if (memory.trim()) {
      const memoryContent = memory.length > memoryBudget
        ? memory.slice(0, memoryBudget) + "..."
        : memory;
      const section = `## Synthesized Memory\n\n${memoryContent}`;
      parts.push(section);
      budget -= section.length;
    }

    // Load learnings scored by relevance — 30% budget
    const learningsBudget = Math.floor(maxChars * 0.3);
    const learnings = await this.readLearnings();
    if (learnings.length > 0) {
      // Score learnings by relevance to current query
      const scored = learnings.map((l) => ({
        learning: l,
        score: scoreMatch(
          userMessage,
          `${l.topic} ${l.content}`,
          extractTags(l.content),
        ),
      })).sort((a, b) => b.score - a.score);

      const learningParts: string[] = [];
      let learningsUsed = 0;
      for (const { learning } of scored) {
        const entry = `### ${learning.topic}\n${learning.content}`;
        if (learningsUsed + entry.length > learningsBudget) break;
        learningParts.push(entry);
        learningsUsed += entry.length;
      }
      if (learningParts.length > 0) {
        const section = `## Learnings\n\n${learningParts.join("\n\n")}`;
        parts.push(section);
        budget -= section.length;
      }
    }

    // Selectively load relevant daily note entries — 20% budget
    const recallBudget = Math.floor(maxChars * 0.2);
    const recalled = await this.recall(userMessage, 5);
    if (recalled.length > 0) {
      const recalledParts: string[] = [];
      let recallUsed = 0;
      for (const r of recalled) {
        const entry = `- [${r.date}] [${r.source}] ${r.content.split("\n")[0]}`;
        if (recallUsed + entry.length > recallBudget) break;
        recalledParts.push(entry);
        recallUsed += entry.length;
      }
      if (recalledParts.length > 0) {
        parts.push(`## Relevant Past Context\n\n${recalledParts.join("\n")}`);
      }
    }

    // Today's note summary — 10% budget
    const todayBudget = Math.floor(maxChars * 0.1);
    const today = await this.readToday();
    if (today.trim()) {
      const truncated = today.length > todayBudget
        ? `...\n${today.slice(-todayBudget)}`
        : today;
      parts.push(`## Today's Notes\n\n${truncated}`);
    }

    return parts.join("\n\n");
  }

  // ──────────────────────────────────────────────
  // Synthesis (weekly)
  // ──────────────────────────────────────────────

  /** Get content for weekly synthesis (called by consolidation) */
  async getWeeklySynthesisInput(
    since?: Date,
  ): Promise<{ existingMemory: string; weeklyNotes: string }> {
    const existingMemory = await this.readLongTerm();

    // If a since date is provided, read all notes since that date.
    // Otherwise fall back to reading all available daily notes.
    const dates = since
      ? await this.listDailyNotes(since)
      : await this.listDailyNotes();
    const notes: Array<{ date: string; content: string }> = [];
    for (const date of dates) {
      const content = await this.readDailyNote(date);
      if (content.trim()) {
        notes.push({ date, content });
      }
    }

    const weeklyNotes = notes
      .map((n) => `### ${n.date}\n\n${n.content}`)
      .join("\n\n---\n\n");
    return { existingMemory, weeklyNotes };
  }

  // ──────────────────────────────────────────────
  // Maintenance
  // ──────────────────────────────────────────────

  /** Archive daily notes older than N days */
  async archiveOldNotes(olderThanDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const archiveDir = join(this.dataDir, "archive");
    await Deno.mkdir(archiveDir, { recursive: true });

    let archived = 0;
    const dates = await this.listDailyNotes();
    for (const date of dates) {
      if (date >= cutoffStr) continue;
      const month = date.slice(0, 7); // YYYY-MM
      const monthFile = join(archiveDir, `${month}.md`);
      const content = await this.readDailyNote(date);

      // Atomic check-and-create for monthly archive
      try {
        await Deno.writeTextFile(monthFile, `# Archive: ${month}\n\n`, {
          createNew: true,
        });
      } catch (err) {
        if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
      }

      await using file = await Deno.open(monthFile, {
        write: true,
        append: true,
      });
      await file.write(
        ENCODER.encode(`\n---\n\n${content}\n`),
      );

      // Remove the daily note
      await Deno.remove(this.dailyPath(date));
      archived++;
    }

    if (archived > 0) {
      this.indexCache = null; // Invalidate index
    }
    return archived;
  }

  /** Initialize directory structure */
  async ensureDirectories(): Promise<void> {
    await Deno.mkdir(this.dailyDir(), { recursive: true });
    await Deno.mkdir(this.learningsDir(), { recursive: true });
    await Deno.mkdir(this.tasksDir(), { recursive: true });
    await Deno.mkdir(join(this.dataDir, "entities"), { recursive: true });
    await Deno.mkdir(this.versionsDir(), { recursive: true });
  }

  // ──────────────────────────────────────────────
  // Versioning
  // ──────────────────────────────────────────────

  /** Create a versioned backup of MEMORY.md before overwriting */
  async versionMemory(): Promise<string | null> {
    const currentMemory = await this.readLongTerm();
    if (!currentMemory.trim()) return null;

    await Deno.mkdir(this.versionsDir(), { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const versionPath = join(this.versionsDir(), `MEMORY-${timestamp}.md`);
    await atomicWrite(versionPath, currentMemory);
    return versionPath;
  }

  /** List all versioned MEMORY.md backups, newest first */
  async listVersions(): Promise<string[]> {
    try {
      const files: string[] = [];
      for await (const entry of Deno.readDir(this.versionsDir())) {
        if (
          entry.isFile && entry.name.startsWith("MEMORY-") &&
          entry.name.endsWith(".md")
        ) {
          files.push(entry.name);
        }
      }
      return files.sort().reverse();
    } catch {
      return [];
    }
  }

  /** Prune old versions, keeping at most maxVersions */
  async pruneVersions(maxVersions = 10): Promise<number> {
    const versions = await this.listVersions();
    let pruned = 0;
    if (versions.length <= maxVersions) return pruned;

    const toRemove = versions.slice(maxVersions);
    for (const name of toRemove) {
      await Deno.remove(join(this.versionsDir(), name));
      pruned++;
    }
    return pruned;
  }
}
