import { join } from "@std/path";

const HEARTBEAT_PROMPT = `Read HEARTBEAT.md in your workspace (if it exists).
Follow any instructions or tasks listed there.
If nothing needs attention, reply with just: HEARTBEAT_OK`;

const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK";

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

type HeartbeatCallback = (prompt: string) => Promise<string>;

export class HeartbeatService {
  private workspace: string;
  private intervalMs: number;
  private enabled: boolean;
  private _running = false;
  private onHeartbeat: HeartbeatCallback | null = null;

  constructor(workspace: string, intervalSeconds = 1800, enabled = true) {
    this.workspace = workspace;
    this.intervalMs = intervalSeconds * 1000;
    this.enabled = enabled;
  }

  setCallback(callback: HeartbeatCallback): void {
    this.onHeartbeat = callback;
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

  private async tick(): Promise<void> {
    const content = await this.readHeartbeatFile();

    if (isHeartbeatEmpty(content)) {
      console.log("Heartbeat: no tasks (HEARTBEAT.md empty)");
      return;
    }

    console.log("Heartbeat: checking for tasks...");

    if (this.onHeartbeat) {
      try {
        const response = await this.onHeartbeat(HEARTBEAT_PROMPT);

        if (
          response
            .replace(/_/g, "")
            .toUpperCase()
            .includes(HEARTBEAT_OK_TOKEN.replace(/_/g, ""))
        ) {
          console.log("Heartbeat: OK (no action needed)");
        } else {
          console.log("Heartbeat: completed task");
        }
      } catch (err) {
        console.error("Heartbeat execution failed:", err);
      }
    }
  }

  async triggerNow(): Promise<string | null> {
    if (this.onHeartbeat) {
      return await this.onHeartbeat(HEARTBEAT_PROMPT);
    }
    return null;
  }
}
