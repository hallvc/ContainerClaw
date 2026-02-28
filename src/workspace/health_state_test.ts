import { assertEquals } from "@std/assert";
import { HealthStateManager } from "./health_state.ts";
import type { GapInfo } from "./health.ts";

function makeGap(fieldKey: string, priority: number): GapInfo {
  return {
    file: "USER.md",
    section: "Test",
    field: "Test",
    fieldKey,
    currentValue: "(placeholder)",
    question: "Test question?",
    priority,
  };
}

Deno.test("HealthStateManager - canAskToday returns false after max questions", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new HealthStateManager(dir, 2, 24);
  await mgr.load();

  assertEquals(mgr.canAskToday(), true);
  mgr.recordQuestion("user.name");
  assertEquals(mgr.canAskToday(), true);
  mgr.recordQuestion("user.timezone");
  assertEquals(mgr.canAskToday(), false);
});

Deno.test("HealthStateManager - canAskField returns false for skipped fields within cooldown", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new HealthStateManager(dir, 2, 24);
  await mgr.load();

  assertEquals(mgr.canAskField("user.name"), true);
  mgr.recordSkip("user.name");
  assertEquals(mgr.canAskField("user.name"), false);
});

Deno.test("HealthStateManager - canAskField returns false for completed fields", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new HealthStateManager(dir, 2, 24);
  await mgr.load();

  assertEquals(mgr.canAskField("user.name"), true);
  mgr.recordCompletion("user.name");
  assertEquals(mgr.canAskField("user.name"), false);
});

Deno.test("HealthStateManager - getNextQuestion returns highest priority askable", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new HealthStateManager(dir, 2, 24);
  await mgr.load();

  const gaps = [
    makeGap("user.role", 6),
    makeGap("user.name", 10),
    makeGap("user.timezone", 9),
  ];

  const next = mgr.getNextQuestion(gaps);
  assertEquals(next?.fieldKey, "user.name");
});

Deno.test("HealthStateManager - getNextQuestion skips completed and skipped fields", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new HealthStateManager(dir, 2, 24);
  await mgr.load();

  mgr.recordCompletion("user.name");
  mgr.recordSkip("user.timezone");

  const gaps = [
    makeGap("user.name", 10),
    makeGap("user.timezone", 9),
    makeGap("user.role", 6),
  ];

  const next = mgr.getNextQuestion(gaps);
  assertEquals(next?.fieldKey, "user.role");
});

Deno.test("HealthStateManager - getNextQuestion returns null when all complete", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new HealthStateManager(dir, 2, 24);
  await mgr.load();

  mgr.recordCompletion("user.name");

  const gaps = [makeGap("user.name", 10)];
  const next = mgr.getNextQuestion(gaps);
  assertEquals(next, null);
});

Deno.test("HealthStateManager - needsProactiveNudge", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new HealthStateManager(dir, 2, 24);
  await mgr.load();

  // No active channel — should be false
  assertEquals(mgr.needsProactiveNudge(true), false);

  // Set active channel
  mgr.recordChannelActivity("slack", "C123");
  assertEquals(mgr.needsProactiveNudge(true), true);

  // No gaps — should be false
  assertEquals(mgr.needsProactiveNudge(false), false);

  // After piggyback — should be false
  mgr.recordPiggyback();
  assertEquals(mgr.needsProactiveNudge(true), false);
});

Deno.test("HealthStateManager - recordChannelActivity updates tracking", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new HealthStateManager(dir, 2, 24);
  await mgr.load();

  assertEquals(mgr.lastActiveChannel, null);
  assertEquals(mgr.lastActiveChatId, null);

  mgr.recordChannelActivity("slack", "C123");
  assertEquals(mgr.lastActiveChannel, "slack");
  assertEquals(mgr.lastActiveChatId, "C123");
});

Deno.test("HealthStateManager - state survives save/load cycle", async () => {
  const dir = await Deno.makeTempDir();
  const mgr1 = new HealthStateManager(dir, 2, 24);
  await mgr1.load();

  mgr1.recordCompletion("user.name");
  mgr1.recordChannelActivity("telegram", "12345");
  mgr1.recordQuestion("user.timezone");
  await mgr1.save();

  // Load into new manager
  const mgr2 = new HealthStateManager(dir, 2, 24);
  await mgr2.load();

  assertEquals(mgr2.canAskField("user.name"), false); // completed
  assertEquals(mgr2.lastActiveChannel, "telegram");
  assertEquals(mgr2.lastActiveChatId, "12345");
  assertEquals(mgr2.pendingQuestion, "user.timezone");
});

Deno.test("HealthStateManager - recordQuestion sets pendingQuestion", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new HealthStateManager(dir, 2, 24);
  await mgr.load();

  assertEquals(mgr.pendingQuestion, null);
  mgr.recordQuestion("user.name");
  assertEquals(mgr.pendingQuestion, "user.name");
});

Deno.test("HealthStateManager - recordSkip clears pendingQuestion", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new HealthStateManager(dir, 2, 24);
  await mgr.load();

  mgr.recordQuestion("user.name");
  assertEquals(mgr.pendingQuestion, "user.name");

  mgr.recordSkip("user.name");
  assertEquals(mgr.pendingQuestion, null);
});

Deno.test("HealthStateManager - recordCompletion clears pendingQuestion", async () => {
  const dir = await Deno.makeTempDir();
  const mgr = new HealthStateManager(dir, 2, 24);
  await mgr.load();

  mgr.recordQuestion("user.name");
  mgr.recordCompletion("user.name");
  assertEquals(mgr.pendingQuestion, null);
});
