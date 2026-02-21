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
  timezone?: string;
}

type JobCallback = (job: CronJob) => Promise<void>;

export interface CronServiceConfig {
  tickIntervalMs?: number;
  jobTimeoutMs?: number;
}

export function parseInterval(expr: string): number {
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

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function computeNextRun(schedule: CronSchedule, from: Date = new Date(), timezone?: string): Date | null {
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
        const opts: { currentDate: Date; tz?: string } = { currentDate: from };
        if (timezone) opts.tz = timezone;
        const interval = CronParser.parseExpression(schedule.expression, opts);
        return interval.next().toDate();
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

export function validateSchedule(schedule: CronSchedule, timezone?: string): string | null {
  if (timezone && !isValidTimezone(timezone)) {
    return `Invalid timezone: ${timezone}`;
  }
  switch (schedule.type) {
    case "at": {
      const d = new Date(schedule.expression);
      if (isNaN(d.getTime())) return `Invalid date: ${schedule.expression}`;
      if (d <= new Date()) return `Date is in the past: ${schedule.expression}`;
      return null;
    }
    case "every": {
      try { parseInterval(schedule.expression); return null; }
      catch { return `Invalid interval: ${schedule.expression}`; }
    }
    case "cron": {
      try { CronParser.parseExpression(schedule.expression); return null; }
      catch (e) { return `Invalid cron: ${e instanceof Error ? e.message : e}`; }
    }
    default: return `Unknown schedule type`;
  }
}

export class CronService {
  private dataDir: string;
  private jobs: Map<string, CronJob> = new Map();
  private _running = false;
  private onJob: JobCallback | null = null;
  private dirty = false;
  private tickIntervalMs: number;
  private jobTimeoutMs: number;
  private runningJobs = new Set<string>();

  constructor(dataDir: string, config?: CronServiceConfig) {
    this.dataDir = dataDir;
    this.tickIntervalMs = config?.tickIntervalMs ?? 30_000;
    this.jobTimeoutMs = config?.jobTimeoutMs ?? 300_000;
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

  async addJob(job: Omit<CronJob, "id" | "lastRun" | "nextRun">): Promise<{ job: CronJob } | { error: string }> {
    const validationError = validateSchedule(job.schedule, job.timezone);
    if (validationError) return { error: validationError };

    const id = crypto.randomUUID();
    const nextRun = computeNextRun(job.schedule, new Date(), job.timezone);
    const newJob: CronJob = {
      ...job,
      id,
      lastRun: null,
      nextRun: nextRun?.toISOString() ?? null,
    };
    this.jobs.set(id, newJob);
    this.dirty = true;
    await this.save();
    this.dirty = false;
    return { job: newJob };
  }

  removeJob(id: string): boolean {
    const deleted = this.jobs.delete(id);
    if (deleted) {
      this.dirty = true;
      this.save().catch((e) => console.error("Cron save error:", e));
    }
    return deleted;
  }

  enableJob(id: string, enabled: boolean): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.enabled = enabled;
    if (enabled && !job.nextRun) {
      const next = computeNextRun(job.schedule, undefined, job.timezone);
      job.nextRun = next?.toISOString() ?? null;
    }
    this.dirty = true;
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
      await new Promise((resolve) => setTimeout(resolve, this.tickIntervalMs));
    }
  }

  stop(): void {
    this._running = false;
  }

  private async executeJob(job: CronJob): Promise<void> {
    if (!this.onJob) return;
    this.runningJobs.add(job.id);
    job.lastRun = new Date().toISOString();
    this.dirty = true;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.onJob(job),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Job "${job.name}" timed out after ${this.jobTimeoutMs}ms`)),
            this.jobTimeoutMs,
          );
        }),
      ]);
    } catch (err) {
      console.error(`Cron job "${job.name}" error:`, err);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.runningJobs.delete(job.id);
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const dueJobs: CronJob[] = [];

    for (const job of this.jobs.values()) {
      if (!job.enabled || !job.nextRun) continue;
      if (this.runningJobs.has(job.id)) continue;
      if (new Date(job.nextRun) > now) continue;

      console.log(`Cron: firing job "${job.name}" (${job.id})`);
      dueJobs.push(job);
    }

    if (dueJobs.length === 0) return;

    // Fire all due jobs concurrently
    await Promise.allSettled(dueJobs.map((job) => this.executeJob(job)));

    // Post-execution: recompute nextRun from NOW (not stale tick-start)
    for (const job of dueJobs) {
      if (job.schedule.type === "at") {
        this.jobs.delete(job.id);
      } else {
        const next = computeNextRun(job.schedule, new Date(), job.timezone);
        job.nextRun = next?.toISOString() ?? null;
      }
    }

    if (this.dirty) {
      await this.save();
      this.dirty = false;
    }
  }
}
