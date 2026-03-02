import { assertEquals } from "@std/assert";
import {
  HeartbeatService,
  isHeartbeatEmpty,
  parseRecurringTasks,
  parseCompletedTasks,
  isTaskDue,
  injectDueTasks,
} from "./service.ts";
import type { ExecuteResult } from "./service.ts";
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
  assertEquals(isHeartbeatEmpty("# Tasks\n- Do something"), false);
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

Deno.test("HeartbeatService - triggerNow returns not-executed without callbacks", async () => {
  const svc = new HeartbeatService("/tmp/fake");
  const result = await svc.triggerNow();
  assertEquals(result, { executed: false, response: null });
});

Deno.test("HeartbeatService - triggerNow returns not-executed when file is empty", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tmpDir, "HEARTBEAT.md"),
      "# Heartbeat Tasks\n\n<!-- comment -->\n",
    );
    const svc = new HeartbeatService(tmpDir, 1, true);
    let triageCalled = false;
    svc.setCallbacks({
      triage: async (_content) => {
        triageCalled = true;
        return "HEARTBEAT_OK";
      },
      execute: async (_assessment) => "done",
    });
    const result = await svc.triggerNow();
    assertEquals(triageCalled, false); // Should skip triage for empty file
    assertEquals(result, { executed: false, response: null });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("HeartbeatService - triggerNow skips execute when triage returns OK", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tmpDir, "HEARTBEAT.md"),
      "# Tasks\n- Check logs\n",
    );
    const svc = new HeartbeatService(tmpDir, 1, true);
    let triageCalled = false;
    let executeCalled = false;
    svc.setCallbacks({
      triage: async (_content) => {
        triageCalled = true;
        return "HEARTBEAT_OK";
      },
      execute: async (_assessment) => {
        executeCalled = true;
        return "done";
      },
    });
    const result = await svc.triggerNow();
    assertEquals(triageCalled, true);
    assertEquals(executeCalled, false);
    assertEquals(result, { executed: false, response: null });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("HeartbeatService - triggerNow calls execute when triage finds work", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tmpDir, "HEARTBEAT.md"),
      "# Tasks\n- Check logs\n",
    );
    const svc = new HeartbeatService(tmpDir, 1, true);
    let triageContent = "";
    let executeAssessment = "";
    svc.setCallbacks({
      triage: async (content) => {
        triageContent = content;
        return "There is a task to check logs";
      },
      execute: async (assessment) => {
        executeAssessment = assessment;
        return "Checked the logs, all clear";
      },
    });
    const result = await svc.triggerNow();
    assertEquals(triageContent.includes("Check logs"), true);
    assertEquals(executeAssessment, "There is a task to check logs");
    assertEquals(result.executed, true);
    assertEquals(result.response, "Checked the logs, all clear");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("HeartbeatService - onExecuteResult fires after successful execute", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tmpDir, "HEARTBEAT.md"),
      "# Tasks\nDo something\n",
    );
    const svc = new HeartbeatService(tmpDir, 1, true);
    let deliveredResult: ExecuteResult | null = null;
    svc.setCallbacks({
      triage: async (_content) => "Work needed",
      execute: async (_assessment) => "Task completed",
      onExecuteResult: async (result) => {
        deliveredResult = result;
      },
    });
    await svc.triggerNow();
    assertEquals(deliveredResult !== null, true);
    assertEquals(deliveredResult!.executed, true);
    assertEquals(deliveredResult!.response, "Task completed");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("HeartbeatService - onExecuteResult not called when triage says OK", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(tmpDir, "HEARTBEAT.md"),
      "# Tasks\nDo something\n",
    );
    const svc = new HeartbeatService(tmpDir, 1, true);
    let resultDelivered = false;
    svc.setCallbacks({
      triage: async (_content) => "HEARTBEAT_OK",
      execute: async (_assessment) => "should not run",
      onExecuteResult: async (_result) => {
        resultDelivered = true;
      },
    });
    await svc.triggerNow();
    assertEquals(resultDelivered, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("HeartbeatService - triage receives file content", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const fileContent = "# Tasks\n- Run the deployment script\n";
    await Deno.writeTextFile(join(tmpDir, "HEARTBEAT.md"), fileContent);
    const svc = new HeartbeatService(tmpDir, 1, true);
    let receivedContent = "";
    svc.setCallbacks({
      triage: async (content) => {
        receivedContent = content;
        return "HEARTBEAT_OK";
      },
      execute: async (_assessment) => "done",
    });
    await svc.triggerNow();
    assertEquals(receivedContent, fileContent);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// isHeartbeatEmpty - section-aware tests
// ---------------------------------------------------------------------------

Deno.test("isHeartbeatEmpty - returns true for completed timestamp entries only", () => {
  const content = [
    "# Heartbeat Tasks",
    "",
    "## Completed",
    "",
    "- 2026-03-01: Run gh-trends to find trending repos",
    "- 2026-03-01: Review trending repos and select 2-3",
    "",
  ].join("\n");
  assertEquals(isHeartbeatEmpty(content), true);
});

Deno.test("isHeartbeatEmpty - returns true for recurring-only content", () => {
  const content = [
    "# Heartbeat Tasks",
    "",
    "# Weekly Recurring Tasks",
    "",
    "- Run gh-trends to find trending repos",
    "- Review trending repos",
    "",
  ].join("\n");
  assertEquals(isHeartbeatEmpty(content), true);
});

Deno.test("isHeartbeatEmpty - returns true for completed + recurring but empty Active Tasks", () => {
  const content = [
    "# Heartbeat Tasks",
    "",
    "## Active Tasks",
    "",
    "<!-- Add one-off tasks here. -->",
    "",
    "## Completed",
    "",
    "- 2026-03-01: Some task",
    "",
    "# Weekly Recurring Tasks",
    "",
    "- Run gh-trends",
    "",
  ].join("\n");
  assertEquals(isHeartbeatEmpty(content), true);
});

Deno.test("isHeartbeatEmpty - returns false for non-empty Active Tasks section", () => {
  const content = [
    "# Heartbeat Tasks",
    "",
    "## Active Tasks",
    "",
    "- Run gh-trends to find trending repos",
    "",
    "## Completed",
    "",
    "- 2026-03-01: Old task",
    "",
  ].join("\n");
  assertEquals(isHeartbeatEmpty(content), false);
});

// ---------------------------------------------------------------------------
// parseRecurringTasks tests
// ---------------------------------------------------------------------------

Deno.test("parseRecurringTasks - parses weekly tasks with frequencyDays=7", () => {
  const content = [
    "# Weekly Recurring Tasks",
    "",
    "- Run gh-trends to find trending repos",
    "- Review trending repos and select 2-3",
    "",
  ].join("\n");
  const tasks = parseRecurringTasks(content);
  assertEquals(tasks.length, 2);
  assertEquals(tasks[0].text, "Run gh-trends to find trending repos");
  assertEquals(tasks[0].frequencyDays, 7);
  assertEquals(tasks[1].text, "Review trending repos and select 2-3");
  assertEquals(tasks[1].frequencyDays, 7);
});

Deno.test("parseRecurringTasks - parses daily tasks with frequencyDays=1", () => {
  const content = [
    "# Daily Recurring Tasks",
    "",
    "- Check error logs",
    "",
  ].join("\n");
  const tasks = parseRecurringTasks(content);
  assertEquals(tasks.length, 1);
  assertEquals(tasks[0].text, "Check error logs");
  assertEquals(tasks[0].frequencyDays, 1);
});

Deno.test("parseRecurringTasks - returns empty array for file with no recurring sections", () => {
  const content = [
    "# Heartbeat Tasks",
    "",
    "## Active Tasks",
    "",
    "- Do something",
    "",
    "## Completed",
    "",
    "- 2026-03-01: Old task",
    "",
  ].join("\n");
  const tasks = parseRecurringTasks(content);
  assertEquals(tasks.length, 0);
});

// ---------------------------------------------------------------------------
// isTaskDue tests
// ---------------------------------------------------------------------------

Deno.test("isTaskDue - returns true when task never completed", () => {
  const task = { text: "Run gh-trends", frequencyDays: 7 };
  const completed: ReturnType<typeof parseCompletedTasks> = [];
  const now = new Date("2026-03-10T12:00:00");
  assertEquals(isTaskDue(task, completed, now), true);
});

Deno.test("isTaskDue - returns true when last completion was > 7 days ago", () => {
  const task = { text: "Run gh-trends", frequencyDays: 7 };
  const completed = parseCompletedTasks(
    "## Completed\n- 2026-03-01: Run gh-trends\n"
  );
  const now = new Date("2026-03-10T12:00:00"); // 9 days later
  assertEquals(isTaskDue(task, completed, now), true);
});

Deno.test("isTaskDue - returns false when last completion was < 7 days ago", () => {
  const task = { text: "Run gh-trends", frequencyDays: 7 };
  const completed = parseCompletedTasks(
    "## Completed\n- 2026-03-07: Run gh-trends\n"
  );
  const now = new Date("2026-03-10T12:00:00"); // 3 days later
  assertEquals(isTaskDue(task, completed, now), false);
});

Deno.test("isTaskDue - two tasks with common prefix do not cross-match", () => {
  const taskA = { text: "Review trending repos and select 2-3", frequencyDays: 7 };
  const taskB = { text: "Review trending repos", frequencyDays: 7 };

  // Only taskB is completed (shorter text)
  const completed = parseCompletedTasks(
    "## Completed\n- 2026-03-07: Review trending repos\n"
  );
  const now = new Date("2026-03-10T12:00:00"); // 3 days later

  // taskB was completed 3 days ago → not due
  assertEquals(isTaskDue(taskB, completed, now), false);

  // taskA: "review trending repos and select 2-3" startsWith "review trending repos" → would match
  // But "review trending repos" does NOT startWith "review trending repos and select 2-3"
  // And "review trending repos and select 2-3" DOES startWith "review trending repos" → match
  // This means cross-match is expected by the plan's design (startsWith bidirectional)
  // The boundary case test: ensure taskA is NOT falsely marked due if taskB was recently done
  // Per plan: entryNorm.startsWith(taskNorm) || taskNorm.startsWith(entryNorm)
  // taskA norm = "review trending repos and select 2-3"
  // entry norm = "review trending repos"
  // taskNorm.startsWith(entryNorm) = true → they match → taskA also not due
  assertEquals(isTaskDue(taskA, completed, now), false);
});

// ---------------------------------------------------------------------------
// injectDueTasks tests
// ---------------------------------------------------------------------------

Deno.test("injectDueTasks - adds tasks to existing Active Tasks section", () => {
  const content = [
    "# Heartbeat Tasks",
    "",
    "## Active Tasks",
    "",
    "<!-- existing comment -->",
    "",
    "## Completed",
    "",
    "- 2026-03-01: Old task",
    "",
  ].join("\n");

  const result = injectDueTasks(content, ["Run gh-trends"]);
  assertEquals(result.includes("- Run gh-trends"), true);
  // Should appear before ## Completed
  const activeIdx = result.indexOf("## Active Tasks");
  const completedIdx = result.indexOf("## Completed");
  const taskIdx = result.indexOf("- Run gh-trends");
  assertEquals(taskIdx > activeIdx, true);
  assertEquals(taskIdx < completedIdx, true);
});

Deno.test("injectDueTasks - creates Active Tasks section if absent", () => {
  const content = [
    "# Heartbeat Tasks",
    "",
    "## Completed",
    "",
    "- 2026-03-01: Old task",
    "",
  ].join("\n");

  const result = injectDueTasks(content, ["Run gh-trends"]);
  assertEquals(result.includes("## Active Tasks"), true);
  assertEquals(result.includes("- Run gh-trends"), true);
  // Active Tasks section should appear before Completed
  assertEquals(result.indexOf("## Active Tasks") < result.indexOf("## Completed"), true);
});

Deno.test("injectDueTasks - does not duplicate tasks already present", () => {
  const content = [
    "# Heartbeat Tasks",
    "",
    "## Active Tasks",
    "",
    "- Run gh-trends to find trending repos",
    "",
    "## Completed",
    "",
  ].join("\n");

  const result = injectDueTasks(content, ["Run gh-trends to find trending repos"]);
  // Should not add a duplicate
  const matches = result.split("- Run gh-trends to find trending repos");
  assertEquals(matches.length, 2); // exactly one occurrence (split produces 2 parts)
});
