import { join } from "@std/path";

const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK";

export const TRIAGE_PROMPT = (content: string) =>
  `The following is the contents of HEARTBEAT.md:\n---\n${content}\n---\n` +
  `Are there any actionable tasks in the "## Active Tasks" section that need work?\n` +
  `IMPORTANT:\n` +
  `- Only the "## Active Tasks" section contains actionable work.\n` +
  `- Items in "## Completed" are already done — ignore them entirely.\n` +
  `- Items in sections with "Recurring" in the name are templates — ignore them.\n` +
  `If there are actionable tasks in ## Active Tasks, briefly describe what needs doing.\n` +
  `If ## Active Tasks is empty or absent, reply with exactly: HEARTBEAT_OK`;

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

  let inSkippedSection = false;

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#")) {
      const heading = line.replace(/^#+\s*/, "").toLowerCase();
      inSkippedSection =
        heading === "completed" ||
        heading.startsWith("completed ") ||
        heading.includes("recurring");
      continue;
    }

    if (inSkippedSection) continue;
    if (line.startsWith("<!--")) continue;
    // Skip checkbox lines (bare placeholders or real checkbox items)
    if (line.startsWith("- [ ]") || line.startsWith("* [ ]") ||
        line.startsWith("- [x]") || line.startsWith("* [x]")) continue;

    return false; // Non-empty active content found
  }
  return true;
}

function isHeartbeatOk(response: string | null): boolean {
  return (response ?? "")
    .replace(/_/g, "")
    .toUpperCase()
    .includes(HEARTBEAT_OK_TOKEN.replace(/_/g, ""));
}

export interface RecurringTask {
  text: string;
  frequencyDays: number;
}

export interface CompletedEntry {
  date: Date;
  text: string;
}

export function parseRecurringTasks(content: string): RecurringTask[] {
  const tasks: RecurringTask[] = [];
  let frequencyDays = 0;

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#")) {
      const heading = line.replace(/^#+\s*/, "").toLowerCase();
      if (heading.includes("recurring")) {
        if (heading.includes("daily")) frequencyDays = 1;
        else if (heading.includes("weekly")) frequencyDays = 7;
        else if (heading.includes("monthly")) frequencyDays = 30;
        else frequencyDays = 7; // default to weekly
      } else {
        frequencyDays = 0; // not a recurring section
      }
      continue;
    }

    if (frequencyDays > 0 && (line.startsWith("- ") || line.startsWith("* "))) {
      const text = line.slice(2).trim();
      if (text && !text.startsWith("[")) { // skip checkbox items
        tasks.push({ text, frequencyDays });
      }
    }
  }

  return tasks;
}

export function parseCompletedTasks(content: string): CompletedEntry[] {
  const entries: CompletedEntry[] = [];
  let inCompleted = false;

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#")) {
      const heading = line.replace(/^#+\s*/, "").toLowerCase();
      inCompleted = heading === "completed" || heading.startsWith("completed ");
      continue;
    }

    if (!inCompleted) continue;

    // Match: "- 2026-03-01: task text"
    const match = line.match(/^[-*]\s+(\d{4}-\d{2}-\d{2}):\s+(.+)$/);
    if (match) {
      const date = new Date(match[1] + "T00:00:00");
      if (!isNaN(date.getTime())) {
        entries.push({ date, text: match[2].trim() });
      }
    }
  }

  return entries;
}

export function isTaskDue(
  task: RecurringTask,
  completed: CompletedEntry[],
  now: Date
): boolean {
  const normalize = (t: string) =>
    t.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  const taskNorm = normalize(task.text);

  // Match: completed text must start with the recurring task text (handles appended notes)
  // This avoids false positives when two tasks share a common prefix.
  const matches = completed.filter((e) => {
    const entryNorm = normalize(e.text);
    return entryNorm.startsWith(taskNorm) || taskNorm.startsWith(entryNorm);
  });

  if (matches.length === 0) return true; // Never completed → due

  const mostRecent = matches.reduce((a, b) => (a.date > b.date ? a : b));
  const daysSince = (now.getTime() - mostRecent.date.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= task.frequencyDays;
}

export function injectDueTasks(content: string, tasksToAdd: string[]): string {
  if (tasksToAdd.length === 0) return content;

  const lines = content.split("\n");
  const insertLines = tasksToAdd.map((t) => `- ${t}`);

  // Find ## Active Tasks section
  const activeSectionIdx = lines.findIndex((l) => {
    const t = l.trim().replace(/^#+\s*/, "").toLowerCase();
    return t === "active tasks" || t === "active";
  });

  if (activeSectionIdx === -1) {
    // No Active Tasks section — insert one before ## Completed
    const completedIdx = lines.findIndex((l) => {
      const t = l.trim().replace(/^#+\s*/, "").toLowerCase();
      return t === "completed" || t.startsWith("completed ");
    });
    const insertAt = completedIdx === -1 ? lines.length : completedIdx;
    lines.splice(insertAt, 0, "## Active Tasks", "", ...insertLines, "");
    return lines.join("\n");
  }

  // Find end of Active Tasks section (next heading or EOF)
  let endIdx = lines.length;
  for (let i = activeSectionIdx + 1; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("#")) {
      endIdx = i;
      break;
    }
  }

  // Check which tasks are already present to avoid duplicates
  const existingSection = lines.slice(activeSectionIdx, endIdx).join("\n").toLowerCase();
  const newTasks = insertLines.filter((t) => {
    const normalized = t.slice(2).toLowerCase().slice(0, 40);
    return !existingSection.includes(normalized);
  });

  if (newTasks.length === 0) return content;

  // Insert before the end of the section (last non-empty line)
  let insertAt = endIdx;
  while (insertAt > activeSectionIdx + 1 && !lines[insertAt - 1].trim()) {
    insertAt--;
  }

  lines.splice(insertAt, 0, ...newTasks);
  return lines.join("\n");
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

  private async maybeInjectRecurringTasks(content: string, now: Date): Promise<string> {
    const recurring = parseRecurringTasks(content);
    if (recurring.length === 0) return content;

    const completed = parseCompletedTasks(content);
    const due = recurring.filter((t) => isTaskDue(t, completed, now)).map((t) => t.text);

    if (due.length === 0) return content;

    const updated = injectDueTasks(content, due);
    await Deno.writeTextFile(this.heartbeatFile(), updated);
    console.log(`Heartbeat: injected ${due.length} recurring task(s): ${due.map((t) => t.slice(0, 30)).join(", ")}`);
    return updated;
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

    // 2. Read HEARTBEAT.md; inject recurring tasks; skip if empty
    let content = await this.readHeartbeatFile();
    content = await this.maybeInjectRecurringTasks(content ?? "", new Date());
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

    let content = await this.readHeartbeatFile();
    content = await this.maybeInjectRecurringTasks(content ?? "", new Date());
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
