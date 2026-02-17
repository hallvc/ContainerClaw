import { join } from "@std/path";
import CronParser from "cron-parser";

export interface CronSchedule {
  type: "at" | "every" | "cron";
  expression: string; // ISO date for "at", duration like "5m" for "every", cron expr for "cron"
}

export interface CronJob {
  id: string;
  name: string;
  schedule: CronSchedule;
  command: string;
  channel: string;
  chatId: string;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
}

type JobCallback = (job: CronJob) => Promise<void>;

function parseInterval(expr: string): number {
  const match = expr.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid interval: ${expr}`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 3600 * 1000;
    case "d": return value * 86400 * 1000;
    default: throw new Error(`Unknown unit: ${unit}`);
  }
}

function computeNextRun(schedule: CronSchedule, from: Date = new Date()): Date | null {
  switch (schedule.type) {
    case "at": {
      const target = new Date(schedule.expression);
      return target > from ? target : null;
    }
    case "every": {
      const intervalMs = parseInterval(schedule.expression);
      return new Date(from.getTime() + intervalMs);
    }
    case "cron": {
      try {
        const interval = CronParser.parseExpression(schedule.expression, {
          currentDate: from,
        });
        return interval.next().toDate();
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

export class CronService {
  private dataDir: string;
  private jobs: Map<string, CronJob> = new Map();
  private _running = false;
  private onJob: JobCallback | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  setCallback(callback: JobCallback): void {
    this.onJob = callback;
  }

  private jobsPath(): string {
    return join(this.dataDir, "cron", "jobs.json");
  }

  async load(): Promise<void> {
    try {
      const text = await Deno.readTextFile(this.jobsPath());
      const data = JSON.parse(text) as CronJob[];
      this.jobs.clear();
      for (const job of data) {
        this.jobs.set(job.id, job);
      }
    } catch {
      // No jobs file yet
    }
  }

  async save(): Promise<void> {
    const dir = join(this.dataDir, "cron");
    await Deno.mkdir(dir, { recursive: true });
    const data = Array.from(this.jobs.values());
    await Deno.writeTextFile(this.jobsPath(), JSON.stringify(data, null, 2));
  }

  addJob(job: Omit<CronJob, "id" | "lastRun" | "nextRun">): CronJob {
    const id = crypto.randomUUID();
    const nextRun = computeNextRun(job.schedule);
    const newJob: CronJob = {
      ...job,
      id,
      lastRun: null,
      nextRun: nextRun?.toISOString() ?? null,
    };
    this.jobs.set(id, newJob);
    this.save().catch((e) => console.error("Cron save error:", e));
    return newJob;
  }

  removeJob(id: string): boolean {
    const deleted = this.jobs.delete(id);
    if (deleted) this.save().catch((e) => console.error("Cron save error:", e));
    return deleted;
  }

  enableJob(id: string, enabled: boolean): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.enabled = enabled;
    if (enabled && !job.nextRun) {
      const next = computeNextRun(job.schedule);
      job.nextRun = next?.toISOString() ?? null;
    }
    this.save().catch((e) => console.error("Cron save error:", e));
    return true;
  }

  listJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  status(): { running: boolean; jobCount: number; enabledCount: number } {
    const jobs = this.listJobs();
    return {
      running: this._running,
      jobCount: jobs.length,
      enabledCount: jobs.filter((j) => j.enabled).length,
    };
  }

  async run(): Promise<void> {
    await this.load();
    this._running = true;
    console.log(`Cron service started with ${this.jobs.size} jobs`);

    while (this._running) {
      await this.tick();
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }

  stop(): void {
    this._running = false;
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const toDelete: string[] = [];

    for (const job of this.jobs.values()) {
      if (!job.enabled || !job.nextRun) continue;

      const nextRun = new Date(job.nextRun);
      if (nextRun > now) continue;

      // Job is due
      console.log(`Cron: firing job "${job.name}" (${job.id})`);
      job.lastRun = now.toISOString();

      try {
        if (this.onJob) {
          await this.onJob(job);
        }
      } catch (err) {
        console.error(`Cron job "${job.name}" error:`, err);
      }

      // Compute next run or mark for deletion
      if (job.schedule.type === "at") {
        toDelete.push(job.id);
      } else {
        const next = computeNextRun(job.schedule, now);
        job.nextRun = next?.toISOString() ?? null;
      }
    }

    // Remove one-shot jobs
    for (const id of toDelete) {
      this.jobs.delete(id);
    }

    if (toDelete.length > 0 || this.jobs.size > 0) {
      await this.save();
    }
  }
}
