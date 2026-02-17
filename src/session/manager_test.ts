import { assertEquals } from "@std/assert";
import { SessionManager } from "./manager.ts";

Deno.test("SessionManager - create, update, save, reload", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const mgr = new SessionManager(tmpDir);
    const session = mgr.getOrCreate("test:chat1");
    assertEquals(session.messages.length, 0);

    session.addMessage("user", "hello");
    session.addMessage("assistant", "hi there");
    assertEquals(session.messages.length, 2);

    mgr.save(session);

    // Reload from disk
    mgr.invalidate("test:chat1");
    const reloaded = mgr.getOrCreate("test:chat1");
    assertEquals(reloaded.messages.length, 2);
    assertEquals(reloaded.messages[0].content, "hello");
    assertEquals(reloaded.messages[1].content, "hi there");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SessionManager - getHistory returns limited messages", () => {
  const mgr = new SessionManager("/tmp/test-sessions-" + Date.now());
  const session = mgr.getOrCreate("test:hist");
  for (let i = 0; i < 10; i++) {
    session.addMessage("user", `msg ${i}`);
  }
  const history = session.getHistory(3);
  assertEquals(history.length, 3);
  assertEquals(history[0].content, "msg 7");
});

Deno.test("SessionManager - clear resets messages", () => {
  const mgr = new SessionManager("/tmp/test-sessions-" + Date.now());
  const session = mgr.getOrCreate("test:clear");
  session.addMessage("user", "hello");
  assertEquals(session.messages.length, 1);
  session.clear();
  assertEquals(session.messages.length, 0);
});
