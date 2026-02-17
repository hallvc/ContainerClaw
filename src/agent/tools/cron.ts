/**
 * Cron tool for scheduling reminders and recurring tasks.
 */

import type { CronService } from "../../cron/service.ts";
import type { Tool } from "./base.ts";

export class CronTool implements Tool {
  name = "cron";
  description =
    "Schedule reminders and recurring tasks. Actions: add, list, remove.";
  parameters = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "list", "remove"],
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
      job_id: {
        type: "string",
        description: "Job ID (for remove).",
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
      default:
        return `Unknown action: ${action}`;
    }
  }

  private addJob(args: Record<string, unknown>): string {
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
      schedule = { type: "every", expression: `${everySeconds}s` };
    } else if (cronExpr) {
      schedule = { type: "cron", expression: cronExpr };
    } else if (at) {
      schedule = { type: "at", expression: at };
    } else {
      return "Error: either every_seconds, cron_expr, or at is required";
    }

    const job = this.cronService.addJob({
      name: message.slice(0, 30),
      schedule,
      command: message,
      channel,
      chatId,
      enabled: true,
    });
    return `Created job '${job.name}' (id: ${job.id})`;
  }

  private listJobs(): string {
    const jobs = this.cronService.listJobs();
    if (jobs.length === 0) return "No scheduled jobs.";
    const lines = jobs.map(
      (j) => `- ${j.name} (id: ${j.id}, ${j.schedule.type})`,
    );
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
}
