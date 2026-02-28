/**
 * Shell execution tool with timeout and workspace cwd.
 */

import type { Tool } from "./base.ts";

const MAX_OUTPUT = 10_000;
const MAX_TIMEOUT_MS = 300_000; // 5 minutes absolute ceiling

const DENY_PATTERNS: RegExp[] = [
  /\brm\s+-[rf]{1,2}\b/i,
  /\bdel\s+\/[fq]\b/i,
  /\brmdir\s+\/s\b/i,
  /\b(format|mkfs|diskpart)\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd/i,
  /\b(shutdown|reboot|poweroff)\b/i,
  /:\(\)\s*\{.*\};\s*:/,
];

export class ExecTool implements Tool {
  name = "exec";
  description = "Execute a shell command in the workspace directory.";
  parameters = {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute." },
      timeout_ms: {
        type: "number",
        description: "Timeout in milliseconds (default from config).",
      },
    },
    required: ["command"],
  };

  constructor(private workspace: string, private defaultTimeoutMs = 60_000) {}

  private guardCommand(command: string): string | null {
    for (const pattern of DENY_PATTERNS) {
      if (pattern.test(command)) {
        return "Error: Command blocked by safety guard (dangerous pattern detected).";
      }
    }
    return null;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const command = String(args.command);
    const blocked = this.guardCommand(command);
    if (blocked) return blocked;

    const timeoutMs = typeof args.timeout_ms === "number"
      ? Math.min(Math.max(1000, Math.floor(args.timeout_ms)), MAX_TIMEOUT_MS)
      : this.defaultTimeoutMs;

    const cmd = new Deno.Command("sh", {
      args: ["-c", command],
      cwd: this.workspace,
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(timeoutMs),
    });

    let output: Deno.CommandOutput;
    try {
      output = await cmd.output();
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error(
          `Command timed out after ${timeoutMs / 1000}s: ${command.slice(0, 80)}`,
          { cause: err },
        );
      }
      throw err;
    }
    const { stdout, stderr } = output;

    const decoder = new TextDecoder();
    const out = decoder.decode(stdout);
    const err = decoder.decode(stderr);
    const combined = out + (err ? (out ? "\n" : "") + err : "");

    if (combined.length > MAX_OUTPUT) {
      return combined.slice(0, MAX_OUTPUT) + "\n[output truncated]";
    }
    return combined;
  }
}
