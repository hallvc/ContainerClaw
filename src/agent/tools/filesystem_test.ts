import { assertEquals, assertStringIncludes, assertRejects } from "@std/assert";
import { ReadFileTool, WriteFileTool, EditFileTool, ListDirTool } from "./filesystem.ts";
import { join } from "@std/path";

const workspace = Deno.realPathSync(Deno.makeTempDirSync());

// --- WriteFileTool ---

Deno.test("WriteFileTool - writes file and creates parent dirs", async () => {
  const tool = new WriteFileTool(workspace);
  const result = await tool.execute({ path: "sub/dir/test.txt", content: "hello" });
  assertStringIncludes(result, "5 bytes");
  const content = await Deno.readTextFile(join(workspace, "sub/dir/test.txt"));
  assertEquals(content, "hello");
});

Deno.test("WriteFileTool - rejects path outside workspace", async () => {
  const tool = new WriteFileTool(workspace);
  await assertRejects(
    () => tool.execute({ path: "/tmp/outside.txt", content: "bad" }),
    Error,
    "outside the workspace",
  );
});

Deno.test("WriteFileTool - rejects symlink traversal outside workspace", async () => {
  // Create a symlink inside the workspace that points outside
  const symlinkPath = join(workspace, "escape_link");
  try {
    await Deno.remove(symlinkPath);
  } catch { /* ignore if doesn't exist */ }
  await Deno.symlink("/tmp", symlinkPath);

  const tool = new WriteFileTool(workspace);
  await assertRejects(
    () => tool.execute({ path: "escape_link/evil.txt", content: "bad" }),
    Error,
    "outside the workspace",
  );

  // Cleanup
  await Deno.remove(symlinkPath);
});

// --- ReadFileTool ---

Deno.test("ReadFileTool - reads existing file", async () => {
  await Deno.writeTextFile(join(workspace, "readable.txt"), "file content");
  const tool = new ReadFileTool(workspace);
  const result = await tool.execute({ path: "readable.txt" });
  assertEquals(result, "file content");
});

Deno.test("ReadFileTool - rejects path outside workspace", async () => {
  const tool = new ReadFileTool(workspace);
  await assertRejects(
    () => tool.execute({ path: "../../../etc/passwd" }),
    Error,
    "outside the workspace",
  );
});

// --- EditFileTool ---

Deno.test("EditFileTool - replaces text successfully", async () => {
  await Deno.writeTextFile(join(workspace, "editable.txt"), "hello world");
  const tool = new EditFileTool(workspace);
  const result = await tool.execute({
    path: "editable.txt",
    old_text: "hello",
    new_text: "goodbye",
  });
  assertStringIncludes(result, "successfully");
  const content = await Deno.readTextFile(join(workspace, "editable.txt"));
  assertEquals(content, "goodbye world");
});

Deno.test("EditFileTool - errors when old_text not found", async () => {
  await Deno.writeTextFile(join(workspace, "edit_missing.txt"), "hello world");
  const tool = new EditFileTool(workspace);
  await assertRejects(
    () => tool.execute({
      path: "edit_missing.txt",
      old_text: "nonexistent",
      new_text: "replacement",
    }),
    Error,
    "not found",
  );
});

Deno.test("EditFileTool - warns on ambiguous multiple occurrences", async () => {
  await Deno.writeTextFile(
    join(workspace, "ambiguous.txt"),
    "foo bar foo baz foo",
  );
  const tool = new EditFileTool(workspace);
  const result = await tool.execute({
    path: "ambiguous.txt",
    old_text: "foo",
    new_text: "qux",
  });
  assertStringIncludes(result, "3 times");
  // File should NOT be modified when ambiguous
  const content = await Deno.readTextFile(join(workspace, "ambiguous.txt"));
  assertEquals(content, "foo bar foo baz foo");
});

Deno.test("EditFileTool - rejects path outside workspace", async () => {
  const tool = new EditFileTool(workspace);
  await assertRejects(
    () => tool.execute({
      path: "/tmp/outside.txt",
      old_text: "a",
      new_text: "b",
    }),
    Error,
    "outside the workspace",
  );
});

// --- ListDirTool ---

Deno.test("ListDirTool - lists directory contents", async () => {
  // Create some files in a subdirectory
  const listDir = join(workspace, "listtest");
  await Deno.mkdir(listDir, { recursive: true });
  await Deno.writeTextFile(join(listDir, "a.txt"), "a");
  await Deno.writeTextFile(join(listDir, "b.txt"), "b");
  await Deno.mkdir(join(listDir, "subdir"));

  const tool = new ListDirTool(workspace);
  const result = await tool.execute({ path: "listtest" });
  assertStringIncludes(result, "a.txt");
  assertStringIncludes(result, "b.txt");
  assertStringIncludes(result, "subdir/");
});

Deno.test("ListDirTool - defaults to workspace root", async () => {
  const tool = new ListDirTool(workspace);
  const result = await tool.execute({});
  // Should list workspace contents without error
  assertEquals(typeof result, "string");
  assertEquals(result.length > 0, true);
});

Deno.test("ListDirTool - rejects path outside workspace", async () => {
  const tool = new ListDirTool(workspace);
  await assertRejects(
    () => tool.execute({ path: "/tmp" }),
    Error,
    "outside the workspace",
  );
});
