/**
 * Shell execution tool with timeout and workspace cwd.
 */

import type { Tool } from "./base.ts";

const MAX_OUTPUT = 10_000;

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
        description: "Timeout in milliseconds (default 30000).",
      },
    },
    required: ["command"],
  };

  constructor(private workspace: string) {}

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
      ? args.timeout_ms
      : 30_000;

    const cmd = new Deno.Command("sh", {
      args: ["-c", command],
      cwd: this.workspace,
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(timeoutMs),
    });

    const { stdout, stderr } = await cmd.output();

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
