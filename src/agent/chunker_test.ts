import { assertEquals, assert } from "@std/assert";
import {
  chunkDailyNote,
  chunkLearning,
  chunkMemory,
  chunkEntity,
  extractTags,
} from "./chunker.ts";

// --- chunkDailyNote ---

Deno.test("chunkDailyNote: single section with bullets", () => {
  const content = `# 2024-01-15

## [10:00] [slack] Morning standup
- Fixed the login bug
- Deployed to staging
`;
  const chunks = chunkDailyNote(content, "2024-01-15");
  assertEquals(chunks.length, 2);
  assertEquals(chunks[0].content, "Fixed the login bug");
  assertEquals(chunks[0].source, "slack");
  assertEquals(chunks[0].date, "2024-01-15");
  assertEquals(chunks[0].position, 0);
  assertEquals(chunks[1].content, "Deployed to staging");
  assertEquals(chunks[1].position, 1);
});

Deno.test("chunkDailyNote: non-bullet content grouped as one chunk", () => {
  const content = `# 2024-01-15

## [10:00] [email] Notes
Some prose here
Another prose line
`;
  const chunks = chunkDailyNote(content, "2024-01-15");
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].content, "Some prose here\nAnother prose line");
  assertEquals(chunks[0].source, "email");
});

Deno.test("chunkDailyNote: mixed bullets and non-bullet content", () => {
  const content = `# 2024-01-15

## [09:00] [github] PR review
Reviewed PR #42
- Approved auth changes
- Left comment on logging
`;
  const chunks = chunkDailyNote(content, "2024-01-15");
  // 2 bullets + 1 non-bullet group
  assertEquals(chunks.length, 3);
  assertEquals(chunks[0].content, "Approved auth changes");
  assertEquals(chunks[1].content, "Left comment on logging");
  assertEquals(chunks[2].content, "Reviewed PR #42");
});

Deno.test("chunkDailyNote: multiple sections", () => {
  const content = `# 2024-01-15

## [09:00] [slack] Standup
- Task A

## [14:00] [email] Meeting
- Task B
- Task C
`;
  const chunks = chunkDailyNote(content, "2024-01-15");
  assertEquals(chunks.length, 3);
  assertEquals(chunks[0].content, "Task A");
  assertEquals(chunks[0].source, "slack");
  assertEquals(chunks[1].content, "Task B");
  assertEquals(chunks[1].source, "email");
  assertEquals(chunks[2].content, "Task C");
  assertEquals(chunks[2].source, "email");
  // positions are sequential across sections
  assertEquals(chunks[0].position, 0);
  assertEquals(chunks[1].position, 1);
  assertEquals(chunks[2].position, 2);
});

Deno.test("chunkDailyNote: empty content produces no chunks", () => {
  const chunks = chunkDailyNote("", "2024-01-15");
  assertEquals(chunks.length, 0);
});

Deno.test("chunkDailyNote: section with no body produces no chunk", () => {
  const content = `# 2024-01-15

## [09:00] [slack] Empty section
`;
  const chunks = chunkDailyNote(content, "2024-01-15");
  assertEquals(chunks.length, 0);
});

// --- chunkLearning ---

Deno.test("chunkLearning: single section", () => {
  const content = `# TypeScript generics
**Learned**: 2024-01-15
**Source**: Official TypeScript docs

Generics allow you to write reusable type-safe code.
`;
  const chunks = chunkLearning(content, "typescript-generics.md");
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].source, "Official TypeScript docs");
  assert(chunks[0].content.includes("Generics allow"));
  assertEquals(chunks[0].position, 0);
});

Deno.test("chunkLearning: multiple --- sections", () => {
  const content = `# First Topic
**Source**: Source A

Content for first topic.

---

# Second Topic
**Source**: Source B

Content for second topic.
`;
  const chunks = chunkLearning(content, "multi.md");
  assertEquals(chunks.length, 2);
  assertEquals(chunks[0].source, "Source A");
  assertEquals(chunks[1].source, "Source B");
  assert(chunks[0].content.includes("Content for first topic"));
  assert(chunks[1].content.includes("Content for second topic"));
  assertEquals(chunks[0].position, 0);
  assertEquals(chunks[1].position, 1);
});

