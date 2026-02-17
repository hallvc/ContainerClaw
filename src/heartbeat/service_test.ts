import { assertEquals } from "@std/assert";
import { HeartbeatService, isHeartbeatEmpty } from "./service.ts";
import { join } from "@std/path";

const settle = () => new Promise((r) => setTimeout(r, 50));

// ---------------------------------------------------------------------------
// isHeartbeatEmpty tests
// ---------------------------------------------------------------------------

Deno.test("isHeartbeatEmpty - returns true for null", () => {
  assertEquals(isHeartbeatEmpty(null), true);
});

Deno.test("isHeartbeatEmpty - returns true for empty string", () => {
  assertEquals(isHeartbeatEmpty(""), true);
});

Deno.test("isHeartbeatEmpty - returns true for headers and comments only", () => {
  const content = "# Heartbeat Tasks\n\n<!-- comment -->\n## Active\n\n";
  assertEquals(isHeartbeatEmpty(content), true);
});

Deno.test("isHeartbeatEmpty - returns true for empty checkboxes only", () => {
  const content = "# Tasks\n- [ ]\n* [ ]\n- [x]\n* [x]\n";
  assertEquals(isHeartbeatEmpty(content), true);
});

Deno.test("isHeartbeatEmpty - returns false for actionable content", () => {
  assertEquals(isHeartbeatEmpty("# Tasks\n- [ ] Do something"), false);
  assertEquals(isHeartbeatEmpty("Check the logs"), false);
});

// ---------------------------------------------------------------------------
// HeartbeatService tests
// ---------------------------------------------------------------------------

Deno.test("HeartbeatService - run returns immediately when disabled", async () => {
  const svc = new HeartbeatService("/tmp/fake", 1800, false);
  await svc.run(); // Should return immediately, not hang
});

Deno.test("HeartbeatService - stop exits run loop", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new HeartbeatService(tmpDir, 1, true); // 1 second interval
    const runPromise = svc.run();
    await settle();
    svc.stop();
    await runPromise;
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("HeartbeatService - triggerNow calls callback when file has content", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(tmpDir, "HEARTBEAT.md"), "# Tasks\n- [ ] Check logs\n");
    const svc = new HeartbeatService(tmpDir, 1, true);
    let called = false;
    svc.setCallback((_prompt: string) => {
      called = true;
      return Promise.resolve("HEARTBEAT_OK");
    });
    const result = await svc.triggerNow();
    assertEquals(called, true);
    assertEquals(result, "HEARTBEAT_OK");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("HeartbeatService - triggerNow returns null without callback", async () => {
  const svc = new HeartbeatService("/tmp/fake");
  const result = await svc.triggerNow();
  assertEquals(result, null);
});
