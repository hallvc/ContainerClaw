import { assertEquals } from "@std/assert";
import { HeartbeatService, isHeartbeatEmpty } from "./service.ts";
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
      "# Tasks\n- [ ] Check logs\n",
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
      "# Tasks\n- [ ] Check logs\n",
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
    const fileContent = "# Tasks\n- [ ] Run the deployment script\n";
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