Deno.test("chunkLearning: topic falls back to filename when heading is missing", () => {
  // A learning file where the first line has no # heading — topic comes from filename
  const content = "# \n**Source**: Some source\n\nBody content here.";
  const chunks = chunkLearning(content, "my-topic.md");
  assertEquals(chunks.length, 1);
  // date field holds topic derived from filename (empty heading triggers fallback)
  assertEquals(chunks[0].date, "my-topic");
});

Deno.test("chunkLearning: empty content produces no chunks", () => {
  const chunks = chunkLearning("", "empty.md");
  assertEquals(chunks.length, 0);
});

// --- chunkMemory ---

Deno.test("chunkMemory: multiple ## headings", () => {
  const content = `# MEMORY.md

## Planning Protocol

Steps for planning tasks in a structured way.

## Tech Stack

Deno, TypeScript, SQLite.
`;
  const chunks = chunkMemory(content);
  assertEquals(chunks.length, 2);
  assertEquals(chunks[0].source, "Planning Protocol");
  assert(chunks[0].content.includes("Steps for planning"));
  assertEquals(chunks[1].source, "Tech Stack");
  assert(chunks[1].content.includes("Deno, TypeScript"));
  // date is today's ISO date
  assert(/^\d{4}-\d{2}-\d{2}$/.test(chunks[0].date));
  assertEquals(chunks[0].position, 0);
  assertEquals(chunks[1].position, 1);
});

Deno.test("chunkMemory: empty content produces no chunks", () => {
  const chunks = chunkMemory("");
  assertEquals(chunks.length, 0);
});

Deno.test("chunkMemory: only # heading skipped, ## heading included", () => {
  const content = `# Top Level

## Section One

Content here.
`;
  const chunks = chunkMemory(content);
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].source, "Section One");
});

// --- chunkEntity ---

Deno.test("chunkEntity: entire file as single chunk", () => {
  const content = `# Alice

Alice is a software engineer working on ContainerClaw.
She focuses on backend systems.
`;
  const chunks = chunkEntity(content);
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].source, "entity");
  assertEquals(chunks[0].position, 0);
  assert(chunks[0].content.includes("Alice is a software engineer"));
});

Deno.test("chunkEntity: empty content produces no chunks", () => {
  const chunks = chunkEntity("");
  assertEquals(chunks.length, 0);
});

Deno.test("chunkEntity: whitespace-only content produces no chunks", () => {
  const chunks = chunkEntity("   \n\n  ");
  assertEquals(chunks.length, 0);
});

// --- Content truncation ---

Deno.test("content truncated at 2000 chars", () => {
  const longContent = "x".repeat(3000);
  const content = `# 2024-01-15

## [09:00] [slack] Long note
- ${longContent}
`;
  const chunks = chunkDailyNote(content, "2024-01-15");
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].content.length, 2000);
});

Deno.test("chunkEntity truncates at 2000 chars", () => {
  const long = "a".repeat(3000);
  const chunks = chunkEntity(long);
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].content.length, 2000);
});

// --- extractTags ---

Deno.test("extractTags: returns top 10 non-stop words", () => {
  const text = "the quick brown fox jumps over the lazy dog the fox";
  const tags = extractTags(text);
  // stop words filtered: "the", "over"
  assert(tags.includes("fox")); // appears twice
  assert(!tags.includes("the"));
  assert(tags.length <= 10);
});

Deno.test("extractTags: filters short words (< 3 chars)", () => {
  const tags = extractTags("do it now go be");
  assert(!tags.includes("it"));
  assert(!tags.includes("go"));
  assert(!tags.includes("be"));
  assert(!tags.includes("do"));
});

Deno.test("extractTags: sorts by frequency descending", () => {
  const text = "apple apple apple banana banana cherry";
  const tags = extractTags(text);
  assertEquals(tags[0], "apple");
  assertEquals(tags[1], "banana");
  assertEquals(tags[2], "cherry");
});

Deno.test("extractTags: empty string returns empty array", () => {
  const tags = extractTags("");
  assertEquals(tags, []);
});
