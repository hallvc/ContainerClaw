import { assertEquals, assertNotEquals } from "@std/assert";
import { QUESTION_BANK, getDirectQuestion, getSystemHint } from "./questions.ts";

Deno.test("QUESTION_BANK - has entries for all core field keys", () => {
  const expectedKeys = [
    "user.name",
    "user.timezone",
    "user.language",
    "user.comm_style",
    "user.response_length",
    "user.tech_level",
    "user.role",
    "user.projects",
    "user.tools",
    "user.topics",
    "user.instructions",
    "soul.personality",
    "heartbeat.tasks",
    "agents.custom",
    "tools.custom",
  ];

  for (const key of expectedKeys) {
    assertEquals(key in QUESTION_BANK, true, `Missing question bank entry for ${key}`);
  }
});

Deno.test("QUESTION_BANK - each entry has direct and systemHint arrays", () => {
  for (const [key, entry] of Object.entries(QUESTION_BANK)) {
    assertEquals(Array.isArray(entry.direct), true, `${key}.direct is not an array`);
    assertEquals(Array.isArray(entry.systemHint), true, `${key}.systemHint is not an array`);
    assertEquals(entry.direct.length > 0, true, `${key}.direct is empty`);
    assertEquals(entry.systemHint.length > 0, true, `${key}.systemHint is empty`);
  }
});

Deno.test("getDirectQuestion - returns a string for known keys", () => {
  const question = getDirectQuestion("user.name");
  assertEquals(typeof question, "string");
  assertEquals(question.length > 0, true);
});

Deno.test("getDirectQuestion - returns fallback for unknown keys", () => {
  const question = getDirectQuestion("unknown.field");
  assertEquals(typeof question, "string");
  assertEquals(question.includes("unknown.field"), true);
});

Deno.test("getSystemHint - returns a string for known keys", () => {
  const hint = getSystemHint("user.timezone");
  assertEquals(typeof hint, "string");
  assertEquals(hint.length > 0, true);
  assertEquals(hint.toLowerCase().includes("timezone") || hint.toLowerCase().includes("time"), true);
});

Deno.test("getSystemHint - returns fallback for unknown keys", () => {
  const hint = getSystemHint("unknown.field");
  assertEquals(typeof hint, "string");
  assertEquals(hint.includes("unknown.field"), true);
});
