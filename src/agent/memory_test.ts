import { assertEquals, assertStringIncludes } from "@std/assert";
import { MemoryStore } from "./memory.ts";

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
    // Check timestamp format: [ISO date]
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
