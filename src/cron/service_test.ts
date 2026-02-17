import { assertEquals } from "@std/assert";
import { CronService } from "./service.ts";

// Small delay to let fire-and-forget saves complete before cleanup
const settle = () => new Promise((r) => setTimeout(r, 50));

Deno.test("CronService - addJob and listJobs", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new CronService(tmpDir);
    const job = svc.addJob({
      name: "test-job",
      schedule: { type: "every", expression: "5m" },
      command: "echo hello",
      channel: "test",
      chatId: "chat1",
      enabled: true,
    });
    assertEquals(job.name, "test-job");
    assertEquals(job.enabled, true);

    const jobs = svc.listJobs();
    assertEquals(jobs.length, 1);
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("CronService - removeJob", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const svc = new CronService(tmpDir);
    const job = svc.addJob({
      name: "to-remove",
      schedule: { type: "every", expression: "1h" },
      command: "test",
      channel: "test",
      chatId: "chat1",
      enabled: true,
    });
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
    const job = svc.addJob({
      name: "toggle",
      schedule: { type: "every", expression: "10m" },
      command: "test",
      channel: "test",
      chatId: "chat1",
      enabled: true,
    });
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
    svc.addJob({
      name: "active",
      schedule: { type: "every", expression: "1m" },
      command: "test",
      channel: "test",
      chatId: "chat1",
      enabled: true,
    });
    svc.addJob({
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
    await settle();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
