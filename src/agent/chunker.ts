/**
 * Smart markdown chunker for the SQLite memory backend.
 * Parses different types of markdown files into searchable chunks.
 */

export interface Chunk {
  content: string;
  source: string;
  date: string;
  tags: string[];
  position: number; // chunk position within document
}

export type ChunkType = "daily" | "learning" | "memory" | "entity";

const MAX_CHUNK_SIZE = 2000;

/** Extract simple keyword tags from text */
export function extractTags(text: string): string[] {
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
    "not",
    "and",
    "but",
    "or",
    "nor",
    "for",
    "yet",
    "so",
    "if",
    "then",
    "else",
    "as",
    "at",
    "by",
    "from",
    "in",
    "into",
    "of",
    "on",
    "to",
    "up",
    "with",
    "about",
    "against",
    "between",
    "during",
    "without",
    "through",
    "before",
    "after",
    "above",
    "below",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "he",
    "she",
    "they",
    "we",
    "you",
    "i",
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

function truncate(s: string): string {
  return s.length > MAX_CHUNK_SIZE ? s.slice(0, MAX_CHUNK_SIZE) : s;
}

/**
 * Parse a daily note file into chunks (one per bullet point, non-bullets grouped per section).
 * Section header pattern: `[time] [source] title`
 */
export function chunkDailyNote(content: string, date: string): Chunk[] {
  const chunks: Chunk[] = [];
  let position = 0;

  const sections = content.split(/\n## /);
  for (const section of sections) {
    if (!section.trim() || section.startsWith("# ")) continue;

    const firstLine = section.split("\n")[0] ?? "";
    const body = section.split("\n").slice(1).join("\n").trim();
    if (!body) continue;

    // Extract source from [time] [source] pattern
    const sourceMatch = firstLine.match(/\[([^\]]+)\]\s*\[([^\]]+)\]/);
    const source = sourceMatch?.[2] ?? "unknown";

    const lines = body.split("\n");
    const bullets: string[] = [];
    const nonBulletLines: string[] = [];

    for (const line of lines) {
      if (/^[-*]\s+/.test(line)) {
        const bullet = line.replace(/^[-*]\s+/, "").trim();
        if (bullet) bullets.push(bullet);
      } else if (line.trim()) {
        nonBulletLines.push(line);
      }
    }

    // Each bullet becomes its own chunk
    for (const bullet of bullets) {
      const c = truncate(bullet);
      if (!c) continue;
      chunks.push({ content: c, source, date, tags: extractTags(bullet), position: position++ });
    }

    // Non-bullet content grouped as one chunk
    if (nonBulletLines.length > 0) {
      const nonBulletContent = nonBulletLines.join("\n").trim();
      const c = truncate(nonBulletContent);
      if (c) {
        chunks.push({
          content: c,
          source,
          date,
          tags: extractTags(`${firstLine} ${nonBulletContent}`),
          position: position++,
        });
      }
    }
  }

  return chunks;
}

/**
 * Parse a learning file into chunks (one per --- section).
 * Topic from # heading, source from **Source**: pattern.
 */
export function chunkLearning(content: string, filename: string): Chunk[] {
  const chunks: Chunk[] = [];
  let position = 0;

  const sections = content.split(/\n---\n/);
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    const lines = trimmed.split("\n");
    const topic = (lines[0] ?? "").replace(/^#\s*/, "").trim() ||
      filename.replace(/\.md$/, "");

    let source = "unknown";
    const bodyLines: string[] = [];
    let pastMeta = false;

    for (const line of lines.slice(1)) {
      const sourceMatch = line.match(/^\*\*Source\*\*:\s*(.+)/);
      if (sourceMatch) {
        source = sourceMatch[1].trim();
        continue;
      }
      // Skip **Learned**: meta line
      if (/^\*\*Learned\*\*:\s*/.test(line)) continue;
      if (!pastMeta && line.trim() === "") continue;
      pastMeta = true;
      bodyLines.push(line);
    }

    const body = bodyLines.join("\n").trim();
    const chunkContent = body || topic;
    if (!chunkContent) continue;

    const c = truncate(chunkContent);
    chunks.push({
      content: c,
      source,
      date: topic, // topic as date field for learnings (no date in file)
      tags: extractTags(`${topic} ${chunkContent}`),
      position: position++,
    });
  }

  return chunks;
}

/**
 * Parse MEMORY.md into chunks (one per ## heading section).
 * Date = today's ISO date string.
 */
export function chunkMemory(content: string): Chunk[] {
  const chunks: Chunk[] = [];
  let position = 0;

  const today = new Date().toISOString().slice(0, 10);

  const sections = content.split(/\n## /);
  for (const section of sections) {
    if (!section.trim() || section.startsWith("# ")) continue;

    const firstLine = section.split("\n")[0] ?? "";
    const heading = firstLine.trim();
    const body = section.split("\n").slice(1).join("\n").trim();

    const chunkContent = body || heading;
    if (!chunkContent.trim()) continue;

    const c = truncate(chunkContent);
    chunks.push({
      content: c,
      source: heading,
      date: today,
      tags: extractTags(`${heading} ${chunkContent}`),
      position: position++,
    });
  }

  return chunks;
}

/**
 * Parse an entity file into a single chunk.
 */
export function chunkEntity(content: string): Chunk[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const c = truncate(trimmed);
  return [{ content: c, source: "entity", date: "", tags: extractTags(trimmed), position: 0 }];
}
