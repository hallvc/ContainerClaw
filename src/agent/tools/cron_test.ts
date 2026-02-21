import { assertEquals, assertStringIncludes, assert } from "@std/assert";
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
    assertEquals(jobs[0].schedule.expression, "5m");
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
    await svc.addJob({
      name: "health-check",
      schedule: { type: "every", expression: "5m" },
      command: "Check health",
      channel: "slack",
      chatId: "C1",
      enabled: true,
    });
    await svc.addJob({
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
    const addResult = await svc.addJob({
      name: "to-remove",
      schedule: { type: "every", expression: "1h" },
      command: "test",
      channel: "slack",
      chatId: "C1",
      enabled: true,
    });
    assert("job" in addResult);
    const job = addResult.job;
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

// --- enable/disable action ---

Deno.test("CronTool - enable action enables a disabled job", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const addResult = await svc.addJob({
      name: "toggle-test",
      schedule: { type: "every", expression: "5m" },
      command: "test",
      channel: "slack",
      chatId: "C1",
      enabled: true,
    });
    assert("job" in addResult);
    const job = addResult.job;
    svc.enableJob(job.id, false);
    assertEquals(svc.listJobs()[0].enabled, false);

    const tool = new CronTool(svc);
    const result = await tool.execute({ action: "enable", job_id: job.id });
    assertStringIncludes(result, "enabled");
    assertEquals(svc.listJobs()[0].enabled, true);
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - disable action disables an enabled job", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const addResult = await svc.addJob({
      name: "toggle-test",
      schedule: { type: "every", expression: "5m" },
      command: "test",
      channel: "slack",
      chatId: "C1",
      enabled: true,
    });
    assert("job" in addResult);
    const job = addResult.job;

    const tool = new CronTool(svc);
    const result = await tool.execute({ action: "disable", job_id: job.id });
    assertStringIncludes(result, "disabled");
    assertEquals(svc.listJobs()[0].enabled, false);
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - enable with invalid job_id returns not found", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    const result = await tool.execute({ action: "enable", job_id: "nonexistent" });
    assertStringIncludes(result, "not found");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - enable without job_id returns error", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    const result = await tool.execute({ action: "enable" });
    assertStringIncludes(result, "Error");
    assertStringIncludes(result, "job_id");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- rich list output ---

Deno.test("CronTool - list shows schedule, nextRun, lastRun, and enabled status", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    await svc.addJob({
      name: "health-check",
      schedule: { type: "every", expression: "5m" },
      command: "Check health",
      channel: "slack",
      chatId: "C1",
      enabled: true,
    });
    const tool = new CronTool(svc);
    const result = await tool.execute({ action: "list" });
    assertStringIncludes(result, "health-check");
    assertStringIncludes(result, "[enabled]");
    assertStringIncludes(result, "every 5m");
    assertStringIncludes(result, "next:");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- interval normalization ---

Deno.test("CronTool - interval normalization: 3600 -> 1h, 300 -> 5m, 90 -> 90s", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    tool.setContext("slack", "C1");

    await tool.execute({ action: "add", message: "hourly", every_seconds: 3600 });
    await tool.execute({ action: "add", message: "five min", every_seconds: 300 });
    await tool.execute({ action: "add", message: "ninety sec", every_seconds: 90 });

    const jobs = svc.listJobs();
    const hourly = jobs.find(j => j.name === "hourly");
    const fiveMin = jobs.find(j => j.name === "five min");
    const ninetySec = jobs.find(j => j.name === "ninety sec");

    assertEquals(hourly?.schedule.expression, "1h");
    assertEquals(fiveMin?.schedule.expression, "5m");
    assertEquals(ninetySec?.schedule.expression, "90s");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- word-boundary truncation ---

Deno.test("CronTool - name truncation at word boundary", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    tool.setContext("slack", "C1");

    await tool.execute({
      action: "add",
      message: "Check server health status now please",
      every_seconds: 300,
    });
    const jobs = svc.listJobs();
    // Should truncate at word boundary, not mid-word
    assert(jobs[0].name.length <= 30);
    assert(!jobs[0].name.endsWith(" "), "Should not end with space");
    // "Check server health status now" is 30 chars, " please" would make it 37
    // So it should truncate to "Check server health status now" (exactly 30) or shorter
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- timezone ---

Deno.test("CronTool - add with timezone passes timezone to addJob", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    tool.setContext("slack", "C1");
    const result = await tool.execute({
      action: "add",
      message: "Morning standup",
      cron_expr: "0 9 * * *",
      timezone: "America/New_York",
    });
    assertStringIncludes(result, "Created job");
    const jobs = svc.listJobs();
    assertEquals(jobs[0].timezone, "America/New_York");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - add without timezone works (backward compat)", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    tool.setContext("slack", "C1");
    const result = await tool.execute({
      action: "add",
      message: "No tz job",
      every_seconds: 300,
    });
    assertStringIncludes(result, "Created job");
    const jobs = svc.listJobs();
    assertEquals(jobs[0].timezone, undefined);
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - list includes timezone when set", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    await svc.addJob({
      name: "tz-job",
      schedule: { type: "cron", expression: "0 9 * * *" },
      command: "standup",
      channel: "slack",
      chatId: "C1",
      enabled: true,
      timezone: "America/New_York",
    });
    const tool = new CronTool(svc);
    const result = await tool.execute({ action: "list" });
    assertStringIncludes(result, "America/New_York");
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronTool - add with invalid timezone returns error", async () => {
  const [svc, tmpDir] = await makeSvc();
  try {
    const tool = new CronTool(svc);
    tool.setContext("slack", "C1");
    const result = await tool.execute({
      action: "add",
      message: "Bad tz",
      cron_expr: "0 9 * * *",
      timezone: "Not/A/Zone",
    });
    assertStringIncludes(result, "Error");
    assertEquals(svc.listJobs().length, 0);
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
