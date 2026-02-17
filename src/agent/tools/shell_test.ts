import { assertEquals, assertStringIncludes } from "@std/assert";
import { ExecTool } from "./shell.ts";

// Use a temp dir as workspace so tests don't touch real files.
const workspace = Deno.makeTempDirSync();

// --- Deny pattern tests (RED: these should fail until guardCommand is implemented) ---

Deno.test("ExecTool - blocks rm -rf", async () => {
  const tool = new ExecTool(workspace);
  const result = await tool.execute({ command: "rm -rf /" });
  assertStringIncludes(result, "blocked");
});

Deno.test("ExecTool - blocks rm -r", async () => {
  const tool = new ExecTool(workspace);
  const result = await tool.execute({ command: "rm -r /tmp/stuff" });
  assertStringIncludes(result, "blocked");
});

Deno.test("ExecTool - blocks rm -fr", async () => {
  const tool = new ExecTool(workspace);
  const result = await tool.execute({ command: "rm -fr /some/path" });
  assertStringIncludes(result, "blocked");
});

Deno.test("ExecTool - blocks mkfs", async () => {
  const tool = new ExecTool(workspace);
  const result = await tool.execute({ command: "mkfs.ext4 /dev/sda1" });
  assertStringIncludes(result, "blocked");
});

Deno.test("ExecTool - blocks dd", async () => {
  const tool = new ExecTool(workspace);
  const result = await tool.execute({ command: "dd if=/dev/zero of=/dev/sda" });
  assertStringIncludes(result, "blocked");
});

Deno.test("ExecTool - blocks shutdown", async () => {
  const tool = new ExecTool(workspace);
  const result = await tool.execute({ command: "shutdown -h now" });
  assertStringIncludes(result, "blocked");
});

Deno.test("ExecTool - blocks reboot", async () => {
  const tool = new ExecTool(workspace);
  const result = await tool.execute({ command: "reboot" });
  assertStringIncludes(result, "blocked");
});

Deno.test("ExecTool - blocks fork bomb", async () => {
  const tool = new ExecTool(workspace);
  const result = await tool.execute({ command: ":(){ :|:& };:" });
  assertStringIncludes(result, "blocked");
});

Deno.test("ExecTool - allows safe commands", async () => {
  const tool = new ExecTool(workspace);
  const result = await tool.execute({ command: "echo hello" });
  assertStringIncludes(result, "hello");
});

Deno.test("ExecTool - allows ls", async () => {
  const tool = new ExecTool(workspace);
  // Should not be blocked — ls is safe
  const result = await tool.execute({ command: "ls -la" });
  // Result should NOT contain "blocked"
  assertEquals(result.includes("blocked"), false);
});

Deno.test("ExecTool - allows rm without -r/-f flags", async () => {
  const tool = new ExecTool(workspace);
  // Plain rm of a single file should be allowed
  const result = await tool.execute({ command: "rm somefile.txt" });
  assertEquals(result.includes("blocked"), false);
});

Deno.test("ExecTool - output truncation", async () => {
  const tool = new ExecTool(workspace);
  // Generate output longer than 10000 chars
  const result = await tool.execute({
    command: "python3 -c \"print('x' * 15000)\" 2>/dev/null || printf '%0.sx' $(seq 1 15000)",
  });
  // Either truncated or the command may fail — but if it produces output, it should be capped
  if (result.length > 100) {
    assertEquals(result.length <= 10_000 + 50, true); // 50 chars tolerance for "[output truncated]"
  }
});

Deno.test("ExecTool - workspace cwd enforcement", async () => {
  const tool = new ExecTool(workspace);
  const result = await tool.execute({ command: "pwd" });
  assertStringIncludes(result, workspace);
});
