/**
 * Cron tool for scheduling reminders and recurring tasks.
 */

import type { CronService } from "../../cron/service.ts";
import type { Tool } from "./base.ts";

function normalizeInterval(seconds: number): string {
  if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export class CronTool implements Tool {
  name = "cron";
  description =
    "Schedule reminders and recurring tasks. Actions: add, list, remove, enable, disable.";
  parameters = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "list", "remove", "enable", "disable"],
        description: "Action to perform.",
      },
      message: {
        type: "string",
        description: "Reminder message (for add).",
      },
      every_seconds: {
        type: "integer",
        description: "Interval in seconds (for recurring tasks).",
      },
      cron_expr: {
        type: "string",
        description: "Cron expression like '0 9 * * *' (for scheduled tasks).",
      },
      at: {
        type: "string",
        description:
          "ISO datetime for one-time execution (e.g. '2026-02-12T10:30:00').",
      },
      mode: {
        type: "string",
        enum: ["reminder", "task"],
        description:
          "Job mode: 'reminder' sends message directly to user (default), 'task' runs message through the agent for execution.",
      },
      job_id: {
        type: "string",
        description: "Job ID (for remove, enable, disable).",
      },
      timezone: {
        type: "string",
        description:
          "IANA timezone (e.g. 'America/New_York'). Defaults to server timezone.",
      },
    },
    required: ["action"],
  };

  private defaultChannel?: string;
  private defaultChatId?: string;

  constructor(private cronService: CronService) {}

  setContext(channel: string, chatId: string): void {
    this.defaultChannel = channel;
    this.defaultChatId = chatId;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = String(args.action ?? "");
    switch (action) {
      case "add":
        return this.addJob(args);
      case "list":
        return this.listJobs();
      case "remove":
        return this.removeJob(args);
      case "enable":
        return this.toggleJob(args, true);
      case "disable":
        return this.toggleJob(args, false);
      default:
        return `Unknown action: ${action}`;
    }
  }

  private async addJob(args: Record<string, unknown>): Promise<string> {
    const message = String(args.message ?? "");
    if (!message) return "Error: message is required for add";

    const channel = this.defaultChannel ?? "";
    const chatId = this.defaultChatId ?? "";
    if (!channel || !chatId) {
      return "Error: no session context (channel/chat_id)";
    }

    const everySeconds = args.every_seconds as number | undefined;
    const cronExpr = args.cron_expr as string | undefined;
    const at = args.at as string | undefined;

    let schedule: { type: "at" | "every" | "cron"; expression: string };
    if (everySeconds) {
      schedule = { type: "every", expression: normalizeInterval(everySeconds) };
    } else if (cronExpr) {
      schedule = { type: "cron", expression: cronExpr };
    } else if (at) {
      schedule = { type: "at", expression: at };
    } else {
      return "Error: either every_seconds, cron_expr, or at is required";
    }

    const timezone = args.timezone as string | undefined;
    const mode = (args.mode as "reminder" | "task" | undefined) ?? "reminder";
    const result = await this.cronService.addJob({
      name: message.length <= 30 ? message : (message.slice(0, 30).replace(/\s+\S*$/, "") || message.slice(0, 30)),
      schedule,
      command: message,
      channel,
      chatId,
      enabled: true,
      mode,
      ...(timezone ? { timezone } : {}),
    });
    if ("error" in result) return `Error: ${result.error}`;
    return `Created job '${result.job.name}' (id: ${result.job.id})`;
  }

  private listJobs(): string {
    const jobs = this.cronService.listJobs();
    if (jobs.length === 0) return "No scheduled jobs.";
    const lines = jobs.map((j) => {
      const status = j.enabled ? "[enabled]" : "[disabled]";
      const scheduleStr = j.schedule.type === "every"
        ? `every ${j.schedule.expression}`
        : j.schedule.type === "cron"
        ? `cron ${j.schedule.expression}`
        : `at ${j.schedule.expression}`;
      const next = j.nextRun ? `next: ${j.nextRun}` : "next: none";
      const last = j.lastRun ? `last: ${j.lastRun}` : "last: never";
      const tz = j.timezone ? ` (${j.timezone})` : "";
      return `- ${j.name} (id: ${j.id}) ${status}${tz}\n  ${scheduleStr} | ${next} | ${last}`;
    });
    return "Scheduled jobs:\n" + lines.join("\n");
  }

  private removeJob(args: Record<string, unknown>): string {
    const jobId = args.job_id as string | undefined;
    if (!jobId) return "Error: job_id is required for remove";
    if (this.cronService.removeJob(jobId)) {
      return `Removed job ${jobId}`;
    }
    return `Job ${jobId} not found`;
  }

  private toggleJob(args: Record<string, unknown>, enabled: boolean): string {
    const jobId = args.job_id as string | undefined;
    if (!jobId) return `Error: job_id is required for ${enabled ? "enable" : "disable"}`;
    if (this.cronService.enableJob(jobId, enabled)) {
      return `Job ${jobId} ${enabled ? "enabled" : "disabled"}`;
    }
    return `Job ${jobId} not found`;
  }
}
