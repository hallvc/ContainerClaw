import { join } from "@std/path";

const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK";

export const TRIAGE_PROMPT = (content: string) =>
  `The following is the contents of HEARTBEAT.md:\n---\n${content}\n---\n` +
  `Are there any actionable tasks that need work? ` +
  `If yes, briefly describe what needs doing. ` +
  `If nothing needs attention, reply with exactly: HEARTBEAT_OK`;

export const EXECUTE_PROMPT = (assessment: string) =>
  `A heartbeat triage identified tasks in HEARTBEAT.md:\n\n${assessment}\n\n` +
  `You are running in a heartbeat context with limited processing time.\n` +
  `Read HEARTBEAT.md and complete the identified tasks.\n` +
  `After completing each task, update HEARTBEAT.md: move the task line to the "## Completed" section ` +
  `and prefix it with a timestamp (e.g. "- 2026-02-27: <task>").\n` +
  `If a task is too large to complete now, add a brief status note under it in HEARTBEAT.md and move on.`;

export interface ExecuteResult {
  executed: boolean;
  response: string | null;
}

export type HeartbeatCallbacks = {
  triage: (content: string) => Promise<string>;
  execute: (assessment: string) => Promise<string>;
  onTick?: () => Promise<void>;
  onExecuteResult?: (result: ExecuteResult) => Promise<void>;
};

export function isHeartbeatEmpty(content: string | null): boolean {
  if (!content) return true;

  const skipPatterns = new Set(["- [ ]", "* [ ]", "- [x]", "* [x]"]);

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (
      !line ||
      line.startsWith("#") ||
      line.startsWith("<!--") ||
      skipPatterns.has(line)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function isHeartbeatOk(response: string | null): boolean {
  return (response ?? "")
    .replace(/_/g, "")
    .toUpperCase()
    .includes(HEARTBEAT_OK_TOKEN.replace(/_/g, ""));
}

export class HeartbeatService {
  private workspace: string;
  private intervalMs: number;
  private enabled: boolean;
  private _running = false;
  private callbacks: HeartbeatCallbacks | null = null;

  constructor(workspace: string, intervalSeconds = 60, enabled = true) {
    this.workspace = workspace;
    this.intervalMs = intervalSeconds * 1000;
    this.enabled = enabled;
  }

  setCallbacks(callbacks: HeartbeatCallbacks): void {
    this.callbacks = callbacks;
  }

  private heartbeatFile(): string {
    return join(this.workspace, "HEARTBEAT.md");
  }

  private async readHeartbeatFile(): Promise<string | null> {
    try {
      return await Deno.readTextFile(this.heartbeatFile());
    } catch {
      return null;
    }
  }

  async run(): Promise<void> {
    if (!this.enabled) {
      console.log("Heartbeat disabled");
      return;
    }
    this._running = true;
    console.log(`Heartbeat started (every ${this.intervalMs / 1000}s)`);

    while (this._running) {
      await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
      if (this._running) {
        await this.tick();
      }
    }
  }

  stop(): void {
    this._running = false;
  }

  private async tick(): Promise<ExecuteResult> {
    // 1. Run onTick (periodic housekeeping) regardless of HEARTBEAT.md content
    if (this.callbacks?.onTick) {
      try {
        await this.callbacks.onTick();
      } catch (err) {
        console.error("Heartbeat onTick error:", err);
      }
    }

    // 2. Read HEARTBEAT.md; skip if empty
    const content = await this.readHeartbeatFile();
    if (isHeartbeatEmpty(content)) {
      console.log("Heartbeat: no tasks (HEARTBEAT.md empty)");
      return { executed: false, response: null };
    }

    if (!this.callbacks) {
      return { executed: false, response: null };
    }

    // 3. Triage with cheap model
    console.log("Heartbeat: triaging...");
    try {
      const triageResponse = await this.callbacks.triage(content!);

      if (isHeartbeatOk(triageResponse)) {
        console.log("Heartbeat: triage OK (no action needed)");
        return { executed: false, response: null };
      }

      // 4. Hand off to main agent
      console.log("Heartbeat: executing task...");
      const response = await this.callbacks.execute(triageResponse);
      console.log("Heartbeat: task executed");

      const result: ExecuteResult = { executed: true, response };

      // 5. Deliver result
      if (this.callbacks.onExecuteResult) {
        try {
          await this.callbacks.onExecuteResult(result);
        } catch (err) {
          console.error("Heartbeat onExecuteResult error:", err);
        }
      }

      return result;
    } catch (err) {
      console.error("Heartbeat execution failed:", err);
      return { executed: false, response: null };
    }
  }

  async triggerNow(): Promise<ExecuteResult> {
    if (!this.callbacks) {
      return { executed: false, response: null };
    }

    const content = await this.readHeartbeatFile();
    if (isHeartbeatEmpty(content)) {
      return { executed: false, response: null };
    }

    const triageResponse = await this.callbacks.triage(content!);
    if (isHeartbeatOk(triageResponse)) {
      return { executed: false, response: null };
    }

    const response = await this.callbacks.execute(triageResponse);
    const result: ExecuteResult = { executed: true, response };

    if (this.callbacks.onExecuteResult) {
      await this.callbacks.onExecuteResult(result);
    }

    return result;
  }
}
