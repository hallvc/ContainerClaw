/**
 * Spawn tool for creating background subagents.
 */

import type { Tool } from "./base.ts";

/** Minimal interface for the subagent manager dependency. */
export interface SpawnManager {
  spawn(
    task: string,
    label?: string,
    originChannel?: string,
    originChatId?: string,
  ): string | Promise<string>;
}

export class SpawnTool implements Tool {
  name = "spawn";
  description =
    "Spawn a subagent to handle a task in the background. " +
    "Use this for complex or time-consuming tasks that can run independently. " +
    "The subagent will complete the task and report back when done.";
  parameters = {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The task for the subagent to complete.",
      },
      label: {
        type: "string",
        description: "Optional short label for the task (for display).",
      },
    },
    required: ["task"],
  };

  private manager: SpawnManager;
  private originChannel = "cli";
  private originChatId = "direct";

  constructor(manager: SpawnManager) {
    this.manager = manager;
  }

  setContext(channel: string, chatId: string): void {
    this.originChannel = channel;
    this.originChatId = chatId;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const task = String(args.task ?? "");
    const label = args.label != null ? String(args.label) : undefined;

    return await this.manager.spawn(
      task,
      label,
      this.originChannel,
      this.originChatId,
    );
  }
}
