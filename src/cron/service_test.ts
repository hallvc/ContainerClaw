import { assertEquals, assert } from "@std/assert";
import { CronService, validateSchedule } from "./service.ts";

// Small delay to let fire-and-forget saves complete before cleanup
const settle = () => new Promise((r) => setTimeout(r, 50));

Deno.test("CronService - addJob and listJobs", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new CronService(tmpDir);
    const result = await svc.addJob({
      name: "test-job",
      schedule: { type: "every", expression: "5m" },
      command: "echo hello",
      channel: "test",
      chatId: "chat1",
      enabled: true,
    });
    assert("job" in result);
    const job = result.job;
    assertEquals(job.name, "test-job");
    assertEquals(job.enabled, true);

    const jobs = svc.listJobs();
    assertEquals(jobs.length, 1);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronService - removeJob", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new CronService(tmpDir);
    const result = await svc.addJob({
      name: "to-remove",
      schedule: { type: "every", expression: "1h" },
      command: "test",
      channel: "test",
      chatId: "chat1",
      enabled: true,
    });
    assert("job" in result);
    const job = result.job;
    assertEquals(svc.listJobs().length, 1);
    svc.removeJob(job.id);
    assertEquals(svc.listJobs().length, 0);
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronService - enableJob toggles", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new CronService(tmpDir);
    const result = await svc.addJob({
      name: "toggle",
      schedule: { type: "every", expression: "10m" },
      command: "test",
      channel: "test",
      chatId: "chat1",
      enabled: true,
    });
    assert("job" in result);
    const job = result.job;
    assertEquals(svc.listJobs()[0].enabled, true);
    svc.enableJob(job.id, false);
    assertEquals(svc.listJobs()[0].enabled, false);
    svc.enableJob(job.id, true);
    assertEquals(svc.listJobs()[0].enabled, true);
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronService - status", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new CronService(tmpDir);
    await svc.addJob({
      name: "active",
      schedule: { type: "every", expression: "1m" },
      command: "test",
      channel: "test",
      chatId: "chat1",
      enabled: true,
    });
    await svc.addJob({
      name: "disabled",
      schedule: { type: "every", expression: "1m" },
      command: "test",
      channel: "test",
      chatId: "chat1",
      enabled: false,
    });
    const st = svc.status();
    assertEquals(st.jobCount, 2);
    assertEquals(st.enabledCount, 1);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- Phase 1: Config + Dirty Flag ---

Deno.test("CronService - constructor accepts optional config", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new CronService(tmpDir, { tickIntervalMs: 5000, jobTimeoutMs: 60_000 });
    // Should construct without error and be functional
    const jobs = svc.listJobs();
    assertEquals(jobs.length, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronService - constructor uses defaults without config", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    // Backward compat: single arg still works
    const svc = new CronService(tmpDir);
    const jobs = svc.listJobs();
    assertEquals(jobs.length, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- Phase 2: Concurrent Execution + Overlap Protection + Timeout ---

// Helper: write a jobs.json file with jobs that have past nextRun
async function writeJobs(tmpDir: string, jobs: Record<string, unknown>[]) {
  const dir = `${tmpDir}/cron`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/jobs.json`, JSON.stringify(jobs));
}

Deno.test("CronService - concurrent execution: two due jobs fire concurrently", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    await writeJobs(tmpDir, [
      { id: "j1", name: "job1", schedule: { type: "every", expression: "1h" }, command: "t", channel: "c", chatId: "c1", enabled: true, lastRun: null, nextRun: pastDate },
      { id: "j2", name: "job2", schedule: { type: "every", expression: "1h" }, command: "t", channel: "c", chatId: "c1", enabled: true, lastRun: null, nextRun: pastDate },
    ]);

    const svc = new CronService(tmpDir, { tickIntervalMs: 100, jobTimeoutMs: 5000 });
    const timestamps: { id: string; start: number; end: number }[] = [];

    svc.setCallback(async (job) => {
      const start = Date.now();
      await new Promise((r) => setTimeout(r, 100));
      timestamps.push({ id: job.id, start, end: Date.now() });
    });

    // Run one tick cycle then stop
    await svc.load();
    const runPromise = svc.run();
    await new Promise((r) => setTimeout(r, 400));
    svc.stop();
    await runPromise;

    assertEquals(timestamps.length, 2);
    // Both should have started before either ended (concurrent)
    const [t1, t2] = timestamps;
    assert(t1.start < t2.end && t2.start < t1.end, "Jobs should overlap in time (concurrent execution)");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronService - overlap protection: running job is skipped on next tick", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    await writeJobs(tmpDir, [
      { id: "j1", name: "slow-job", schedule: { type: "every", expression: "1s" }, command: "t", channel: "c", chatId: "c1", enabled: true, lastRun: null, nextRun: pastDate },
    ]);

    const svc = new CronService(tmpDir, { tickIntervalMs: 50, jobTimeoutMs: 5000 });
    let callCount = 0;

    svc.setCallback(async () => {
      callCount++;
      // Hang for longer than 2 tick intervals
      await new Promise((r) => setTimeout(r, 300));
    });

    await svc.load();
    const runPromise = svc.run();
    // Wait for ~3 tick intervals — should only invoke callback once due to overlap protection
    await new Promise((r) => setTimeout(r, 250));
    svc.stop();
    await runPromise;

    assertEquals(callCount, 1, "Job should only be invoked once due to overlap protection");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test({ name: "CronService - timeout: hanging job is terminated after jobTimeoutMs", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    await writeJobs(tmpDir, [
      { id: "j1", name: "hang-job", schedule: { type: "every", expression: "1h" }, command: "t", channel: "c", chatId: "c1", enabled: true, lastRun: null, nextRun: pastDate },
    ]);

    const svc = new CronService(tmpDir, { tickIntervalMs: 50, jobTimeoutMs: 100 });
    let callbackStarted = false;

    svc.setCallback(async () => {
      callbackStarted = true;
      // Hang forever (well, longer than timeout)
      await new Promise((r) => setTimeout(r, 10_000));
    });

    await svc.load();
    const runPromise = svc.run();
    // Wait enough for tick + timeout + next tick
    await new Promise((r) => setTimeout(r, 400));
    svc.stop();
    await runPromise;

    assert(callbackStarted, "Callback should have been invoked");
    // Job should have lastRun set and nextRun recomputed
    const jobs = svc.listJobs();
    assertEquals(jobs.length, 1);
    assert(jobs[0].lastRun !== null, "lastRun should be set after timeout");
    assert(jobs[0].nextRun !== null, "nextRun should be recomputed after timeout");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}});

// --- Phase 3: Validation + Async addJob ---

Deno.test("CronService - validateSchedule accepts valid every expressions", () => {
  assertEquals(validateSchedule({ type: "every", expression: "5m" }), null);
  assertEquals(validateSchedule({ type: "every", expression: "2h" }), null);
  assertEquals(validateSchedule({ type: "every", expression: "30s" }), null);
  assertEquals(validateSchedule({ type: "every", expression: "1d" }), null);
});

Deno.test("CronService - validateSchedule rejects invalid every expressions", () => {
  assert(validateSchedule({ type: "every", expression: "5x" }) !== null);
  assert(validateSchedule({ type: "every", expression: "abc" }) !== null);
  assert(validateSchedule({ type: "every", expression: "" }) !== null);
});

Deno.test("CronService - validateSchedule accepts valid cron expressions", () => {
  assertEquals(validateSchedule({ type: "cron", expression: "0 9 * * *" }), null);
  assertEquals(validateSchedule({ type: "cron", expression: "*/5 * * * *" }), null);
});

Deno.test("CronService - validateSchedule rejects invalid cron expressions", () => {
  assert(validateSchedule({ type: "cron", expression: "not a cron" }) !== null);
  assert(validateSchedule({ type: "cron", expression: "60 * * * *" }) !== null);
});

Deno.test("CronService - validateSchedule accepts valid at dates", () => {
  assertEquals(validateSchedule({ type: "at", expression: "2099-12-31T23:59:00" }), null);
});

Deno.test("CronService - validateSchedule rejects past at dates", () => {
  assert(validateSchedule({ type: "at", expression: "2000-01-01T00:00:00" }) !== null);
});

Deno.test("CronService - validateSchedule rejects invalid at dates", () => {
  assert(validateSchedule({ type: "at", expression: "not-a-date" }) !== null);
});

Deno.test("CronService - async addJob returns { job } for valid schedule", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new CronService(tmpDir);
    const result = await svc.addJob({
      name: "test",
      schedule: { type: "every", expression: "5m" },
      command: "test",
      channel: "test",
      chatId: "chat1",
      enabled: true,
    });
    assert("job" in result);
    assertEquals(result.job.name, "test");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronService - async addJob returns { error } for invalid schedule", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new CronService(tmpDir);
    const result = await svc.addJob({
      name: "test",
      schedule: { type: "cron", expression: "not valid" },
      command: "test",
      channel: "test",
      chatId: "chat1",
      enabled: true,
    });
    assert("error" in result);
    assertEquals(svc.listJobs().length, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- Phase 5: Timezone Support ---

Deno.test("CronService - CronJob with timezone serializes and deserializes", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new CronService(tmpDir);
    const result = await svc.addJob({
      name: "tz-job",
      schedule: { type: "cron", expression: "0 9 * * *" },
      command: "test",
      channel: "test",
      chatId: "c1",
      enabled: true,
      timezone: "America/New_York",
    });
    assert("job" in result);
    assertEquals(result.job.timezone, "America/New_York");

    // Save and reload
    await svc.save();
    const svc2 = new CronService(tmpDir);
    await svc2.load();
    const jobs = svc2.listJobs();
    assertEquals(jobs.length, 1);
    assertEquals(jobs[0].timezone, "America/New_York");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronService - job without timezone still works", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new CronService(tmpDir);
    const result = await svc.addJob({
      name: "no-tz",
      schedule: { type: "every", expression: "5m" },
      command: "test",
      channel: "test",
      chatId: "c1",
      enabled: true,
    });
    assert("job" in result);
    assertEquals(result.job.timezone, undefined);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronService - validateSchedule rejects invalid timezone", () => {
  assertEquals(
    validateSchedule({ type: "cron", expression: "0 9 * * *" }, "Not/A/Zone") !== null,
    true,
  );
});

Deno.test("CronService - validateSchedule accepts valid timezone", () => {
  assertEquals(validateSchedule({ type: "cron", expression: "0 9 * * *" }, "America/New_York"), null);
  assertEquals(validateSchedule({ type: "cron", expression: "0 9 * * *" }, "UTC"), null);
  assertEquals(validateSchedule({ type: "cron", expression: "0 9 * * *" }, "Europe/London"), null);
});

Deno.test("CronService - validateSchedule without timezone still works", () => {
  assertEquals(validateSchedule({ type: "every", expression: "5m" }), null);
});

Deno.test("CronService - computeNextRun passes tz to cron-parser", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new CronService(tmpDir);
    const result = await svc.addJob({
      name: "tz-cron",
      schedule: { type: "cron", expression: "0 9 * * *" },
      command: "test",
      channel: "test",
      chatId: "c1",
      enabled: true,
      timezone: "America/New_York",
    });
    assert("job" in result);
    // nextRun should be set (cron-parser should handle the timezone)
    assert(result.job.nextRun !== null, "nextRun should be computed with timezone");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
