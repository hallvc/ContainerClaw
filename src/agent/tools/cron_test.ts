import { assertEquals, assertStringIncludes } from "@std/assert";
import { CronTool } from "./cron.ts";
import { CronService } from "../../cron/service.ts";

const settle = () => new Promise((r) => setTimeout(r, 50));

async function makeSvc(): Promise<[CronService, string]> {
  const tmpDir = await Deno.makeTempDir();
  return [new CronService(tmpDir), tmpDir];
}

// --- add action ---

Deno.test("CronTool - add with every_seconds creates recurring job", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    tool.setContext("telegram", "chat42");
    const result = await tool.execute({
      action: "add",
      message: "Check server health",
      every_seconds: 300,
    });
    assertStringIncludes(result, "Created job");
    const jobs = svc.listJobs();
    assertEquals(jobs.length, 1);
    assertEquals(jobs[0].schedule.type, "every");
    assertEquals(jobs[0].schedule.expression, "300s");
    assertEquals(jobs[0].channel, "telegram");
    assertEquals(jobs[0].chatId, "chat42");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - add with cron_expr creates cron job", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    tool.setContext("slack", "C100");
    const result = await tool.execute({
      action: "add",
      message: "Daily standup reminder",
      cron_expr: "0 9 * * *",
    });
    assertStringIncludes(result, "Created job");
    const jobs = svc.listJobs();
    assertEquals(jobs.length, 1);
    assertEquals(jobs[0].schedule.type, "cron");
    assertEquals(jobs[0].schedule.expression, "0 9 * * *");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - add with at creates one-time job", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    tool.setContext("slack", "C100");
    const result = await tool.execute({
      action: "add",
      message: "Meeting in 10 minutes",
      at: "2099-12-31T23:59:00",
    });
    assertStringIncludes(result, "Created job");
    const jobs = svc.listJobs();
    assertEquals(jobs.length, 1);
    assertEquals(jobs[0].schedule.type, "at");
    assertEquals(jobs[0].schedule.expression, "2099-12-31T23:59:00");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - add without message returns error", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    tool.setContext("slack", "C100");
    const result = await tool.execute({
      action: "add",
      every_seconds: 60,
    });
    assertStringIncludes(result, "Error");
    assertStringIncludes(result, "message");
    assertEquals(svc.listJobs().length, 0);
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - add without schedule params returns error", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    tool.setContext("slack", "C100");
    const result = await tool.execute({
      action: "add",
      message: "reminder",
    });
    assertStringIncludes(result, "Error");
    assertEquals(svc.listJobs().length, 0);
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - add without context returns error", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    const result = await tool.execute({
      action: "add",
      message: "reminder",
      every_seconds: 60,
    });
    assertStringIncludes(result, "Error");
    assertStringIncludes(result, "context");
    assertEquals(svc.listJobs().length, 0);
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- list action ---

Deno.test("CronTool - list with jobs returns formatted list", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    svc.addJob({
      name: "health-check",
      schedule: { type: "every", expression: "5m" },
      command: "Check health",
      channel: "slack",
      chatId: "C1",
      enabled: true,
    });
    svc.addJob({
      name: "daily-report",
      schedule: { type: "cron", expression: "0 9 * * *" },
      command: "Send report",
      channel: "slack",
      chatId: "C1",
      enabled: true,
    });
    const tool = new CronTool(svc);
    const result = await tool.execute({ action: "list" });
    assertStringIncludes(result, "health-check");
    assertStringIncludes(result, "daily-report");
    assertStringIncludes(result, "every");
    assertStringIncludes(result, "cron");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - list empty returns no jobs message", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    const result = await tool.execute({ action: "list" });
    assertStringIncludes(result, "No scheduled jobs");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- remove action ---

Deno.test("CronTool - remove with valid id removes job", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const job = svc.addJob({
      name: "to-remove",
      schedule: { type: "every", expression: "1h" },
      command: "test",
      channel: "slack",
      chatId: "C1",
      enabled: true,
    });
    const tool = new CronTool(svc);
    const result = await tool.execute({ action: "remove", job_id: job.id });
    assertStringIncludes(result, "Removed");
    assertEquals(svc.listJobs().length, 0);
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - remove without job_id returns error", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    const result = await tool.execute({ action: "remove" });
    assertStringIncludes(result, "Error");
    assertStringIncludes(result, "job_id");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - remove with invalid id returns not found", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    const result = await tool.execute({ action: "remove", job_id: "nonexistent" });
    assertStringIncludes(result, "not found");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- unknown action ---

Deno.test("CronTool - unknown action returns error", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    const result = await tool.execute({ action: "pause" });
    assertStringIncludes(result, "Unknown action");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
